# 车长侧 ↔ 仿真自驾端 ZMQ 对接协议

- **版本号: V2.0**
- **修订时间: 2026.10.23**

## 1. 角色、通道与单帧格式

车长侧扮演原表“决策”：发送模式、任务和控制，接收状态。`isr-simulation` **只模拟“自驾”**：接收并处理车长消息，执行内部仿真任务，发布反馈与状态；不会替车长构造或主动下发任务。

| 方向 | topic | 自驾模拟端 | 车长端 | TCP 端口 |
| --- | --- | --- | --- | ---: |
| 车长 → 自驾 | `ad_remote_command` | SUB，`bind` | PUB，`connect` | 10001 |
| 车长 → 自驾 | `call_task` | 同上 | 同上 | 10001 |
| 自驾 → 车长 | `ipc_message` | PUB，`bind` | SUB，`connect` | 11001 |

三者都是话题类接口。**自驾模拟端负责两个端口的 `bind`，车长端负责全部 `connect`。** 自驾端绑定 `tcp://<本机监听地址>:10001` 和 `tcp://<本机监听地址>:11001`；车长端分别连接 `tcp://<自驾端可达IP>:10001` 和 `tcp://<自驾端可达IP>:11001`。原表 `127.0.0.1` 只是本机示例。每条业务消息占**一个 ZMQ frame**：

```text
ASCII(topic) | 0x3A | binary(OutdataMessage)
```

`0x3A` 是半角冒号 `:`，不加空格；接收端只按**第一个** `0x3A` 分割，后面的二进制内容不可再按冒号拆分。三个二进制消息头在 frame 中的起始偏移分别是：`call_task:` 之后第 10 字节、`ad_remote_command:` 之后第 18 字节、`ipc_message:` 之后第 12 字节（从 0 计数）。若使用 ZMQ SUB 前缀过滤，订阅完整的 `topic:` 前缀，再按 `msg_id` 分发。

## 2. 序列化与通用头

字段按下表和 §5～6 的顺序编码；多字节数值采用**小端**。`int` 和 `unsigned int` 均占 **4 字节**，`float` 占 **4 字节**，`double` 占 **8 字节**，`bool` 占 **1 字节**，多字节字段按小端编码；结构体字段之间**没有 padding**。每遇到 `std::vector<T>`，先写入小端 `uint32_t length`，**length 是元素个数**，再逐个编码元素；空 vector 写 4 字节零，嵌套 vector 逐层执行。`OutdataMessage.payload` 直接放原始二进制 payload 字节，不再加 `std::string` 长度前缀。

`OutdataMessage` 逻辑结构：

| 顺序 | 类型 | 字段 | 说明 |
| ---: | --- | --- | --- |
| 1 | `uint32_t` | `msg_id` | 下表消息 ID |
| 2 | `uint64_t` | `system_id` | 发送方系统 / 车辆 ID |
| 3 | `uint64_t` | `target_system_id` | 接收目标；原表规定 0 表示所有车辆 |
| 4 | `uint16_t` | `len` | **仅计算 payload 的字节数**，不计 `topic:` 和 24 字节通用头 |
| 5 | `uint16_t` | `checksum` | 序列化后 payload 字节的 CRC-16/CCITT-FALSE；字段按小端写入 |
| 6 | `std::string` | `payload` | 按 message ID 选择的原始二进制载荷；无线路字符串长度前缀 |

**CRC 已确认：**对序列化后的 `payload` 字节计算 CRC-16/CCITT-FALSE；多项式 `0x1021`，初始值 `0xFFFF`，输入不反转（`refin=false`），输出不反转（`refout=false`），最终异或 `0x0000`。`topic:` 和通用头不参与校验。标准检查向量：ASCII `123456789` → CRC `0x29B1`；写入小端 `checksum` 字段时字节为 `B1 29`。

前五个定宽字段合计 **24 字节**。`len` 的类型是 `uint16_t`，必须等于实际 payload 字节数，最大为 65535。**本轮所有消息均有非空 payload**（空 vector 仍含 4 字节长度前缀）；发送或接收时发现空 payload、超长 payload、`len` 与实际字节数不符或报文不足 24 字节，立即输出 `error_log` 并返回，不发布消息、不调用 ROS2 业务，也不产生 `OutdataReturn`。

**本轮不使用 `OutdataReturn`。**旧接口表保留的该输出栏不参与车长与仿真自驾端的开发、发送、接收或验收；任务下发结果以 `0x10000028 MissionStatusFeedbak` 为准，执行状态以 `0x10000000 MissionState` 为准。

