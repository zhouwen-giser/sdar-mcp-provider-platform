# SDAR UGV Provider 接口协议说明
## Work 模式实施合同 V1.0

> **文档状态：** UGV Provider Profile Contract  
> **用途：** 作为 `SDAR_UGV_Provider_Codex_Work_Task_Package_V1.1.md` 的必需接口合同输入  
> **适用范围：** UGV Provider Runtime、UGV Provider Adapter、UGV MQTT Ingress、UGV Device MCP Client、Mock UGV 环境及其测试  
> **不适用范围：** NPC Tank Provider、Referee Provider、上层任务编排、红蓝对抗目标判定  
> **协议策略：** 不修改现有冻结 MCP/Adapter/Business Events Wire；本文件只冻结 UGV Provider 专题 Profile  
> **版本：** 1.0  
> **日期：** 2026-07-23  

---

# 0. 文档定位

现有资料分别解决了不同问题：

1. `SDAR_MCP_Tasks_Unified_Protocol_Profile_V1.0_FROZEN`
   - 冻结 Runtime 对外 MCP Tasks、Availability、Task Notification、Evidence 等通用协议；
2. ISR-Simulation UGV/NPC 接口报告
   - 罗列仿真系统已有 MQTT Topic、消息类型、设备 MCP 工具和数据来源；
3. `SDAR_UGV_Provider_Codex_Work_Task_Package_V1.1`
   - 规定 Work 模式的实现范围、工程交付和测试要求。

三者之间仍缺少一份**可直接编码和验收的 UGV 专题接口合同**。本文件补齐：

```text
外部接口盘点
→ 规范化 Wire 读取规则
→ UGV Provider Operation Contract
→ 状态/任务/错误映射
→ 幂等与恢复语义
→ Business Event / Evidence Contract
→ Contract Capture 与 Blocker 规则
```

本文件不是新的基础协议，不得修改：

```text
MCP Base Protocol
SEP-2663 Tasks Extension
SDAR Unified Protocol Profile
Adapter Proto
Business Events Wire
Provider Telemetry Ingress
Provider Ops Envelope
```

---

# 1. 规范性等级

本文件使用以下关键词：

```text
MUST / 必须
MUST NOT / 禁止
SHOULD / 应当
SHOULD NOT / 不应
MAY / 可以
```

接口条目分为三种状态。

## 1.1 Inherited Frozen

直接继承现有冻结协议，本文仅引用，不重新定义：

```text
MCP Protocol Version
Task Wire Shape
Availability Envelope
tasks/get
tasks/update
tasks/cancel
Task Notification
Evidence Envelope
Business Events Wire
Adapter Protocol RPC
```

如果本文与冻结协议冲突，以冻结协议和当前仓库中的共享 Schema/Proto 为准，并产生：

```text
UGV_PROFILE_FROZEN_PROTOCOL_CONFLICT
```

## 1.2 UGV Profile Frozen

本次冻结并作为实现验收依据：

```text
providerId / resourceId
UGV Operation 名称
Operation 输入输出
UGV 状态模型
MQTT Topic Allowlist
任务轨道
设备状态映射
Reason Code
Business Event Type
Evidence Type
安全隔离规则
```

该部分后续修改必须发布本文件 V1.1 或更高版本。

## 1.3 Capture Required

当前来源资料未给出精确 Wire 字段，必须从真实接口捕获：

```text
设备 MCP 每个工具的实际 inputSchema
设备 MCP 返回 Content/Structured Content 形态
是否返回稳定 Mission ID
MQTT ROS2 Bridge 的精确 JSON Envelope
载荷异常的精确字段和错误码
Gimbal 角度单位
Area Recon Polygon 的实际字段命名
```

Capture Required 项不得由 Codex 推测为正式合同。

---

# 2. 权威输入和完整性锁

## 2.1 Work 任务包

```text
文件：
SDAR_UGV_Provider_Codex_Work_Task_Package_V1.1.md

SHA-256：
5a7339cacd0f216094c244c10b79701fef2a767d9acce88d28123b4c815c1f53
```

## 2.2 ISR-Simulation 接口报告

```text
文件：
粘贴的 markdown (1)。md(21)

建议入库名称：
docs/requirements/ISR-Simulation_UGV_NPC_Tank_Interface.md

SHA-256：
a67b7909ec7af7b3757e77cbaf5bae1c600fe348daa7faf239d8715d89fa375c
```

## 2.3 冻结通用协议

Work 执行时必须使用项目副本中现有冻结协议资产及其 Lock。

本文件不固定仓库外的绝对路径；Work 启动时必须输出：

```text
reports/ugv-provider-v1/protocol-input-lock.json
```

至少包含：

```json
{
  "workTaskPackage": {
    "name": "SDAR_UGV_Provider_Codex_Work_Task_Package_V1.1.md",
    "sha256": "5a7339cacd0f216094c244c10b79701fef2a767d9acce88d28123b4c815c1f53"
  },
  "ugvInterfaceSource": {
    "name": "ISR-Simulation_UGV_NPC_Tank_Interface.md",
    "sha256": "a67b7909ec7af7b3757e77cbaf5bae1c600fe348daa7faf239d8715d89fa375c"
  },
  "ugvProfile": {
    "name": "SDAR_UGV_Provider_Interface_Protocol_Profile_V1.0.md",
    "sha256": "<generated>"
  },
  "frozenProtocolAssets": [
    {
      "path": "<project-relative-path>",
      "sha256": "<calculated>"
    }
  ]
}
```

---

# 3. 分层架构和边界

```text
External MCP Client
        │
        │ Frozen MCP Tasks / Business Events
        ▼
UGV Provider Runtime
        │
        │ Frozen Adapter Protocol gRPC
        ▼
UGV Provider Adapter
    ┌───┴───────────────────┐
    │                       │
MQTT Ingress          UGV Device MCP
状态/观测              查询/控制
```

## 3.1 UGV Provider 权威范围

UGV Provider 只对以下事实负责：

```text
UGV 自身底盘状态
UGV 自身载荷状态
UGV 自身观测目标
UGV 本地设备任务状态
UGV 本地控制命令
UGV 本地故障
UGV 本地火控动作
```

## 3.2 明确禁止的数据域

UGV Provider 禁止消费、存储、推导或发布：

```text
HP
裁判弹药
存活裁决
Hit / Miss
Destroyed
Damage / Remaining HP
CARLA 全局实体真值
全局障碍真值
通信丢失区域
裁判事件
异常注入状态
NPC Tank 状态
```

## 3.3 “本地火控完成”边界

```text
vehicle_fire_weapon succeeded
=
UGV 本地火控动作获得设备状态确认

vehicle_fire_weapon succeeded
≠
命中
未命中
目标摧毁
伤害生效
```

设备 MCP 返回的裁判型字段必须丢弃。

---

# 4. 身份、版本和端点

## 4.1 Provider Identity

```yaml
providerId: isr.vehicle.ugv.ugv1
providerType: isr.vehicle.ugv
providerProfileVersion: "1.0"
providerComponentVersion: "0.1.0"
```

## 4.2 Resource Identity

```yaml
resourceId: vehicle:ugv1
resourceType: isr.vehicle.ugv
entityId: ugv1
roleName: ugv
mqttNamespace: /ugv
```

规则：

