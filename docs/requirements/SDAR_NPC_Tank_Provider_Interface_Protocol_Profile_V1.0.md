# SDAR NPC Tank Provider 接口协议说明
## Work 模式实施合同 V1.0

> **文档状态：** NPC Tank Provider Profile Contract  
> **用途：** NPC Tank Provider 的编码、Mock、Contract Test 和验收权威  
> **继承关系：** 继承现有冻结 MCP Tasks、Adapter、Business Events 协议及 UGV 阶段共享 Vehicle Profile  
> **版本：** 1.0  
> **日期：** 2026-07-23  

---

# 0. 协议定位

本文件只冻结 NPC Tank Provider 专题接口：

```text
Provider / Resource Identity
MQTT Topic Allowlist
状态权威
Device MCP Tool Mapping
导航主备策略
EO 周扫能力
Operation Capability
Reason Code
Business Event / Evidence
隔离与安全
```

本文件不修改：

```text
MCP Tasks Wire
Adapter Proto
Business Events Wire
Provider Telemetry Ingress
Provider Ops Envelope
```

---

# 1. 规范状态

## 1.1 Inherited Frozen

```text
MCP Tasks
Availability
Task Lifecycle
Task Notification
Evidence Envelope
Adapter Protocol
Business Events Wire
共享 Vehicle Operation 语义
```

## 1.2 NPC Profile Frozen

```text
NPC Identity
NPC Resource
12 个 MQTT Topic
任务状态权威
工具选择策略
EO 周扫广告规则
Reason Code
Fire/Referee 边界
```

## 1.3 Capture Required

```text
NPC Device MCP 精确 inputSchema / output shape
MQTT Bridge 精确 JSON Envelope
设备 Mission ID
EO Scan 精确参数
Gimbal 角度单位
Payload Exception Schema
```

Capture Required 项禁止猜测为正式合同。

---

# 2. 输入完整性

```text
ISR-Simulation_UGV_NPC_Tank_Interface.md
SHA-256:
a67b7909ec7af7b3757e77cbaf5bae1c600fe348daa7faf239d8715d89fa375c

SDAR_UGV_Provider_Interface_Protocol_Profile_V1.0.md
SHA-256:
b1700a78e18fc2d510a461abcc454b4aa81dbe7bbdc8b891d9e09726e11187f6
```

Work 启动时生成：

```text
reports/npc-tank-provider-v1/protocol-input-lock.json
```

记录所有实际 Hash。

---

# 3. Identity

```yaml
providerId: isr.vehicle.npc-tank.npc-tank1
providerType: isr.vehicle.npc_tank
providerProfileVersion: "1.0"
providerComponentVersion: "0.1.0"

resourceId: vehicle:npc_tank1
resourceType: isr.vehicle.npc_tank
entityId: npc_tank1
roleName: npc_tank1
executionMode: simulation
```

默认端点：

```yaml
runtimeMcpUrl: http://127.0.0.1:19103/mcp
adapterGrpcEndpoint: 127.0.0.1:7013
deviceMcpUrl: http://127.0.0.1:19003/mcp
```

---

# 4. 权威边界

NPC Provider 负责：

```text
本车底盘状态
本车载荷状态
本车目标观测
本车任务状态
本车控制
本车故障
本地火控周期
```

禁止消费、存储、推导或发布：

```text
HP
裁判 ammo
alive
camp
hit
miss
destroyed
damage
remaining HP
global truth
referee event
world obstacle
anomaly state
UGV data
```

---

# 5. Resource Contract

```json
{
  "resourceId": "vehicle:npc_tank1",
  "displayName": "NPC Tank 1",
  "resourceType": "isr.vehicle.npc_tank",
  "enabled": true,
  "labels": {
    "vehicleRole": "npc_tank1",
    "executionMode": "simulation"
  },
  "metadata": {
    "entityId": "npc_tank1",
    "tracks": ["chassis", "eo", "weapon"],
    "supportsCircularEoScan": false,
    "externalVideo": true,
    "refereeDataAvailable": false,
    "globalTruthAvailable": false
  }
}
```

首版只暴露：

```text
vehicle:npc_tank1
```

`chassis/eo/weapon` 是内部轨道。

---

# 6. MQTT Southbound Contract

## 6.1 Allowlist

