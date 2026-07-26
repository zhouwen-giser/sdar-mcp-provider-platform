# SDAR MCP Tasks Provider Runtime
# NPC Tank Provider Codex Work 任务包 V1.0

## 0. 任务目标

在已经完成 UGV Provider 的原 Work 工作空间中继续实现 NPC Tank Provider。

最终项目同时包含：

```text
UGV Provider
NPC Tank Provider
共享 Provider Adapter Kit
共享 Vehicle Provider Core
两个独立 Runtime/Adapter 部署单元
完整源码 ZIP
```

本任务继续采用 Work 模式：

```text
不使用 Git
不创建分支
不提交
不推送
不创建 PR
不创建 Tag
```

本阶段不实现：

```text
Referee Provider
裁判数据
全局真值
红蓝对抗总体目标判断
NPC 行为树/Utility/Threat/自主策略
```

---

# 1. 输入工作空间

优先使用：

```text
NPC_WORKSPACE_ROOT
```

该目录应为 UGV Work 已完成后的项目根目录。

备选输入：

```text
UGV_WORK_DELIVERY_ZIP
```

或：

```text
/mnt/data/sdar-mcp-tasks-provider-runtime-ugv-provider-v1-work-delivery.zip
```

若使用 ZIP：

1. 校验 SHA-256；
2. 解压到稳定工作目录；
3. 确认不存在 `.git`；
4. 在该目录内继续工作；
5. 不重新 Clone 或初始化仓库。

开始前生成：

```text
reports/npc-tank-provider-v1/workspace-baseline.json
reports/npc-tank-provider-v1/workspace-baseline-files.sha256
```

至少记录：

```text
workspaceRoot
sourceType
inputZipSha256
fileCount
UGV provider files
shared package files
protected protocol files
UGV report files
capturedAt
```

---

# 2. 输入合同

必须同时提供并校验：

```text
SDAR_UGV_Provider_Codex_Work_Task_Package_V1.1.md
SHA-256:
5a7339cacd0f216094c244c10b79701fef2a767d9acce88d28123b4c815c1f53

SDAR_UGV_Provider_Interface_Protocol_Profile_V1.0.md
SHA-256:
b1700a78e18fc2d510a461abcc454b4aa81dbe7bbdc8b891d9e09726e11187f6

ISR-Simulation_UGV_NPC_Tank_Interface.md
SHA-256:
a67b7909ec7af7b3757e77cbaf5bae1c600fe348daa7faf239d8715d89fa375c

SDAR_NPC_Tank_Provider_Interface_Protocol_Profile_V1.0.md
SHA-256:
<使用随包校验文件>
```

---

# 3. UGV 基线门禁

最低应存在：

```text
UGV Adapter App
UGV Manifest
UGV MQTT Ingress
UGV Device MCP Mapping
Vehicle Provider Core
Execution Ledger
Business Events
Telemetry
verify:ugv-provider
reports/ugv-provider-v1
```

缺失时报告：

```text
UGV_WORKSPACE_BASELINE_INCOMPLETE
```

不得重新搭一套平行框架。

允许修复共享缺陷，但必须保证：

```text
UGV Manifest 语义不变
UGV MQTT Allowlist 不扩大
UGV Fire/Referee 隔离不变
UGV 全量回归通过
```

---

# 4. NPC 身份

```yaml
providerId: isr.vehicle.npc-tank.npc-tank1
providerType: isr.vehicle.npc_tank
providerProfileVersion: "1.0"
providerComponentVersion: "0.1.0"

resourceId: vehicle:npc_tank1
resourceType: isr.vehicle.npc_tank
entityId: npc_tank1
roleName: npc_tank1

runtimeMcpPort: 19103
adapterGrpcPort: 7013
deviceMcpUrl: http://127.0.0.1:19003/mcp
```

推荐数据库：

```text
npc_runtime
npc_adapter
```

禁止使用：

```text
ugv_runtime
ugv_adapter
```

---

# 5. 代码复用原则

优先复用 UGV 阶段已有：

```text
provider-adapter-kit
vehicle-provider-core
vehicle-mqtt-ingress
vehicle-device-mcp-client
execution store
business event source store
telemetry
mock harness
```