1. `/ugv` 是 Topic 命名空间，不等于实体 ID；
2. 消息包含 `entity_id` 时必须等于配置的 `ugv1`；
3. 消息包含 `role_name` 时必须等于 `ugv`；
4. 不匹配消息必须拒绝，Reason：

```text
UGV_ENTITY_ID_MISMATCH
UGV_ROLE_NAME_MISMATCH
```

## 4.3 默认端点

```yaml
runtimeMcpUrl: http://127.0.0.1:19100/mcp
adapterGrpcEndpoint: 127.0.0.1:7010
deviceMcpUrl: http://127.0.0.1:19000/mcp
```

默认值只能用于开发环境；生产必须配置。

---

# 5. 通用 MCP Tasks 继承规则

UGV Runtime 对外必须继承冻结协议。

## 5.1 Tool Name 精确绑定

本文冻结以下 Tool/Operation 名称：

```text
vehicle_get_state
vehicle_get_payload_status
vehicle_get_targets
vehicle_laser_range
vehicle_navigate
vehicle_area_recon
vehicle_track_target
vehicle_fire_weapon
vehicle_emergency_stop
```

客户端、Manifest、Availability、Adapter 和测试必须使用完全一致的名称。

禁止自动进行：

```text
snake_case ↔ dot.name
大小写转换
别名转换
旧 Tool 名兼容
```

## 5.2 Task Behavior

```text
SYNCHRONOUS
→ Runtime 同步 CallToolResult

TASK_REQUIRED
→ Server-directed Task
→ Flat CreateTaskResult
```

业务接纳拒绝：

```text
CallToolResult
resultType = complete
isError = true
structuredContent.outcome = admission_rejected
```

设备或领域业务失败：

```text
Task.status = completed
CallToolResult.isError = true
structuredContent.outcome = failed | uncertain
```

只有底层请求无法形成正常业务 Result 的技术失败才映射：

```text
Task.status = failed
JSON-RPC error
```

## 5.3 Task Wire

必须使用冻结字段：

```text
taskId
status
createdAt
lastUpdatedAt
ttlMs
pollIntervalMs
inputRequests
inputResponses
```

禁止：

```text
ttl
pollInterval
tasks/result
tasks/list
旧 inputs 数组
Nested CreateTaskResult
```

## 5.4 Fire Confirmation

`vehicle_fire_weapon` 必须使用标准 MRTR：

```text
Task.status = input_required
inputRequests["fire-approval"] = elicitation/create
```

`tasks/update` 通过：

```text
inputResponses["fire-approval"]
```

提交确认。

`tasks/update` 返回空 Ack，不返回 Task Snapshot。

---

# 6. Adapter Protocol 合同

UGV Adapter 必须实现现有 Adapter Protocol RPC：

```text
DescribeProvider
ListResources
CheckAvailability
StartOperation
GetExecution
ReconcileExecution
RequestCancel
UpdateExecution
PauseExecution
ResumeExecution
StreamExecutionEvents
StreamBusinessEvents
```

## 6.1 必需身份字段

每个被接纳的长期执行必须持久保存：

```text
taskId
externalExecutionId
operationName
argumentHash
resourceId
executionContext
tracks
providerRevision
```

## 6.2 externalExecutionId

优先：

```text
ugv1:<track>:<deviceMissionId>
```

设备没有稳定 Mission ID 时：

```text
ugv1:<track>:<persisted UUID>
```

要求：

- 第一次接纳时生成并持久化；
- 重启后不重新生成；
- 不把内存地址、时间戳或随机临时值作为恢复身份；
- 同一 Task Identity 冲突返回 `CONFLICT`。

## 6.3 Command Idempotency

控制命令身份：

```text
taskId + commandType + commandSequence
```

重复命令：

- 返回原 Ack；
- 不重复调用有副作用的 Device MCP 工具；
- 不创建新的设备 Mission；
- 记录 `duplicate=true` 的低基数遥测。

---

# 7. Resource Contract

## 7.1 ListResources 输出

```json
{
  "resourceId": "vehicle:ugv1",
  "displayName": "UGV-1",
  "resourceType": "isr.vehicle.ugv",
  "enabled": true,
  "health": "unknown",
  "labels": {
    "vehicleRole": "ugv",
    "executionMode": "simulation"
  },
  "metadata": {
    "entityId": "ugv1",
    "tracks": ["chassis", "eo", "weapon"],
    "externalVideo": true,
    "refereeDataAvailable": false,
    "globalTruthAvailable": false
  }
}
```

`health` 的允许值以现有 Adapter Protocol 为准。

## 7.2 单资源、多轨道

首版只暴露一个 Runtime Resource：

```text
vehicle:ugv1
```

内部轨道：

```text
chassis
eo
weapon
```

不得把轨道虚构成三个可独立发现的资源。

---

# 8. MQTT Southbound Contract

## 8.1 Transport

```yaml
protocol: MQTT
encoding: JSON
defaultQos: 1
speedQos: 0
direction: ROS2-to-MQTT
```

QoS 只描述传输，不保证业务消息全局唯一。

QoS 1 可能重复，Adapter 必须幂等消费。

## 8.2 Topic Allowlist

允许：

| Topic | ROS/领域类型 | 用途 | 默认 QoS |
|---|---|---|---:|
| `/ugv/gnss` | `sensor_msgs/NavSatFix` | WGS84 定位 | 1 |
| `/ugv/imu` | `isr_ros2_msgs/PolarAngle` | 姿态 | 1 |
| `/ugv/speed` | `std_msgs/Float64` | 速度 km/h | 0 |
| `/ugv/status` | `std_msgs/String(JSON)` | 综合状态 | 1 |
| `/ugv/system_state` | `AutoSystemState` | 运行、自检、底盘错误 | 1 |
| `/ugv/component_status` | `EntityHealth` | 10 部件健康 | 1 |
| `/ugv/battery_range_km` | `std_msgs/Float32` | 剩余里程 km | 1 |
| `/ugv/mission_state` | `MissionState` | 底盘任务态 | 1 |
| `/ugv/nav_state` | `NavState` | 导航态 | 1 |
| `/ugv/detected_objects` | `DetectedObjectArray` | 本车检测目标 | 1 |
| `/ugv/target_detected` | `std_msgs/String` | 目标提示 | 1 |
| `/ugv/target/gnss` | `NavSatFix` | 当前锁定目标 GNSS | 1 |

禁止：

```text
/ugv/referee/status
/ugv/target/base64
/entity/state
/referee/*
/world/*
/sim/*
/npc_tank1/*
#
/ugv/#
```

## 8.3 MQTT Wire Shape 模式

来源资料未完全给出 ROS2-MQTT Bridge 的 JSON Envelope，状态为：

```text
Capture Required
```

Adapter 必须提供配置：

```text
UGV_MQTT_WIRE_MODE=auto|ros_message_json|direct_domain_json
```

生产环境建议显式配置，不应长期使用 `auto`。

### ros_message_json

标准消息示例：

```json
{
  "data": 32.5
}
```

`std_msgs/String(JSON)` 示例：

```json
{
  "data": "{\"vehicle_id\":\"ugv1\",\"speed_kmh\":12.3}"
}
```

规则：

- 外层 JSON 解码一次；
- `data` 为 JSON 字符串时，只允许再解码一次；
- 禁止无限递归解码字符串；
- 第二次解码失败应拒绝消息。

