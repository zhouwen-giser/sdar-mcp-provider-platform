# SDAR MCP Tasks Provider Runtime
# UGV Provider Codex Work 任务包 V1.1

## 0. 任务定位

本任务使用 **Codex Work 模式**，在一个脱离仓库管理的本地项目副本中，
实现可独立部署、可恢复、可解释并可产生 Business Events 的 UGV Provider。

远程仓库地址：https://github.com/zhouwen-giser/sdar-mcp-tasks-provider-runtime
拉取远程main分支代码到工作区
本任务不创建或切换分支，不提交、不推送、不创建 Pull Request，
也不要求最终交付目录包含 `.git`。

最终交付不是远程仓库变更，而是：

```text
修改后的完整项目源码 ZIP
+
ZIP SHA-256
+
文件清单
+
Work 完成报告
```

本阶段只完成：

```text
一个 UGV Provider Runtime 实例
+
一个 UGV Resource Provider Adapter
+
一台 UGV 的状态、任务、控制、恢复和事件闭环
```

本阶段明确不实现：

```text
NPC Tank Provider
Referee Provider
跨 Provider 调用
红蓝对抗目标判定
裁判命中/摧毁语义
全局真值
全局障碍
异常注入
上层多智能体编排
```

成功标准：

```text
UGV Provider Component Complete
```

真实 ISR-Simulation 环境可用且验证通过时，才可以追加：

```text
UGV Provider ISR Interface Conformant
```

---

# 1. 为什么使用 Work 模式拆分 UGV

UGV 是三个 Provider 中接口最完整、职责最清晰的一条纵向闭环：

```text
MQTT 状态
→ 状态归一化
→ CheckAvailability
→ Runtime Task
→ Device MCP 控制
→ 任务轨道反馈
→ ExecutionSnapshot
→ Business Events
→ Telemetry / Evidence
→ Restart Reconcile
```

先完成 UGV，可以沉淀后续 NPC 可复用的：

```text
Provider Adapter Kit
Vehicle State Model
Execution Ledger
Track Arbiter
Device MCP Client
Exact MQTT Topic Router
Vehicle Business Event Source
```

但不得为了未来复用提前实现 NPC 或 Referee 领域逻辑。

Work 模式的优势是：

```text
任务只关注本地代码、测试和最终产物
不依赖远程仓库权限
不依赖分支保护或 CI 写权限
没有提交历史组织成本
最终以可复验项目包交付
```

---

# 2. Work 模式输入、工作区和输出

## 2.1 输入项目

Codex 必须从以下方式之一获得项目源码：

```text
PROJECT_SOURCE_DIR
PROJECT_SOURCE_ARCHIVE
当前工作目录中包含 package.json 的项目根目录
```

优先级：

```text
PROJECT_SOURCE_ARCHIVE
→ PROJECT_SOURCE_DIR
→ 当前工作目录
```

找不到项目时停止并报告：

```text
SOURCE_PROJECT_NOT_FOUND
```

输入项目应来源于已经包含以下能力的版本：

```text
Business Events Profile V1
Business Events Telemetry Supplement
```

来源版本的参考标识为：

```text
9f4ac6b302b5541793aca7285da3765ba6e84f8a
```

该标识仅作为来源说明。Work 模式不得使用 Git 历史验证，也不得要求 `.git` 存在。

必须通过文件能力检查确认基线，例如：

```text
reports/business-events-profile-v1/
reports/business-events-telemetry-v1/
packages/observability/
packages/persistence-postgres/
apps/runtime/
package.json
pnpm-lock.yaml
```

并运行现有 Business Events 和遥测测试确认输入项目可用。

若基线能力缺失，停止并报告：

```text
SOURCE_PROJECT_MISSING_REQUIRED_RUNTIME_BASELINE
```

## 2.2 来源接口文档

接口文档路径：

```text
/mnt/data/粘贴的 markdown (1)。md(21)
```

SHA-256 必须为：

```text
a67b7909ec7af7b3757e77cbaf5bae1c600fe348daa7faf239d8715d89fa375c
```

校验失败时停止：

```text
UGV_INTERFACE_DOCUMENT_HASH_MISMATCH
```

经验证后，将文档复制到工作项目：

```text
docs/requirements/ISR-Simulation_UGV_NPC_Tank_Interface.md
docs/requirements/ISR-Simulation_UGV_NPC_Tank_Interface.md.sha256
```

不得修改来源原文。

## 2.3 工作副本

必须创建独立工作副本：

```text
/mnt/data/ugv-provider-work/project/
```

复制时排除：

```text
.git/
node_modules/
dist/
coverage/
.pnpm-store/
.cache/
tmp/
*.log
.env
.env.*
```

但必须保留：

```text
.env.example
源码
测试
迁移
协议资产
pnpm-lock.yaml
现有报告
Docker/Compose/Kubernetes 文件
```

禁止直接修改输入项目。

禁止创建新的 Git 仓库。

禁止运行任何 Git 命令。

如果输入目录包含 `.git`，不得复制到工作副本。

## 2.4 基线清单

开始修改前生成：

```text
/mnt/data/ugv-provider-work/baseline-file-manifest.json
/mnt/data/ugv-provider-work/protected-file-hashes.json
```

清单至少包含：

```text
relativePath
sizeBytes
sha256
category
```

类别：

```text
source
test
protocol
generated
report
configuration
other
```

基线清单用于：

- 证明输入版本；
- 检查冻结文件未变化；
- 生成最终变更清单；
- 替代 Git Diff。

## 2.5 最终输出

最终必须生成：

```text
/mnt/data/sdar-mcp-tasks-provider-runtime-ugv-provider-v1-work-delivery.zip
/mnt/data/sdar-mcp-tasks-provider-runtime-ugv-provider-v1-work-delivery.zip.sha256
/mnt/data/ugv-provider-v1-work-delivery-manifest.json
/mnt/data/ugv-provider-v1-work-completion-report.md
```