## 3. 当前消息清单

### 车长 → 自驾：`ad_remote_command`

| ID | 命令 | payload | 取值 |
| --- | --- | --- | --- |
| `0x00000001` | 自驾模式切换 | `int` | 本次任务用：路径 1、目标点 3、返航 4、巡逻 5；0 空闲。旧表另列跟踪 2、废弃轨迹 6、编队 7、编排 8、航线 9，本次没有对应任务接口 |
| `0x00000002` | 机动控制 | `int` | 1 开始、2 暂停、3 恢复、4 结束；不含 `mission_id` |
| `0x00000003` | 车速限制 | `float` | m/s |
| `0x00000004` | 单车绕障 | `uint8_t` | 1 开启绕障、0 关闭（遇障停车） |
| `0x00000020` | 感知优先 | `uint8_t` | 0 关闭、1 开启（默认） |

新表 `0x00000004` 的“接口类型”单元格为空，但 topic 和载荷明确列出；本文将它归于 `ad_remote_command`，最终以双方实测消息为准。

### 车长 → 自驾：`call_task`

| ID | 任务 | payload | 模式切换值 | `MissionState.type` | 说明 |
| --- | --- | --- | ---: | ---: | ---: |
| `0x0000000A` | 目标点 | `TargetPointMisson` | 3 | 1 | 根据目标点和必经点借助路网来规划完整路线 |
| `0x0000000B` | 路径跟随 | `PathFollowMission` | 1 | 2 | 不使用路网严格踩点行进 |
| `0x0000000D` | 返航 | `ReturnHomeMission` | 4 | 4 | |

这四行在新表均标“话题”。旧表中的 `OutdataReturn` 输出栏本轮不使用；车长端接收 `0x10000028` 任务下发反馈和 `0x10000000` 执行状态。

### 自驾 → 车长：`ipc_message`

| ID | 上报 | payload | 新表频率 |
| --- | --- | --- | --- |
| `0x10000000` | 自驾任务状态 | `MissionState` | 1 Hz |
| `0x10000001` | 自驾系统状态 | `AutoSystemState` | 1 Hz |
| `0x10000002` | 单车定位 | `LocalizationInfo` | 100 Hz |
| `0x10000004` | 全局路径 | `PlanningPath` | 收到任务后一次 |
| `0x10000020` | 系统性能 | `SysPerformanceInfo` | 1 Hz |
| `0x10000021` | failsafe 故障码 | `std::vector<OutPutData>` | 1 Hz |
| `0x10000024` | 感知优先状态 | `uint8_t` | 0.1 Hz（每10秒）；0 关闭、1 开启（默认） |
| `0x10000028` | 任务下发响应 | `MissionStatusFeedbak` | 路径规划完成1秒后发送 |

故障码以 `0x10000021` failsafe 上报为准。`0x10000028` 使用 **V4.2.1 结构体**，不能按早期单个 `uint8_t` 版本解码。新表另外列 `0x10000005` 局部路径但注明“自驾自用”；`0x1000000A/B/C` 只有 ID、没有消息定义，均不属于当前车长对接范围。其余旧 Excel ID 也不属于本次清单。

## 4. 车长侧必须执行的任务时序

**先切对应模式 → 等新模式回显 → 下发任务 → 再发 START。** 四类任务的模式值见 §3。模式值与 `MissionState.type` 是不同枚举，目标点即模式 3、任务类型 1。车长侧不要把任务类型直接作为切模式 payload。

```text
车长 → 自驾  ad_remote_command / 0x00000001 / 对应模式值
车长 ← 自驾  ipc_message / 0x10000001 / 本车新的 AutoSystemState.mode == 对应模式值
车长 → 自驾  call_task / 对应任务 ID / 含 mission_id 的任务载荷
车长 ← 自驾  ipc_message / 0x10000028 / 状态 0 或 1 才继续，状态 2 停止本次流程
车长 → 自驾  ad_remote_command / 0x00000002 / 1（START）
车长 ← 自驾  ipc_message / 0x10000000 / RUNNING → 终态
```

车长侧必须在发切模式命令后，收到**本车新发布的** `AutoSystemState.mode` 与目标值一致，才发任务；旧缓存状态不能满足门槛。等待回显超时则**重发相同模式设置指令**，仍未匹配时不发任务。具体超时和重发次数见 §7。仿真自驾端负责切换并回显模式、接收任务和在收到 START 后启动执行；单独收到任务不会启动车辆。