新增 NPC 内容应主要是：

```text
NpcTankProfile
NPC Topic Allowlist
NPC Normalizer
NPC Tool Mapping
NPC Manifest
NPC Adapter App
NPC Mock Fixtures
NPC Tests
```

禁止：

```text
复制整个 UGV Adapter 后只替换字符串
复制一套执行账本
复制一套 MQTT Client
复制一套 Business Event Store
```

共享代码发生修改时必须同时运行 UGV Gate。

---

# 6. NPC Adapter Protocol

实现现有 Adapter Protocol：

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

不得修改 Proto。

必须持久：

```text
taskId
externalExecutionId
operationName
argumentHash
resourceId
executionContext
tracks
providerRevision
commandAcks
```

Command 幂等键：

```text
taskId + commandType + commandSequence
```

---

# 7. NPC Resource

只暴露：

```text
vehicle:npc_tank1
```

内部轨道：

```text
chassis
eo
weapon
```

不得将轨道拆成独立 Runtime Resource。

Resource Metadata 至少：

```json
{
  "entityId": "npc_tank1",
  "vehicleRole": "npc_tank1",
  "executionModes": ["simulation"],
  "tracks": ["chassis", "eo", "weapon"],
  "supportsCircularEoScan": false,
  "externalVideo": true,
  "refereeDataAvailable": false,
  "globalTruthAvailable": false
}
```

`supportsCircularEoScan` 由合同捕获决定。

---

# 8. MQTT Exact Topic Allowlist

只允许订阅：

```text
/npc_tank1/gnss
/npc_tank1/imu
/npc_tank1/speed
/npc_tank1/status
/npc_tank1/system_state
/npc_tank1/component_status
/npc_tank1/battery_range_km
/npc_tank1/mission_state
/npc_tank1/nav_state
/npc_tank1/detected_objects
/npc_tank1/target_detected
/npc_tank1/target/gnss
```

禁止：

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

禁止宽泛订阅后过滤。

MQTT 解码、时间、重复、Payload Limit 复用 UGV 实现。

---

# 9. NPC 状态权威

底盘权威：

```text
/npc_tank1/mission_state
/npc_tank1/status.chassis_task
/npc_tank1/nav_state
```

载荷权威：

```text
npc_tank_area_recon_get_status
/npc_tank1/status.eo_task
/npc_tank1/status.weapon_task
```

以下只可解释，不可决定任务完成：

```text
run_state
mode
maneuver_state
move_status
nav_status
```

冲突时：

```text
NPC_TASK_STATE_CONFLICT
→ Reconcile
→ 不静默判成功
```

---

# 10. NPC Snapshot

复用共享 Vehicle Snapshot，NPC 身份固定为：

```ts
identity: {
  providerId: "isr.vehicle.npc-tank.npc-tank1";
  resourceId: "vehicle:npc_tank1";
  entityId: "npc_tank1";
  vehicleType: "npc_tank";
  executionMode: "simulation";
}
```

载荷可扩展：

```ts
eoScan?: {
  supported: boolean;
  active?: boolean;
  mode?: "circular" | "unknown";
  angle?: number;
  zoom?: number;
  angleUnit?: "rad" | "deg" | "unknown";
}
```

禁止字段：

```text
hp
裁判 ammo
alive
camp
hit
miss
destroyed
damage
remainingHp
global truth
world obstacles
```

---

# 11. NPC Device MCP

配置：

```text
NPC_TANK_DEVICE_MCP_URL=http://127.0.0.1:19003/mcp
NPC_TANK_DEVICE_MCP_TIMEOUT_MS
NPC_TANK_DEVICE_MCP_TLS_MODE
NPC_TANK_DEVICE_MCP_HEADERS_FILE
```

启动：

```text
initialize
tools/list
contract validation
```

输出：

```text
reports/npc-tank-provider-v1/external-contract/npc-tank-device-mcp-tools.json
```