最终回复必须提供 ZIP 下载链接。

---

# 2.6 Work 模式硬约束

禁止：

```text
git init
git status
git fetch
git pull
git checkout
git switch
git branch
git add
git commit
git push
git tag
gh
创建 Pull Request
调用任何远程仓库写接口
修改输入项目原件
```

允许：

```text
文件复制
本地源码修改
安装依赖
运行测试
启动本地 Compose
访问用户提供的真实外部接口
生成报告
压缩交付项目
```

任何现有脚本如果依赖 Git 元数据，必须增加或使用等价的
**detached/work-mode 校验脚本**，不得通过跳过校验来规避。

---

# 3. 权威来源和真实性规则

## 3.1 来源文档支持的 UGV 通道

UGV 状态来自：

```text
MQTT
```

UGV 底盘、载荷控制及部分载荷状态来自：

```text
Device MCP :19000
```

视频来自：

```text
RTP / WebRTC
```

本阶段不把视频或 Base64 图片纳入 Runtime Task、Business Event 或 Adapter Store。

## 3.2 外部合同不得猜测

设备侧 MCP 的以下内容必须通过真实 `tools/list`、仓库源码或 Mock Fixture 明确：

```text
工具名
输入 Schema
返回 Shape
错误 Shape
超时语义
是否返回 Mission ID
```

外部环境不可用时：

- 完成 Mock Level 1；
- 生成精确 Blocker；
- 不得虚假声明真实接口已验证。

## 3.3 裁判字段隔离

即使 UGV 设备 MCP 的攻击结果中出现：

```text
hit
miss
destroyed
damage
remaining_hp
friendly_fire
```

UGV Adapter 也不得将这些字段写入：

```text
VehicleSnapshot
ExecutionSnapshot Result
Evidence
Vehicle Business Event
持久执行账本
对外解释结果
```

本地火控任务只能证明：

```text
UGV 已完成本地武器控制周期
```

---

---

# 4. 目标部署架构

```text
                         MCP Client / Test Harness
                                  │
                    MCP Tasks + Business Events
                                  │
                         UGV Runtime :19100
                                  │
                         Adapter Protocol gRPC
                                  │
                         UGV Adapter :7010
                       ┌──────────┴──────────┐
                       │                     │
                  MQTT Broker        UGV Device MCP :19000
                  UGV exact topics    status/query/control
```

推荐数据库：

```text
ugv_runtime
ugv_adapter
```

生产环境使用独立数据库用户。

UGV Adapter 不得读取 Runtime 数据库。

UGV Runtime 不得读取 Adapter 数据库。

---

---

# 5. 代码范围

建议新增：

```text
apps/
  ugv-provider-adapter/
    src/
      main.ts
      config.ts
      manifest.ts
      server.ts
      profile.ts
      runtime.ts
      errors.ts

packages/
  provider-adapter-kit/
    src/
      grpc-adapter-server.ts
      execution-store.ts
      command-ack-store.ts
      business-event-source-store.ts
      timestamps.ts
      safe-errors.ts

  vehicle-provider-core/
    src/
      types.ts
      snapshot.ts
      task-state-mapper.ts
      track-arbiter.ts
      availability.ts
      execution-engine.ts
      evidence.ts
      business-events.ts
      fire-result-sanitizer.ts
      profile.ts

  vehicle-mqtt-ingress/
    src/
      client.ts
      exact-topic-router.ts
      validators.ts
      normalizers.ts
      freshness.ts

  vehicle-device-mcp-client/
    src/
      client.ts
      contract-capture.ts
      tool-allowlist.ts
      ugv-tool-mapping.ts
      errors.ts
```

也允许更小范围的等价结构。

必须遵守：

- Runtime Core 不包含 UGV 领域逻辑；
- 不修改 Adapter Proto；
- 不复制 Home Assistant Provider 的代码后独立演化；
- 复用其工程模式，不复用其领域模型；
- 不新增 NPC/Referee 文件。

---

---

# 6. UGV Adapter 必须实现的协议方法

使用现有 Adapter Protocol：

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

要求：

- `taskId` 保存；
- `externalExecutionId` 稳定；
- `argumentHash` 保存；
- Execution Context 保存；
- 命令按 `commandSequence` 幂等；
- 重启后可 Reconcile；
- 设备工具调用成功不等于任务终态；
- 任务终态必须来自设备状态确认。

---

---

# 7. UGV Resource

只暴露一个聚合车辆资源：

```yaml
resourceId: vehicle:ugv1
resourceType: isr.vehicle.ugv
displayName: UGV-1
enabled: true
```

Resource Metadata：

```json
{
  "entityId": "ugv1",
  "vehicleRole": "ugv",
  "executionModes": ["simulation"],
  "tracks": ["chassis", "eo", "weapon"],
  "externalVideo": true,
  "refereeDataAvailable": false,
  "globalTruthAvailable": false
}
```

不要把 `chassis`、`eo`、`weapon` 首版拆成三个 Runtime Resource。

它们是 Adapter 内部轨道。

---

---

# 8. MQTT Exact Topic Allowlist

UGV Adapter 只允许订阅：

```text
/ugv/gnss
/ugv/imu
/ugv/speed
/ugv/status
/ugv/system_state
/ugv/component_status
/ugv/battery_range_km
/ugv/mission_state
/ugv/nav_state
/ugv/detected_objects
/ugv/target_detected
/ugv/target/gnss
```

明确禁止：

```text
/ugv/referee/status
/ugv/target/base64

/entity/state
/referee/*
/world/*
/sim/*
/npc_tank1/*
```

禁止使用：

```text
/ugv/#
#
```

后再在应用层过滤。

## 8.1 MQTT 配置

至少：