`0x10000028` 的状态为 0 正常、1 折返警告、2 错误。**START 前必须收到本次任务的 `0x10000028`，且状态不能为 2；状态 0 或折返警告 1 均可 START。**该结构没有 `mission_id`；自驾端在内部维护唯一当前底盘任务及其下发ID，不允许同时执行两个不同的底盘任务。车长侧串行下发并等待本次反馈，不能并发提交多个任务后猜测反馈归属。反馈在规划完成1秒后发送，不是收到任务指令1秒后发送；提供的路径无需重规划时以路点校验完成作为起点。ZMQ `send()` 成功只表示进入发送队列，不等于自驾端已受理。`0x00000002` 也没有 `mission_id`，按唯一当前底盘任务处理。本轮没有载荷任务。

`MissionState.state`：0 未开始、1 运行中、2 已暂停、3 已终止、4 正常完成、5 失败；`process` 范围 0～100。暂停用机动控制值 2，恢复用 3，结束用 4。回执、执行状态、通信失败和设备故障必须分别处理。

## 5. 车长下发 payload 的完整字段顺序

以下类型名保持原表拼写。每个 `task_points` 都按 §2 的 vector 元素个数规则编码。

```text
TargetPointMisson / PathFollowMission:
  unsigned int mission_id
  std::vector<TaskPoint> task_points

ReturnHomeMission:
  unsigned int mission_id
  unsigned char type       # 0 历史轨迹返航；1 重规划返航
  std::vector<TaskPoint> task_points  # 原表允许为空

TaskPoint:
  double latitude        # 纬度，双精度角度值
  double longitude       # 经度，双精度角度值
  double heading_angle    # 弧度，规定为0，这里不处理
  uint8_t property        # 1 必达；2 途经（默认）
  uint32_t reserved
```

## 6. 自驾上报 payload 的完整字段顺序

```text
MissionState (0x10000000):
  unsigned int id
  unsigned char type      # 1目标点 2路径 3跟踪 4返航 5巡逻 6废弃 7编队 8编排 9航线
  unsigned char state     # 0未开始 1运行 2暂停 3终止 4完成 5失败
  unsigned char process   # 0..100

AutoSystemState (0x10000001):
  uint8_t run_state       # 0异常；1正常
  uint8_t mode            # 0空闲 1路径 2跟踪 3目标点 4返航 5巡逻 6废弃 7编队
  float speed_limit      # m/s
  VideoProperty video_config   # 忽视
  std::vector<uint16_t> err_list # 错误码以下方的failsafe为准

VideoProperty:
  uint8_t video_enable, video_option, streams_set
  uint8_t resolution_set, video_source, mode

LocalizationInfo (0x10000002):
  uint64_t time_us, sys_time_us, utc_time  # 均为微秒；分别为传感器采集、系统、UTC 时间
  uint8_t ahrs_status
  double longitude, latitude, altitude  # 经纬度为 WGS84 十进制度；海拔基准待确认
  double vel_e, vel_n, vel_u  # m/s；分别为东、北、上方向
  double roll, pitch, yaw  # yaw 为 0° 时朝向正东
  double acc_x, acc_y, acc_z
  double angular_vel_x, angular_vel_y, angular_vel_z
  double q_w, q_x, q_y, q_z
  double mercator_x, mercator_y, mercator_z
  double current_curvature
  uint8_t fix_type, fix_quality, fix_systemAlignmentMode

PlanningPath (0x10000004):
  std::vector<WayPoint> points
WayPoint:
  int32_t longitude      # 经度 × 1e7
  int32_t latitude       # 纬度 × 1e7

SysPerformanceInfo (0x10000020):
  float cpu_usage, memory_usage   # 小数，如 0.35 表示 35%
  float temperature
  float network_upload, network_download  # byte/s

failsafe (0x10000021):
  std::vector<OutPutData>  # 整个 payload，前置 uint32_t 元素个数
OutPutData:
  FaultInfo faultInfo
  uint32_t errorCode
FaultInfo:
  uint8_t faultType      # 0部件 1功能 2系统
  int faultLevel         # 3警告 2限速 1急停 0正常

感知优先状态 (0x10000024):
  uint8_t               # 0关闭；1开启

MissionStatusFeedbak (0x10000028):
  uint8_t mission_status_feeedback # 0正常 1折返警告 2错误
  std::vector<TurnaroundPoint> turnaroundpoints
TurnaroundPoint:
  uint8_t type           # 0 折返点
  int32 lon              # 经度 × 1e6
  int32 lat              # 纬度 × 1e6
```

