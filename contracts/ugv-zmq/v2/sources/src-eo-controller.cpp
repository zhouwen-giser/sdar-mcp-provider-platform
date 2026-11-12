#include "ros2_zmq_server_sl/eo/controller.hpp"
#include <algorithm>
#include <chrono>
#include <cmath>

namespace sl::eo
{
Controller::Controller(Config c, Hardware & hardware)
: config_(std::move(c)), hardware_(hardware), plan_(config_)
{
  identifier(config_.device);
  identifier(config_.session);
  if (!(config_.pitch_min >= -pi / 2 && config_.pitch_max <= pi / 2 &&
    config_.pitch_min < config_.pitch_max &&
    config_.max_speed > 0 && config_.max_speed <= pi && config_.tolerance > 0 && config_.stopped_rate >= 0 &&
    config_.fresh_ms > 0 && config_.settle_ms > 0 && config_.range > 0 && config_.grid_spacing > 0 &&
    config_.plane_tolerance >= 0 && config_.ledger_capacity > 0))
  {
    throw std::invalid_argument("invalid EO deployment limits");
  }
  hardware_.observing(nullptr);
  hardware_.velocity(0, 0);
  hardware_.unlock();
  stop_started_ = 0;
}
bool Controller::fresh(double stamp) const {return now_ >= stamp && now_ - stamp <= config_.fresh_ms;}
bool Controller::terminal() const
{
  return !task_.is_null() &&
         (task_["state"] == "completed" || task_["state"] == "canceled" || task_["state"] == "failed");
}
bool Controller::active_task() const {return !task_.is_null() && !terminal();}
bool Controller::tele_running() const {return !tele_.is_null() && tele_["state"] == "running";}
bool Controller::stopped() const
{
  return !feedback.command_pending && fresh(feedback.pose_ms) && feedback.unlocked && stationary_since_ >= 0 &&
         feedback.pose_ms - stationary_since_ >= config_.settle_ms;
}
void Controller::available() const
{
  if (!fault_.empty()) {
    throw Error("NOT_READY", "device fault: " + fault_ +
      (feedback_fault_ ? "; waiting for confirmed feedback recovery" : "; fault remains latched"));
  }
  if (!feedback.session_ready || stop_started_ >= 0 || startup_ || !stopped() || !fresh(feedback.camera_ms)) {
    throw Error("NOT_READY", "fresh camera and confirmed stopped gimbal required");
  }
}

double Controller::scan_speed() const
{
  return task_["task_type"] ==
         "CircularSearch" ? task_params_["yaw_speed_rad_s"].get<double>() : config_.max_speed;
}


void Controller::set_command(const std::string & id, const std::string & state, const std::string & reason)
{
  if (id.empty()) {return;}
  auto & cmd = ledger_.at(id).command;
  ledger_.at(id).finished = true;
  if (cmd["state"] == state && cmd["reason"] == (reason.empty() ? Json(nullptr) : Json(reason))) {return;}
  cmd["state"] = state;
  cmd["reason"] = reason.empty() ? Json(nullptr) : Json(reason);
  if (!task_command_.is_null() && task_command_["request_id"] == id) {task_command_ = cmd;}
  if (!tele_.is_null() && tele_["command"]["request_id"] == id) {tele_["command"] = cmd;}
  dirty_ = true;
}
Json Controller::request(const std::string & wire, double now, std::uint64_t epoch)
{
  now_ = now;
  Json r = nullptr;
  try {
    r = parse_request(wire, config_.device, &r);
    const auto id = r["request_id"].get<std::string>();
    auto found = ledger_.find(id);
    if (found != ledger_.end()) {
      if (r != found->second.request) {
        throw Error("ID_CONFLICT", "request_id already used with different contents");
      }
      return found->second.reply;
    }
    if (ledger_.size() >= config_.ledger_capacity) {
      throw Error("RESOURCE_EXHAUSTED", "command ledger full; restart only after confirmed stop");
    }
    try {validate_params(r);}
    catch (const Error & error) {
      auto rejected=response(config_.device,r,nullptr,error.code,error.what());
      ledger_[id]={r,rejected,nullptr};
      ledger_[id].epoch=epoch;
      return rejected;
    }
    const auto method=r["method"].get<std::string>();
    const auto action=r["params"].value("action",std::string(""));
    const bool safety=(method=="TaskControl" && (action=="stop" || action=="pause")) ||
      (method=="TeleControl" && action=="stop");
    if (!runtime_admitted() && !safety) {
      auto rejected=response(config_.device,r,nullptr,"NOT_READY","Runtime EO admission closed");
      ledger_[id]={r,rejected,nullptr}; ledger_[id].epoch=epoch; return rejected;
    }
    hardware_.admit_request(id, r.dump());
    ledger_[id] = {r, nullptr, nullptr};
    ledger_[id].epoch=epoch;
    Json reply;
    try {
      reply = accept(r);
    } catch (const Error & e) {
      reply = response(config_.device, r, nullptr, e.code, e.what());
    } catch (const std::exception & e) {
      feedback_fault_ = false;
      fault_ = "DEVICE_FAULT";
      if (active_task() || tele_running()) {
        begin_stop(active_task() ? "failed" : "tele_failed", fault_);
      } else {
        hardware_.velocity(0, 0);
        hardware_.unlock();
        dirty_ = true;
      }
      reply = response(config_.device, r, nullptr, "INTERNAL", e.what());
    }
    ledger_[id].reply = reply;
    publish_status();
    return reply;
  } catch (const RequestStorageFailure &) {
    throw;
  } catch (const Error & e) {
    return response(config_.device, r, nullptr, e.code, e.what());
  } catch (const std::exception & e) {
    return response(config_.device, r, nullptr, "INTERNAL", e.what());
  }
}
std::optional<Controller::Receipt> Controller::receipt(const std::string & id) const
{
  const auto found=ledger_.find(id);
  if (found==ledger_.end() || found->second.reply.is_null()) {return std::nullopt;}
  const auto & record=found->second;
  return Receipt{record.epoch,record.request,record.reply,record.command};
}
bool Controller::task_in_epoch(const std::string & task,std::uint64_t epoch) const
{
  return epoch && !task_.is_null() && task_["task_id"]==task && task_epoch_==epoch;
}
Json Controller::accept(const Json & r)
{
  auto method = r["method"].get<std::string>(), id = r["request_id"].get<std::string>();
  const auto & p = r["params"];
  if (method == "AreaSearch" || method == "CircularSearch") {
    if (p.contains("target_entity_id") && !config_.map_coordinates) {
      throw Error("UNSUPPORTED","Public target selection requires the typed map adapter");
    }
    if (active_task() || tele_running()) {throw Error("BUSY", "control is occupied");}
    available();
    if (p["search_strategy"] == "track" && feedback.lock_failed) {
      throw Error("NOT_READY", "target lock service unavailable");
    }
    if (method == "AreaSearch") {plan_.prepare_area(p, feedback, now_);} else {
      if (!config_.continuous_yaw) {
        throw Error("UNSUPPORTED", "this adapter requires a continuous yaw gimbal for scans");
      }
      plan_.check_pitch(p["pitch_rad"]);
      if (p["yaw_speed_rad_s"].get<double>() > config_.max_speed) {
        throw Error("INVALID_ARGUMENT", "scan speed exceeds deployment limit");
      }
    }
    if (!hardware_.prepare_control(true)) {throw Error("NOT_READY", "waiting for RECON control ownership");}
    if (!task_.is_null()) {retired_tasks_[task_["task_id"].get<std::string>()] = task_;}
    std::string task_id = "task-" + config_.session + "-" + std::to_string(++ids_);
    task_ =
    {{"task_id", task_id}, {"task_type", method}, {"state", "ready"},
      {"remaining_ms", p["task_timeout_ms"]},
      {"progress_ratio", method == "CircularSearch" ? Json(0.0) : Json(nullptr)}, {"coverage_ratio", nullptr}, {"coverage_complete", nullptr},
      {"completed_cycles", method == "CircularSearch" ? Json(0) : Json(nullptr)},
      {"total_cycles", method == "CircularSearch" ? p["cycle_count"] : Json(nullptr)}, {"reason", nullptr}};
    last_track_ = nullptr;
    task_epoch_=ledger_.at(id).epoch;
    task_params_ = p;
    task_request_ = id;
    task_command_ = command(r, task_id);
    ledger_[id].command = task_command_;
    started_ = false;
    deadline_ = 0;
    step_ = 0;
    path_ = 0;
    segment_progress_ = 0;
    issued_ = false;
    set_command(id, "accepted");
  } else if (method == "TaskControl") {
    auto task_id = p["task_id"].get<std::string>(), action = p["action"].get<std::string>();
    if (task_.is_null() || task_["task_id"] != task_id) {
      if (retired_tasks_.count(task_id) && action == "stop") {
        auto cmd = command(r, task_id);
        cmd["state"] = "accepted";
        ledger_[id].command = cmd;
        return response(config_.device, r, command(r, task_id));
      }
      throw Error("NOT_FOUND", "task_id does not exist");
    }
    std::string state = task_["state"];
    if (action == "start" && state != "ready") {throw Error("INVALID_STATE", "start requires ready");}
    if (action == "resume" && state != "paused") {throw Error("INVALID_STATE", "resume requires paused");}
    if (action == "pause" && state != "starting" && state != "searching" && state != "paused") {
      throw Error("INVALID_STATE", "pause requires starting/searching/paused");
    }
    if (action == "stop" && terminal() && stop_started_ < 0) {
      auto cmd = command(r, task_id);
      cmd["state"] = "accepted";
      ledger_[id].command = cmd;
      return response(config_.device, r, command(r, task_id));
    }
    if ((action == "start" || action == "resume") &&
      (!fresh(feedback.pose_ms) || !fresh(feedback.camera_ms) || !fault_.empty()))
    {
      throw Error("NOT_READY", "feedback stale or device fault");
    }
    if ((action == "pause" || (action == "stop" &&
      ledger_[task_request_].request["params"].value("action", "") != "stop")) &&
      !task_request_.empty() && !ledger_[task_request_].finished)
    {
      set_command(task_request_, "failed", "SUPERSEDED");
    }
    task_request_ = id;
    task_command_ = command(r, task_id);
    ledger_[id].command = task_command_;
    if (action == "start" || action == "resume") {
      if (!started_) {
        started_ = true;
        int budget = task_params_["task_timeout_ms"];
        deadline_ = budget == 0 ? 0 : now_ + budget;
        if (task_["task_type"] == "CircularSearch" && task_["total_cycles"] == 0) {
          task_["progress_ratio"] = 0.01;
        }
      }
      if (action == "start" && task_["task_type"] == "CircularSearch") {plan_.prepare_sweep(task_params_, feedback);}
      task_["state"] = "starting";
      issued_ = false;
      hardware_.observing(task_["task_id"]);
    } else if (action == "pause") {
      if (state == "paused") {set_command(id, "accepted");} else {begin_stop("paused");}
    } else {begin_stop("canceled", "CANCELED_BY_CLIENT");}
  } else {
    auto action = p["action"].get<std::string>();
    if (active_task()) {throw Error("BUSY", "search task owns the gimbal");}
    if (startup_ || (stop_started_ >= 0 && stop_target_.rfind("tele_", 0) != 0)) {
      throw Error("NOT_READY", "task/startup stop supervision still owns the actuator");
    }
    if (action == "zoom") {
      throw Error("UNSUPPORTED", "simulator zoom recreates the camera; no optical lens stop feedback");
    }
    if (action != "stop") {
      if (tele_running() && !(action == "velocity" && tele_["action"] == "velocity" && stop_started_ < 0)) {
        throw Error("BUSY", "telecontrol in progress");
      }
      if (!tele_running()) {available();}
      if (!fresh(feedback.pose_ms) || !fault_.empty() || stop_started_ >= 0) {
        throw Error("NOT_READY", "gimbal unavailable");
      }
      if (action == "position") {plan_.check_pitch(p["pitch_rad"]);} else {
        double y = p["yaw_rate_rad_s"], pitch = p["pitch_rate_rad_s"];
        if (!config_.continuous_pitch_velocity && pitch!=0) {throw Error("UNSUPPORTED", "continuous pitch velocity is unavailable");}
        if (std::abs(y) > config_.max_speed || std::abs(pitch) > config_.max_speed) {
          throw Error("INVALID_ARGUMENT", "velocity exceeds deployment limit");
        }
        double end = feedback.pitch + pitch * p["hold_ms"].get<int>() / 1000.0;
        plan_.check_pitch(end);
      }
    }
    if (action!="stop" && !hardware_.prepare_control(false)) {throw Error("NOT_READY", "waiting for MANUAL control ownership");}
    if (tele_running() && tele_["action"] != "stop") {set_command(tele_request_, "failed", "SUPERSEDED");}
    tele_request_ = id;
    ledger_[id].command = command(r, nullptr);
    tele_ = {{"action", action}, {"state", "running"}, {"remaining_ms", 0}, {"command", ledger_[id].command}};
    if (action == "stop") {begin_stop("tele_succeeded");} else if (action == "velocity") {
      tele_deadline_ = now_ + p["hold_ms"].get<int>();
      hardware_.velocity(p["yaw_rate_rad_s"], p["pitch_rate_rad_s"], p["hold_ms"]);
    } else {
      tele_deadline_ = now_ + p["move_timeout_ms"].get<int>();
      hardware_.position(p["yaw_rad"], p["pitch_rad"], config_.max_speed);
      stationary_since_ = -1;
    }
  }
  dirty_ = true;
  return response(config_.device, r, command(r, ledger_[id].command["task_id"]));
}
void Controller::begin_stop(const std::string & target, const std::string & reason)
{
  if (stop_started_ >= 0) {
    if (target == "tele_succeeded" && stop_target_.empty()) {stop_target_ = target;}
    if (target == "canceled" || target == "failed" || target == "tele_failed") {stop_target_ = target; stop_reason_ = reason;}
    return;
  }
  stop_started_ = now_;
  stop_asserted_ms_ = now_;
  stationary_since_ = -1;
  stop_target_ = target;
  stop_reason_ = reason;
  hardware_.observing(nullptr);
  hardware_.velocity(0, 0);
  hardware_.unlock();
  if (active_task() && task_params_["search_strategy"] == "track") {track_event("idle");}
  tracking_ = false;
  track_role_.clear();
  if (active_task()) {task_["state"] = target == "paused" ? "pausing" : "stopping";}
  dirty_ = true;
}
void Controller::finish_stop()
{
  if (startup_) {
    startup_ = false;
  } else if (stop_target_.rfind("tele_", 0) == 0) {
    if (fault_ == "STOP_UNCONFIRMED") {
      stop_target_ = "tele_failed";
      stop_reason_ = fault_;
    }
    if (stop_target_ == "tele_succeeded" && tele_["action"] == "position" && now_ > tele_deadline_) {
      stop_target_ = "tele_failed";
      stop_reason_ = "DEADLINE_EXCEEDED";
    }
    tele_["state"] = stop_target_ == "tele_succeeded" ? "succeeded" : "failed";
    set_command(tele_request_, tele_["state"] == "succeeded" ? "accepted" : "failed", stop_reason_);
  } else if (!task_.is_null()) {
    if (task_["state"] != "failed") {
      task_["state"] = stop_target_;
      task_["reason"] = stop_reason_.empty() ? Json(nullptr) : Json(stop_reason_);
    }
    set_command(
      task_request_, task_["state"] == "failed" ? "failed" : "accepted",
      task_["state"] == "failed" ? task_["reason"].get<std::string>() : "");
  }
  for (auto &[id, record] : ledger_) {
    if (record.finished || record.command.is_null()) {continue;}
    if (record.request["method"] == "TeleControl" && record.request["params"]["action"] == "stop" &&
      !tele_.is_null())
    {
      set_command(id, tele_["state"] == "succeeded" ? "accepted" : "failed", stop_reason_);
    }
    if (record.request["method"] == "TaskControl" && record.request["params"]["action"] == "stop" &&
      !task_.is_null() && record.command["task_id"] == task_["task_id"])
    {
      set_command(
        id, task_["state"] == "failed" ? "failed" : "accepted",
        task_["state"] == "failed" ? task_["reason"].get<std::string>() : "");
    }
  }
  if (!startup_ && stop_target_ != "paused" && stop_target_ != "startup") {hardware_.idle();}
  stop_started_ = -1;
  stop_target_.clear();
  stop_reason_.clear();
  dirty_ = true;
}
void Controller::execute_step()
{
  if (tracking_) {return;}
  std::pair<double, double> target;
  if (task_["task_type"] == "AreaSearch") {
    if (step_ >= plan_.area.size()) {begin_stop("completed"); return;}
    target = plan_.area_angle(plan_.area[step_], feedback, now_);
  } else {
    if (step_ >= plan_.sweep.size()) {
      int cycles = task_["completed_cycles"].get<int>() + 1;
      task_["completed_cycles"] = cycles;
      if (task_["total_cycles"] != 0 && cycles == task_["total_cycles"]) {task_["progress_ratio"] = 1; begin_stop("completed"); return;}
      step_ = 0;
    }
    target = {wrap(plan_.sweep[step_]), task_params_["pitch_rad"].get<double>()};
  }
  if (!issued_ ||
    (task_["task_type"] == "AreaSearch" &&
    (std::abs(wrap(target.first - issued_yaw_)) > config_.tolerance ||
    std::abs(target.second - issued_pitch_) > config_.tolerance)))
  {
    hardware_.position(target.first, target.second, scan_speed());
    stationary_since_ = -1;
    issued_ = true;
    issued_yaw_ = target.first;
    issued_pitch_ = target.second;
    last_pose_ms_ = feedback.pose_ms;
    return;
  }
  if (task_["task_type"] == "CircularSearch" && step_ > 0 && feedback.pose_ms > last_pose_ms_) {
    double direction = plan_.sweep[step_] > plan_.sweep[step_ - 1] ? 1 : -1;
    double measured = direction * wrap(feedback.yaw - wrap(plan_.sweep[step_ - 1]));
    double segment = std::abs(plan_.sweep[step_] - plan_.sweep[step_ - 1]);
    segment_progress_ = std::max(segment_progress_, std::clamp(measured, 0.0, segment));
    double cycle_length = task_params_["scan_mode"] ==
      "circular" ? 2 * pi : 2 * task_params_["yaw_span_rad"].get<double>();
    task_["progress_ratio"] =
      task_["total_cycles"] == 0 ? 0.01 :
      std::clamp((path_ + segment_progress_) / (cycle_length * task_["total_cycles"].get<int>()), 0.0, 1.0);
    last_pose_ms_ = feedback.pose_ms;
  }
  if (std::abs(wrap(target.first - feedback.yaw)) <= config_.tolerance &&
    std::abs(target.second - feedback.pitch) <= config_.tolerance &&
    std::abs(feedback.yaw_rate) <= config_.stopped_rate &&
    std::abs(feedback.pitch_rate) <= config_.stopped_rate && stopped())
  {
    if (task_["task_type"] == "CircularSearch" && step_ > 0) {path_ += segment_progress_;}
    ++step_;
    issued_ = false;
    segment_progress_ = 0;
  }
}
void Controller::tick(double now)
{
  now_ = now;
  if (!feedback.session_ready) {publish_status(); return;}
  if (awaiting_feedback_) {
    if (!fresh(feedback.pose_ms) || !fresh(feedback.camera_ms)) {publish_status(); return;}
    awaiting_feedback_ = false;
    stop_started_ = now_;
    stationary_since_ = -1;
    dirty_ = true;
  }
  if (feedback.device_fault) {feedback_fault_ = false;}
  if (feedback.device_fault && fault_.empty()) {
    fault_ = "DEVICE_FAULT";
    dirty_ = true;
    if (active_task() || tele_running()) {
      begin_stop(active_task() ? "failed" : "tele_failed", fault_);
    } else {
      hardware_.velocity(0, 0);
      hardware_.unlock();
    }
  }
  bool stationary = fresh(feedback.pose_ms) && std::abs(feedback.yaw_rate) <= config_.stopped_rate &&
    std::abs(feedback.pitch_rate) <= config_.stopped_rate;
  if (!stationary) {stationary_since_ = -1;} else if (stationary_since_ < 0) {
    stationary_since_ = feedback.pose_ms;
  }
  if (active_task() && started_ && deadline_ > 0 && now_ >= deadline_ && stop_started_ >= 0 && stop_target_ != "failed") {
    stop_target_ = "failed";
    stop_reason_ = "DEADLINE_EXCEEDED";
    task_["state"] = "stopping";
  }
  if (stop_started_ >= 0) {
    if (stopped() && feedback.pose_ms > stop_started_) {
      finish_stop();
    } else if (now_ - stop_started_ >= 3000) {
      feedback_fault_ = false;
      fault_ = "STOP_UNCONFIRMED";
      if (!task_.is_null() && (active_task() || task_["state"] == "failed")) {
        task_["state"] = "failed";
        task_["reason"] = fault_;
        set_command(task_request_, "failed", fault_);
      }
      if (tele_running()) {tele_["state"] = "failed"; set_command(tele_request_, "failed", fault_);}
      // Keep supervising without flooding the local actuator's command queue.
      if (now_ - stop_asserted_ms_ >= 200) {
        hardware_.velocity(0, 0);
        stop_asserted_ms_ = now_;
      }
    }
  } else {
    if ((active_task() && started_) || tele_running()) {
      if (!fresh(feedback.pose_ms) || !fresh(feedback.camera_ms)) {
        feedback_fault_ = true;
        feedback_recovery_since_ = -1;
        fault_ = "DEVICE_FAULT";
        begin_stop(active_task() ? "failed" : "tele_failed", fault_);
      }
    }
    if (active_task() && started_ && stop_started_ < 0) {
      if (deadline_ > 0 && now_ >= deadline_) {
        begin_stop("failed", "DEADLINE_EXCEEDED");
      } else if (task_["state"] == "starting" || task_["state"] == "searching") {
        if (task_["state"] != "searching") {task_["state"] = "searching"; dirty_ = true;}
        set_command(task_request_, "accepted");
        try {
          execute_step();
        } catch (const Error & e) {
          begin_stop("failed", e.code == "NOT_READY" ? "DEVICE_FAULT" : e.code);
        }
      }
    }
    if (tele_running() && stop_started_ < 0) {
      auto action = tele_["action"].get<std::string>();
      if (action == "velocity" && now_ >= tele_deadline_) {
        begin_stop("tele_succeeded");
      } else if (action == "position") {
        auto & p = ledger_[tele_request_].request["params"];
        if (stopped() && std::abs(wrap(feedback.yaw - p["yaw_rad"].get<double>())) <= config_.tolerance &&
          std::abs(feedback.pitch - p["pitch_rad"].get<double>()) <= config_.tolerance)
        {
          begin_stop("tele_succeeded");
        } else if (now_ >= tele_deadline_) {begin_stop("tele_failed", "DEADLINE_EXCEEDED");}
      }
    }
  }
  if (tracking_ && (now_ - last_frame_ms_ > config_.fresh_ms || feedback.lock_failed)) {
    track_event("lost");
    tracking_ = false;
    track_role_.clear();
    hardware_.unlock();
    issued_ = false;
  }
  if (!last_track_.is_null() &&
    (last_track_["track_state"] == "acquiring" || last_track_["track_state"] == "lost") &&
    now_ - track_published_ms_ >= 1000)
  {
    events_.emplace_back("tracklist", last_track_);
    track_published_ms_ = now_;
  }
  if (feedback_fault_ && fault_ == "DEVICE_FAULT") {
    bool recovered = !active_task() && !tele_running() && stop_started_ < 0 &&
      !feedback.device_fault && fresh(feedback.camera_ms) && stopped();
    if (!recovered) {
      feedback_recovery_since_ = -1;
    } else if (feedback_recovery_since_ < 0) {
      feedback_recovery_since_ = now_;
    } else if (now_ - feedback_recovery_since_ >= config_.settle_ms &&
      feedback.camera_ms > feedback_recovery_since_ && feedback.pose_ms > feedback_recovery_since_)
    {
      fault_.clear();
      feedback_fault_ = false;
      feedback_recovery_since_ = -1;
      dirty_ = true;
    }
  }
  publish_status();
}
void Controller::publish_status()
{
  if (!dirty_) {return;}
  events_.emplace_back("device_status", device_status(now_));
  events_.emplace_back("task_status", task_status(now_));
  dirty_ = false;
}
Json Controller::readiness(double now) const
{
  return {{"startup", startup_}, {"awaiting_feedback", awaiting_feedback_},
    {"stop_pending", stop_started_ >= 0},
    {"stop_elapsed_ms", stop_started_ >= 0 && !awaiting_feedback_ ? Json(now - stop_started_) : Json(nullptr)},
    {"pose_age_ms", feedback.pose_ms >= 0 ? Json(now - feedback.pose_ms) : Json(nullptr)},
    {"camera_age_ms", feedback.camera_ms >= 0 ? Json(now - feedback.camera_ms) : Json(nullptr)},
    {"feedback_fresh_ms", config_.fresh_ms}, {"settle_ms", config_.settle_ms},
    {"stationary_ms", stationary_since_ >= 0 ? Json(feedback.pose_ms - stationary_since_) : Json(nullptr)},
    {"stopped_rate_rad_s", config_.stopped_rate},
    {"yaw_rate_rad_s", feedback.yaw_rate}, {"pitch_rate_rad_s", feedback.pitch_rate},
    {"unlocked", feedback.unlocked}, {"lock_failed", feedback.lock_failed},
    {"device_fault", feedback.device_fault}, {"session_ready", feedback.session_ready}, {"command_pending", feedback.command_pending}, {"fault_code", fault_},
    {"fault_recoverable", feedback_fault_},
    {"recovery_elapsed_ms", feedback_recovery_since_ < 0 ? Json(nullptr) : Json(now - feedback_recovery_since_)}};
}
Json Controller::device_status(double now) const
{
  Json tele = tele_;
  if (!tele.is_null()) {
    tele["remaining_ms"] = tele["state"] == "running" && tele["action"] != "stop" &&
      stop_started_ < 0 ? std::max(0, static_cast<int>(tele_deadline_ - now)) : 0;
  }
  bool pose = now >= feedback.pose_ms && now - feedback.pose_ms <= config_.fresh_ms;
  bool camera = now >= feedback.camera_ms && now - feedback.camera_ms <= config_.fresh_ms;
  bool nav = now >= feedback.navigation_ms && now - feedback.navigation_ms <= config_.fresh_ms;
  return {{"mode",
    !fault_.empty() ? "fault" : stop_started_ >=
    0 ? "stopping" : active_task() ? "task" : tele_running() ? "telecontrol" : "idle"},
    {"ready",
      feedback.session_ready && fault_.empty() && stop_started_ < 0 && !startup_ && !active_task() && !tele_running() && pose &&
      camera && stopped()},
    {"data_origin", "simulated"}, {"camera_online", camera}, {"gimbal_online", pose},
    {"navigation_valid", nav},
    {"gimbal_yaw_rad", pose ? Json(feedback.yaw) : Json(nullptr)}, {"gimbal_pitch_rad", pose ? Json(
        feedback.pitch) : Json(nullptr)},
    {"zoom_ratio", nullptr}, {"active_task_id", active_task() ? task_["task_id"] : Json(nullptr)},
    {"telecontrol", tele},
    {"fault_code", fault_.empty() ? Json(nullptr) : Json(fault_)}, {"fault_message", fault_.empty() ? Json(
        nullptr) : Json(feedback_fault_ ? "feedback interrupted; waiting for fresh frames, confirmed stop and unlock"
        : "motion disabled; verify actuator feedback and restart after safe stop")}};
}
Json Controller::task_status(double now) const
{
  Json task = task_;
  if (!task.is_null()) {
    task["remaining_ms"] =
      terminal() || task_params_["task_timeout_ms"] == 0 ? 0 : started_ ? std::max(
      0,
      static_cast<int>(deadline_ - now)) : task_params_["task_timeout_ms"].get<int>();
  }
  return {{"task", task}, {"command", task_command_}};
}
Json Controller::visualization_status(double now) const
{
  Json status = task_status(now);
  status["device_id"] = config_.device;
  status["region"] = nullptr;
  status["search_strategy"] = task_.is_null() ? Json(nullptr) : task_params_["search_strategy"];
  if (active_task() && task_["task_type"] == "AreaSearch") {
    Json points = Json::array();
    for (const auto & vertex : task_params_["region_wgs84"]) {
      points.push_back(Json::array({
        (vertex["longitude_deg"].get<double>() - config_.longitude_origin) * 111320,
        (config_.latitude_origin - vertex["latitude_deg"].get<double>()) * 110540}));
    }
    status["region"] = {{"type", 5}, {"points", points}};
  }
  return status;
}
Json Controller::event(const std::string & topic, const Json & data) const
{
  auto utc = std::chrono::duration_cast<std::chrono::milliseconds>(
    std::chrono::system_clock::now().time_since_epoch()).count();
  return {{"protocol", "2.3"}, {"kind", "event"}, {"device_id", config_.device}, {"topic", topic},
    {"published_at_utc_ms", utc}, {"data", data}};
}
std::vector<std::pair<std::string, Json>> Controller::take_events()
{
  auto out = std::move(events_);
  events_.clear();
  return out;
}
void Controller::track_event(const std::string & state, const Json & targets, const Json & stamp)
{
  last_track_ = Json{{"task_id", task_["task_id"]}, {"track_state", state},
    {"track_id", state == "idle" ? Json(nullptr) : Json(track_id_)}, {"target_id", state == "idle" ? Json(
        nullptr) : Json(target_id_)},
    {"observed_at_utc_ms", stamp}, {"data_origin", "simulated"}, {"targets", targets}};
  track_published_ms_ = now_;
  events_.emplace_back("tracklist", last_track_);
}
void Controller::simulation_reset(double now)
{
  now_ = now;
  awaiting_feedback_ = true;
  feedback.camera_ms = feedback.pose_ms = feedback.navigation_ms = -1e12;
  feedback.unlocked = false;
  if (active_task()) {
    begin_stop("failed", "SIMULATION_RESET");
  } else if (tele_running()) {
    begin_stop("tele_failed", "SIMULATION_RESET");
  } else {
    startup_ = true;
    begin_stop("startup");
  }
}
void Controller::execution_failed(const std::string & reason, double now)
{
  now_ = now;
  if (stop_started_>=0 && (stop_target_=="failed" || stop_target_=="tele_failed") && !stop_reason_.empty()) {return;}
  if (active_task() || tele_running()) {
    begin_stop(active_task() ? "failed" : "tele_failed", reason);
  }
}
void Controller::shutdown(double now)
{
  now_ = now;
  hardware_.observing(nullptr);
  hardware_.velocity(0, 0);
  hardware_.unlock();
  if (active_task() || tele_running()) {
    begin_stop(active_task() ? "canceled" : "tele_failed", "CANCELED_BY_CLIENT");
  }
}
}