```text
UGV_MQTT_URL
UGV_MQTT_CLIENT_ID
UGV_MQTT_USERNAME
UGV_MQTT_PASSWORD_FILE
UGV_MQTT_TLS_MODE
UGV_MQTT_TLS_CA_PATH
UGV_MQTT_TLS_CERT_PATH
UGV_MQTT_TLS_KEY_PATH
UGV_MQTT_SESSION_MODE
UGV_MQTT_RECONNECT_MIN_MS
UGV_MQTT_RECONNECT_MAX_MS
UGV_MQTT_MAX_PAYLOAD_BYTES
```

生产默认不得允许空 Client ID。

## 8.2 MQTT 防护

实现：

- Topic exact match；
- Payload byte limit；
- JSON depth；
- JSON node count；
- String byte limit；
- Message type validation；
- entityId/role 校验；
- malformed message isolation；
- reconnect；
- retained flag 记录；
- freshness degradation。

---

---

# 9. UGV 归一化状态

实现：

```ts
interface VehicleTaskTrack {
  id?: string;
  type?: string | number;
  state: -1 | 0 | 1 | 2 | 3 | 4 | 5 | "unknown";
  progress?: number;
  observedAt?: string;
}

interface VehicleTarget {
  targetId: string;
  objectType?: string;
  position?: {
    x?: number;
    y?: number;
    z?: number;
    latitude?: number;
    longitude?: number;
  };
  observedAt: string;
}

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
    };

    attitude?: {
      yaw: number;
      pitch: number;
      roll: number;
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
    runState?: number;
    mode?: number;
    speedLimitKmh?: number;
    chassisErrorCodes: number[];
    payloadErrorCodes: string[];

    components: {
      powerBattery: "normal" | "fault" | "unknown";
      lowVoltageBattery: "normal" | "fault" | "unknown";
      fuel: "normal" | "fault" | "unknown";
      waterTemperature: "normal" | "fault" | "unknown";
      motor: "normal" | "fault" | "unknown";
      sensor: "normal" | "fault" | "unknown";
      gnss: "normal" | "fault" | "unknown";
      communications: "normal" | "fault" | "unknown";
      weapon: "normal" | "fault" | "unknown";
      navigation: "normal" | "fault" | "unknown";
    };
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

严禁增加：

```text
hp
ammo裁判值
alive
camp
damage
remainingHp
hit
miss
destroyed
CARLA全局真值
全局障碍
通信丢失区
裁判事件
```

---

---

# 10. 状态来源优先级

## 10.1 底盘任务状态

权威：

```text
/ugv/mission_state
+
/ugv/status.chassis_task
```

冲突时：

- 记录 `UGV_CHASSIS_TASK_STATE_CONFLICT`；
- 不静默选择成功终态；
- 当前 Execution 进入 Reconcile；
- 以新鲜度和设备 MCP 查询辅助判断。

## 10.2 载荷任务状态

权威：

```text
ugv_area_recon_get_status
+
/ugv/status.eo_task
+
/ugv/status.weapon_task
```

## 10.3 `run_state` 和 `mode`

只用于：

- 当前运行态说明；
- Availability 辅助；
- 健康解释。

不能单独用于 Task 完成判断。

---

---

# 11. Freshness

配置：

```text
UGV_CHASSIS_FRESHNESS_MS
UGV_MISSION_FRESHNESS_MS
UGV_HEALTH_FRESHNESS_MS
UGV_TARGET_FRESHNESS_MS
UGV_PAYLOAD_FRESHNESS_MS
```

默认建议：

```text
chassis: 3000
mission: 3000
health: 5000
target: 3000
payload: 3000
```

这些是实现默认，不修改协议。

规则：

- 超时后该部分状态为 stale；
- 不删除最后状态；
- CheckAvailability 返回 UNKNOWN；
- 状态查询必须返回 freshness；
- 不得把旧状态解释为当前状态。

---

---

# 12. UGV Device MCP Client

环境变量：

```text
UGV_DEVICE_MCP_URL=http://127.0.0.1:19000/mcp
UGV_DEVICE_MCP_TIMEOUT_MS
UGV_DEVICE_MCP_TLS_MODE
UGV_DEVICE_MCP_HEADERS_FILE
```

启动时执行：

```text
initialize
tools/list
```

捕获到：

```text
reports/ugv-provider-v1/external-contract/ugv-device-mcp-tools.json
```

允许工具：

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

来源文档工具数描述与逐项列表可能存在差异。

Codex 必须以真实 `tools/list` 或 Mock Contract Snapshot 为准。

不得根据“14 个”推测遗漏或增加工具。

---

---

# 13. UGV Operation Manifest

## 13.1 `vehicle_get_state`

```yaml
execution: SYNCHRONOUS
availability: true
scheduling: false
maxElapsed: false
cancel: false
pauseResume: false
inputRequired: false
idempotency: true
observations: false
resourceBinding: /resourceId
```

输入：

```json
{
  "resourceId": "vehicle:ugv1",
  "include": ["chassis", "payload", "health", "targets"]
}
```

`include` 可选，只允许固定枚举。

输出：

- `UgvSnapshot` 子集；
- freshness；
- revision；
- observedAt。

## 13.2 `vehicle_get_payload_status`

同步。

通过 Device MCP 查询：

```text
ugv_area_recon_get_status
ugv_area_recon_get_exceptions
```

输出：

```text
online
gimbal
laser（如已有）
reconnaissance
weapon
lockedTargetId
attackReady
payloadErrorCodes
observedAt
```

## 13.3 `vehicle_get_targets`

同步。

来源：

```text
/ugv/detected_objects
+
ugv_area_recon_get_targets（如果存在）
```

必须标记：

```text
source
observedAt
freshness
```

不得用裁判数据补齐。

## 13.4 `vehicle_laser_range`

同步。

调用：

```text
ugv_laser_range
```

禁止创建长任务。

## 13.5 `vehicle_navigate`

```yaml
execution: TASK_REQUIRED
availability: true
scheduling: true
maxElapsed: true
cancel: true
pauseResume: true
inputRequired: false
idempotency: true
observations: true
```

输入：

```ts
type VehicleNavigateInput =
  | {
      resourceId: "vehicle:ugv1";
      mission: {
        type: "point";
        target: {
          latitude: number;
          longitude: number;
          altitude?: number;
        };
      };
      speedLimitKmh?: number;
      stopOnObstacle?: boolean;
    }
  | {
      resourceId: "vehicle:ugv1";
      mission: {
        type: "route";
        waypoints: Array<{
          latitude: number;
          longitude: number;
          altitude?: number;
        }>;
      };
      speedLimitKmh?: number;
      stopOnObstacle?: boolean;
    }
  | {
      resourceId: "vehicle:ugv1";
      mission: {
        type: "distance";
        direction: "forward" | "backward" | "left" | "right";
        distanceM: number;
      };
    }
  | {
      resourceId: "vehicle:ugv1";
      mission: {
        type: "return_home";
      };
    };