### direct_domain_json

仅在桥接器明确直接发布领域对象时允许：

```json
{
  "vehicle_id": "ugv1",
  "speed_kmh": 12.3
}
```

### auto

只用于开发/Contract Capture：

1. 先验证 ROS Message Envelope；
2. 失败后验证 Direct Domain Schema；
3. 两者同时匹配时拒绝为 `UGV_MQTT_AMBIGUOUS_WIRE_SHAPE`；
4. 成功捕获后报告推荐固定模式。

## 8.4 时间语义

存在合法 `header.stamp`：

```text
sourceObservedAt = header.stamp
receivedAt = Adapter receive time
timeAuthority = source
```

没有源时间：

```text
sourceObservedAt = null
receivedAt = Adapter receive time
timeAuthority = ingest
```

禁止将 `receivedAt` 伪装为源端采样时间。

## 8.5 顺序和重复

外部接口未定义统一 Source Sequence。

因此：

- 不得声称 MQTT 消息具有跨 Topic 全局顺序；
- Adapter 维护内部 `ingestSequence`，仅用于本地审计；
- 状态更新按 `sourceObservedAt` 或 `receivedAt` 比较；
- 同一 Topic、同一有效观察时间、同一规范化 Payload Hash 可判定重复；
- QoS 1 重复不得增加 Snapshot Revision；
- 更旧的 Source Observation 不得覆盖新状态；
- 没有源时间时按接收顺序处理，但标记 `timeAuthority=ingest`。

## 8.6 Payload 限制

配置至少包括：

```text
UGV_MQTT_MAX_PAYLOAD_BYTES
UGV_MQTT_MAX_JSON_DEPTH
UGV_MQTT_MAX_JSON_NODES
UGV_MQTT_MAX_STRING_BYTES
```

超限 Reason：

```text
UGV_MQTT_PAYLOAD_TOO_LARGE
UGV_MQTT_JSON_DEPTH_EXCEEDED
UGV_MQTT_JSON_NODE_LIMIT_EXCEEDED
UGV_MQTT_STRING_LIMIT_EXCEEDED
```

---

# 9. MQTT Message Profile

以下为 Adapter 的**规范化读取合同**。外部 Wire 可通过兼容 Decoder 转换到这些结构。

## 9.1 `/ugv/gnss`

```ts
interface UgvGnssMessage {
  header?: MessageHeader;
  latitude: number;   // -90..90
  longitude: number;  // -180..180
  altitude?: number;
}
```

规范化：

```json
{
  "latitude": 30.123,
  "longitude": 114.456,
  "altitude": 42.0,
  "frame": "WGS84"
}
```

非法经纬度必须拒绝。

## 9.2 `/ugv/imu`

```ts
interface UgvImuMessage {
  yaw: number;
  pitch: number;
  roll: number;
}
```

单位：

```text
radian
```

必须保持有限数值。

## 9.3 `/ugv/speed`

支持外层：

```json
{"data": 12.5}
```

规范化：

```json
{
  "speedKmh": 12.5
}
```

不得自动将 m/s 解释为 km/h。

## 9.4 `/ugv/status`

规范化可识别字段：

```ts
interface UgvCompositeStatus {
  vehicle_id?: string;
  role_name?: string;
  entity_id?: string;

  position?: { x?: number; y?: number; z?: number };
  speed_kmh?: number;

  control?: {
    throttle?: number;
    steer?: number;
    brake?: number;
    reverse?: boolean;
  };

  lvbattery_soc?: number;
  hvbattery1_soc?: number;
  hvbattery2_soc?: number;
  fuel1?: number;
  fuel2?: number;

  motor_temp?: number;
  engine_water_temp?: number;

  ready_status?: unknown;
  gear_status?: unknown;
  veh_speed?: number;
  brake_status?: unknown;
  emergency_stop_status?: unknown;

  heading?: number;
  roll?: number;
  pitch?: number;
  ins_init?: unknown;
  gnss?: unknown;
  location_status?: unknown;

  power_supply_status?: unknown;
  operate_mode_status?: unknown;
  fault?: number;
  ping_status?: unknown;
  packet_loss_rate?: number;
  average_round_trip_time?: number;

  chassis_task?: UgvDeviceTaskTrack;
  eo_task?: UgvDeviceTaskTrack;
  weapon_task?: UgvDeviceTaskTrack;

  available?: boolean;
}
```

`position{x,y,z}` 是仿真局部坐标，不得覆盖 GNSS WGS84。

当：

```json
{"available": false}
```

Adapter 必须保留旧状态但标记当前综合状态不可用。

## 9.5 `/ugv/system_state`

```ts
interface UgvSystemState {
  header?: MessageHeader;
  entity_id: string;
  run_state: 0 | 1;
  mode: number;
  speed_limit: number;
  video_config?: unknown;
  err_list: number[];
}
```

`run_state` 和 `mode` 不能单独证明 Task 完成。

## 9.6 `/ugv/component_status`

```ts
interface UgvComponentStatus {
  header?: MessageHeader;
  entity_id: string;
  power_battery: 0 | 1;
  lvbattery: 0 | 1;
  fuel: 0 | 1;
  water_temp: 0 | 1;
  motor: 0 | 1;
  sensor: 0 | 1;
  gnss: 0 | 1;
  comms: 0 | 1;
  weapon: 0 | 1;
  navigation: 0 | 1;
}
```

注意：

- 该消息是仿真专有能力；
- 全零可能表示正常，也可能是异常系统不可用后的降级；
- 仅凭全零不得证明所有部件真实健康；
- 若来源可用性未知，应规范化为 `unknown`。

## 9.7 `/ugv/battery_range_km`

```json
{"data": 35.2}
```

规范化：

```json
{"rangeKm": 35.2}
```

负值拒绝。

## 9.8 `/ugv/mission_state`

```ts
interface UgvMissionState {
  header?: MessageHeader;
  entity_id: string;
  id?: string | number;
  type: 1 | 2 | 4 | number;
  state: -1 | 0 | 1 | 2 | 3 | 4 | 5;
  progress: number;
}
```

`progress` 必须在 0..100。

## 9.9 `/ugv/nav_state`

```ts
interface UgvNavState {
  header?: MessageHeader;
  entity_id: string;
  position_x?: number;
  position_y?: number;
  position_z?: number;
  speed_kmh?: number;
  battery_range_km?: number;
}
```

## 9.10 `/ugv/detected_objects`

```ts
interface UgvDetectedObject {
  header?: MessageHeader;
  object_type?: string | number;
  id: string | number;
  x?: number;
  y?: number;
  z?: number;
}

interface UgvDetectedObjectArray {
  header?: MessageHeader;
  objects: UgvDetectedObject[];
}
```

目标坐标规范化时必须标记：

```text
coordinateFrame = carla_world
```

不得转换成 WGS84，除非有正式坐标转换合同。

## 9.11 `/ugv/target_detected`

只作为提示性观察，不作为目标存在的唯一权威。

```json
{"data": "target detected"}
```

## 9.12 `/ugv/target/gnss`

只表示当前锁定/关联目标的 GNSS 观察。

必须与目标 ID 或当前 Lock 状态关联后才能写入 Target。

---

# 10. Device MCP Southbound Contract

## 10.1 Transport

