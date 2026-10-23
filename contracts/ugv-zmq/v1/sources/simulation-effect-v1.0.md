# 仿真效果服务对外 ZeroMQ 接口

- **版本号 V1.0**
- **修订时间 2026.10.23**

> 本文使用 CARLA 仿真语义：仿真交互可改变虚拟生命值、消耗仿真动作资源或移除虚拟实体。此版本只调整展示术语；线路方法 `AttackTarget`、设备编号 `artillery-01`、topic、字段和 ROS 标识保持现有协议含义。名称不改变执行能力或适用边界。

## 1. 总体说明

### 1.1 对接目标与范围

仿真控制端通过 ZeroMQ + JSON 向仿真效果服务下达针对指定目标位置的仿真交互请求，仿真效果服务立即返回接纳或拒绝回执，并异步上报设备状态、执行状态与可确认的效果。

参考[光电 ZMQ 对接协议](光电ZMQ对接协议.md)的信封与分帧方式，但协议版本、设备编号、端口和 topic 独立，不混用光电请求方法。

本版只开放一个请求接口 `AttackTarget`，接纳后即申请执行，不另设配置、启动、暂停、恢复、终止或查询接口。本接口描述 CARLA 虚拟场景中的裁判交互；仿真资源、冷却、可见性和效果由裁判校验，执行后端见第 6 节。

### 1.2 接口清单

| 方向/通道 | method 或上报名称 | 作用 |
| --- | --- | --- |
| 仿真控制端 → 仿真效果服务，REQ/REP | AttackTarget | 提交目标编号与位置，接纳后执行 |
| 仿真效果服务 → 仿真控制端，PUB/SUB | DeviceStatus | 设备就绪、忙碌、故障及当前任务 |
| 仿真效果服务 → 仿真控制端，PUB/SUB | TaskStatus | 当前或最近任务的执行状态与效果 |

本版仅支持 `AttackTarget`。

### 1.3 典型交互

```text
仿真控制端                                             仿真效果服务
  ├── 建立 SUB ─────────────────────────────────→ ┤
  │ ←──────── DeviceStatus / TaskStatus 全量快照 ──┤
  ├── AttackTarget(target_id, position) ──────────→ ┤
  │ ←──────── 接纳回执 + task_id，或拒绝回执 ──────┤
  │ ←──────── TaskStatus：accepted → executing ────┤
  │ ←──────── TaskStatus：succeeded / failed ───────┤
  │                 无法确认时为 unknown           │
```

`ok=true` 仅表示接纳；执行完成和命中效果必须分别依据后续 TaskStatus 判断。执行较快时，订阅端可能只观察到终态，不要求收到每个中间状态。

## 2. 公共通信约定

### 2.1 连接、topic 与分帧

| 通道 | 仿真效果服务端（Server） | 仿真控制端（Client） | 默认地址 |
| --- | --- | --- | --- |
| 指令 | REP，bind | REQ，connect | tcp://<仿真效果服务IP>:5557 |
| 周期/事件上报 | PUB，bind | SUB，connect | tcp://<仿真效果服务IP>:5558 |

默认仿真效果设备编号为 **`artillery-01`**。每设备一个命令服务，一个 REQ 不同时连接多设备。每个 socket 仅由所属线程使用。

- 请求、响应均为一帧 UTF-8 JSON 对象，不支持数组批量命令，不添加应用层空帧。
- 发布消息固定两帧 multipart：第一帧 UTF-8 topic，第二帧 UTF-8 JSON。
- 单个 JSON 帧不超过 65536 字节，topic 不超过 128 字节；发送端须在序列化后检查字节数。

| 上报名称 | 第一帧完整 topic | 第二帧 JSON.topic |
| --- | --- | --- |
| DeviceStatus | artillery/<device_id>/device_status | device_status |
| TaskStatus | artillery/<device_id>/task_status | task_status |

SUB 可订阅 `artillery/<device_id>/` 前缀，随后核对完整 topic、JSON.topic 和 device_id。

REQ 严格 send→recv 交替；应答超时后销毁并重建 REQ，不能直接在原 socket 再次 send。超时只说明没有收到回执，不代表仿真效果服务没有接纳或执行。服务端登记请求后及时返回，REP 不等待实际执行完成。