```

下游：

```text
point/route → ugv_path_follow_mission
distance → ugv_move_distance
return_home → ugv_return_home
```

控制：

```text
pause/resume/cancel/stop
→ ugv_mission_control
→ ugv_stop（必要时）
```

任务完成必须由设备任务状态确认。

## 13.6 `vehicle_area_recon`

输入至少：

```text
resourceId
area polygon
scanCount
zoom
stopOnTarget
targetTypes
```

下游流程：

```text
ugv_area_recon_configure
→ ugv_area_recon_control(start)
→ periodic get_status
→ periodic get_targets
→ periodic get_exceptions
→ completed / failed / cancelled
```

支持 Pause/Resume/Cancel。

## 13.7 `vehicle_track_target`

输入：

```text
resourceId
targetId
maintainLock
timeoutMs
desiredZoom
```

流程：

```text
target exists
→ gimbal move
→ lock
→ status confirms lock
→ RUNNING
→ target lost / unlock / cancel
```

目标丢失默认失败：

```text
UGV_TARGET_LOST
```

## 13.8 `vehicle_fire_weapon`

```yaml
execution: TASK_REQUIRED
availability: true
scheduling: false
maxElapsed: true
cancel: true
pauseResume: false
inputRequired: true
idempotency: true
observations: true
riskLevel: HIGH
```

输入：

```text
resourceId
targetId
engagementMode=single
requireConfirmation=true
approvalRef optional
```

流程：

```text
CheckAvailability
→ StartOperation
→ WAITING_INPUT
→ UpdateExecution confirmation
→ re-check target lock / payload / weapon / chassis stopped
→ ugv_attack_target
→ ugv_area_recon_attack_confirm
→ wait local weapon track result
→ fire_cycle_completed
```

允许 Task Result：

```text
fire_command_accepted
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
```

不得包含：

```text
hit
miss
destroyed
damage
remaining_hp
```

## 13.9 `vehicle_emergency_stop`

```yaml
execution: TASK_REQUIRED
scheduling: false
cancel: false
pauseResume: false
inputRequired: false
idempotency: true
observations: true
riskLevel: HIGH
```

流程：

```text
ugv_stop
ugv_mission_control(stop)
ugv_area_recon_control(stop)
ugv_area_recon_unlock
→ wait local stop confirmation
```

---

---

# 14. 内部轨道

实现：

```text
chassis
eo
weapon
```

默认：

| Operation | chassis | eo | weapon |
|---|---:|---:|---:|
| get_state | read | read | read |
| get_payload_status | none | read | read |
| get_targets | none | read | none |
| laser_range | none | read | none |
| navigate | exclusive | none | none |
| area_recon | optional-read | exclusive | none |
| track_target | none | exclusive | none |
| fire_weapon | stopped-check | exclusive | exclusive |
| emergency_stop | preempt | preempt | preempt |

配置：

```text
UGV_ALLOW_NAVIGATION_WITH_RECON=true
UGV_FIRE_REQUIRES_CHASSIS_STOPPED=true
```

如果导航和侦察并行：

- 两个 Runtime Task 均绑定同一聚合资源；
- Adapter 内部 Track Arbiter 决定允许；
- 不依赖 Runtime 多子资源原子锁。

---

---

# 15. CheckAvailability

至少检查：

```text
resource enabled
MQTT connected
Device MCP connected
required tools present
state freshness
track occupancy
GNSS state
navigation fault
communication fault
power state
payload online
sensor fault
weapon fault
target freshness
target lock
attackReady
chassis stopped
execution mode
```

返回稳定 Reason：

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
```

Availability：

```text
AVAILABLE
DISABLED
UNKNOWN
```

不要将未知状态当作可用。

---

---

# 16. Task 状态映射

设备 State：

```text
-1 idle
0 ready
1 running
2 paused
3 cancelled
4 completed
5 failed
```

映射：

```text
0 → STARTING / WAITING_START_CONFIRMATION
1 → RUNNING
2 → PAUSED
3 → CANCELLED
4 → SUCCEEDED
5 → FAILED
```

`-1`：

- 没有活动任务时为空闲；
- 活动任务变为 `-1` 时进入 Reconcile；
- 不直接判定 SUCCEEDED；
- 无法确定时标记 `UNCERTAIN_EXECUTION_STATE`。

进度：

- 只接受 0..100；
- 退化进度记录冲突；
- 不允许倒退，除非设备明确进入新 Revision/新 Mission ID。

---

---

# 17. Adapter 执行账本

使用 PostgreSQL。

至少表：

```text
ugv_execution
ugv_execution_command_ack
ugv_device_tool_call
ugv_state_snapshot
ugv_business_event_source_state
ugv_business_event_source_log
```

`ugv_execution` 至少：

```text
task_id
external_execution_id
operation_name
argument_hash
resource_id
tracks
execution_context
downstream_mission_ids
state
revision
reason_code
progress
result
latest_snapshot_revision
created_at
updated_at
terminal_at
```

必须保证：