```yaml
transport: streamable-http
path: /mcp
defaultPort: 19000
```

启动时：

```text
initialize
→ tools/list
→ contract validation
```

## 10.2 Contract Snapshot

必须生成：

```text
reports/ugv-provider-v1/external-contract/ugv-device-mcp-tools.json
```

每个 Tool 至少捕获：

```text
name
description
inputSchema
outputSchema（若提供）
annotations（若提供）
capturedAt
serverInfo
protocolVersion
schemaHash
```

## 10.3 Allowlist

允许候选集合：

```text
ugv_path_follow_mission
ugv_return_home
ugv_move_distance
ugv_mission_control
ugv_stop
ugv_attack_target
ugv_area_recon_configure
ugv_area_recon_lock
ugv_area_recon_unlock
ugv_gimbal_move
ugv_area_recon_attack_confirm
ugv_area_recon_control
ugv_area_recon_reset
ugv_area_recon_get_status
ugv_area_recon_get_targets
ugv_area_recon_get_exceptions
ugv_laser_range
ugv_get_capabilities
```

实际可调用集合：

```text
candidate allowlist
∩
captured tools/list
∩
schema validation passed
```

## 10.4 Schema 状态

来源文档只冻结 Tool 名称和用途，未冻结所有请求字段。

因此具体 Device MCP 入参字段为：

```text
Capture Required
```

Adapter 必须维护：

```text
Canonical Provider Request
→ Versioned Device Tool Mapper
→ Captured Tool Input Schema
```

不得让上游 Operation 直接依赖设备 Tool 的字段命名。

## 10.5 Mock-only Canonical Fixture

真实接口不可用时，Mock Server 可以使用以下**仅测试合同**。

该 Fixture 不得被声明为真实 ISR-Simulation 合同。

### `ugv_path_follow_mission`

```json
{
  "waypoints": [
    {
      "latitude": 30.123,
      "longitude": 114.456,
      "altitude": 0
    }
  ],
  "speed_limit_kmh": 20,
  "stop_on_obstacle": true
}
```

### `ugv_return_home`

```json
{}
```

### `ugv_move_distance`

```json
{
  "direction": "forward",
  "distance_m": 10
}
```

### `ugv_mission_control`

```json
{
  "action": "pause"
}
```

允许 Mock Action：

```text
start
pause
resume
terminate
cancel
stop
```

### `ugv_stop`

```json
{}
```

### `ugv_area_recon_configure`

```json
{
  "area": {
    "coordinate_frame": "WGS84",
    "polygon": [
      {"latitude": 30.1, "longitude": 114.1},
      {"latitude": 30.1, "longitude": 114.2},
      {"latitude": 30.2, "longitude": 114.2}
    ]
  },
  "scan_count": 1,
  "zoom": 1.0,
  "stop_on_target": false,
  "target_types": []
}
```

### `ugv_area_recon_control`

```json
{
  "command": 1
}
```

Mock Command：

```text
1 start
2 pause
3 resume
4 stop
```

### `ugv_area_recon_lock`

```json
{
  "target_id": "target-1"
}
```

### `ugv_area_recon_unlock`

```json
{}
```

### `ugv_gimbal_move`

```json
{
  "mode": "absolute",
  "yaw": 0,
  "pitch": 0,
  "angle_unit": "deg"
}
```

Mock 支持：

```text
absolute
relative
velocity
reset
```

### `ugv_attack_target`

```json
{
  "target_id": "target-1"
}
```

### `ugv_area_recon_attack_confirm`

```json
{
  "target_id": "target-1",
  "confirmed": true
}
```

### Query Tools

Mock Query Tool 返回必须能表达：

```text
area recon status
targets
exceptions
laser range
capabilities
```

## 10.6 Tool Response Envelope

设备 MCP Response 可能为：

```text
text content
structuredContent
JSON text
multiple content items
```

Adapter 必须：

1. 优先验证 `structuredContent`；
2. 如只有 JSON Text，最多解析一次；
3. 非 JSON Text 不用于状态终态判断；
4. 多个冲突结果拒绝；
5. Raw Response 不进入 Task Result、Evidence 或日志；
6. 超出大小限制拒绝。

## 10.7 Mission ID

如果实际工具返回稳定 Mission ID：

```text
downstreamMissionId = returned mission ID
```

否则：

```text
downstreamMissionId = null
externalExecutionId = persisted provider UUID
```

禁止从 Tool 调用时间、数组索引或文本描述推导 Mission ID。

---

# 11. 规范化 UGV Snapshot

```ts
interface UgvSnapshot {
  identity: {
    providerId: "isr.vehicle.ugv.ugv1";
    resourceId: "vehicle:ugv1";
    entityId: "ugv1";
    vehicleType: "ugv";
    executionMode: "simulation";
  };

  chassis: {
    position?: {
      latitude: number;
      longitude: number;
      altitude?: number;
      frame: "WGS84";
    };

    localPosition?: {
      x?: number;
      y?: number;
      z?: number;
      frame: "carla_world";
    };

    attitude?: {
      yaw: number;
      pitch: number;
      roll: number;
      angleUnit: "rad";
    };

    speedKmh?: number;

    energy?: {
      rangeKm?: number;
      lowVoltageSoc?: number;
      highVoltage1Soc?: number;
      highVoltage2Soc?: number;
      fuel1?: number;
      fuel2?: number;
    };

    temperature?: {
      motor?: number;
      engineWater?: number;
    };

    mission: VehicleTaskTrack;

    navigation?: {
      positionX?: number;
      positionY?: number;
      positionZ?: number;
      frame: "carla_world";
      speedKmh?: number;
      batteryRangeKm?: number;
    };
  };

  payload: {
    online?: boolean;

    gimbal?: {
      yaw?: number;
      pitch?: number;
      zoom?: number;
      angleUnit: "rad" | "deg" | "unknown";
    };

    laser?: {
      distanceM?: number;
      valid?: boolean;
    };

    reconnaissance: VehicleTaskTrack;
    weapon: VehicleTaskTrack;

    lockedTargetId?: string;
    attackReady?: boolean;
    targets: VehicleTarget[];
  };

  health: {
    runState?: 0 | 1;
    mode?: number;
    speedLimitKmh?: number;
    chassisErrorCodes: number[];
    payloadErrorCodes: string[];
    components: Record<string, "normal" | "fault" | "unknown">;
  };

  connectivity: {
    mqttConnected: boolean;
    deviceMcpConnected: boolean;
    packetLossRate?: number;
    averageRoundTripTimeMs?: number;
  };

  freshness: {
    chassisObservedAt?: string;
    healthObservedAt?: string;
    missionObservedAt?: string;
    targetObservedAt?: string;
    payloadObservedAt?: string;
  };

  revision: string;
  observedAt: string;
}
```

## 11.1 Snapshot Revision

Revision 是 Adapter 本地单调十进制字符串。

只有规范化状态发生变化时增加。

以下不增加 Revision：

```text
MQTT QoS 重复
相同 Payload Hash 重复
Telemetry 重试
相同 Device MCP Query Result
```

## 11.2 observedAt

Snapshot `observedAt` 是形成该 Snapshot 的最新有效观察时间。

如果只存在 Ingest Time，必须在内部保留 `timeAuthority=ingest`。

---

# 12. 任务轨道合同

```text
chassis
eo
weapon
```

