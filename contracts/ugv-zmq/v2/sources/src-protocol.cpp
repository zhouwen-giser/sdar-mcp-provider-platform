#include "ros2_zmq_server_sl/protocol.hpp"

#include <cstring>
#include <limits>
#include <type_traits>

// 本文件只负责线协议：业务结构体 <-> payload字节，以及Message <-> 完整单帧。
// 不依赖ROS2/ZMQ，也不执行任务；模式、速度、坐标有效性等业务校验由节点处理。
// 帧格式：topic文本 + ':' + 24字节通用头 + uint32字符串长度 + 业务payload；数值均为小端。
// 逐字段编码，不直接复制结构体内存，因此不受结构体padding或主机字节序影响。
namespace ros2_zmq_server_sl {
namespace {

// 线路规定float为4字节、double为8字节，且浮点表示采用IEEE 754。
// 平台不符合时在编译期报错，避免编译成功却发送不兼容的浮点字节。
static_assert(sizeof(float) == 4 && sizeof(double) == 8);
static_assert(std::numeric_limits<float>::is_iec559 && std::numeric_limits<double>::is_iec559);

// 写入器：把各字段按协议顺序追加到二进制缓冲区；也复用于24字节通用头。
class Writer {
 public:
  // std::string在这里是字节容器，允许包含'\0'，其size()才是实际字节数。
  std::string bytes;

  // scalar写入一个整数或浮点字段；T的宽度决定其在线路上占用的字节数。
  template <typename T> void scalar(const T &value) {
    // uint16线路长度包含外层string的4字节前缀，业务payload最多65531字节。
    if (bytes.size() + sizeof(T) > max_business_payload_size) {
      throw ProtocolError("payload exceeds uint16 length");
    }
    // if constexpr按T在编译期选择分支，整数类型不会编译浮点分支，反之亦然。
    if constexpr (std::is_floating_point_v<T>) {
      using Bits = std::conditional_t<sizeof(T) == 4, std::uint32_t, std::uint64_t>;
      Bits bits;
      // memcpy保留浮点数的原始位模式，并避免指针强转造成严格别名违规。
      // 再用整数分支以小端写出这些位，不做float -> integer数值转换。
      std::memcpy(&bits, &value, sizeof(T));
      scalar(bits);
    } else {
      static_assert(std::is_integral_v<T>);
      // 先转为同宽无符号类型；有符号负数按模2^位宽转换，得到协议的补码位模式。
      auto bits = static_cast<std::make_unsigned_t<T>>(value);
      // 从最低有效字节开始写。例如uint32_t的0x12345678写成78 56 34 12。
      for (std::size_t i = 0; i < sizeof(T); ++i) {
        bytes.push_back(static_cast<char>((bits >> (8 * i)) & 0xFF));
      }
    }
  }

  // C++17逗号折叠表达式：按参数从左到右依次调用scalar，保持字段顺序。
  template <typename... T> void fields(const T &...value) { (scalar(value), ...); }

  // vector在线路上不是C++容器内存，而是uint32元素数 + 逐项编码的元素。
  // element_size是每项的线路字节数（不是sizeof(T)），element负责该项的字段顺序。
  template <typename T, typename F>
  void vector(const std::vector<T> &values, std::size_t element_size, F element) {
    // 先限制元素数，再检查已有字节+4字节计数+全部元素，保证乘法和长度受控。
    // 本文件所有调用都传入固定、非零的element_size。
    if (values.size() > max_business_payload_size / element_size ||
        bytes.size() + 4 + values.size() * element_size > max_business_payload_size) {
      throw ProtocolError("vector exceeds uint16 payload length");
    }
    // 空vector仍写入4字节的0计数，因此不等于空payload。
    scalar(static_cast<std::uint32_t>(values.size()));
    for (const auto &value : values) { element(value); }
  }
};

// 读取器：在string_view指向的原始字节上移动游标，不复制整份输入缓冲区。
// 输入字节的所有者须在读取期间保持有效；解码出的业务结构体独立保存字段值。
class Reader {
 public:
  explicit Reader(std::string_view bytes) : bytes_(bytes) {}