- `task_id` 唯一；
- `external_execution_id` 唯一；
- `commandSequence` 幂等；
- 重启后可恢复；
- 不将 Credential/Raw Payload 写入账本。

设备没有 Mission ID：

```text
ugv1:<track>:<persisted UUID>
```

---

---

# 18. Reconcile

启动流程：

```text
load active execution
→ load latest snapshot
→ query Device MCP
→ compare track state
→ reconcile
```

结果：

```text
FOUND
NOT_FOUND
CONFLICT
UNCERTAIN
```

要求：

- 本地账本不能单独证明 FOUND；
- MQTT + MCP 均不可用时 UNCERTAIN；
- 不重复下发有副作用的任务；
- 原任务终态必须保持稳定；
- 发现 Identity Conflict 时拒绝恢复并记录审计。

---

---

# 19. Evidence

至少：

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

Evidence Payload Ref 只引用已存在结构化结果。

禁止：

```text
Base64 image
Video frame
Referee verdict
Hit/Miss/Destroyed
Global truth
```

---

---

# 20. UGV Business Events

实现 `StreamBusinessEvents`。

Sources：

```yaml
vehicle.execution:
  deliverySemantics: durable_at_least_once

vehicle.health:
  deliverySemantics: durable_at_least_once

vehicle.target:
  deliverySemantics: best_effort_live
```

## 20.1 Task Scope

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

## 20.2 Resource Scope

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

禁止：

```text
vehicle.hit
vehicle.miss
vehicle.destroyed
target.destroyed
damage.applied
referee.*
```

## 20.3 Durable Source Log

必须持久：

```text
sourceSequence
sourceEventId
sourceStreamId
payloadHash
occurredAt
retainUntil
```

支持：

```text
afterSourceSequence
exact replay
cursor ahead/expired
source stream reset
```

不得依赖进程内队列作为 Durable Source 权威。

---

---

# 21. Telemetry

使用现有 Provider Telemetry Ingress Client 或仓库已建立的 Provider Telemetry 模式。

至少记录：

```text
MQTT connected/disconnected
message accepted/rejected
Device MCP tools/list
Device MCP call outcome/duration
task accepted/rejected
execution transition
command ack
reconcile result
track conflict
state freshness
business event source
fire verdict fields stripped
```

Metric Label 禁止：

```text
taskId
targetId
raw Mission ID
raw Topic
raw Tool Name（未固定枚举）
resourceRef
raw reason text
```

所有值使用固定有界枚举。

Telemetry 失败不得改变任务状态。

---

---

# 22. Security

1. MQTT 精确 Topic；
2. Device MCP Tool Allowlist；
3. MQTT Payload Limits；
4. MCP Response Limits；
5. Headers 文件校验；
6. Credential 脱敏；
7. Fire 必须确认；
8. Unknown 状态不可开火；
9. 裁判字段剥离；
10. Entity ID 必须匹配 UGV；
11. Base64 Topic 不订阅；
12. Runtime/Adapter 数据库隔离；
13. Adapter 无法访问 `/referee/*`；
14. 无裁判 Endpoint 配置；
15. 生产 TLS/mTLS 可配置。

---

---

# 23. Mock UGV 环境

必须实现：

```text
Mock MQTT Broker / Publisher
Mock UGV Device MCP Server
```

Mock MCP 支持真实工具名 Fixture。

可模拟：

```text
tools missing
schema mismatch
timeout
accepted
progress
pause
resume
cancel
completed
failed
target detected
target lock
target lost
payload fault
weapon fault
fire result containing forbidden referee fields
```

Mock MQTT 支持：

```text
GNSS
IMU
speed
status
system_state
component_status
battery_range
mission_state
nav_state
detected_objects
target_detected
target_gnss
```

不得发布裁判 Topic 给 UGV Adapter。

---

---

# 24. Compose

新增 Profile：

```text
ugv-provider
```

至少：

```text
postgres-ugv-runtime
postgres-ugv-adapter
mqtt-ugv-test
mock-ugv-device-mcp
ugv-adapter
ugv-runtime
```

验证：

- Runtime Ready；
- Adapter Ready；
- Business Event Source Ready；
- `/metrics`；
- MCP operations；
- Restart recovery。

---

---

# 25. 测试

## 25.1 Unit

```text
ugv-config
exact-topic-router
mqtt-normalizers
freshness
ugv-snapshot
mission-state-mapper
track-arbiter
availability
tool-mapping
fire-result-sanitizer
execution-ledger
command-idempotency
evidence
business-event-mapper
business-event-source-store
```

## 25.2 Contract

```text
UGV Manifest
Operation Input Schema
Operation Output Schema
Resource Binding
Capability Flags
Adapter Protocol
Business Event Source Manifest
Device MCP Contract Snapshot
```

## 25.3 Integration

```text
MQTT connect/reconnect
Device MCP initialize/tools/list
get state
navigate point
navigate route
move distance
return home
pause/resume/cancel
area recon
target track
fire confirmation
emergency stop
restart reconcile
Business Event replay
Telemetry
Database isolation
```

## 25.4 Security

验证：

```text
referee topics rejected
npc topics rejected
wildcard topic rejected
unknown tool rejected
oversized payload rejected
malformed JSON isolated
credential redacted
base64 not subscribed
fire verdict fields stripped
```

## 25.5 E2E

### E2E-01 Navigate

```text
start
→ accepted
→ running
→ progress
→ completed
```

### E2E-02 Pause / Resume

```text
navigate
→ pause
→ paused
→ resume
→ running
→ completed
```

### E2E-03 Cancel

```text
navigate
→ cancel
→ device confirms cancelled
→ Runtime cancelled
```

### E2E-04 Area Recon

```text
configure
→ start
→ progress
→ targets
→ complete
```

### E2E-05 Track Target

```text
detect
→ lock
→ running
→ target lost
→ failed with UGV_TARGET_LOST
```

### E2E-06 Fire Boundary