| Operation | chassis | eo | weapon |
|---|---|---|---|
| `vehicle_get_state` | read | read | read |
| `vehicle_get_payload_status` | none | read | read |
| `vehicle_get_targets` | none | read | none |
| `vehicle_laser_range` | none | read | none |
| `vehicle_navigate` | exclusive | none | none |
| `vehicle_area_recon` | optional-read | exclusive | none |
| `vehicle_track_target` | none | exclusive | none |
| `vehicle_fire_weapon` | stopped-check | exclusive | exclusive |
| `vehicle_emergency_stop` | preempt | preempt | preempt |

配置：

```text
UGV_ALLOW_NAVIGATION_WITH_RECON
UGV_FIRE_REQUIRES_CHASSIS_STOPPED
```

Availability 必须按当前配置解释。

---

# 13. Device Task State 映射

设备状态：

| Device State | 含义 |
|---:|---|
| `-1` | idle |
| `0` | ready |
| `1` | running |
| `2` | paused |
| `3` | cancelled |
| `4` | completed |
| `5` | failed |

Adapter 状态：

| Device | Adapter |
|---:|---|
| `0` | `STARTING` / `WAITING_START_CONFIRMATION` |
| `1` | `RUNNING` |
| `2` | `PAUSED` |
| `3` | `CANCELLED` |
| `4` | `SUCCEEDED` |
| `5` | `FAILED` |

`-1`：

- 无活动任务：Idle；
- 有活动任务：进入 Reconcile；
- 不得直接判成功；
- 无法证明终态：`UNCERTAIN_EXECUTION_STATE`。

进度：

- 允许 0..100；
- 同 Mission ID 进度不得倒退；
- 新 Mission ID 可重置；
- 冲突状态不得静默覆盖。

---

# 14. Operation Manifest 总表

| Operation | Behavior | Availability | Scheduling | MaxElapsed | InputRequired | Cancel | Pause/Resume | Idempotency |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `vehicle_get_state` | synchronous_only | dynamic | false | false | false | false | false | server_managed |
| `vehicle_get_payload_status` | synchronous_only | dynamic | false | false | false | false | false | server_managed |
| `vehicle_get_targets` | synchronous_only | dynamic | false | false | false | false | false | server_managed |
| `vehicle_laser_range` | synchronous_only | dynamic | false | false | false | false | false | server_managed |
| `vehicle_navigate` | task_required | dynamic | true | true | false | true | true | server_managed |
| `vehicle_area_recon` | task_required | dynamic | true | true | false | true | true | server_managed |
| `vehicle_track_target` | task_required | dynamic | false | true | false | true | false | server_managed |
| `vehicle_fire_weapon` | task_required | dynamic | false | true | true | true | false | server_managed |
| `vehicle_emergency_stop` | task_required | dynamic | false | true | false | false | false | server_managed |

注意：

- `Cancel`、`Pause/Resume` 是 Provider 领域能力；
- 对外 MCP Task Wire 的取消语义仍继承冻结协议；
- Manifest 字段名称必须使用当前仓库的冻结 `io.sdar/taskExecution` Shape，不得直接使用本表列名作为 Wire 字段。

---

# 15. Operation Schema

所有输入：

```text
additionalProperties = false
```

除非以下合同明确允许。

## 15.1 `vehicle_get_state`

### Input

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["resourceId"],
  "properties": {
    "resourceId": {
      "const": "vehicle:ugv1"
    },
    "include": {
      "type": "array",
      "uniqueItems": true,
      "maxItems": 4,
      "items": {
        "enum": ["chassis", "payload", "health", "targets"]
      }
    }
  }
}
```

### Output

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["resourceId", "snapshot", "revision", "observedAt"],
  "properties": {
    "resourceId": {"const": "vehicle:ugv1"},
    "snapshot": {"type": "object"},
    "revision": {"type": "string", "pattern": "^[0-9]+$"},
    "observedAt": {"type": "string", "format": "date-time"}
  }
}
```

同步读取若状态不可证明当前有效：

```text
isError = true
outcome = unavailable | uncertain
reasonCode = UGV_STATE_STALE | UGV_MQTT_UNAVAILABLE
```

## 15.2 `vehicle_get_payload_status`

### Input

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["resourceId"],
  "properties": {
    "resourceId": {"const": "vehicle:ugv1"}
  }
}
```

### Output

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "resourceId",
    "online",
    "reconnaissance",
    "weapon",
    "payloadErrorCodes",
    "observedAt"
  ],
  "properties": {
    "resourceId": {"const": "vehicle:ugv1"},
    "online": {"type": ["boolean", "null"]},
    "gimbal": {"type": ["object", "null"]},
    "laser": {"type": ["object", "null"]},
    "reconnaissance": {"type": "object"},
    "weapon": {"type": "object"},
    "lockedTargetId": {"type": ["string", "null"]},
    "attackReady": {"type": ["boolean", "null"]},
    "payloadErrorCodes": {
      "type": "array",
      "items": {"type": "string"},
      "maxItems": 128
    },
    "observedAt": {"type": "string", "format": "date-time"}
  }
}
```

## 15.3 `vehicle_get_targets`

### Input

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["resourceId"],
  "properties": {
    "resourceId": {"const": "vehicle:ugv1"},
    "maxAgeMs": {
      "type": "integer",
      "minimum": 0,
      "maximum": 600000
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 256
    }
  }
}
```

### Output

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["resourceId", "targets", "observedAt"],
  "properties": {
    "resourceId": {"const": "vehicle:ugv1"},
    "targets": {
      "type": "array",
      "maxItems": 256,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["targetId", "source", "observedAt", "freshness"],
        "properties": {
          "targetId": {"type": "string", "minLength": 1, "maxLength": 128},
          "objectType": {"type": ["string", "null"]},
          "position": {"type": ["object", "null"]},
          "source": {
            "enum": ["mqtt_detected_objects", "device_mcp_recon", "merged"]
          },
          "observedAt": {"type": "string", "format": "date-time"},
          "freshness": {"enum": ["fresh", "stale", "unknown"]}
        }
      }
    },
    "observedAt": {"type": "string", "format": "date-time"}
  }
}
```

## 15.4 `vehicle_laser_range`

### Input

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["resourceId"],
  "properties": {
    "resourceId": {"const": "vehicle:ugv1"}
  }
}
```

### Output

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["resourceId", "valid", "observedAt"],
  "properties": {
    "resourceId": {"const": "vehicle:ugv1"},
    "valid": {"type": "boolean"},
    "distanceM": {
      "type": ["number", "null"],
      "minimum": 0
    },
    "reasonCode": {"type": ["string", "null"]},
    "observedAt": {"type": "string", "format": "date-time"}
  }
}
```

## 15.5 `vehicle_navigate`

### Input