`fix_type`：0 默认、1 GNSS 有效、2 GNSS 无效、3 备用。`fix_quality`：0 不可用、1 单点、2 差分、3 无效 PPS、4 RTK Fix、5 RTK 浮点、6 正在估算。`fix_systemAlignmentMode`：0 准备、1 粗对准、2 精对准、3 对准完成。`turnaroundpoints` 仅状态 1 时有折返点；原表以 `181 × 1e6` 表示无效经纬度。`vel_e/vel_n/vel_u` 的速度单位为 **m/s**。其他未确认的数据语义见 §8。

## 7. 启动、断线重连与联调

**启动顺序：**仿真自驾端先启动并完成 10001/11001 的 `bind`，随后车长侧 `connect`，先订阅 `ipc_message:`。车长侧收到第一条新的 `0x10000001 AutoSystemState` 后，再发送模式切换。由于 PUB/SUB 建链期可能丢消息，模式命令是否到达以新的 `AutoSystemState.mode` 回显为准，不以 `send()` 成功为准。

**模式重发：**从每次发送 `0x00000001` 起等待 **3 秒**（系统状态为 1 Hz）。未见本车新状态回显目标模式，重发**相同模式值**；最多发送 **3 次**（含首次）。三次仍未匹配则本次任务流程失败、记录超时且**不发送 `call_task`**。收到其他模式值不算成功，也不提前启动任务。

**断线重连：**车长侧两个 `connect` socket 保持存活，设置 `ZMQ_RECONNECT_IVL=1000 ms`、`ZMQ_RECONNECT_IVL_MAX=5000 ms`，由 libzmq 对断开的 TCP 连接自动重试（参数含义见 [libzmq 官方文档](https://libzmq.readthedocs.io/en/latest/zmq_setsockopt.html)）。连续 **3 秒**收不到新的 1 Hz `AutoSystemState`，车长侧标记自驾端离线，暂停新任务下发；仿真端仍保持 `bind` 并持续发布周期状态。重新收到新状态后，车长侧重新发送所需模式并等待回显，再继续后续业务。断线前已下发的任务和 START **不自动重发**；先用 `MissionState.id/state` 对账，避免重复创建或误启动任务。若 socket 本身报错，可重建该侧 socket 并重新 `connect`/订阅。

### 联调最小用例

1. 建链并订阅 `ipc_message:`；核对 `AutoSystemState` 1 Hz 和 `LocalizationInfo` 100 Hz，确认目标车辆 ID。
2. 对四种任务分别按 §4 执行模式、回显、任务、START；检查 `MissionStatusFeedbak`、`MissionState` 的 ID/类型/状态/进度，以及全局路径一次上报。
3. 分别测试暂停、恢复、结束；模式回显超时后重发同一模式指令，仍不匹配则车长不发任务；任务响应为 2 时不发 START，响应为 1（折返警告）时允许 START；任务已下发但未 START 时自驾不启动车辆。
4. 测试空返航路点、多个路点、非空折返点、空/非空 failsafe；核对 vector 前缀都是元素个数。
5. 测试断线、重连、重复任务、反馈超时；空 payload、超过 65535 字节和 `len` 不匹配时应记录 `error_log` 并返回。传输未知、业务拒绝、执行失败应在日志中区分。

## 8. 仍需对齐的数据语义

`LocalizationInfo.altitude` 的海拔基准和 `mercator_x/y/z` 的坐标定义仍需样例。

`LocalizationInfo.time_us/sys_time_us/utc_time` 的时钟基准（仿真时钟还是 Unix UTC）及仿真暂停、重置时的变化仍待确认。

车长开发者可先完成已确认的消息模型和机动流程；上述数据语义需在定位与状态联调前签定。

建议先交换四组**完整原始单帧字节**及字段值：模式切换 `0x00000001`、含两个路点的 `0x0000000B`、含折返点的 `0x10000028`、含故障项的 `0x10000021`。这些样例同时校验 frame、定宽类型、vector、`len` 和 CRC 的具体报文字段值。

## 9.注意事项

1. 最新确认：遇到障碍而停车时，没有专门报告“遇到障碍”的事件消息；正常定义的定位、任务、系统等消息均继续发布。不得关闭周期发布或仅因遇障停车构造任务失败、暂停和failsafe故障。
2. 不新增向车长发送的绕障话题/消息。协议已有的 `0x00000004` 是车长通过 `ad_remote_command` 下发的开关，不是自驾向车长报告遇障的事件。