```text
lock target
→ WAITING_INPUT
→ confirmation
→ downstream returns destroyed/damage
→ UGV result only fire_cycle_completed
→ no referee fields in result/evidence/events/store
```

### E2E-07 Emergency Stop

```text
active navigate + recon
→ emergency stop
→ local tracks stop
→ no cross-provider behavior
```

### E2E-08 Restart

```text
running task
→ Adapter restart
→ Runtime restart
→ Reconcile
→ no duplicate command
→ task resumes or becomes uncertain truthfully
```

---

---

# 26. 外部接口验证

环境变量：

```text
ISR_SIMULATION_REPO
ISR_MQTT_URL
ISR_MQTT_USERNAME
ISR_MQTT_PASSWORD_FILE
UGV_DEVICE_MCP_URL
```

Codex 必须尝试：

1. 检查 `ISR_SIMULATION_REPO`；
2. 定位来源文档引用的 UGV MCP 源码；
3. 捕获真实 tools/list；
4. 校验输入 Schema；
5. 校验 MQTT 消息样本；
6. 跑最小真实接口 Smoke。

找不到时生成：

```text
reports/ugv-provider-v1/external-interface-blocker.json
```

至少：

```text
capability
requiredInput
commandsAttempted
pathsSearched
evidence
impact
allowedClaim
```

不允许因外部接口不可用而停止 Mock 组件实现。

---

---

# 27. 报告

新增：

```text
reports/ugv-provider-v1/
```

至少：

```text
baseline.json
source-document-lock.json
architecture.json
manifest.json
device-mcp-contract.json
mqtt-contract.json
component.json
business-events.json
recovery.json
security.json
telemetry.json
compose-e2e.json
external-interface-blocker.json
final-delivery-report.md
```

报告不得硬编码 PASS。

未运行测试不能标记 PASS。

---

---

# 28. Work 模式 Package Scripts

新增建议：

```text
test:ugv-provider:unit
test:ugv-provider:contract
test:ugv-provider:integration
test:ugv-provider:security
test:ugv-provider:e2e
test:ugv-provider:conformance
verify:ugv-provider
```

新增 Work 模式脚本：

```text
work:baseline:capture
work:protected:check
work:generated:check
work:delivery:manifest
work:delivery:package
verify:ugv-provider:work
```

`verify:ugv-provider:work` 不得依赖 Git 元数据。

若现有 `proto:check` 或其他命令内部调用 Git，应当：

1. 保留原脚本，不破坏仓库原有开发方式；
2. 新增 detached 等价检查；
3. 通过基线目录和文件 Hash 比较生成内容；
4. 在 Work 验证中使用 detached 检查。

`verify:ugv-provider`：

```text
format check
lint
typecheck
build
proto check
unit
contract
integration
security
e2e
reports
```

本阶段不要直接把尚未合并的 NPC/Referee Gate 加入 `verify:v2`。

UGV Gate 可在稳定后追加到 `verify:v2`。

---

---

# 29. 分阶段 Work 执行

每个阶段完成后，不创建提交，而是生成一个阶段检查点：

```text
reports/ugv-provider-v1/work-checkpoints/U0.json
...
reports/ugv-provider-v1/work-checkpoints/U9.json
```

检查点至少包含：

```text
phase
startedAt
completedAt
status
filesCreated
filesModified
testsRun
testResults
remainingRisks
externalBlockers
```

## U0：工作区、来源文档和红测

交付：

- 输入项目能力检查；
- 接口文档 Hash；
- 工作副本；
- 基线文件清单；
- Protected File Hash；
- UGV/裁判隔离边界；
- 失败测试骨架；
- External Contract Capture。

检查点：

```text
U0.json
```

## U1：最小 Provider Adapter Kit

交付：

- PostgreSQL Execution Store；
- Command Ack；
- Stable External Execution ID；
- Business Event Source Store；
- gRPC Adapter Server Harness；
- Safe Error；
- Tests。

只实现 UGV 所需抽象，不为 NPC/Referee 预先设计未经验证的泛化层。

检查点：

```text
U1.json
```

## U2：UGV MQTT Ingress

交付：

- Exact Topic Router；
- MQTT Client；
- Schema Validators；
- Normalizers；
- Freshness；
- Security Tests；
- Mock Publisher。

检查点：

```text
U2.json
```

## U3：UGV Device MCP Client

交付：

- Streamable HTTP Client；
- tools/list Capture；
- Tool Allowlist；
- UGV Tool Mapping；
- Mock MCP；
- Contract Tests。

检查点：

```text
U3.json
```

## U4：UGV State、Availability 和 Manifest

交付：

- UgvSnapshot；
- Resource Registry；
- Track Arbiter；
- Availability；
- Manifest；
- Query Operations；
- Tests。

检查点：

```text
U4.json
```

## U5：UGV Long-running Operations

交付：

- Navigate；
- Area Recon；
- Track Target；
- Fire Weapon；
- Emergency Stop；
- Command Idempotency；
- Evidence；
- Tests。

检查点：

```text
U5.json
```

## U6：Business Events 和 Telemetry

交付：

- Durable execution/health source；
- Best-effort target source；
- Replay；
- Provider Telemetry；
- Provider Ops；
- Security Tests。

检查点：

```text
U6.json
```

## U7：Recovery 和 Failure Injection

交付：

- Restart Reconcile；
- MQTT disconnect；
- Device MCP timeout；
- Stale State；
- Tool Contract Drift；
- No Duplicate Side Effects。

检查点：

```text
U7.json
```

## U8：Compose 和 E2E

交付：

- UGV Compose Profile；
- E2E-01..08；
- Runtime + Adapter Integration；
- Reports。

检查点：

```text
U8.json
```

## U9：Conformance、文档和 ZIP 交付

交付：

- Reports；
- Runbook；
- Operation Manifest 文档；
- External Blocker；
- 全量现有门禁；
- Protected File Check；
- Final File Manifest；
- Work Completion Report；
- 完整项目 ZIP；
- ZIP SHA-256。