候选 Allowlist：

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
candidate allowlist
∩ tools/list
∩ schema validation
```

---

# 12. 导航 Tool 策略

可能存在：

```text
npc_tank_path_follow_mission
npc_tank_send_waypoints
```

冻结策略：

1. 优先 `npc_tank_path_follow_mission`；
2. 不存在或 Schema 不匹配时使用 `npc_tank_send_waypoints`；
3. 启动期选择并固定；
4. 运行中不得自动切换重发；
5. 选择结果写入报告；
6. Contract Drift 后 Availability 变为 unknown/disabled。

输出：

```text
reports/npc-tank-provider-v1/navigation-tool-selection.json
```

---

# 13. Operation Catalog

对外 Operation 与 UGV 一致：

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

输入 Resource 固定：

```text
vehicle:npc_tank1
```

## 查询类

```text
vehicle_get_state
vehicle_get_payload_status
vehicle_get_targets
vehicle_laser_range
```

同步执行。

## `vehicle_navigate`

支持：

```text
point
route
distance
return_home
```

映射：

```text
point/route → 启动期选定的导航 Tool
distance → npc_tank_move_distance
return_home → npc_tank_return_home
pause/resume/terminate → npc_tank_mission_control
cancel → npc_tank_cancel_mission
stop → npc_tank_stop
```

## `vehicle_area_recon`

基础支持：

```text
area
sector
```

`circular` 仅在以下 Tool 和 Schema 全部有效时广告：

```text
npc_tank_eo_scan_start
npc_tank_eo_scan_stop
npc_tank_eo_set_angle
```

否则：

```text
NPC_TANK_CIRCULAR_SCAN_UNSUPPORTED
```

## `vehicle_track_target`

映射：

```text
npc_tank_gimbal_move
npc_tank_area_recon_lock
npc_tank_area_recon_unlock
npc_tank_area_recon_get_status
```

## `vehicle_fire_weapon`

映射：

```text
npc_tank_attack_target
npc_tank_area_recon_attack_confirm
```

只证明本地火控周期。

必须递归剥离：

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

## `vehicle_emergency_stop`

建议顺序：

```text
npc_tank_stop
npc_tank_cancel_mission
npc_tank_mission_control(terminate)
npc_tank_area_recon_control(stop)
npc_tank_area_recon_unlock
```

---

# 14. 明确不实现 NPC 决策

Provider 不包含：

```text
Behavior Tree
Threat Score
Utility Score
目标选择
攻击决策
撤退决策
巡逻策略
抢占策略
```

Provider 只执行显式 Operation，并解释本地执行事实。

---

# 15. Track Arbiter

默认：

| Operation | chassis | eo | weapon |
|---|---|---|---|
| query | read | read | read |
| navigate | exclusive | none | none |
| area_recon | optional-read | exclusive | none |
| track_target | none | exclusive | none |
| fire_weapon | stopped-check | exclusive | exclusive |
| emergency_stop | preempt | preempt | preempt |

配置：

```text
NPC_TANK_ALLOW_NAVIGATION_WITH_RECON
NPC_TANK_FIRE_REQUIRES_CHASSIS_STOPPED
```

---

# 16. Availability Reason Code

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

Wire 使用冻结小写枚举：

```text
available
restricted
disabled
unknown
```

---

# 17. Task State

设备：

```text
-1 idle
0 ready
1 running
2 paused
3 cancelled
4 completed
5 failed
```

映射与 UGV 相同。

活动任务出现 `-1`：

```text
Reconcile
not direct success
```

`run_state/mode` 不决定终态。

---

# 18. 执行账本与隔离

NPC 使用独立表或 Provider-scoped 通用表。

最低记录：

```text
taskId
externalExecutionId
operationName
argumentHash
resourceId
tracks
executionContext
downstreamMissionIds
selectedDeviceTool
state
revision
reasonCode
progress
result
latestSnapshotRevision
commandAcks
timestamps
```

必须保证：

```text
NPC 不读取 UGV 执行
UGV 不读取 NPC 执行
```

---

# 19. Reconcile

流程：

```text
load NPC active execution
→ load NPC snapshot
→ query NPC Device MCP
→ compare public task tracks
→ reconcile
```

结果：

```text
FOUND
NOT_FOUND
CONFLICT
UNCERTAIN
```

禁止：

```text
读取 UGV 执行
读取裁判状态
读取内部 ROS-only Topic
重复下发副作用命令
```

---

# 20. Business Events

Sources：

```yaml
vehicle.execution: durable_at_least_once
vehicle.health: durable_at_least_once
vehicle.target: best_effort_live
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