  template <typename T> void scalar(T &value) {
    // 在移动游标前检查完整字段是否存在，截断报文不能越界读取。
    if (remaining() < sizeof(T)) { throw ProtocolError("truncated field"); }
    if constexpr (std::is_floating_point_v<T>) {
      using Bits = std::conditional_t<sizeof(T) == 4, std::uint32_t, std::uint64_t>;
      Bits bits;
      // 与Writer相反：先读同宽整数的位模式，再原样还原float/double。
      scalar(bits);
      std::memcpy(&value, &bits, sizeof(T));
    } else {
      static_assert(std::is_integral_v<T>);
      using Bits = std::make_unsigned_t<T>;
      Bits bits = 0;
      // 每个字节先转unsigned char，避免char为有符号类型时发生符号扩展。
      // 第i个字节放到第8*i位，按小端组装；position_随读取递增。
      for (std::size_t i = 0; i < sizeof(T); ++i) {
        bits |= static_cast<Bits>(static_cast<unsigned char>(bytes_[position_++])) << (8 * i);
      }
      // 有符号字段：最高位为0时可直接转换；为1时用-1-(按位取反后的值)还原负数。
      // 取反后的值在有符号正数范围内，避免把超范围无符号数直接强转为有符号数。
      if constexpr (std::is_signed_v<T>) {
        constexpr auto high = static_cast<Bits>(std::numeric_limits<T>::max());
        value = bits <= high ? static_cast<T>(bits) :
          static_cast<T>(-1 - static_cast<T>(static_cast<Bits>(~bits)));
      } else {
        value = bits;
      }
    }
  }

  // 与Writer的fields共享调用形式，这里的参数是待填充字段的引用。
  template <typename... T> void fields(T &...value) { (scalar(value), ...); }

  template <typename T, typename F>
  void vector(std::vector<T> &values, std::size_t element_size, F element) {
    std::uint32_t count;
    scalar(count);
    // 先用剩余字节验证计数，再resize；禁止恶意计数触发巨大分配。
    // 使用除法判断，而不是count*element_size，避免乘法溢出。
    if (count > remaining() / element_size) { throw ProtocolError("invalid vector count"); }
    values.resize(count);
    for (auto &value : values) { element(value); }
  }

  // position_从0开始，所有读取都先做边界检查，因此不会超过bytes_.size()。
  std::size_t remaining() const { return bytes_.size() - position_; }
  void finish() const {
    // 解码结束必须刚好消费整个payload，拒绝字段之后夹带额外字节的报文。
    if (remaining() != 0) { throw ProtocolError("trailing payload bytes"); }
  }