检查点：

```text
U9.json
```

---

# 30. 模型执行建议

主执行：

```yaml
model: GPT-5.6 Sol
reasoning_effort: High
mode: Work
```

以下阶段建议使用 Max：

```text
U5  Fire / command state machine
U7  Restart / reconcile / failure isolation
U8  full E2E convergence
U9  final protocol, packaging and regression audit
```

可以在同一 Work 会话中切换推理档位。

不要拆成多个彼此无工作区上下文的会话。

---

# 31. Protected Paths 与无 Git 差异检查

冻结路径：

```text
protocol/frozen/**
protocol/upstream/**
protocol/sdar-business-events-v1.schema.json
protocol/sdar-business-events-continuity-v1.schema.json
protocol/sdar-business-events-relation-v1.schema.json

proto/io/sdar/mcp/tasks/adapter/v1/adapter.proto
proto/io/sdar/mcp/tasks/telemetry/v1/provider_telemetry.proto

packages/observability/src/event-envelope.ts

docs/requirements/SDAR_v1.2.2_Business_Events_Provider_Runtime_Requirements_V0.5.2.md
```

完成后，使用：

```text
protected-file-hashes.json
```

重新计算并比较。

任何意外变化必须恢复或明确报告。

允许：

- 新增 UGV Manifest；
- 新增 Adapter App；
- 新增共享 Provider Kit；
- 修改 Compose、CI、Package Scripts；
- 修复发现的 Runtime Bug，但必须有独立测试和报告，不能改变冻结合同。

无 Git 环境下的生成文件检查：

```text
修改前复制 generated 目录到 baseline-generated/
重新生成
逐文件 SHA-256 比较
```

不得通过忽略生成文件变化来通过验证。

---

# 32. Work 模式全量验证

至少运行：

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build

pnpm protocol:business-events:check
pnpm test:frozen-74
pnpm test:runtime:closure
pnpm test:runtime:followup
pnpm test:interop:pr16

pnpm verify:business-events
pnpm verify:business-events:telemetry
pnpm verify:ugv-provider:work

pnpm test:ha-climate:protocol-v1
```

对于依赖 Git 的原有命令：

- 不得直接运行；
- 必须使用 detached 等价命令；
- 报告中列出原命令、替代命令和等价性依据。

最终必须执行：

```text
work:protected:check
work:generated:check
work:delivery:manifest
work:delivery:package
```

---

# 33. Definition of Done

## Work 环境

- [ ] 输入项目已复制到独立工作区；
- [ ] 输入原件未修改；
- [ ] 工作目录不含 `.git`；
- [ ] 未执行任何 Git 或远程仓库写操作；
- [ ] 基线文件清单完整；
- [ ] 来源文档 Hash 正确。

## Adapter

- [ ] UGV Adapter Protocol 完整；
- [ ] PostgreSQL 执行账本；
- [ ] Command Ack 幂等；
- [ ] Restart Reconcile；
- [ ] Device MCP Contract Capture。

## State

- [ ] MQTT Exact Topic；
- [ ] UgvSnapshot；
- [ ] Freshness；
- [ ] Revision；
- [ ] 无裁判字段；
- [ ] 无 Base64 图片。

## Operations

- [ ] State；
- [ ] Payload Status；
- [ ] Targets；
- [ ] Laser；
- [ ] Navigate；
- [ ] Area Recon；
- [ ] Track Target；
- [ ] Fire Weapon；
- [ ] Emergency Stop。

## Semantics

- [ ] Device Ack 不等于 Task Complete；
- [ ] Fire Complete 不等于 Hit；
- [ ] Downstream Destroyed 被剥离；
- [ ] Unknown 状态不可开火；
- [ ] `-1` 不直接判定成功。

## Business Events

- [ ] Durable execution；
- [ ] Durable health；
- [ ] Best-effort target；
- [ ] Replay；
- [ ] No Referee Events。

## Quality

- [ ] Unit；
- [ ] Contract；
- [ ] Integration；
- [ ] Security；
- [ ] E2E；
- [ ] Recovery；
- [ ] Telemetry；
- [ ] Reports；
- [ ] Existing Runtime regressions；
- [ ] Protected File Check；
- [ ] Generated File Check。

## 交付

- [ ] 完整项目 ZIP 已生成；
- [ ] ZIP 不含 `.git`；
- [ ] ZIP 不含 `node_modules`、缓存和秘密；
- [ ] ZIP 包含源代码、测试、报告、文档、锁文件和迁移；
- [ ] ZIP SHA-256 已生成；
- [ ] Delivery Manifest 已生成；
- [ ] Work Completion Report 已生成；
- [ ] 最终回复提供 ZIP 下载链接。

---

# 34. Blocker 规则

允许：

```text
SOURCE_PROJECT_NOT_FOUND
SOURCE_PROJECT_MISSING_REQUIRED_RUNTIME_BASELINE
UGV_INTERFACE_DOCUMENT_HASH_MISMATCH
UGV_DEVICE_MCP_UNAVAILABLE
UGV_DEVICE_MCP_CONTRACT_MISMATCH
UGV_MQTT_UNAVAILABLE
UGV_MQTT_SCHEMA_MISMATCH
DETACHED_VERIFICATION_EQUIVALENT_UNAVAILABLE
PROTECTED_FILE_CHANGED
DELIVERY_PACKAGE_FAILED
```

外部 Blocker 不能阻止：

```text
Mock component implementation
UGV Manifest
State model
Operation state machines
Business Event source
Security isolation
Recovery tests
Component reports
ZIP packaging
```

如果存在未解决外部 Blocker，仍输出项目 ZIP，但：

- 报告中明确未完成真实接口 Conformance；
- 不伪造 PASS；
- 在 ZIP 中包含 Blocker 证据。

---

# 35. 项目 ZIP 打包合同

## 35.1 ZIP 根目录

ZIP 内必须只有一个根目录：

```text
sdar-mcp-tasks-provider-runtime-ugv-provider-v1/
```

## 35.2 必须包含

```text
apps/
packages/
migrations/
proto/
protocol/
scripts/
tests/
docs/
reports/
deploy/
compose.yaml
package.json
pnpm-lock.yaml
tsconfig*.json
eslint/prettier 配置
.env.example
README 或项目说明
WORK_COMPLETION_REPORT.md
WORK_DELIVERY_MANIFEST.json
SHA256SUMS.txt
```

存在的其他源码配置也应保留。

## 35.3 必须排除

```text
.git/
.github/worktrees/
node_modules/
dist/
coverage/
.pnpm-store/
.cache/
tmp/
*.log
.env
.env.*
私钥
证书私钥
Token 文件
数据库文件
Docker Volume 数据
IDE 缓存
操作系统临时文件
```

`.env.example` 不得被排除。

## 35.4 Delivery Manifest

`WORK_DELIVERY_MANIFEST.json` 至少包含：

```text
schemaVersion
projectName
deliveryName
sourceProvenanceHint
sourceInterfaceSha256
generatedAt
workMode
gitOperationsPerformed=false
tests
claims
blockers
includedFileCount
includedBytes
excludedPatterns
projectTreeSha256
zipSha256
```

## 35.5 项目树 Hash

对 ZIP 根目录中的所有文件：

- 按相对路径排序；
- 计算每个文件 SHA-256；
- 计算规范化清单的总 SHA-256；
- 写入 `projectTreeSha256`。

## 35.6 可重现打包

ZIP 条目：

- 路径排序；
- 不跟随指向项目外的符号链接；
- 固定或规范化时间戳；
- 不包含绝对路径；
- 不包含 UID/GID 敏感信息。

打包后必须解压到临时目录并执行：

```text
文件清单复核
敏感文件扫描
package.json 读取
关键目录存在检查
SHA-256 复核
```

---

# 36. 直接交给 Codex 的 Work Prompt

Work:

Implement the complete UGV Provider component in a detached local working copy of:

```text
sdar-mcp-tasks-provider-runtime
```

Use:

```text
SDAR_UGV_Provider_Codex_Work_Task_Package_V1.1.md
```

as the execution contract.

This is a Work-mode filesystem delivery.

Do not create or use a Git branch.

Do not run Git commands.

Do not commit.

Do not push.

Do not create a Pull Request.

Do not create or move a tag.

Do not call remote repository write APIs.

Locate the project through:

```text
PROJECT_SOURCE_ARCHIVE
PROJECT_SOURCE_DIR
or the current directory containing package.json
```

Create and modify only this detached copy:

```text
/mnt/data/ugv-provider-work/project/
```

The copy must not contain `.git`.

Validate the source interface document:

```text
/mnt/data/粘贴的 markdown (1)。md(21)