```json
{
  "oneOf": [
    {
      "type": "object",
      "additionalProperties": false,
      "required": ["resourceId", "mission"],
      "properties": {
        "resourceId": {"const": "vehicle:ugv1"},
        "mission": {
          "type": "object",
          "additionalProperties": false,
          "required": ["type", "target"],
          "properties": {
            "type": {"const": "point"},
            "target": {"$ref": "#/$defs/geoPoint"}
          }
        },
        "speedLimitKmh": {
          "type": "number",
          "exclusiveMinimum": 0,
          "maximum": 100
        },
        "stopOnObstacle": {"type": "boolean"}
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": ["resourceId", "mission"],
      "properties": {
        "resourceId": {"const": "vehicle:ugv1"},
        "mission": {
          "type": "object",
          "additionalProperties": false,
          "required": ["type", "waypoints"],
          "properties": {
            "type": {"const": "route"},
            "waypoints": {
              "type": "array",
              "minItems": 2,
              "maxItems": 1024,
              "items": {"$ref": "#/$defs/geoPoint"}
            }
          }
        },
        "speedLimitKmh": {
          "type": "number",
          "exclusiveMinimum": 0,
          "maximum": 100
        },
        "stopOnObstacle": {"type": "boolean"}
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": ["resourceId", "mission"],
      "properties": {
        "resourceId": {"const": "vehicle:ugv1"},
        "mission": {
          "type": "object",
          "additionalProperties": false,
          "required": ["type", "direction", "distanceM"],
          "properties": {
            "type": {"const": "distance"},
            "direction": {
              "enum": ["forward", "backward", "left", "right"]
            },
            "distanceM": {
              "type": "number",
              "exclusiveMinimum": 0,
              "maximum": 10000
            }
          }
        }
      }
    },
    {
      "type": "object",
      "additionalProperties": false,
      "required": ["resourceId", "mission"],
      "properties": {
        "resourceId": {"const": "vehicle:ugv1"},
        "mission": {
          "type": "object",
          "additionalProperties": false,
          "required": ["type"],
          "properties": {
            "type": {"const": "return_home"}
          }
        }
      }
    }
  ],
  "$defs": {
    "geoPoint": {
      "type": "object",
      "additionalProperties": false,
      "required": ["latitude", "longitude"],
      "properties": {
        "latitude": {
          "type": "number",
          "minimum": -90,
          "maximum": 90
        },
        "longitude": {
          "type": "number",
          "minimum": -180,
          "maximum": 180
        },
        "altitude": {"type": "number"}
      }
    }
  }
}
```

### Final Structured Content

```json
{
  "resourceId": "vehicle:ugv1",
  "outcome": "completed",
  "missionType": "route",
  "confirmed": true,
  "finalPosition": {
    "latitude": 30.123,
    "longitude": 114.456,
    "frame": "WGS84"
  },
  "reasonCode": "UGV_NAVIGATION_COMPLETED",
  "observedAt": "2026-07-23T00:00:00Z"
}
```

`outcome`：

```text
completed
failed
cancelled
uncertain
```

## 15.6 `vehicle_area_recon`

### Input

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["resourceId", "area"],
  "properties": {
    "resourceId": {"const": "vehicle:ugv1"},
    "area": {
      "type": "object",
      "additionalProperties": false,
      "required": ["coordinateFrame", "polygon"],
      "properties": {
        "coordinateFrame": {"const": "WGS84"},
        "polygon": {
          "type": "array",
          "minItems": 3,
          "maxItems": 256,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["latitude", "longitude"],
            "properties": {
              "latitude": {"type": "number", "minimum": -90, "maximum": 90},
              "longitude": {"type": "number", "minimum": -180, "maximum": 180}
            }
          }
        }
      }
    },
    "scanCount": {
      "type": "integer",
      "minimum": 1,
      "maximum": 1000
    },
    "zoom": {
      "type": "number",
      "exclusiveMinimum": 0
    },
    "stopOnTarget": {"type": "boolean"},
    "targetTypes": {
      "type": "array",
      "uniqueItems": true,
      "maxItems": 64,
      "items": {"type": "string", "minLength": 1, "maxLength": 64}
    }
  }
}
```

### Final Structured Content

```json
{
  "resourceId": "vehicle:ugv1",
  "outcome": "completed",
  "confirmed": true,
  "scanCountCompleted": 1,
  "targetsObserved": 2,
  "reasonCode": "UGV_RECON_COMPLETED",
  "observedAt": "2026-07-23T00:00:00Z"
}
```

## 15.7 `vehicle_track_target`

### Input

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["resourceId", "targetId"],
  "properties": {
    "resourceId": {"const": "vehicle:ugv1"},
    "targetId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "maintainLock": {"type": "boolean"},
    "timeoutMs": {
      "type": "integer",
      "minimum": 1000,
      "maximum": 3600000
    },
    "desiredZoom": {
      "type": "number",
      "exclusiveMinimum": 0
    }
  }
}
```

### Final Structured Content

```json
{
  "resourceId": "vehicle:ugv1",
  "targetId": "target-1",
  "outcome": "failed",
  "lockMaintained": false,
  "reasonCode": "UGV_TARGET_LOST",
  "observedAt": "2026-07-23T00:00:00Z"
}
```

## 15.8 `vehicle_fire_weapon`

### Input

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "resourceId",
    "targetId",
    "engagementMode",
    "requireConfirmation"
  ],
  "properties": {
    "resourceId": {"const": "vehicle:ugv1"},
    "targetId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "engagementMode": {"const": "single"},
    "requireConfirmation": {"const": true},
    "approvalRef": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    }
  }
}
```

### Input Request

```json
{
  "method": "elicitation/create",
  "params": {
    "mode": "form",
    "message": "Approve local UGV fire-control execution?",
    "requestedSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": ["approved"],
      "properties": {
        "approved": {"type": "boolean"}
      }
    }
  }
}
```

### Final Structured Content

```json
{
  "resourceId": "vehicle:ugv1",
  "targetId": "target-1",
  "outcome": "fire_cycle_completed",
  "localOnly": true,
  "confirmed": true,
  "reasonCode": "UGV_FIRE_CYCLE_COMPLETED",
  "observedAt": "2026-07-23T00:00:00Z"
}
```

允许 `outcome`：

```text
fire_cycle_completed
target_not_found
target_not_locked
out_of_range
out_of_fov
no_ammo_reported_by_weapon
weapon_fault
friendly_target_rejected
timeout
cancelled
uncertain
```

禁止字段：

```text
hit
miss
destroyed
damage
remainingHp
remaining_hp
```

## 15.9 `vehicle_emergency_stop`

### Input

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["resourceId"],
  "properties": {
    "resourceId": {"const": "vehicle:ugv1"},
    "reason": {
      "type": "string",
      "maxLength": 512
    }
  }
}
```

### Final Structured Content

```json
{
  "resourceId": "vehicle:ugv1",
  "outcome": "completed",
  "confirmed": true,
  "stoppedTracks": ["chassis", "eo", "weapon"],
  "reasonCode": "UGV_EMERGENCY_STOP_CONFIRMED",
  "observedAt": "2026-07-23T00:00:00Z"
}
```

---

# 16. CheckAvailability Contract

继承冻结方法：

```text
io.sdar/taskExecution/checkAvailability
```

UGV Profile 使用：

```text
available
restricted
disabled
unknown
```

Work 任务包内部的大写枚举只可作为 Adapter 内部枚举，Runtime Wire 必须映射为冻结小写枚举。

## 16.1 Risk Level

| Operation | Risk |
|---|---|
| 查询类 | low |
| navigate | medium |
| area_recon | medium |
| track_target | medium |
| fire_weapon | high |
| emergency_stop | high |

## 16.2 Reason Code