| Topic | 类型 | 语义 |
|---|---|---|
| `/npc_tank1/gnss` | `NavSatFix` | WGS84 定位 |
| `/npc_tank1/imu` | `PolarAngle` | yaw/pitch/roll |
| `/npc_tank1/speed` | `Float64` | km/h |
| `/npc_tank1/status` | `String(JSON)` | 综合状态 |
| `/npc_tank1/system_state` | `AutoSystemState` | 自检 |
| `/npc_tank1/component_status` | `EntityHealth` | 部件健康 |
| `/npc_tank1/battery_range_km` | `Float32` | 续航 |
| `/npc_tank1/mission_state` | `MissionState` | 底盘任务 |
| `/npc_tank1/nav_state` | `NavState` | 导航 |
| `/npc_tank1/detected_objects` | `DetectedObjectArray` | 目标 |
| `/npc_tank1/target_detected` | `String` | 目标提示 |
| `/npc_tank1/target/gnss` | `NavSatFix` | 目标位置 |

## 6.2 Forbidden

```text
/npc_tank1/referee/status
/npc_tank1/target/base64
/entity/state
/referee/*
/world/*
/sim/*
/ugv/*
#
/npc_tank1/#
```

## 6.3 Transport

```text
encoding = JSON
default QoS = 1
speed QoS = 0
QoS1 duplicate possible
no global source sequence
```

解码、时间、乱序、重复和 Payload Limit 继承 UGV Profile。

---

# 7. MQTT Message Profile

消息字段总体与 UGV 同构。

## 7.1 GNSS

```ts
interface NpcGnss {
  header?: MessageHeader;
  latitude: number;
  longitude: number;
  altitude?: number;
}
```

## 7.2 IMU

```ts
interface NpcImu {
  yaw: number;
  pitch: number;
  roll: number;
}
```

单位：

```text
radian
```

## 7.3 Mission State

```ts
interface NpcMissionState {
  header?: MessageHeader;
  entity_id: "npc_tank1";
  id?: string | number;
  type: number;
  state: -1 | 0 | 1 | 2 | 3 | 4 | 5;
  progress: number;
}
```

`progress` 只允许 0..100。

## 7.4 Status

可识别：

```text
vehicle_id
role_name
entity_id
position
speed_kmh
energy
temperature
network
chassis_task
eo_task
weapon_task
available
```

局部位置必须标记：

```text
frame = carla_world
```

不能覆盖 WGS84 GNSS。

---

# 8. 状态权威

底盘权威：

```text
mission_state
status.chassis_task
nav_state
```

载荷权威：

```text
area_recon_get_status
status.eo_task
status.weapon_task
```

非权威：

```text
run_state
mode
maneuver_state
nav_status
move_status
```

规则：

```text
run_state/mode 可解释
run_state/mode 不可完成任务
```

冲突：

```text
NPC_TASK_STATE_CONFLICT
→ Reconcile
```

---

# 9. Snapshot Contract

```ts
interface NpcTankSnapshot {
  identity: {
    providerId: "isr.vehicle.npc-tank.npc-tank1";
    resourceId: "vehicle:npc_tank1";
    entityId: "npc_tank1";
    vehicleType: "npc_tank";
    executionMode: "simulation";
  };

  chassis: VehicleChassisSnapshot;

  payload: VehiclePayloadSnapshot & {
    eoScan?: {
      supported: boolean;
      active?: boolean;
      mode?: "circular" | "unknown";
      angle?: number;
      zoom?: number;
      angleUnit?: "rad" | "deg" | "unknown";
    };
  };

  health: VehicleHealthSnapshot;
  connectivity: VehicleConnectivity;
  freshness: VehicleFreshness;
  revision: string;
  observedAt: string;
}
```

Revision 规则继承 UGV Profile。

禁止裁判字段。

---

# 10. Device MCP Contract

## 10.1 Transport

```yaml
transport: streamable-http
path: /mcp
defaultPort: 19003
```

启动：

```text
initialize
tools/list
schema validation
```

输出：

```text
reports/npc-tank-provider-v1/external-contract/npc-tank-device-mcp-tools.json
```

## 10.2 Candidate Allowlist

```text
npc_tank_send_waypoints
npc_tank_path_follow_mission
npc_tank_move_distance
npc_tank_return_home
npc_tank_mission_control
npc_tank_stop
npc_tank_cancel_mission

npc_tank_attack_target
npc_tank_area_recon_configure
npc_tank_area_recon_lock
npc_tank_area_recon_unlock
npc_tank_gimbal_move
npc_tank_area_recon_attack_confirm
npc_tank_area_recon_control
npc_tank_area_recon_reset
npc_tank_area_recon_get_status
npc_tank_area_recon_get_targets
npc_tank_area_recon_get_exceptions
npc_tank_laser_range

npc_tank_eo_scan_start
npc_tank_eo_scan_stop
npc_tank_eo_set_angle
npc_tank_get_capabilities
```

实际集合：

```text
candidate ∩ tools/list ∩ validated schema
```

---

# 11. 导航 Tool 选择