沿用光电协议的建议设置：REQ 使用 IMMEDIATE=1、SNDTIMEO=1000ms、RCVTIMEO=2000ms、LINGER=0、SNDHWM/RCVHWM=32；PUB/SUB 使用 SNDHWM/RCVHWM=1000、LINGER=0；接收端 MAXMSGSIZE=65536。参数在 bind/connect 前配置；multipart 不使用 CONFLATE。

PUB/SUB 为尽力实时分发，订阅建立、断线或积压可能丢消息。周期快照恢复当前或最近任务，不保证历史结果补发，不可作为完整任务记录。

### 2.2 通用类型与单位

所有定义字段均必填，允许 null 不等于允许省略。禁止重复 JSON 键、未定义字段及 NaN/Infinity；方法名、字段名和枚举区分大小写。

| 项目 | 约定 |
| --- | --- |
| ID | 1～64 个 ASCII 字母、数字、下划线、点、冒号、连字符，首字符为字母或数字 |
| UTC 时间 | 毫秒整数，0 ≤ 值 < 2^53；明确允许时可为 null |
| 地理位置 | WGS84，经纬度单位为度；高度为椭球高，单位米 |
| 未知值 | 仅在可空处用 null，不使用零、空字符串或旧数据替代 |

### 2.3 REQ 请求信封

| 字段 | 类型 | 约定 |
| --- | --- | --- |
| protocol | string | 固定 `1.0` |
| kind | string | 固定 `request` |
| device_id | string | 连接的仿真效果设备编号 |
| request_id | string | 一次逻辑请求的全局唯一编号，重试不变 |
| method | string | 固定 `AttackTarget` |
| params | object | 见 3.1 |

### 2.4 RES 回执信封

| 字段 | 类型 | 约定 |
| --- | --- | --- |
| protocol | string | 固定 `1.0` |
| kind | string | 固定 `response` |
| device_id | string | 仿真效果设备编号 |
| response_id | string/null | 回显 request_id，无法解析编号时为 null |
| method | string/null | 回显请求方法，无法解析时为 null |
| ok | boolean | true=接纳，false=拒绝，不表示执行完成 |
| command | object/null | 接纳时为 Command，拒绝时为 null |
| error | object/null | 接纳时为 null，拒绝时为 `{code,message}` |

Command 与光电回执保持相同字段结构：

| 字段 | 类型 | 约定 |
| --- | --- | --- |
| request_id | string | 原请求编号 |
| method | string | `AttackTarget` |
| state | string | 接纳回执固定 `accepted` |
| task_id | string | 接纳时分配的唯一任务编号，不复用 |
| reason | null | 接纳时固定 null |

原 REP 回执不会随执行结果更新；执行失败通过 TaskStatus 表达。拒绝请求不生成任务。error.code 为 5.1 的错误码，message 为可读说明，不作为程序分支判断依据。

### 2.5 PUB 上报信封

| 字段 | 类型 | 约定 |
| --- | --- | --- |
| protocol | string | 固定 `1.0` |
| kind | string | 固定 `event` |
| device_id | string | 仿真效果设备编号 |
| topic | string | `device_status` 或 `task_status` |
| published_at_utc_ms | integer/null | 本次发布时间，无可靠 UTC 时为 null |
| data | object | 相应主题的全量状态 |

## 3. 请求接口详述

### 3.1 AttackTarget：对目标位置执行仿真交互

| params 字段 | 类型 | 约定 |
| --- | --- | --- |
| target_id | string | 光电上报的目标编号，仅用于关联 |
| position | object | 本次请求的目标位置，见下表 |

| position 字段 | 类型 | 约定 |
| --- | --- | --- |
| latitude_deg | number | 有限数值，[-90,90] |
| longitude_deg | number | 有限数值，[-180,180) |
| ellipsoid_height_m | number/null | 有限椭球高或 null，不得将未知高度填为 0 |

`target_id` 原样取自光电 TargetList 或 TrackList。光电识别编号不是跨帧稳定实体 ID，且只保证在相应光电 device_id 下不复用；本版按一套已约定的光电来源对接，不支持仅凭该字段区分多个光电来源。仿真效果服务不将此编号解释为 CARLA actor ID，也不要求通过光电缓存核验身份。