# 21. Evidence

复用：

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

# 22. Telemetry

复用共享 Telemetry。

固定有界属性：

```text
providerType = isr.vehicle.npc_tank
vehicleType = npc_tank
operationName
track
outcome
reasonCode
```

禁止：

```text
taskId
targetId
raw Mission ID
raw Payload
raw Reason
```

共享修改必须通过 UGV 回归。

---

# 23. Mock NPC 环境

实现：

```text
Mock NPC MQTT Publisher
Mock NPC Device MCP Server
```

场景：

```text
primary navigation available
primary missing → fallback
circular scan supported
circular scan unsupported
pause/resume/cancel/stop
target lock/lost
fire response with forbidden verdict
run_state/mode conflict
mission_state authoritative
restart recovery
```

---

# 24. Compose

追加：

```text
npc-tank-provider
```

NPC 组件：

```text
postgres-npc-runtime
postgres-npc-adapter
mqtt-npc-test
mock-npc-device-mcp
npc-tank-adapter
npc-tank-runtime
```

必须可与 UGV 同时启动。

---

# 25. 测试

## Unit

```text
npc-config
npc-topic-profile
npc-normalizers
npc-tool-mapping
navigation-tool-selection
eo-scan-capability
npc-availability
npc-fire-sanitizer
npc-state-authority
```

## Contract

```text
NPC Manifest
NPC Resource
Operation schemas
Device MCP contract
MQTT contract
Business Event source
Evidence
```

## Integration

```text
MQTT reconnect
tools/list
navigation primary/fallback
move distance
return home
pause/resume/cancel
area recon
conditional circular scan
track target
fire confirmation
emergency stop
reconcile
event replay
telemetry
database isolation
```

## Security

```text
referee topics rejected
UGV topics rejected
wildcard rejected
unknown tool rejected
forbidden verdict stripped
cross-provider execution inaccessible
```

## E2E

```text
NPC-01 Navigate Primary
NPC-02 Navigation Fallback
NPC-03 Area Recon
NPC-04 Circular Scan Conditional
NPC-05 Fire Boundary
NPC-06 State Authority
NPC-07 Restart
NPC-08 UGV Full Regression
```

---

# 26. 外部接口验证

环境变量：

```text
ISR_SIMULATION_REPO
ISR_MQTT_URL
ISR_MQTT_USERNAME
ISR_MQTT_PASSWORD_FILE
NPC_TANK_DEVICE_MCP_URL
```

尝试：

```text
定位 NPC MCP 源码
捕获 tools/list
验证导航 Tool
验证 EO Scan
捕获 MQTT 样本
只读 Smoke
可控任务 Smoke
```

失败时输出：

```text
reports/npc-tank-provider-v1/external-interface-blocker.json
```

Mock Level 1 仍必须完成。

---

# 27. 报告

新增：

```text
reports/npc-tank-provider-v1/
```

至少：

```text
workspace-baseline.json
workspace-baseline-files.sha256
source-document-lock.json
protocol-input-lock.json
architecture.json
reuse-audit.json
shared-code-diff.json
manifest.json
mqtt-contract.json
device-mcp-contract.json
navigation-tool-selection.json
eo-scan-capability.json
component.json
business-events.json
recovery.json
security.json
telemetry.json
ugv-regression.json
compose-e2e.json
external-interface-blocker.json
final-delivery-report.md
```

---

# 28. Work 阶段

```text
N0 Workspace Baseline
N1 Reuse Audit
N2 NPC MQTT Profile
N3 NPC Device MCP Mapping
N4 Manifest / State / Query
N5 Long-running Operations
N6 Business Events / Evidence / Telemetry
N7 Recovery / Isolation
N8 Compose / E2E / UGV Regression
N9 Final ZIP Delivery
```

每阶段输出：

```text
reports/npc-tank-provider-v1/checkpoints/N0.json
...
reports/npc-tank-provider-v1/checkpoints/N9.json
```

---

# 29. 验证脚本