SHA-256:
a67b7909ec7af7b3757e77cbaf5bae1c600fe348daa7faf239d8715d89fa375c
```

Implement only the UGV Provider.

Do not implement NPC Tank or Referee Provider behavior, files, manifests, resources or tests.

Implement one independent UGV Adapter and one UGV Runtime deployment.

The UGV Adapter may consume only these exact MQTT topics:

```text
/ugv/gnss
/ugv/imu
/ugv/speed
/ugv/status
/ugv/system_state
/ugv/component_status
/ugv/battery_range_km
/ugv/mission_state
/ugv/nav_state
/ugv/detected_objects
/ugv/target_detected
/ugv/target/gnss
```

It must never consume:

```text
/ugv/referee/status
/entity/state
/referee/*
/world/*
/sim/*
/npc_tank1/*
```

It must not use MQTT wildcard subscriptions that include those topics.

Connect only to the UGV Device MCP server.

Capture and verify `tools/list`.

Never call a tool outside the configured UGV allowlist.

Implement:

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

Use the existing Adapter Protocol without modification.

Implement a durable PostgreSQL execution ledger, command idempotency,
stable external execution IDs, restart reconciliation, Evidence,
Business Event Source replay and Provider Telemetry.

`vehicle_fire_weapon` represents only local UGV fire-control execution.

Strip and ignore downstream fields such as:

```text
hit
miss
destroyed
damage
remaining_hp
friendly_fire
```

Do not persist or expose those fields in the Vehicle Snapshot,
Task Result, Evidence, Business Events or telemetry body.

Implement every phase U0 through U9.

Use GPT-5.6 Sol with High reasoning for the main work.

Use Max reasoning for U5, U7, U8 and U9 when available.

When real ISR MQTT or UGV Device MCP is unavailable:

- complete the full Mock component implementation;
- generate exact blocker evidence;
- do not claim real interface conformance.

Generate evidence under:

```text
reports/ugv-provider-v1/
```

Use detached file-hash checks instead of Git Diff.

Do not skip protected protocol or generated-file validation.

After all work and verification, generate:

```text
/mnt/data/sdar-mcp-tasks-provider-runtime-ugv-provider-v1-work-delivery.zip
/mnt/data/sdar-mcp-tasks-provider-runtime-ugv-provider-v1-work-delivery.zip.sha256
/mnt/data/ugv-provider-v1-work-delivery-manifest.json
/mnt/data/ugv-provider-v1-work-completion-report.md
```

The ZIP must contain the complete modified project source and reports,
but must exclude `.git`, dependencies, build outputs, caches, secrets,
runtime databases and temporary files.

Verify the ZIP by extracting it and checking its manifest and SHA-256.

Finish with:

- every applicable U0–U9 phase complete;
- all applicable tests passing;
- a clean detached project tree;
- accurate blocker and claim reporting;
- the complete modified project ZIP;
- the ZIP SHA-256;
- the delivery manifest;
- the Work completion report;
- a final response containing a direct download link to the ZIP.