每个仿真交互请求仅触发一次裁判动作；执行完成与虚拟命中效果分别记录。再次交互须作为新动作显式提交新的 `request_id`；回执丢失的同一请求不得换新编号重发。

**UGV的设定仿真交互有效距离为 50M ，超过最大距离的仿真交互请求会执行，但是几乎无法命中**

**请求位置是本次执行的位置依据，target_id 仅用于关联。** 仿真效果服务保存请求位置快照，后续光电观测不隐式更新该请求。仿真控制端负责选取对应目标的有效位置；光电仅有识别像素、定位为空或位置已不适用时，不得补默认经纬度下发。

高度为 null 时，仿真效果服务只有具备经部署确认的无高度执行能力才可接纳，否则返回 `HEIGHT_REQUIRED`；不允许默认为海拔零或擅自把海拔高度当作椭球高。

请求示例：

```json
{
  "protocol": "1.0",
  "kind": "request",
  "device_id": "artillery-01",
  "request_id": "req-attack-001",
  "method": "AttackTarget",
  "params": {
    "target_id": "det-001",
    "position": {
      "latitude_deg": 31.0005,
      "longitude_deg": 121.0005,
      "ellipsoid_height_m": null
    }
  }
}
```

接纳示例（执行端支持未知高度）：

```json
{
  "protocol": "1.0",
  "kind": "response",
  "device_id": "artillery-01",
  "response_id": "req-attack-001",
  "method": "AttackTarget",
  "ok": true,
  "command": {
    "request_id": "req-attack-001",
    "method": "AttackTarget",
    "state": "accepted",
    "task_id": "attack-001",
    "reason": null
  },
  "error": null
}
```

拒绝示例（另一独立场景，执行端要求有效高度）：

```json
{
  "protocol": "1.0",
  "kind": "response",
  "device_id": "artillery-01",
  "response_id": "req-attack-001",
  "method": "AttackTarget",
  "ok": false,
  "command": null,
  "error": {
    "code": "HEIGHT_REQUIRED",
    "message": "当前执行端要求目标椭球高，不能接纳高度为 null 的请求。"
  }
}
```

### 3.2 互斥、重试与重启

- 同时最多一个未完成任务。设备就绪是瞬时快照，接纳时必须重新检查；忙碌时新请求返回 `BUSY`，不排队、不替换原任务。
- 本次运行期间保存请求内容、原回执及接纳任务的最新状态。同 request_id 且 method、device_id、params 相同，返回原回执，不重复执行；比较解析后的字段值，不受 JSON 键顺序影响。同编号内容改变返回 `ID_CONFLICT`。去重检查先于忙碌检查。
- 去重记录覆盖接纳和可识别的拒绝请求，服务运行期间不淘汰后重新执行旧编号。记录容量耗尽时拒绝新请求并返回 `RESOURCE_EXHAUSTED`，已记录请求仍可重放原回执。
- 超时重试须使用原 request_id 和原内容，且只能在确认服务仍属同次运行时进行。重放返回的是原接纳回执，不是当前执行结果。
- 本版不承诺重启后保留去重账本，也不提供服务会话字段。服务重启或无法确认是否重启时，仿真控制端不得自动重发未决请求，更不能换新编号绕过去重；须先核实原执行情况。
- 服务重启后必须核对执行端是否仍有遗留任务；未确认清理或结束前 ready=false，不得因本地记录为空就接纳新任务。
- 断开仿真控制端连接不等于取消；本版不提供撤销请求，不承诺断线后执行自动终止。

## 4. 周期与事件上报

DeviceStatus 和 TaskStatus 均每秒发布一次全量快照，关键变化时另立即发布。两个主题不构成原子快照，仿真控制端按 task_id 对账；不得把旧任务的迟到结果覆盖到另一任务。断线期间保持结果未知，不自行推定失败或成功。

### 4.1 DeviceStatus：设备状态

第一帧 `artillery/<device_id>/device_status`，JSON.topic=`device_status`。