新增：

```text
test:npc-tank-provider:unit
test:npc-tank-provider:contract
test:npc-tank-provider:integration
test:npc-tank-provider:security
test:npc-tank-provider:e2e
verify:npc-tank-provider
```

必须同时运行：

```text
verify:ugv-provider
verify:npc-tank-provider
verify:business-events
verify:business-events:telemetry
verify:v2
```

不得缩短 UGV Gate。

---

# 30. 最终交付

输出：

```text
/mnt/data/sdar-mcp-tasks-provider-runtime-ugv-npc-provider-v1-work-delivery.zip
/mnt/data/sdar-mcp-tasks-provider-runtime-ugv-npc-provider-v1-work-delivery.zip.sha256
/mnt/data/ugv-npc-provider-v1-work-delivery-manifest.json
/mnt/data/npc-tank-provider-v1-work-completion-report.md
```

ZIP 包含：

```text
UGV Provider
NPC Tank Provider
共享源码
测试
迁移
协议
需求
报告
锁文件
Compose
文档
```

ZIP 排除：

```text
.git
node_modules
dist
coverage
.env
credentials
private keys
database runtime data
cache
temporary files
```

---

# 31. Definition of Done

- [ ] 原 UGV Work 空间继续使用；
- [ ] 无 Git；
- [ ] UGV 基线完整；
- [ ] 不复制共享框架；
- [ ] NPC 通过 Profile/Mapping 扩展；
- [ ] 12 个精确 NPC Topic；
- [ ] Device MCP :19003；
- [ ] 9 个 Operation；
- [ ] Primary/Fallback Navigation；
- [ ] Conditional Circular Scan；
- [ ] NPC 独立账本；
- [ ] Reconcile；
- [ ] Business Events；
- [ ] Evidence；
- [ ] Telemetry；
- [ ] 不使用裁判或 UGV 数据；
- [ ] Fire Verdict 被剥离；
- [ ] NPC 全量测试通过；
- [ ] UGV 全量回归通过；
- [ ] 完整 UGV+NPC ZIP；
- [ ] SHA-256；
- [ ] Manifest；
- [ ] Completion Report。

---

# 32. Blocker

```text
UGV_WORKSPACE_BASELINE_INCOMPLETE
NPC_INTERFACE_DOCUMENT_HASH_MISMATCH
NPC_DEVICE_MCP_UNAVAILABLE
NPC_DEVICE_MCP_CONTRACT_MISMATCH
NPC_MQTT_UNAVAILABLE
NPC_MQTT_SCHEMA_MISMATCH
NPC_NAVIGATION_TOOL_UNAVAILABLE
NPC_EO_SCAN_CONTRACT_UNAVAILABLE
FROZEN_PROTOCOL_CONCURRENT_DRIFT
UGV_REGRESSION_FAILED
```

---

# 33. Codex Work 指令

Continue in the existing UGV Provider work workspace.

Do not use Git. Do not create a branch, commit, push, pull request or tag.

Read:

```text
SDAR_NPC_Tank_Provider_Codex_Work_Task_Package_V1.0.md
SDAR_NPC_Tank_Provider_Interface_Protocol_Profile_V1.0.md
SDAR_UGV_Provider_Interface_Protocol_Profile_V1.0.md
ISR-Simulation_UGV_NPC_Tank_Interface.md
```

Reuse the existing UGV foundations. Add one independent NPC Tank Adapter and one independent NPC Runtime.

Do not copy the UGV framework. Express differences through profiles, exact topic allowlists, tool mappings, schemas and capability rules.

Use only the 12 allowed NPC MQTT topics and only the NPC Device MCP server at port 19003.

Use MissionState and public task tracks as authority. Never use run_state or mode to decide task completion.

Prefer `npc_tank_path_follow_mission`; select `npc_tank_send_waypoints` only as a startup fallback when the captured contract requires it.

Advertise circular EO scan only when the captured tools and schemas support it.

Strip all referee/verdict fields before persistence, logging, results, evidence, events and telemetry.

Complete N0 through N9. Run every NPC gate and every existing UGV gate.

Return the complete modified project ZIP plus SHA-256, manifest and completion report.