 private:
  std::string_view bytes_;
  std::size_t position_{};
};

// 每种payload只定义一份字段列表：Archive为Writer时写出，为Reader时填入。
// 编码时Variant可为const Payload，解码时为可修改Payload；auto&自动保留const属性。
// std::get按msg_id取得variant中的具体结构体；类型不匹配会抛bad_variant_access。
// 以下字段顺序是线协议的一部分，不能因为结构体布局或显示习惯而调整。
template <typename Archive, typename Variant>
void transfer(Archive &a, std::uint32_t msg_id, Variant &payload) {
  switch (msg_id) {
    // 单值命令：模式/机动控制为int32，限速为float(m/s)，两个开关为uint8。
    case id::mode: a.fields(std::get<Mode>(payload).value); break;
    case id::control: a.fields(std::get<Control>(payload).value); break;
    case id::speed_limit: a.fields(std::get<SpeedLimit>(payload).value); break;
    case id::obstacle: a.fields(std::get<Obstacle>(payload).value); break;
    case id::perception: a.fields(std::get<Perception>(payload).value); break;
    // 感知优先状态也是单字节，但它是上报消息，使用独立的variant类型。
    case id::perception_state: a.fields(std::get<PerceptionState>(payload).value); break;
    case id::target:
    case id::path:
    case id::home:
    case id::patrol: {
      auto &m = std::get<TaskMission>(payload);
      a.fields(m.mission_id);
      // 四类任务复用内存模型，但线路不同：仅巡逻有patrol_num，返航/巡逻有type。
      if (msg_id == id::patrol) { a.fields(m.patrol_num); }
      if (msg_id == id::home || msg_id == id::patrol) { a.fields(m.type); }
      // TaskPoint每项29字节：3个double(24) + property:uint8(1) + reserved:uint32(4)。
      // 纬度、经度使用十进制度，heading_angle使用弧度；此处不换算坐标或单位。
      a.vector(m.task_points, 29, [&](auto &p) {
        a.fields(p.latitude, p.longitude, p.heading_angle, p.property, p.reserved);
      });
      break;
    }
    case id::mission_state: {
      auto &m = std::get<MissionState>(payload);
      // 任务状态共7字节：ID:uint32，类型/状态/进度各uint8。
      // 0未开始、1运行、2暂停、3终止、4完成、5失败；进度由业务层提供0~100。
      a.fields(m.mission_id, m.type, m.state, m.process);
      break;
    }
    case id::system_state: {
      auto &m = std::get<AutoSystemState>(payload);
      auto &v = m.video_config;
      // 系统状态按协议保留完整6字节视频配置，不能因业务不用视频而省略。
      a.fields(m.run_state, m.mode, m.speed_limit, v.video_enable, v.video_option,
               v.streams_set, v.resolution_set, v.video_source, v.mode);
      // 错误码列表每项uint16；列表计数依然是uint32。
      a.vector(m.err_list, 2, [&](auto &code) { a.fields(code); });
      break;
    }
    case id::localization: {
      auto &m = std::get<LocalizationInfo>(payload);
      // 定位共212字节：3个uint64时间戳 + 1字节AHRS状态 + 23个double + 3字节质量状态。
      // 依次为：采集/系统/UTC微秒时间；经纬高；东/北/上速度(m/s)；姿态；
      // 加速度；角速度；四元数(w,x,y,z)；Mercator坐标；曲率；定位质量状态。
      // 这里只保留传入值的字节表示，不生成时间戳、融合传感器或计算Mercator。
      a.fields(m.time_us, m.sys_time_us, m.utc_time, m.ahrs_status,
        m.longitude, m.latitude, m.altitude, m.vel_e, m.vel_n, m.vel_u,
        m.roll, m.pitch, m.yaw, m.acc_x, m.acc_y, m.acc_z,
        m.angular_vel_x, m.angular_vel_y, m.angular_vel_z,
        m.q_w, m.q_x, m.q_y, m.q_z, m.mercator_x, m.mercator_y, m.mercator_z,
        m.current_curvature, m.fix_type, m.fix_quality, m.fix_system_alignment_mode);
      break;
    }
    case id::planning_path: {
      auto &m = std::get<PlanningPath>(payload);
      // 路径点每项8字节，经度在前、纬度在后，均为int32，实际度数=线路值/1e7。
      a.vector(m.points, 8, [&](auto &p) { a.fields(p.longitude, p.latitude); });
      break;
    }
    case id::performance: {
      auto &m = std::get<SysPerformanceInfo>(payload);
      // 性能共20字节：5个float；CPU/内存为比例小数，上传/下载速率为byte/s。
      a.fields(m.cpu_usage, m.memory_usage, m.temperature, m.network_upload, m.network_download);
      break;
    }
    case id::failsafe: {
      auto &m = std::get<Failsafe>(payload);
      // 故障项9字节：类别uint8 + 等级int32 + 错误码uint32；编码不插入对齐字节。
      a.vector(m.faults, 9, [&](auto &f) { a.fields(f.fault_type, f.fault_level, f.error_code); });
      break;
    }
    case id::feedback: {
      auto &m = std::get<MissionFeedback>(payload);
      a.fields(m.status);
      // 受理反馈不是单字节：状态后必须有折返点vector（即使空，也有4字节计数）。
      // 每项9字节：type:uint8 + 经度int32 + 纬度int32，坐标缩放为1e6，区别于全局路径。
      a.vector(m.points, 9, [&](auto &p) { a.fields(p.type, p.lon, p.lat); });
      // 状态仅允许0正常/1有折返点/2错误；“状态为1”等价于“列表非空”。
      // 因此0/2携带非空列表、1携带空列表都会拒绝；编码与解码共同执行此校验。
      if (m.status > 2 || (m.status == 1) != !m.points.empty()) {
        throw ProtocolError("invalid feedback status/turnaround points");
      }
      break;
    }
    default: throw ProtocolError("unknown msg_id");
  }
}

// 解码前按ID创建正确的空variant分支，供transfer把线路字段填进去。
// 四类任务共享TaskMission；未知ID没有默认降级类型，直接拒绝。
Payload empty_payload(std::uint32_t msg_id) {
  switch (msg_id) {
    case id::mode: return Mode{};
    case id::control: return Control{};
    case id::speed_limit: return SpeedLimit{};
    case id::obstacle: return Obstacle{};
    case id::perception: return Perception{};
    case id::target: case id::path: case id::home: case id::patrol: return TaskMission{};
    case id::mission_state: return MissionState{};
    case id::system_state: return AutoSystemState{};
    case id::localization: return LocalizationInfo{};
    case id::planning_path: return PlanningPath{};
    case id::performance: return SysPerformanceInfo{};
    case id::failsafe: return Failsafe{};
    case id::perception_state: return PerceptionState{};
    case id::feedback: return MissionFeedback{};
    default: throw ProtocolError("unknown msg_id");
  }
}

// 业务payload只允许1~65531字节；外层另有4字节string长度，空vector仍有元素计数。
void check_payload_size(std::size_t size) {
  if (size == 0 || size > max_business_payload_size) { throw ProtocolError("invalid payload length"); }
}

}  // namespace

// CRC-16/CCITT-FALSE：poly=0x1021，init=0xFFFF，xorout=0，输入/输出均不反转。
// 帧校验覆盖线路payload（含string长度前缀），不包含topic或通用头。
std::uint16_t crc16(std::string_view bytes) {
  std::uint16_t crc = 0xFFFF;
  for (unsigned char byte : bytes) {
    // 将本字节异或到CRC高8位，再从最高位向最低位处理8次。
    crc ^= static_cast<std::uint16_t>(byte) << 8;
    for (int bit = 0; bit < 8; ++bit) {
      // 最高位为1：左移后异或生成多项式；否则仅左移。转换回uint16保留低16位。
      crc = static_cast<std::uint16_t>((crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1);
    }
  }
  return crc;
}

// 每个ID只能使用固定topic：控制开关/任务下发/状态上报分别走三个前缀。
// 返回值不带冒号，encode_frame统一添加；未知ID也在这里被拒绝。
std::string_view topic_for(std::uint32_t msg_id) {
  switch (msg_id) {
    case id::mode: case id::control: case id::speed_limit: case id::obstacle:
    case id::perception: return "ad_remote_command";
    case id::target: case id::path: case id::home: case id::patrol: return "call_task";
    case id::mission_state: case id::system_state: case id::localization:
    case id::planning_path: case id::performance: case id::failsafe:
    case id::perception_state: case id::feedback: return "ipc_message";
    default: throw ProtocolError("unknown msg_id");
  }
}

// 把业务variant编码为纯payload，不含通用头或topic。
std::string encode_payload(std::uint32_t msg_id, const Payload &payload) {
  Writer writer;
  try { transfer(writer, msg_id, payload); }
  // 把std::get的类型错误统一转换为本模块的协议异常，便于调用方统一捕获。
  catch (const std::bad_variant_access &) { throw ProtocolError("msg_id/payload type mismatch"); }
  check_payload_size(writer.bytes.size());
  return writer.bytes;
}

// 按ID解析纯payload；依次验证总长、具体字段/vector边界和无尾随字节。
Payload decode_payload(std::uint32_t msg_id, std::string_view bytes) {
  check_payload_size(bytes.size());
  auto payload = empty_payload(msg_id);
  Reader reader(bytes);
  transfer(reader, msg_id, payload);
  reader.finish();
  return payload;
}

// 生成单个ZMQ frame的内容：topic + ':' + header + payload，不使用multipart。
std::string encode_frame(const Message &message) {
  const auto topic = topic_for(message.msg_id);
  const auto payload = encode_payload(message.msg_id, message.payload);
  Writer prefix;
  prefix.scalar(static_cast<std::uint32_t>(payload.size()));
  const auto wire_payload = prefix.bytes + payload;
  Writer header;
  // 通用头顺序及宽度：ID(4) + 来源系统ID(8) + 目标系统ID(8) + len(2) + CRC(2) = 24。
  // 线路payload包含string长度前缀；len和CRC均覆盖此前缀与业务字节。
  header.fields(message.msg_id, message.system_id, message.target_system_id,
    static_cast<std::uint16_t>(wire_payload.size()), crc16(wire_payload));
  return std::string(topic) + ':' + header.bytes + wire_payload;
}

// 解析并校验完整单帧；任何不符合线路格式的输入均抛ProtocolError。
// 此函数不按本车ID过滤，也不负责ZMQ multipart检查，这些由接收节点处理。
Message decode_frame(std::string_view frame) {
  // 先限制整帧长度：最长topic及冒号18字节 + 通用头24字节 + 最大payload。
  if (frame.size() > max_frame_size) { throw ProtocolError("frame too large"); }
  // 只找第一个冒号；二进制头/payload本身可以含0x3A，不能继续按冒号切分。
  const auto colon = frame.find(':');
  if (colon == std::string_view::npos) { throw ProtocolError("missing topic delimiter"); }
  const auto topic = frame.substr(0, colon);
  if (topic != "ad_remote_command" && topic != "call_task" && topic != "ipc_message") {
    throw ProtocolError("unknown topic");
  }
  const auto binary = frame.substr(colon + 1);
  if (binary.size() < header_size) { throw ProtocolError("truncated header"); }
  Message message;
  std::uint16_t length, checksum;
  // 限定Reader只能看到通用头，随后将剩下的字节全部视为线路payload。
  Reader header(binary.substr(0, header_size));
  header.fields(message.msg_id, message.system_id, message.target_system_id, length, checksum);
  const auto payload = binary.substr(header_size);
  if (payload.size() > max_payload_size) { throw ProtocolError("invalid payload length"); }
  // len不含topic和头；先检查实际长度和CRC，再确认topic与ID的归属一致。
  // 只有这些校验通过后才解码具体字段，调用方不会收到半解析的Message。
  if (length != payload.size()) { throw ProtocolError("len differs from payload length"); }
  if (crc16(payload) != checksum) { throw ProtocolError("payload CRC mismatch"); }
  if (topic != topic_for(message.msg_id)) { throw ProtocolError("topic/msg_id mismatch"); }
  std::uint32_t content_length;
  Reader prefix(payload);
  prefix.scalar(content_length);
  if (content_length != prefix.remaining()) { throw ProtocolError("string length differs from payload length"); }
  message.payload = decode_payload(message.msg_id, payload.substr(string_length_size));
  return message;
}

// 目标0是广播，目标等于本车system_id是单车指令；其他目标由接收节点忽略。
// 这里只判断目标，不鉴权来源，也不执行任何业务动作。
bool addressed_to(const Message &message, std::uint64_t system_id) {
  return message.target_system_id == 0 || message.target_system_id == system_id;
}

}  // namespace ros2_zmq_server_sl