```text
primary = npc_tank_path_follow_mission
fallback = npc_tank_send_waypoints
```

规则：

1. 启动时选择；
2. 优先 primary；
3. primary 缺失或 Schema 不匹配才使用 fallback；
4. 执行中不得自动切换；
5. Contract Drift 后停止接纳新导航任务；
6. 选择结果持久报告。

输出：

```text
reports/npc-tank-provider-v1/navigation-tool-selection.json
```

---

# 12. EO Circular Scan

广告条件：

```text
npc_tank_eo_scan_start exists
npc_tank_eo_scan_stop exists
npc_tank_eo_set_angle exists
all schemas valid
```

满足：

```text
supportsCircularEoScan = true
```

不满足：

```text
supportsCircularEoScan = false
NPC_TANK_CIRCULAR_SCAN_UNSUPPORTED
```

不得用普通区域侦察伪装周扫。

---

# 13. Operation Catalog

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

所有输入：

```text
resourceId = vehicle:npc_tank1
additionalProperties = false
```

通用输入输出 Schema 继承 UGV Profile，Resource 和 Reason Code 替换为 NPC。

---

# 14. Operation 差异

## 14.1 `vehicle_navigate`

支持：

```text
point
route
distance
return_home
```

映射：

```text
point/route → selected navigation tool
distance → npc_tank_move_distance
return_home → npc_tank_return_home
pause/resume/terminate → npc_tank_mission_control
cancel → npc_tank_cancel_mission
stop → npc_tank_stop
```

## 14.2 `vehicle_area_recon`

输入可增加：

```json
{
  "scanMode": {
    "enum": ["area", "sector", "circular"]
  }
}
```

`circular` 不支持时同步 Admission Rejected：

```json
{
  "outcome": "admission_rejected",
  "reasonCode": "NPC_TANK_CIRCULAR_SCAN_UNSUPPORTED",
  "retryable": false
}
```

## 14.3 `vehicle_track_target`

映射：

```text
npc_tank_gimbal_move
npc_tank_area_recon_lock
npc_tank_area_recon_unlock
npc_tank_area_recon_get_status
```

## 14.4 `vehicle_fire_weapon`

必须使用标准 Input Required 确认。

最终本地结果：

```json
{
  "resourceId": "vehicle:npc_tank1",
  "targetId": "target-1",
  "outcome": "fire_cycle_completed",
  "localOnly": true,
  "confirmed": true,
  "reasonCode": "NPC_TANK_FIRE_CYCLE_COMPLETED",
  "observedAt": "2026-07-23T00:00:00Z"
}
```

禁止：

```text
hit
miss
destroyed
damage
remaining_hp
remainingHp
alive
```

## 14.5 `vehicle_emergency_stop`

```text
npc_tank_stop
npc_tank_cancel_mission
npc_tank_mission_control(terminate)
npc_tank_area_recon_control(stop)
npc_tank_area_recon_unlock
```

---

# 15. Task Behavior

| Operation | Behavior | Scheduling | MaxElapsed | InputRequired | Pause/Resume |
|---|---|---:|---:|---:|---:|
| 查询类 | synchronous_only | false | false | false | false |
| navigate | task_required | true | true | false | true |
| area_recon | task_required | true | true | false | true |
| track_target | task_required | false | true | false | false |
| fire_weapon | task_required | false | true | true | false |
| emergency_stop | task_required | false | true | false | false |

Wire 字段使用当前冻结 `io.sdar/taskExecution` Shape。

---

# 16. Track Contract

| Operation | chassis | eo | weapon |
|---|---|---|---|
| query | read | read | read |
| navigate | exclusive | none | none |
| area_recon | optional-read | exclusive | none |
| track_target | none | exclusive | none |
| fire_weapon | stopped-check | exclusive | exclusive |
| emergency_stop | preempt | preempt | preempt |

---

# 17. State Mapping

```text
-1 → idle or reconcile
0 → starting
1 → running
2 → paused
3 → cancelled
4 → succeeded
5 → failed
```

活动任务出现 `-1`：

```text
Reconcile
not direct success
```

---

# 18. Availability

Wire：

```text
available
restricted
disabled
unknown
```

Reason Code：