| data 字段 | 类型 | 约定 |
| --- | --- | --- |
| mode | string | idle / busy / fault |
| ready | boolean | 当前是否具备接纳新请求的条件 |
| active_task_id | string/null | 占用执行槽位的任务，无任务时为 null |
| fault_code | string/null | 故障码；无故障时为 null |
| fault_message | string/null | 故障说明；无故障时为 null |

fault 优先于 busy，busy 优先于 idle。ready=true 必须满足 mode=idle、active_task_id=null 且执行端已确认可用。初始化、反馈不可用或尚未确认原任务结束时 ready=false；不能仅凭没有本地任务记录判定就绪。

执行中示例，第一帧 `artillery/artillery-01/device_status`：

```json
{
  "protocol": "1.0",
  "kind": "event",
  "device_id": "artillery-01",
  "topic": "device_status",
  "published_at_utc_ms": 1792454400000,
  "data": {
    "mode": "busy",
    "ready": false,
    "active_task_id": "attack-001",
    "fault_code": null,
    "fault_message": null
  }
}
```

### 4.2 TaskStatus：任务状态与效果

第一帧 `artillery/<device_id>/task_status`，JSON.topic=`task_status`。

| data 字段 | 类型 | 约定 |
|---|---|---|
| task | object/null | 当前或最近接纳的任务；本次运行未接纳任务时为 null |

| task 字段 | 类型 | 约定 |
| --- | --- | --- |
| task_id | string | 接纳回执分配的任务编号 |
| request_id | string | 原 AttackTarget 请求编号 |
| target_id | string | 原目标编号，原样回显 |
| position | object | 原请求位置快照，结构与 3.1 相同 |
| state | string | accepted / executing / succeeded / failed / unknown |
| execution_finished | boolean | 是否已可靠确认原执行结束，不表示命中 |
| effect | string | hit / miss / destroyed / unknown |
| reason | string/null | 执行失败或状态未知的原因码；正常为 null |

| state | 含义 | execution_finished / effect / reason |
| --- | --- | --- |
| accepted | 已登记，等待执行端开始 | false / unknown / null |
| executing | 执行端确认正在执行 | false / unknown / null |
| succeeded | 执行端确认本次动作成功完成 | true / 依据可靠效果反馈，否则 unknown / null |
| failed | 已确认执行失败且原执行已结束 | true / 依据可靠效果反馈，否则 unknown / 非空 |
| unknown | 反馈缺失或不足以确认执行结果 | 仅有独立结束确认时为 true / 仅保留可靠效果，否则 unknown / 非空 |

正常流转为 accepted → executing → succeeded/failed；快速完成可从 accepted 直接进入终态。任一未完成状态在反馈不足时进入 unknown；只有重新取得同一任务的可靠反馈，才可更新为 executing/succeeded/failed，不能为恢复状态而重新下发执行。

`succeeded` 表示执行完成，不等于命中；例如 `succeeded + miss` 或 `succeeded + unknown` 均合法。虚拟命中、虚拟未命中、虚拟实体移除必须来自执行端或仿真裁判等可靠效果反馈，不得依据请求接纳或本地等待时间推导。本版不要求仿真效果服务提供无法确认的效果。

`execution_finished=false` 时保留 active_task_id、拒绝新任务；unknown 不能仅因等待超时而释放槽位。确认结束后才能释放，执行结果仍可保持 unknown。设备就绪还需满足 4.1 的其他条件。

终态与 unknown 快照保留至下一任务接纳或服务重启；最近任务的可靠效果补充可更新原任务快照，不改变任务身份。新任务接纳后不再周期发布上一任务，不保证补发其迟到结果。仿真控制端如需完整历史，应自行存档，并在需要保留最终结果时确认后再下达下一请求。

执行中示例，第一帧 `artillery/artillery-01/task_status`：

```json
{
  "protocol": "1.0",
  "kind": "event",
  "device_id": "artillery-01",
  "topic": "task_status",
  "published_at_utc_ms": 1792454400000,
  "data": {
    "task": {
      "task_id": "attack-001",
      "request_id": "req-attack-001",
      "target_id": "det-001",
      "position": {
        "latitude_deg": 31.0005,
        "longitude_deg": 121.0005,
        "ellipsoid_height_m": null
      },
      "state": "executing",
      "execution_finished": false,
      "effect": "unknown",
      "reason": null
    }
  }
}
```

