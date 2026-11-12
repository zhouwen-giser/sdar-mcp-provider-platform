#include "ros2_zmq_server_sl/eo/controller.hpp"
#include "ros2_zmq_server_sl/eo/ros_hardware.hpp"
#include "ros2_zmq_server_sl/eo/v2_hardware.hpp"
#include "ros2_zmq_server_sl/eo/transport.hpp"
#include <fstream>
#include "ros2_zmq_server_sl/execution_heartbeat.hpp"
#include "ros2_zmq_server_sl/runtime_admission.hpp"
#include <iostream>
#include <memory>
#include <isr_ros2_msgs/srv/get_zmq_eo_receipt_v2.hpp>
#include <isr_ros2_msgs/srv/zmq_eo_task_control_v2.hpp>
#include <isr_ros2_msgs/srv/zmq_eo_scan_v2.hpp>
#include <isr_ros2_msgs/srv/zmq_eo_manual_v2.hpp>

namespace sl::eo
{
class Server : public rclcpp::Node
{
public:
  Server()
  : Node("eo_zmq_server")
  {
    auto & config=config_;
    std::ifstream random("/proc/sys/kernel/random/uuid");
    std::getline(random, config.session);
    if (config.session.empty()) {
      throw std::runtime_error("could not generate unique EO session identifiers");
    }
    // Short enough for task/frame/target IDs to remain within the protocol's 64 byte limit.
    rcl_interfaces::msg::ParameterDescriptor startup_only;
    startup_only.read_only=true;
    const bool use_v2 = declare_parameter("use_v2", false, startup_only);
    if (use_v2) {hardware_ = std::make_unique<V2Hardware>(*this, config);}
    else {hardware_ = std::make_unique<RosHardware>(*this, config);}
    controller_ = std::make_unique<Controller>(config, *hardware_);
    admission_=std::make_unique<sl::RuntimeAdmission>(*this,"eo:" + (use_v2 ? get_parameter("entity_id").as_string() : std::string("ugv")));
    controller_->runtime_admitted=[this] {return admission_->allows();};
    hardware_->attach(*controller_);
    device_ = config.device;
    instance_=config.session;
    if (use_v2) {
      map_projection_=std::make_unique<ScanPlan>(config_);
      const auto entity=get_parameter("entity_id").as_string();
      observation_=create_publisher<isr_ros2_msgs::msg::ZmqEoStateV2>("/"+entity+"/zmq_eo/state_v2",10);
      reports_=create_publisher<isr_ros2_msgs::msg::ZmqEoReportV2>("/"+entity+"/zmq_eo/reports_v2",10);
      auto * adapter=static_cast<V2Hardware *>(hardware_.get());
      observation_timer_=create_wall_timer(std::chrono::milliseconds(100),[this,adapter] {
          auto message=adapter->state();message.sequence=++observation_sequence_;observation_->publish(message);
        });
      receipts_=create_service<Receipt>("/"+entity+"/zmq_eo/receipt_v2",
        [this](const std::shared_ptr<Receipt::Request> request,std::shared_ptr<Receipt::Response> response) {
          fill_receipt(request->request_id,request->simulation_epoch,request->controller_instance_id,*response);
        });
      controls_=create_service<TaskControl>("/"+entity+"/zmq_eo/task_control_v2",
        [this](const std::shared_ptr<TaskControl::Request> request,std::shared_ptr<TaskControl::Response> response) {
          try {
            if (request->operation<TaskControl::Request::START || request->operation>TaskControl::Request::STOP) {
              throw Error("INVALID_ARGUMENT","Task operation must be START/PAUSE/RESUME/STOP");
            }
            const char * actions[]={"start","pause","resume","stop"};
            const Json wire={{"protocol","2.3"},{"kind","request"},{"device_id",device_},
              {"request_id",request->request_id},{"method","TaskControl"},
              {"params",{{"task_id",request->task_id},{"action",actions[request->operation-1]}}}};
            submit_original(*request,*response,wire,request->task_id);
          } catch (const Error & error) {refuse(*request,*response,error);}
        });
      manual_=create_service<Manual>("/"+entity+"/zmq_eo/manual_v2",
        [this](const std::shared_ptr<Manual::Request> request,std::shared_ptr<Manual::Response> response) {
          try {
            const bool position=request->operation==Manual::Request::POSITION;
            const bool velocity=request->operation==Manual::Request::VELOCITY;
            if (!position && !velocity && request->operation!=Manual::Request::STOP) {
              throw Error("INVALID_ARGUMENT","Manual operation must be POSITION/VELOCITY/STOP");
            }
            if ((!position && (request->yaw_rad!=0 || request->pitch_rad!=0 || request->move_timeout_ms!=0))
                || (!velocity && (request->yaw_rate_rad_s!=0 || request->pitch_rate_rad_s!=0 || request->hold_ms!=0))) {
              throw Error("INVALID_ARGUMENT","Unused manual fields must be zero");
            }
            Json params={{"action",position ? "position" : velocity ? "velocity" : "stop"}};
            if (position) {params.update({{"yaw_rad",request->yaw_rad},{"pitch_rad",request->pitch_rad},
                {"move_timeout_ms",request->move_timeout_ms}});}
            if (velocity) {params.update({{"yaw_rate_rad_s",request->yaw_rate_rad_s},{"pitch_rate_rad_s",request->pitch_rate_rad_s},
                {"hold_ms",request->hold_ms}});}
            submit_original(*request,*response,Json{{"protocol","2.3"},{"kind","request"},{"device_id",device_},
              {"request_id",request->request_id},{"method","TeleControl"},{"params",params}});
          } catch (const Error & error) {refuse(*request,*response,error);}
        });
      scans_=create_service<Scan>("/"+entity+"/zmq_eo/scan_v2",
        [this](const std::shared_ptr<Scan::Request> request,std::shared_ptr<Scan::Response> response) {
          try {
            Json params={{"task_timeout_ms",request->task_timeout_ms},
              {"search_strategy",request->track_targets ? "track" : "recognize"}};
            if (!request->target_entity_id.empty()) {params["target_entity_id"]=request->target_entity_id;}
            std::string method;
            if (request->scan_kind==Scan::Request::AREA) {
              if (request->yaw_center_rad!=0 || request->yaw_span_rad!=0 || request->pitch_rad!=0
                  || request->yaw_speed_rad_s!=0 || request->cycle_count!=0) {
                throw Error("INVALID_ARGUMENT","AREA requires unused sweep fields to be zero");
              }
              method="AreaSearch";params["region_wgs84"]=Json::array();
              for (const auto & p : request->region_map) {
                const auto geo=map_projection_->geographic({p.x,p.y,p.z});
                params["region_wgs84"].push_back({{"longitude_deg",geo.x},{"latitude_deg",geo.y},{"ellipsoid_height_m",geo.z}});
              }
            } else {
              if (request->scan_kind!=Scan::Request::SECTOR && request->scan_kind!=Scan::Request::CIRCULAR) {
                throw Error("INVALID_ARGUMENT","Scan kind must be AREA/SECTOR/CIRCULAR");
              }
              for (const auto & p : request->region_map) {
                if (p.x!=0 || p.y!=0 || p.z!=0) {throw Error("INVALID_ARGUMENT","Sweep requires unused map corners to be zero");}
              }
              const bool circular=request->scan_kind==Scan::Request::CIRCULAR;
              if (circular && (request->yaw_center_rad!=0 || request->yaw_span_rad!=0)) {
                throw Error("INVALID_ARGUMENT","CIRCULAR requires zero center/span");
              }
              method="CircularSearch";
              params.update({{"scan_mode",circular ? "circular" : "sector"},
                {"yaw_center_rad",circular ? Json(nullptr) : Json(request->yaw_center_rad)},
                {"yaw_span_rad",circular ? Json(nullptr) : Json(request->yaw_span_rad)},
                {"pitch_rad",request->pitch_rad},{"yaw_speed_rad_s",request->yaw_speed_rad_s},{"cycle_count",request->cycle_count}});
            }
            submit_original(*request,*response,Json{{"protocol","2.3"},{"kind","request"},{"device_id",device_},
              {"request_id",request->request_id},{"method",method},{"params",params}});
          } catch (const Error & error) {refuse(*request,*response,error);}
        });
    }
    visualization_ = create_publisher<std_msgs::msg::String>("/eo/task_status", 10);
    targets_ = create_publisher<std_msgs::msg::String>("/eo/targetlist", 10);
    tracks_ = create_publisher<std_msgs::msg::String>("/eo/tracklist", 10);
    transport_ = std::make_unique<Transport>(
      declare_parameter<std::string>(
        "command_address",
        "tcp://0.0.0.0:5555"),
      declare_parameter<std::string>("status_address", "tcp://0.0.0.0:5556"));
    if (use_v2) {
      const auto cache_mib=declare_parameter<int>("frame_cache_mib",512,startup_only);
      if (cache_mib<1 || cache_mib>4096) {throw std::invalid_argument("frame_cache_mib must be 1..4096");}
      frames_=std::make_unique<Frames>(device_,
        declare_parameter<std::string>("frame_pull_address","tcp://0.0.0.0:5559",startup_only),
        std::size_t(cache_mib)*1024*1024);
      static_cast<V2Hardware *>(hardware_.get())->attach_frames(*frames_,
        [this](const Json & metadata) {publish("frame_header",metadata);});
    }
    heartbeat_=std::make_unique<ExecutionHeartbeat>(*this,"zmq_eo");
    timer_ = create_wall_timer(
      std::chrono::milliseconds(10), [this] {
        if (frames_) {frames_->check();}
        const auto now = monotonic_ms();
        controller_->tick(now);
        hardware_->refresh();
        // Bound request processing so command floods cannot starve lease/deadline supervision.
        for (int i = 0; i < 16; ++i) {
          auto wire = transport_->receive();
          if (!wire) {
            break;
          }
          RCLCPP_INFO(get_logger(), "EO ZMQ request: %s", wire->c_str());
          const auto reply = controller_->request(*wire, monotonic_ms(), hardware_->simulation_epoch());
          transport_->reply(reply.dump());
          if (reply.at("ok") == true) {
            RCLCPP_INFO(get_logger(), "EO ZMQ reply: %s", reply.dump().c_str());
          } else {
            RCLCPP_WARN(get_logger(), "EO ZMQ rejected: %s readiness=%s", reply.dump().c_str(),
              controller_->readiness(monotonic_ms()).dump().c_str());
          }
        }
        for (const auto & item : controller_->take_events()) {
          if (item.first == "diagnostic") {
            RCLCPP_WARN(get_logger(), "%s", item.second.dump().c_str());
            continue;
          }
          publish(item.first, item.second);
        }
        const auto snapshot_time = monotonic_ms();
        if (snapshot_time - last_snapshot_ >= 1000) {
          publish("device_status", controller_->device_status(snapshot_time));
          publish("task_status", controller_->task_status(snapshot_time));
          last_snapshot_ = snapshot_time;
        }
        heartbeat_->advanced();
      });
    RCLCPP_INFO(get_logger(), "EO protocol 2.3 endpoint ready: %s", device_.c_str());
  }
  ~Server() override {if (controller_ && rclcpp::ok()) {controller_->shutdown(monotonic_ms());}}

private:
  template<typename Request,typename Response>
  void refuse(const Request & request,Response & response,const Error & error) const
  {
    response.request_id=request.request_id;
    response.current_simulation_epoch=hardware_->simulation_epoch();response.current_controller_instance_id=instance_;
    response.phase=Response::NOT_FORWARDED;response.error_code=error.code;response.error_message=error.what();
  }
  template<typename Request,typename Response>
  void submit_original(const Request & request,Response & response,const Json & wire,const std::string & task_id={})
  {
    try {
      if (request.controller_instance_id!=instance_) {throw Error("STALE_INSTANCE","Original EO Controller instance required");}
      if (!request.simulation_epoch) {throw Error("STALE_EPOCH","Original nonzero epoch required");}
      identifier(Json(request.request_id));validate_params(wire);
      const auto record=controller_->receipt(request.request_id);
      if (record) {
        if (record->epoch!=request.simulation_epoch || record->request!=wire) {throw Error("ID_CONFLICT","Original request context/content changed");}
        fill_receipt(request.request_id,request.simulation_epoch,instance_,response);response.receipt_retained=true;return;
      }
      if (request.simulation_epoch!=hardware_->simulation_epoch()) {throw Error("STALE_EPOCH","Current backend epoch differs");}
      if (request.header.stamp.sec<0 || request.header.stamp.nanosec>=1000000000U
          || !hardware_->valid_context(request.header.frame_id,
            std::int64_t(request.header.stamp.sec)*1000000000LL+request.header.stamp.nanosec)) {throw Error("NOT_READY","Fresh original map context required");}
      if (!task_id.empty() && !controller_->task_in_epoch(task_id,request.simulation_epoch)) {throw Error("NOT_FOUND","No current task in the original epoch");}
      const Json reply=controller_->request(wire.dump(),monotonic_ms(),request.simulation_epoch);
      fill_receipt(request.request_id,request.simulation_epoch,instance_,response);
      response.receipt_retained=bool(controller_->receipt(request.request_id));
      if (!response.receipt_retained && !reply.at("ok").get<bool>()) {
        response.phase=Response::REJECTED;response.simulation_epoch=request.simulation_epoch;response.controller_instance_id=instance_;
        response.method=wire.at("method").get<std::string>();response.error_code=reply.at("error").at("code").get<std::string>();
        response.error_message=reply.at("error").at("message").get<std::string>();
      }
    } catch (const Error & error) {refuse(request,response,error);}
  }
  template<typename Response>
  void fill_receipt(const std::string & id,std::uint64_t epoch,const std::string & instance,Response & response) const
  {
          response.request_id=id;
          response.current_simulation_epoch=hardware_->simulation_epoch();
          response.current_controller_instance_id=instance_;
          response.phase=Receipt::Response::UNKNOWN;
          if (instance!=instance_ || !epoch || id.empty()
              || id.size()>64) {return;}
          const auto record=controller_->receipt(id);
          if (!record || record->epoch!=epoch) {return;}
          response.simulation_epoch=record->epoch;
          response.controller_instance_id=instance_;
          response.method=record->request.at("method").get<std::string>();
          response.phase=record->reply.at("ok").get<bool>() ? Receipt::Response::ADMITTED : Receipt::Response::REJECTED;
          const auto & error=record->reply.at("error");
          if (!error.is_null()) {
            response.error_code=error.at("code").get<std::string>();
            response.error_message=error.at("message").get<std::string>();
          }
          const auto & command=record->command;
          if (!command.is_null()) {
            response.has_command_state=true;
            response.command_state=command.at("state").get<std::string>();
            if (command.contains("task_id") && !command.at("task_id").is_null()) {response.task_id=command.at("task_id").get<std::string>();}
            if (command.contains("reason") && !command.at("reason").is_null()) {response.reason=command.at("reason").get<std::string>();}
          }
  }
  void publish(const std::string & topic, const Json & data)
  {
    if (topic == "targetlist" || topic == "tracklist") {
      if (reports_) {
        try {
          auto report=static_cast<V2Hardware *>(hardware_.get())->report(topic,data);
          if (report) {report->sequence=++report_sequence_;reports_->publish(*report);}
        } catch (const Error & error) {RCLCPP_WARN(get_logger(),"EO typed report refused: %s",error.what());}
      }

      std_msgs::msg::String report;
      report.data = data.dump();
      (topic == "targetlist" ? targets_ : tracks_)->publish(report);
    }
    if (topic == "device_status") {
      Json state = {{"mode", data["mode"]}, {"ready", data["ready"]},
        {"camera_online", data["camera_online"]}, {"gimbal_online", data["gimbal_online"]},
        {"navigation_valid", data["navigation_valid"]}, {"fault_code", data["fault_code"]},
        {"active_task_id", data["active_task_id"]}, {"telecontrol", data["telecontrol"]}};
      if (!state["telecontrol"].is_null()) {state["telecontrol"].erase("remaining_ms");}
      if (state != last_device_log_) {
        const Json previous_fault=last_device_log_.is_object() ? last_device_log_["fault_code"] : Json(nullptr);
        if (state["fault_code"] != previous_fault) {
          if (state["fault_code"].is_null()) {RCLCPP_INFO(get_logger(), "EO device fault cleared");}
          else {RCLCPP_WARN(get_logger(), "EO device fault: %s", data["fault_message"].dump().c_str());}
        }
        RCLCPP_DEBUG(get_logger(), "EO device state: %s readiness=%s", state.dump().c_str(),
          controller_->readiness(monotonic_ms()).dump().c_str());
        last_device_log_ = std::move(state);
      }
    } else if (topic == "task_status") {
      std_msgs::msg::String snapshot;
      snapshot.data = controller_->visualization_status(monotonic_ms()).dump();
      visualization_->publish(snapshot);
      Json state = data;
      if (!state["task"].is_null()) {
        for (const auto * key : {"remaining_ms", "progress_ratio", "coverage_ratio"}) {
          state["task"].erase(key);
        }
      }
      if (state != last_task_log_) {
        RCLCPP_INFO(get_logger(), "EO task state: %s", state.dump().c_str());
        last_task_log_ = std::move(state);
      }
    }
    transport_->publish("isr/" + device_ + "/" + topic, controller_->event(topic, data).dump());
  }
  rclcpp::Publisher<isr_ros2_msgs::msg::ZmqEoStateV2>::SharedPtr observation_;
  rclcpp::TimerBase::SharedPtr observation_timer_;
  std::uint64_t observation_sequence_=0;
  rclcpp::Publisher<isr_ros2_msgs::msg::ZmqEoReportV2>::SharedPtr reports_;
  std::uint64_t report_sequence_=0;
  Config config_;
  std::unique_ptr<ScanPlan> map_projection_;
  using Manual=isr_ros2_msgs::srv::ZmqEoManualV2;
  rclcpp::Service<Manual>::SharedPtr manual_;
  using Scan=isr_ros2_msgs::srv::ZmqEoScanV2;
  rclcpp::Service<Scan>::SharedPtr scans_;
  using Receipt=isr_ros2_msgs::srv::GetZmqEoReceiptV2;
  using TaskControl=isr_ros2_msgs::srv::ZmqEoTaskControlV2;
  rclcpp::Service<TaskControl>::SharedPtr controls_;
  rclcpp::Service<Receipt>::SharedPtr receipts_;
  std::string device_,instance_;
  Json last_device_log_ = nullptr, last_task_log_ = nullptr;
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr visualization_;
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr targets_, tracks_;
  std::unique_ptr<Hardware> hardware_;
  std::unique_ptr<Controller> controller_;
  std::unique_ptr<Transport> transport_;
  std::unique_ptr<Frames> frames_;
  rclcpp::TimerBase::SharedPtr timer_;
  std::unique_ptr<ExecutionHeartbeat> heartbeat_;
  std::unique_ptr<sl::RuntimeAdmission> admission_;
  double last_snapshot_ = -1e12;
};
}
int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  int result = 0;
  try {
    rclcpp::spin(std::make_shared<sl::eo::Server>());
  } catch (const std::exception & e) {
    std::cerr << "EO server: " << e.what() << '\n';
    result = 1;
  }
  rclcpp::shutdown();
  return result;
}