```text
UGV_AVAILABLE
UGV_MQTT_UNAVAILABLE
UGV_DEVICE_MCP_UNAVAILABLE
UGV_STATE_STALE
UGV_TOOL_UNAVAILABLE
UGV_CHASSIS_TRACK_BUSY
UGV_EO_TRACK_BUSY
UGV_WEAPON_TRACK_BUSY
UGV_GNSS_LOST
UGV_PATH_BLOCKED
UGV_POWER_DEPLETED
UGV_COMMUNICATION_LOST
UGV_SENSOR_BLIND
UGV_GIMBAL_FAULT
UGV_WEAPON_FAULT
UGV_TARGET_NOT_FOUND
UGV_TARGET_STALE
UGV_TARGET_NOT_LOCKED
UGV_ATTACK_NOT_READY
UGV_FIRE_REQUIRES_STOP
UGV_EXECUTION_MODE_UNSUPPORTED
UGV_ARGUMENT_INVALID
```

## 16.3 映射规则

```text
可以证明当前可执行
→ available

轨道忙但存在明确可用窗口
→ restricted

能力被配置或硬故障明确禁止
→ disabled

无法证明可用或数据过期
→ unknown
```

`restricted` 必须附有效窗口。

执行前必须使用完整参数重新检查。

---

# 17. Command 合同

## 17.1 Cancel

Runtime `tasks/cancel`：

- 表示 cooperative intent；
- Ack 不等于设备已经停止；
- Adapter 接收后调用相应设备控制；
- 最终 Task 可以是 cancelled、completed、failed 或 uncertain；
- 同一 `commandSequence` 只执行一次。

## 17.2 Pause / Resume

只适用于：

```text
vehicle_navigate
vehicle_area_recon
```

不适用于：

```text
vehicle_track_target
vehicle_fire_weapon
vehicle_emergency_stop
```

不支持时返回稳定 Ack：

```text
accepted = false
reasonCode = UGV_PAUSE_NOT_SUPPORTED | UGV_RESUME_NOT_SUPPORTED
```

## 17.3 Fire Update

只有当前 Task 是 `input_required` 且 Key 为 `fire-approval` 时处理。

拒绝或过期确认：

```text
UGV_FIRE_APPROVAL_REJECTED
UGV_FIRE_APPROVAL_EXPIRED
UGV_FIRE_APPROVAL_RESPONSE_INVALID
```

---

# 18. Reconcile Contract

请求身份至少匹配：

```text
taskId
operationName
argumentHash
externalExecutionId（若提供）
authorizationContextHash
executionMode
simulationId
```

结果：

```text
FOUND
NOT_FOUND
CONFLICT
UNCERTAIN
```

## 18.1 FOUND

需要至少一项当前外部证据：

```text
MQTT 任务轨道与 Execution 匹配
Device MCP Query 返回匹配 Mission
已确认终态
```

本地账本不能单独证明 FOUND。

## 18.2 NOT_FOUND

只有在外部权威明确不存在该执行时返回。

短暂断线不得返回 NOT_FOUND。

## 18.3 CONFLICT

示例：

```text
taskId 相同但 argumentHash 不同
externalExecutionId 指向其他 Mission
operationName 不同
执行上下文不兼容
```

## 18.4 UNCERTAIN

```text
MQTT 不可用
Device MCP 不可用
活动任务突然变为 idle
多个状态源冲突
```

UNCERTAIN 不得触发重复下发。

---

# 19. 底盘错误码 Profile

| Code | Reason | 影响 |
|---:|---|---|
| 1 | `path_blocked` | 驻车、任务停止 |
| 2 | `gnss_lost` | 定位失效 |
| 3 | `weapon_jammed` | 本地火控不可用 |
| 4 | `eo_no_aim` | 云台/瞄准不可用 |
| 5 | `power_depleted` | 停止、续航为零 |
| 6 | `net_lost` | 不接收任务、不回传 |
| 7 | `sensor_blind` | 感知回传中断 |
| 8 | `mobility_damage` | 机动不可用 |
| 9 | `nav_stuck` | 急停 |

载荷错误码是独立域，禁止与此 Code 数值合并。

---

# 20. Business Events Profile

使用现有 Business Events Wire。

## 20.1 Source

| sourceId | Delivery |
|---|---|
| `vehicle.execution` | `durable_at_least_once` |
| `vehicle.health` | `durable_at_least_once` |
| `vehicle.target` | `best_effort_live` |

## 20.2 Task Scope Events

```text
vehicle.mission.started
vehicle.mission.paused
vehicle.mission.resumed
vehicle.mission.completed
vehicle.mission.failed
vehicle.mission.cancelled

vehicle.payload.recon_started
vehicle.payload.recon_completed
vehicle.payload.recon_failed

vehicle.payload.target_locked
vehicle.payload.target_lost

vehicle.weapon.fire_started
vehicle.weapon.fire_completed
vehicle.weapon.fire_failed
```

## 20.3 Resource Scope Events

```text
vehicle.chassis.path_blocked
vehicle.chassis.gnss_lost
vehicle.chassis.power_depleted
vehicle.chassis.communication_lost
vehicle.chassis.mobility_damage
vehicle.chassis.navigation_stuck

vehicle.payload.sensor_blind
vehicle.payload.gimbal_fault
vehicle.payload.weapon_fault
vehicle.payload.offline

vehicle.target.detected
```

## 20.4 禁止事件

```text
vehicle.hit
vehicle.miss
vehicle.destroyed
target.destroyed
damage.applied
referee.*
```

## 20.5 Event Payload 最小字段

```json
{
  "resourceId": "vehicle:ugv1",
  "entityId": "ugv1",
  "operationName": "vehicle_navigate",
  "reasonCode": "UGV_PATH_BLOCKED",
  "observedAt": "2026-07-23T00:00:00Z",
  "snapshotRevision": "12"
}
```

Task Scope 额外包含：

```text
taskId relation（通过现有 Wire/Relation 机制）
providerRevision
```

不得在 Metric Label 或无授权 Payload 中泄露任意 Task ID。

---

# 21. Evidence Profile

Evidence Envelope 继承冻结协议。

Provider Wire 不包含上层本地 `requirementId`。

## 21.1 Evidence Type

```text
vehicle.state.observation
vehicle.position.observation
vehicle.health.observation
vehicle.mission.state
vehicle.payload.status
vehicle.target.observation
vehicle.target.lock
vehicle.weapon.local_result
```

## 21.2 推荐 JSON Pointer

| Operation | Evidence | Pointer |
|---|---|---|
| get_state | `vehicle.state.observation` | `/snapshot` |
| navigate | `vehicle.position.observation` | `/finalPosition` |
| navigate | `vehicle.mission.state` | `/outcome` |
| area_recon | `vehicle.payload.status` | `/scanCountCompleted` |
| track_target | `vehicle.target.lock` | `/lockMaintained` |
| fire_weapon | `vehicle.weapon.local_result` | `/outcome` |
| emergency_stop | `vehicle.mission.state` | `/stoppedTracks` |

## 21.3 禁止 Evidence

```text
Base64 图片
视频帧
裁判命中
裁判摧毁
全局真值
未脱敏 Raw Device MCP Response
```

---

# 22. Telemetry Contract

Telemetry 是 Best Effort，不改变任务状态。

至少：

```text
mqtt_connection
mqtt_message
device_mcp_contract
device_mcp_call
operation_admission
execution_transition
command_ack
reconcile
track_conflict
state_freshness
business_event_source
fire_verdict_field_stripped
```