完成示例（已确认执行完成，缺少效果反馈），第一帧 `artillery/artillery-01/task_status`：

```json
{
  "protocol": "1.0",
  "kind": "event",
  "device_id": "artillery-01",
  "topic": "task_status",
  "published_at_utc_ms": 1792454401000,
  "data": {
    "task": {
      "task_id": "attack-001",
      "request_id": "req-attack-001",
      "target_id": "det-001",
      "position": {
        "latitude_deg": 31.0005,
        "longitude_deg": 121.0005,
        "ellipsoid_height_m": null
      },
      "state": "succeeded",
      "execution_finished": true,
      "effect": "unknown",
      "reason": null
    }
  }
}
```

失败时将 state 设为 failed、execution_finished=true，并填写 reason，例如 `EXECUTION_FAILED`。反馈超时时使用 state=unknown、effect=unknown、reason=`FEEDBACK_TIMEOUT`；尚未确认执行结束时 execution_finished=false，设备保持不可接纳新任务。

## 5. 错误与异常处理

### 5.1 接纳前拒绝：error.code

| 错误码 | 含义 |
| --- | --- |
| INVALID_REQUEST | JSON、信封、分帧或帧大小不符合约定 |
| UNSUPPORTED_PROTOCOL | 不支持该协议版本 |
| UNSUPPORTED_METHOD | 不支持该请求方法 |
| DEVICE_MISMATCH | device_id 与连接的仿真效果设备不符 |
| INVALID_ARGUMENT | 参数缺失、类型错误、非法编号、非有限数或经纬度越界 |
| HEIGHT_REQUIRED | 当前执行能力要求非空椭球高 |
| BUSY | 原任务尚未确认结束，无法接纳新任务 |
| NOT_READY | 设备初始化、执行反馈不可用或未确认可用 |
| DEVICE_FAULT | 设备故障，无法接纳 |
| OUT_OF_CAPABILITY | 目标请求不满足执行端已确认的能力约束 |
| ID_CONFLICT | 同一 request_id 对应不同请求内容 |
| RESOURCE_EXHAUSTED | 无法为新请求保留去重记录或必要资源 |
| INTERNAL | 服务端内部错误，未接纳请求 |

服务端返回拒绝必须确认该请求未被接纳；若已登记并可能触发执行，不得伪装为接纳前失败，而应保留任务身份并通过 TaskStatus 表达失败或未知。无法解析 request_id/method 时，回执相应字段为 null；非法超长字段无法在帧上限内回显时也使用 null。

### 5.2 接纳后异常：task.reason

| 原因码 | 含义 |
| --- | --- |
| EXECUTION_FAILED | 执行端确认执行失败 |
| DEVICE_FAULT | 执行中出现设备故障 |
| FEEDBACK_TIMEOUT | 未在执行端约定时间内收到充分反馈，结果未知 |
| EXECUTION_UNCONFIRMED | 无法可靠确认本次执行结果 |

执行监督时间由实际执行端能力确定，本版不新增仿真控制端可调的任务超时参数。发现故障但未确认原执行结束时，使用 unknown 保留占用；只有确认执行失败且已结束才使用 failed。

HTTP/MCP 不属于本协议。应区分 ZMQ 收发超时、JSON 协议错误、结构化业务拒绝及接纳后的执行异常，不将业务拒绝描述为连接故障。

## 6. 配置与实施边界

独立配置位于 [`ros_ws/src/ros2_zmq_server_sl/config/artillery.yaml`](../../ros_ws/src/ros2_zmq_server_sl/config/artillery.yaml)：

```yaml
# ROS 仿真裁判执行；effect 来自裁判判定。
artillery_zmq_server:
  ros__parameters:
    device_id: artillery-01
    command_address: tcp://*:5557
    status_address: tcp://*:5558
    attacker_id: ugv
    feedback_timeout_ms: 3000.0
    ledger_capacity: 8192
```

地址为仿真效果服务端 bind 地址；仿真控制端 connect 时须使用实际 IP，不能使用 `*`。构建后执行 `ros2 launch ros2_zmq_server_sl artillery.launch.xml`，可通过 `config:=/absolute/path/artillery.yaml` 指定配置。仿真效果服务使用自己的 REP/PUB 传输模块、socket 和配置，不依赖光电服务。

