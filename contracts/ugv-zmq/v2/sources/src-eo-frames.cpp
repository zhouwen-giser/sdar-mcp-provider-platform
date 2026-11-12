#include "ros2_zmq_server_sl/eo/frames.hpp"
#include <opencv2/imgcodecs.hpp>
#include <zmq.h>
#include <chrono>
#include <future>

namespace sl::eo
{
namespace
{
double seconds()
{
  return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
}
void zmq_check(int value)
{
  if (value < 0) {throw std::runtime_error(zmq_strerror(zmq_errno()));}
}
constexpr std::size_t max_jpeg = 16777216;
}
Frames::Frames(std::string device, const std::string & address, std::size_t memory_bytes)
: device_(std::move(device)), budget_(memory_bytes)
{
  identifier(device_);
  if (!budget_) {throw std::invalid_argument("frame cache budget must be positive");}
  std::promise<void> started;
  auto ready = started.get_future();
  worker_ = std::thread([this, address, started = std::move(started)]() mutable {
    void * context = nullptr, * socket = nullptr;
    bool bound = false;
    try {
      context = zmq_ctx_new();
      if (!context) {throw std::runtime_error(zmq_strerror(zmq_errno()));}
      socket = zmq_socket(context, ZMQ_REP);
      if (!socket) {throw std::runtime_error(zmq_strerror(zmq_errno()));}
      for (const auto & setting : {std::pair<int,int>{ZMQ_LINGER,0}, {ZMQ_SNDTIMEO,100},
          {ZMQ_RCVTIMEO,100}, {ZMQ_SNDHWM,2}, {ZMQ_RCVHWM,32}}) {
        zmq_check(zmq_setsockopt(socket, setting.first, &setting.second, sizeof(setting.second)));
      }
      const std::int64_t limit = max_frame;
      zmq_check(zmq_setsockopt(socket, ZMQ_MAXMSGSIZE, &limit, sizeof(limit)));
      zmq_check(zmq_bind(socket, address.c_str()));
      bound = true;
      started.set_value();
      while (!stopping_) {
        zmq_msg_t message;
        zmq_check(zmq_msg_init(&message));
        const int received = zmq_msg_recv(&message, socket, 0);
        if (received < 0) {
          const int error = zmq_errno();
          zmq_msg_close(&message);
          if (error == EAGAIN || error == EINTR) {continue;}
          zmq_check(received);
        }
        std::string wire(static_cast<const char *>(zmq_msg_data(&message)), zmq_msg_size(&message));
        const bool multipart = zmq_msg_more(&message);
        while (zmq_msg_more(&message)) {
          if (zmq_msg_recv(&message, socket, 0) < 0) {
            zmq_msg_close(&message);
            throw std::runtime_error("incomplete FramePull multipart request");
          }
        }
        zmq_msg_close(&message);
        Json request = nullptr, reply;
        std::vector<unsigned char> jpeg;
        try {
          if (multipart) {throw Error("INVALID_ARGUMENT", "one JSON frame required");}
          request = parse_request(wire, device_, &request);
          if (request["method"] != "FramePull") {throw Error("UNSUPPORTED", "FramePull required");}
          const auto & params = request["params"];
          fields(params, {"camera_id", "frame_id"});
          identifier(params["camera_id"]); identifier(params["frame_id"]);
          const auto frame = find(params["camera_id"], params["frame_id"]);
          if (!cv::imencode(".jpg", frame->pixels, jpeg, {cv::IMWRITE_JPEG_QUALITY,90})) {
            throw Error("INTERNAL", "JPEG encoding failed");
          }
          if (jpeg.empty() || jpeg.size() > max_jpeg) {throw Error("RESOURCE_EXHAUSTED", "JPEG exceeds capacity");}
          reply = response(device_, request, nullptr);
          reply["result"] = frame->metadata;
          reply["result"].update({{"encoding","jpeg"}, {"byte_length",jpeg.size()}});
        } catch (const Error & error) {
          reply = response(device_, request, nullptr, error.code, error.what());
        } catch (const std::bad_alloc &) {
          reply = response(device_, request, nullptr, "RESOURCE_EXHAUSTED", "Frame encoding capacity exhausted");
        } catch (const std::exception & error) {
          reply = response(device_, request, nullptr, "INTERNAL", error.what());
        }
        reply.erase("command");
        try {identifier(reply["response_id"]);} catch (const Error &) {reply["response_id"]=nullptr;}
        if (reply["method"].is_string() && reply["method"].get_ref<const std::string &>().size()>64) {reply["method"]=nullptr;}
        if (!reply["ok"].get<bool>()) {reply["result"] = nullptr; jpeg.clear();}
        const auto json = reply.dump();
        if (json.size() > max_frame) {throw std::runtime_error("FramePull JSON exceeds frame limit");}
        zmq_check(zmq_send(socket, json.data(), json.size(), jpeg.empty() ? 0 : ZMQ_SNDMORE));
        if (!jpeg.empty()) {zmq_check(zmq_send(socket, jpeg.data(), jpeg.size(), 0));}
      }
    } catch (const std::exception & error) {
      if (!bound) {started.set_exception(std::current_exception());}
      else {std::lock_guard<std::mutex> lock(mutex_); failure_ = error.what();}
    }
    if (socket) {zmq_close(socket);}
    if (context) {zmq_ctx_term(context);}
  });
  try {ready.get();} catch (...) {stopping_ = true; worker_.join(); throw;}
}
Frames::~Frames() {stopping_ = true; worker_.join();}
void Frames::check() const
{
  std::lock_guard<std::mutex> lock(mutex_);
  if (!failure_.empty()) {throw std::runtime_error("FramePull worker failed: " + failure_);}
}
bool Frames::store(const Json & metadata, const cv::Mat & pixels)
{
  fields(metadata, {"camera_id", "frame_id", "exposure_utc_ms", "width_px", "height_px"});
  identifier(metadata["camera_id"]); identifier(metadata["frame_id"]);
  const auto & utc = metadata["exposure_utc_ms"];
  if (!utc.is_null() && (!utc.is_number_integer() || utc.get<double>() < 0 || utc.get<double>() >= 9007199254740992.0)) {
    throw Error("INVALID_ARGUMENT", "invalid exposure UTC");
  }
  const int width = integer(metadata["width_px"], 1, 32768), height = integer(metadata["height_px"], 1, 32768);
  if (pixels.type() != CV_8UC3 || pixels.cols != width || pixels.rows != height || pixels.empty()) {
    throw Error("INVALID_ARGUMENT", "detection-space bgr8 pixels required");
  }
  const auto size = pixels.total() * pixels.elemSize();
  if (size > budget_) {throw Error("RESOURCE_EXHAUSTED", "raw frame exceeds cache budget");}
  std::lock_guard<std::mutex> lock(mutex_);
  const auto now = seconds();
  bool full_window = true;
  for (const auto & frame : cache_) {
    if (frame->metadata["camera_id"] == metadata["camera_id"] && frame->metadata["frame_id"] == metadata["frame_id"]) {
      throw Error("INVALID_ARGUMENT", "frame ID already registered");
    }
  }
  while (!cache_.empty() && (now - cache_.front()->received > 5 || bytes_ + size > budget_ || cache_.size() >= 4096)) {
    if (now - cache_.front()->received <= 5) {full_window = false;}
    bytes_ -= cache_.front()->pixels.total() * cache_.front()->pixels.elemSize();
    cache_.pop_front();
  }
  cache_.push_back(std::make_shared<Frame>(Frame{metadata, pixels.clone(), now}));
  cameras_.insert(metadata["camera_id"].get<std::string>());
  bytes_ += size;
  return full_window;
}
std::shared_ptr<const Frames::Frame> Frames::find(const std::string & camera, const std::string & frame)
{
  std::lock_guard<std::mutex> lock(mutex_);
  const bool known_camera = cameras_.count(camera);
  for (const auto & entry : cache_) {
    if (entry->metadata["camera_id"] != camera) {continue;}
    if (entry->metadata["frame_id"] == frame && seconds() - entry->received <= 5) {return entry;}
  }
  throw Error(known_camera ? "FRAME_UNAVAILABLE" : "NOT_FOUND", known_camera ? "Frame not in current cache" : "Camera not registered");
}
void Frames::clear()
{
  std::lock_guard<std::mutex> lock(mutex_);
  cache_.clear(); bytes_ = 0;
}
}