禁止高基数 Label：

```text
taskId
targetId
raw Mission ID
raw Topic
未固定 Tool Name
resourceRef
raw reason text
```

固定枚举可以作为 Label：

```text
operationName
track
outcome
reasonCode
connectionState
```

---

# 23. 安全合同

## 23.1 数据隔离

UGV Adapter 不得配置：

```text
REFEREE_ENDPOINT
NPC_DEVICE_MCP_URL
GLOBAL_WORLD_TOPIC
```

## 23.2 Tool 隔离

未知 Tool：

```text
UGV_DEVICE_TOOL_NOT_ALLOWED
```

`tools/list` 缺少必需 Tool：

- 对应 Operation 不广告或 Availability disabled/unknown；
- 不使用相似名字猜测。

## 23.3 Fire Sanitizer

递归丢弃 Key：

```text
hit
miss
destroyed
damage
remaining_hp
remainingHp
hp
alive
referee
verdict
```

丢弃必须发生在：

```text
持久化前
日志前
Task Result 前
Evidence 前
Business Event 前
Telemetry Body 前
```

## 23.4 Secret

禁止进入 ZIP 和报告：

```text
.env
Password
Token
Authorization Header
TLS Private Key
MQTT Credential
Device MCP Headers
```

---

# 24. Contract Capture 流程

## 24.1 Device MCP

```text
initialize
→ tools/list
→ schema validation
→ safe read-only smoke
→ optional controlled task smoke
→ snapshot
```

## 24.2 MQTT

每个 Topic 至少捕获：

```text
topic
qos
retain
payload size
raw shape hash
decoded schema
example with sensitive values removed
source timestamp presence
entity ID field
```

输出：

```text
reports/ugv-provider-v1/external-contract/
├── ugv-device-mcp-tools.json
├── ugv-mqtt-topics.json
├── ugv-mqtt-wire-shapes.json
└── ugv-contract-diff.json
```

## 24.3 Contract Drift

真实接口与本 Profile 不兼容：

```text
UGV_DEVICE_MCP_CONTRACT_MISMATCH
UGV_MQTT_SCHEMA_MISMATCH
```

不得自动放宽 Schema 使测试通过。

---

# 25. Mock Contract 规则

Mock 的作用是验证 Provider 组件，不证明真实接口互操作。

Mock 必须：

- 遵循本文 Provider Operation Contract；
- 使用明确标记的 Mock-only Device MCP Fixture；
- 支持重复、乱序、超时、断线；
- 支持状态冲突；
- 支持返回禁止裁判字段；
- 验证 Sanitizer。

报告声明：

```text
componentLevel = complete
realInterfaceConformance = not_executed | blocked | passed
```

---

# 26. Conformance Case

至少：

## C-001 Topic Allowlist

UGV Adapter 只订阅 12 个允许 Topic。

## C-002 Referee Topic Rejection

发布 `/ugv/referee/status` 后：

- Adapter 不消费；
- Snapshot 无变化；
- Revision 不增加。

## C-003 MQTT Duplicate

QoS 1 重复消息不增加 Revision。

## C-004 MQTT Older Observation

旧观察不覆盖新观察。

## C-005 Mission Start

Device State 0/1 驱动 Task 到 Starting/Working。

## C-006 Mission Complete

只有 Device State 4 才确认本地完成。

## C-007 Idle Ambiguity

活动 Task 突然 `-1`：

- 不成功；
- 进入 Reconcile。

## C-008 Command Idempotency

相同 commandSequence 不重复调用设备。

## C-009 Restart

重启后 externalExecutionId 不变。

## C-010 Fire Approval

未批准不得调用攻击工具。

## C-011 Fire Verdict Strip

设备返回：

```json
{
  "result": "destroyed",
  "damage": 100,
  "remaining_hp": 0
}
```

对外只允许：

```json
{
  "outcome": "fire_cycle_completed",
  "localOnly": true
}
```

## C-012 Business Event Isolation

不产生任何 `referee.*` 或 `vehicle.destroyed`。

## C-013 Evidence Isolation

Evidence 无裁判字段。

## C-014 Availability Unknown

状态过期时不得返回 available。

## C-015 Technical vs Business Failure

领域失败映射 completed + isError；
技术失败映射 failed + JSON-RPC error。

---

# 27. 外部缺口和实现策略

| 缺口 | 当前状态 | Work 策略 |
|---|---|---|
| Device MCP 精确字段 | Capture Required | tools/list +源码捕获；Mock-only Fixture |
| Device Mission ID | Capture Required | 有则使用；无则持久 UUID |
| MQTT Bridge 精确 Envelope | Capture Required | Wire Mode + Contract Capture |
| Gimbal 单位 | Capture Required | 输出携带 angleUnit |
| Payload Error Schema | Capture Required | 字符串归一化，保留安全枚举 |
| MQTT Source Sequence | 不存在/未定义 | 只使用本地 ingestSequence |
| 裁判结果混入攻击返回 | 已知风险 | 强制递归剥离 |
| 视频/截图 | 外部链路 | 不进入 Provider Contract |

---

# 28. Work 模式交付集成

本文件应与 Work 任务包同时提供给 Codex。

Work 输入至少：

```text
项目源码副本或项目 ZIP
SDAR_UGV_Provider_Codex_Work_Task_Package_V1.1.md
SDAR_UGV_Provider_Interface_Protocol_Profile_V1.0.md
ISR-Simulation_UGV_NPC_Tank_Interface.md
现有冻结协议资产
```

Work 输出 ZIP 必须包含：

```text
docs/protocol/SDAR_UGV_Provider_Interface_Protocol_Profile_V1.0.md
docs/requirements/ISR-Simulation_UGV_NPC_Tank_Interface.md
reports/ugv-provider-v1/protocol-input-lock.json
reports/ugv-provider-v1/external-contract/*
reports/ugv-provider-v1/final-delivery-report.md
```

ZIP 不包含：

```text
.git
node_modules
dist
coverage
.env
密钥
运行数据库数据
临时缓存
```

---

# 29. Definition of Protocol Ready

- [ ] 本文 SHA-256 已生成；
- [ ] Work 任务包 Hash 已校验；
- [ ] ISR 接口报告 Hash 已校验；
- [ ] 冻结协议资产 Hash 已记录；
- [ ] Operation Schema 已生成到代码；
- [ ] Manifest 与本文一致；
- [ ] MQTT Allowlist 与本文一致；
- [ ] Device MCP Allowlist 与本文一致；
- [ ] Capture Required 项未被伪装为 Frozen；
- [ ] Conformance C-001～C-015 通过；
- [ ] Fire Verdict Strip 通过真实执行路径测试；
- [ ] Work ZIP 包含本协议和报告。

---

# 30. 最终冻结关系

```text
通用 MCP Tasks Wire
= Inherited Frozen

Adapter Protocol
= Inherited Frozen

Business Events Wire
= Inherited Frozen

UGV Provider Operation / State / Error / Event Semantics
= UGV Profile Frozen V1.0

Device MCP 实际 Tool JSON 字段
= Capture Required

MQTT Bridge 实际 JSON Envelope
= Capture Required

Mock-only Fixture
= Component Test Contract
≠ Real Interface Contract
```