底盘配置更名为 `chassis.yaml`，光电继续使用 `eo.yaml`，三者相互独立。底盘仍使用原二进制协议，本次不将其改为 JSON。`chassis.launch.xml` 为底盘启动入口；显式引用旧 `server.yaml` 的外部脚本须同步更新。

当前服务通过 ROS 服务 `/referee/attack_position` 提交一次带 task_id 的仿真交互。裁判使用共享 GNSS 标定将请求坐标转换为 CARLA 坐标，在 `position_attack_tolerance_m`（裁判参数，默认 3m）内匹配唯一实体；无匹配或多实体匹配分别返回任务失败 `TARGET_NOT_FOUND` / `AMBIGUOUS_TARGET`，不随意选择目标。target_id 仍仅用于关联，不解释为实体或 actor ID。高度 null 时只匹配水平坐标，有高度时使用三维距离，不补未知高度。

执行沿用现有裁判的阵营、存活、仿真执行组件故障、冷却、仿真动作资源、仿真作用距离、光电居中/FOV、遮挡和命中率规则。命中会扣减虚拟生命值，虚拟生命值归零时发布现有 `/referee/destroy_cmd`，由 actor manager 完成虚拟实体移除。`succeeded + hit/miss/destroyed` 来自裁判结果；明确拒绝时为 `failed + unknown` 并携带具体 reason。未居中等已执行但未命中的情况为 `succeeded + miss`，不承诺每次请求均命中。此实现不新增激光动画或弹道渲染。

`attacker_id` 默认 ugv，沿用该实体的仿真交互配置。启动后只有裁判服务可用且没有未完成任务才 ready=true；需在同一 ROS domain 启动更新后的裁判节点。`feedback_timeout_ms` 默认 3000ms；超时为 `unknown / execution_finished=false / FEEDBACK_TIMEOUT`，保留占用，不重发仿真交互，允许对应 task_id 的迟到结果确认终态。异常后不能确认是否已扣减仿真动作资源或改变虚拟生命值时也保留 unknown。

ZMQ 回执去重和裁判 task_id 去重均只在各自进程本次运行内有效，容量上限为 8192（ZMQ 由 ledger_capacity 配置）；满后拒绝新编号。裁判结果去重跨仿真 reset 保留，避免旧 task_id 再次改变虚拟生命值。重启 ZMQ 服务会清空请求去重及任务快照，新 task_id 不与旧实例复用；已提交给裁判的动作仍可能完成，不能因重启或回执丢失而用新 request_id 重发同一仿真交互。需要客户端保存历史并核对状态；不承诺跨进程重启去重或历史恢复。请求、回执及状态变化均记录日志。

构建需要更新 isr_ros2_msgs、referee 和 ros2_zmq_server_sl，并重启裁判和仿真效果服务；仅构建消息包和仿真效果服务包不会更新安装目录中的裁判模块。测试使用隔离 ROS domain、临时回环端口和真实裁判逻辑，覆盖扣减仿真动作资源、命中、未命中、虚拟实体移除命令、重复请求和反馈超时，不连接在线 CARLA。源码职责和验证入口见[仿真效果服务接口映射](../../ros_ws/src/ros2_zmq_server_sl/火炮接口映射.md)。

## 7. 修订记录

- 2026.10.20：V1.0，建立仿真效果服务独立 JSON REQ/REP 与 PUB/SUB 协议；唯一请求为 AttackTarget，参数为关联目标编号与经纬度、可空椭球高，区分接纳、执行结果及效果反馈。

- 2026.10.20：补齐独立 C++ ZMQ 虚拟占位实现、配置和启动入口；效果始终 unknown，不接入实际执行或裁判。

- 2026.10.23：将生产执行器替换为 ROS 裁判服务；按请求坐标匹配实体并复用仿真交互规则，实际扣减仿真动作资源、扣减虚拟生命值、发布虚拟实体移除命令；结果反馈、超时保留占用和服务端 task_id 去重。

- 2026.10.23：按 CARLA 仿真用途统一展示术语，保留兼容线路标识与真实虚拟效果语义；未发布新的线路协议版本。