```text
NPC_TANK_AVAILABLE
NPC_TANK_MQTT_UNAVAILABLE
NPC_TANK_DEVICE_MCP_UNAVAILABLE
NPC_TANK_STATE_STALE
NPC_TANK_TOOL_UNAVAILABLE
NPC_TANK_CHASSIS_TRACK_BUSY
NPC_TANK_EO_TRACK_BUSY
NPC_TANK_WEAPON_TRACK_BUSY
NPC_TANK_GNSS_LOST
NPC_TANK_PATH_BLOCKED
NPC_TANK_POWER_DEPLETED
NPC_TANK_COMMUNICATION_LOST
NPC_TANK_SENSOR_BLIND
NPC_TANK_GIMBAL_FAULT
NPC_TANK_WEAPON_FAULT
NPC_TANK_TARGET_NOT_FOUND
NPC_TANK_TARGET_STALE
NPC_TANK_TARGET_NOT_LOCKED
NPC_TANK_ATTACK_NOT_READY
NPC_TANK_FIRE_REQUIRES_STOP
NPC_TANK_EXECUTION_MODE_UNSUPPORTED
NPC_TANK_CIRCULAR_SCAN_UNSUPPORTED
NPC_TANK_NAVIGATION_TOOL_UNAVAILABLE
NPC_TASK_STATE_CONFLICT
```

无法证明可用时必须 `unknown`。

---

# 19. Command Contract

## Cancel

```text
navigate → cancel_mission
recon → area_recon_control(stop)
track → unlock
fire → irreversible local action 前可取消
```

## Pause/Resume

支持：

```text
navigate
area_recon
```

不支持：

```text
track_target
fire_weapon
emergency_stop
```

## Idempotency

```text
taskId + commandType + commandSequence
```

重复命令不重复调用 Device MCP。

---

# 20. Reconcile

匹配：

```text
taskId
operationName
argumentHash
externalExecutionId
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

FOUND 必须有当前外部证据。

禁止读取：

```text
UGV execution
Referee state
ROS-only internal topics
```

---

# 21. Business Events

Sources：

```text
vehicle.execution
vehicle.health
vehicle.target
```

使用共享 Vehicle Event Catalog。

Payload：

```text
resourceId = vehicle:npc_tank1
entityId = npc_tank1
```

禁止：

```text
referee.*
vehicle.hit
vehicle.miss
vehicle.destroyed
target.destroyed
damage.applied
```

---

# 22. Evidence

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

Subject：

```text
resource:vehicle:npc_tank1
```

---

# 23. Security

递归剥离：

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

必须发生在：

```text
持久化前
日志前
Result 前
Evidence 前
Event 前
Telemetry 前
```

NPC Adapter 不得配置 UGV 或 Referee Endpoint。

---

# 24. Contract Capture

输出：

```text
reports/npc-tank-provider-v1/external-contract/
├── npc-tank-device-mcp-tools.json
├── npc-tank-mqtt-topics.json
├── npc-tank-mqtt-wire-shapes.json
├── navigation-tool-selection.json
├── eo-scan-capability.json
└── npc-contract-diff.json
```

Mock 合同：

```text
Component Test Contract
≠ Real Interface Contract
```

---

# 25. Conformance

```text
C-NPC-001 仅订阅 12 个 NPC Topic
C-NPC-002 UGV Topic 不影响 NPC Snapshot
C-NPC-003 Referee Topic 不影响 NPC Snapshot
C-NPC-004 MissionState 是任务权威
C-NPC-005 优先 path_follow
C-NPC-006 primary 缺失时启动期 fallback
C-NPC-007 执行中不切换 Tool
C-NPC-008 周扫只在完整合同下广告
C-NPC-009 活动任务 -1 进入 Reconcile
C-NPC-010 Command Sequence 幂等
C-NPC-011 Restart 后 externalExecutionId 稳定
C-NPC-012 Fire 未批准不执行
C-NPC-013 Verdict 字段被剥离
C-NPC-014 不发布 Referee/Destroyed Event
C-NPC-015 UGV 全量回归通过
```

---

# 26. Work 交付集成

Work 输入：

```text
原 UGV Work 工作空间或 UGV Work ZIP
SDAR_NPC_Tank_Provider_Codex_Work_Task_Package_V1.0.md
SDAR_NPC_Tank_Provider_Interface_Protocol_Profile_V1.0.md
SDAR_UGV_Provider_Interface_Protocol_Profile_V1.0.md
ISR-Simulation_UGV_NPC_Tank_Interface.md
冻结协议资产
```

最终 ZIP 必须包含：

```text
UGV Provider
NPC Tank Provider
两个 Profile
接口合同捕获
UGV 回归报告
NPC 报告
```

---

# 27. 最终冻结关系

```text
MCP Tasks / Adapter / Business Events
= Inherited Frozen

Shared Vehicle Operation Semantics
= Inherited from UGV Profile

NPC Identity / Topics / State Authority / Tool Selection / EO Capability
= NPC Profile Frozen V1.0

Device MCP 实际字段
= Capture Required

MQTT Bridge 实际 Envelope
= Capture Required
```
