#include "ros2_zmq_server_sl/eo/protocol.hpp"
#include <cmath>
#include <set>
#include <regex>

namespace sl::eo
{
void fields(const Json & v, std::initializer_list<const char *> names)
{
  if (!v.is_object() || v.size() != names.size()) {
    throw Error("INVALID_ARGUMENT", "missing or undefined fields");
  }
  for (auto name : names) {
    if (!v.contains(name)) {
      throw Error("INVALID_ARGUMENT", std::string("missing ") + name);
    }
  }
}
void identifier(const Json & v)
{
  if (!v.is_string()) {throw Error("INVALID_ARGUMENT", "ID must be a string");}
  auto s = v.get<std::string>();
  auto alnum =
    [](char c) {return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');};
  if (s.empty() || s.size() > 64 || !alnum(s[0])) {throw Error("INVALID_ARGUMENT", "invalid ID");}
  for (char c : s) {
    if (!alnum(c) && c != '_' && c != '.' && c != ':' && c != '-') {
      throw Error("INVALID_ARGUMENT", "invalid ID");
    }
  }
}
double number(const Json & v, double low, double high)
{
  if (!v.is_number() || !std::isfinite(v.get<double>()) || v.get<double>() < low || v.get<double>() > high) {
    throw Error("INVALID_ARGUMENT", "number outside permitted range");
  }
  return v.get<double>();
}
int integer(const Json & v, int low, int high)
{
  number(v, low, high);
  if (!v.is_number_integer()) {throw Error("INVALID_ARGUMENT", "integer required");}
  return v.get<int>();
}
double wrap(double a) {return a - 2 * pi * std::floor((a + pi) / (2 * pi));}
Json parse_request(const std::string & wire, const std::string & device, Json * parsed)
{
  if (wire.size() > max_frame) {throw Error("INVALID_ARGUMENT", "JSON exceeds 65536 bytes");}
  std::vector<std::set<std::string>> keys;
  Json r;
  try {
    r = Json::parse(
      wire, [&keys](int depth, Json::parse_event_t event, Json & value) {
        if (depth > 32) {
          throw Error("INVALID_ARGUMENT", "JSON nesting exceeds 32 levels");
        }
        if (event == Json::parse_event_t::object_start) {keys.emplace_back();}
        if (event == Json::parse_event_t::key && !keys.back().insert(value.get<std::string>()).second) {
          throw Error("INVALID_ARGUMENT", "duplicate JSON key");
        }
        if (event == Json::parse_event_t::object_end) {keys.pop_back();}
        return true;
      });
  } catch (const Json::exception &) {
    throw Error("INVALID_ARGUMENT", "invalid UTF-8 JSON");
  }
  if (parsed) {*parsed = r;}
  fields(r, {"protocol", "kind", "device_id", "request_id", "method", "params"});
  identifier(r["request_id"]);
  if (r["protocol"] != "2.3") {throw Error("UNSUPPORTED", "protocol must be 2.3");}
  if (r["kind"] != "request") {throw Error("INVALID_ARGUMENT", "kind must be request");}
  if (r["device_id"] != device) {throw Error("FORBIDDEN", "wrong device_id");}
  if (!r["method"].is_string() || !r["params"].is_object()) {
    throw Error("INVALID_ARGUMENT", "invalid method/params");
  }
  return r;
}
void validate_params(const Json & r)
{
  auto p = r.at("params");
  auto method = r.at("method").get<std::string>();
  if (method == "AreaSearch" || method == "CircularSearch") {
    if (p.contains("target_entity_id")) {
      const auto & target=p["target_entity_id"];
      if (!target.is_string() || !std::regex_match(target.get<std::string>(),
          std::regex("[A-Za-z][A-Za-z0-9_]{0,63}")) || p.value("search_strategy",Json(nullptr))!="track") {
        throw Error("INVALID_ARGUMENT","A public entity ID and track strategy are required for target selection");
      }
      p.erase("target_entity_id");
    }
    if (method == "AreaSearch") {
      fields(p, {"region_wgs84", "task_timeout_ms", "search_strategy"});
      const auto & points = p["region_wgs84"];
      if (!points.is_array() || points.size() != 4) {
        throw Error("INVALID_ARGUMENT", "four boundary vertices required");
      }
      for (const auto & v : points) {
        fields(v, {"latitude_deg", "longitude_deg", "ellipsoid_height_m"});
        number(v["latitude_deg"], -90, 90);
        if (number(v["longitude_deg"], -180, 180) == 180) {
          throw Error("INVALID_ARGUMENT", "longitude must be <180");
        }
        number(v["ellipsoid_height_m"], -1e9, 1e9);
      }
      double sign = 0;
      for (int i = 0; i < 4; ++i) {
        auto x = [&](int j) {return points[j % 4]["longitude_deg"].get<double>();};
        auto y = [&](int j) {return points[j % 4]["latitude_deg"].get<double>();};
        double cross = (x(i + 1) - x(i)) * (y(i + 2) - y(i + 1)) - (y(i + 1) - y(i)) * (x(i + 2) - x(i + 1));
        if (cross == 0 || (sign && cross * sign <= 0)) {
          throw Error("INVALID_ARGUMENT", "region must be strictly convex in boundary order");
        }
        sign = cross;
      }
    } else {
      fields(
        p, {"scan_mode", "yaw_center_rad", "yaw_span_rad", "pitch_rad", "yaw_speed_rad_s", "cycle_count",
          "task_timeout_ms", "search_strategy"});
      if (p["scan_mode"] == "sector") {
        if (number(
            p["yaw_center_rad"], -pi,
            pi) == pi || number(p["yaw_span_rad"], 0, 2 * pi) <= 0 || p["yaw_span_rad"] == 2 * pi)
        {
          throw Error("INVALID_ARGUMENT", "invalid sector");
        }
      } else if (p["scan_mode"] != "circular" || !p["yaw_center_rad"].is_null() ||
        !p["yaw_span_rad"].is_null())
      {
        throw Error("INVALID_ARGUMENT", "circular requires null center/span");
      }
      number(p["pitch_rad"], -pi / 2, pi / 2);
      if (number(p["yaw_speed_rad_s"], 0, 1e6) <= 0) {
        throw Error("INVALID_ARGUMENT", "positive speed required");
      }
      integer(p["cycle_count"], 0, 10000);
    }
    integer(p["task_timeout_ms"], 0, 3600000);
    if (p["task_timeout_ms"] != 0 && p["task_timeout_ms"] < 1000) {
      throw Error("INVALID_ARGUMENT", "task_timeout_ms must be 0 or 1000..3600000");
    }
    if (p["search_strategy"] != "recognize" && p["search_strategy"] != "track") {
      throw Error("INVALID_ARGUMENT", "invalid search_strategy");
    }
  } else if (method == "TaskControl") {
    fields(p, {"task_id", "action"});
    identifier(p["task_id"]);
    if (p["action"] != "start" && p["action"] != "pause" && p["action"] != "resume" &&
      p["action"] != "stop")
    {
      throw Error("INVALID_ARGUMENT", "invalid task action");
    }
  } else if (method == "TeleControl") {
    if (!p.contains("action")) {throw Error("INVALID_ARGUMENT", "missing action");}
    if (p["action"] == "position") {
      fields(p, {"action", "yaw_rad", "pitch_rad", "move_timeout_ms"});
      if (number(p["yaw_rad"], -pi, pi) == pi) {throw Error("INVALID_ARGUMENT", "yaw must be <pi");}
      number(p["pitch_rad"], -pi / 2, pi / 2);
      integer(p["move_timeout_ms"], 100, 10000);
    } else if (p["action"] == "velocity") {
      fields(p, {"action", "yaw_rate_rad_s", "pitch_rate_rad_s", "hold_ms"});
      number(p["yaw_rate_rad_s"], -1e6, 1e6);
      number(p["pitch_rate_rad_s"], -1e6, 1e6);
      integer(p["hold_ms"], 100, 1000);
    } else if (p["action"] == "zoom") {
      fields(p, {"action", "zoom_ratio", "zoom_timeout_ms"});
      number(p["zoom_ratio"], 1, 1e6);
      integer(p["zoom_timeout_ms"], 100, 10000);
    } else if (p["action"] == "stop") {fields(p, {"action"});} else {
      throw Error("INVALID_ARGUMENT", "invalid telecontrol action");
    }
  } else {throw Error("UNSUPPORTED", "unknown method");}
}
Json command(const Json & r, const Json & task)
{
  return {{"request_id", r["request_id"]}, {"method", r["method"]}, {"state", "accepted"}, {"task_id", task},
    {"reason", nullptr}};
}
Json response(
  const std::string & device, const Json & r, const Json & cmd, const std::string & code,
  const std::string & message)
{
  return {{"protocol", "2.3"}, {"kind", "response"}, {"device_id", device},
    {"response_id",
      r.is_object() && r.contains("request_id") && r["request_id"].is_string() ? r["request_id"] : Json(
        nullptr)},
    {"method",
      r.is_object() && r.contains("method") && r["method"].is_string() ? r["method"] : Json(nullptr)},
    {"ok", code.empty()}, {"command", code.empty() ? cmd : Json(nullptr)},
    {"error", code.empty() ? Json(nullptr) : Json{{"code", code}, {"message", message}}}};
}
}
