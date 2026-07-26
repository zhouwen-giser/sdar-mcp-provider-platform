# SDAR MCP Tasks Provider Profile

> **文档状态：** Provider Profile 冻结稿  
> **Profile 版本：** `1.0`  
> **目标客户端：** SDAR v1.1  
> **适用对象：** MCP Server、MCP Tasks 服务提供商、具身设备控制平台、仿真平台、批处理与长时任务平台  
> **标准底座：** SEP-2663 MCP Tasks Extension  
> **SDAR 扩展命名空间：** `io.sdar/taskExecution`  
> **日期：** 2026-07-16

---

# 1. 文档定位

本文档不是重新定义一套独立的 Task 协议，而是定义：

> **一个基于 SEP-2663 的 SDAR Provider Profile。**

协议分层如下：

```text
SEP-2663
  └─ 定义通用远程 Task 生命周期

SDAR MCP Tasks Provider Profile
  └─ 定义 SDAR 所需的可用性、受限状态、可用时间窗口、
     启动时间合同、最大等待、观测事件和结构化业务终态

Provider 内部实现
  └─ 负责资源、调度、抢占、暂停恢复和实际执行
```

因此：

- SEP-2663 已定义的内容，本文档只规定“必须遵守”，不重新发明；
- SEP-2663 未覆盖但 SDAR v1.1 必须使用的内容，由 `io.sdar/taskExecution` Profile 补充；
- Provider 内部资源模型不属于本 Profile。

---

# 2. 规范性关键词

本文档使用：

- **MUST / 必须**：强制要求；
- **MUST NOT / 禁止**：禁止行为；
- **SHOULD / 应当**：除非有明确且记录的原因，否则必须遵守；
- **SHOULD NOT / 不应**：除非有明确且记录的原因，否则不采用；
- **MAY / 可以**：可选能力。

Provider 只有满足对应等级的全部 MUST，才能声明符合该 Profile 等级。

---

# 3. Profile 目标

本 Profile 解决：

1. SDAR 通过 `tools/call` 发起同步操作或异步 Task；
2. Provider 作为资源和实际执行态的权威；
3. Provider 对 Operation 提供：
   - `available`
   - `restricted`
   - `disabled`
   - `unknown`
4. `restricted` 时返回当前可用时间信息；
5. DSL 校验阶段允许 LLM 做出继续、改期、替换、请求确认或放弃决策；
6. Provider 在实际调用时完成最终仲裁；
7. Provider 可以暂停或恢复其管理的其他 Task；
8. 暂停和恢复只作为观测，不改变 SEP-2663 标准状态；
9. Task 支持 immediate、scheduled、start tolerance 和可选 max elapsed；
10. 到达启动窗口仍不可用时，Provider 返回结构化业务终态；
11. 到达最大等待时间时，Provider安全停止并返回结构化业务终态；
12. SDAR 可以可靠轮询、重启恢复、补充输入和请求取消。

---

# 4. 非目标

本 Profile 不定义：

- Provider 内部资源类型；
- 资源能力本体；
- 设备锁；
- 优先级算法；
- 抢占算法；
- 暂停队列；
- 恢复顺序；
- Worker 技术选型；
- 数据库选型；
- Provider 内部 Task 状态机实现；
- SDAR 的 Workflow DSL；
- SDAR 的 LangGraph continuation 实现；
- 跨 Provider 资源仲裁。

---

# 5. SEP-2663 标准底座

符合本 Profile 的 Provider MUST 符合 SEP-2663。

必须支持：

```text
tools/call
tasks/get
tasks/update
tasks/cancel
```

可选支持：

```text
notifications/tasks
```

必须使用 SEP-2663 标准 Task 状态：

```text
working
input_required
completed
failed
cancelled
```

## 5.1 标准规则

Provider MUST 遵守：

- Task 返回前已持久化；
- 返回 taskId 后可立即通过 `tasks/get` 查询；
- `tasks/get` 是幂等读取；
- `tasks/update` 是输入更新确认；
- `tasks/cancel` 是取消请求确认，不表示立即停止；
- `completed / failed / cancelled` 是不可逆终态；
- Tool 业务错误通过 `CallToolResult.isError=true` 表达；
- `failed` 只用于 Task 执行中的 JSON-RPC Error；
- unknown taskId 返回标准无效参数错误；
- Provider 不向未声明 Tasks 能力的客户端返回 Task。

## 5.2 本 Profile 不重新定义的字段

```text
taskId
status
statusMessage
createdAt
lastUpdatedAt
ttlMs
pollIntervalMs
inputRequests
result
error
```

---

# 6. 能力协商

## 6.1 SEP-2663 能力

Provider MUST 声明：

```json
{
  "capabilities": {
    "extensions": {
      "io.modelcontextprotocol/tasks": {}
    }
  }
}
```

## 6.2 SDAR Profile 能力

Provider 支持本 Profile 时 MUST 声明：

```json
{
  "capabilities": {
    "extensions": {
      "io.sdar/taskExecution": {
        "version": "1.0",
        "availability": true,
        "scheduling": true,
        "observations": true,
        "idempotency": true
      }
    }
  }
}
```

```ts
interface SdarTaskExecutionCapability {
  version: "1.0";
  availability: boolean;
  scheduling: boolean;
  observations: boolean;
  idempotency: boolean;
}
```

Provider 不支持某项能力时 MUST 显式返回 `false`。

---

# 7. Tool 发现 Profile

## 7.1 Tool 元数据

Task-capable Tool SHOULD 在 `_meta` 中声明：

```json
{
  "name": "vehicle_patrol",
  "description": "Runs a long-running vehicle patrol.",
  "inputSchema": {},
  "_meta": {
    "io.sdar/taskExecution": {
      "profileVersion": "1.0",
      "execution": "task_required",
      "availability": "dynamic",
      "supportsScheduling": true,
      "supportsMaxElapsed": true,
      "supportsObservations": true,
      "supportsInputRequired": true,
      "supportsCancel": true,
      "supportsIdempotency": true
    }
  }
}
```

## 7.2 元数据模型

```ts
interface SdarTaskToolProfile {
  profileVersion: "1.0";
  execution: "synchronous" | "task_capable" | "task_required";
  availability: "not_supported" | "dynamic";
  supportsScheduling: boolean;
  supportsMaxElapsed: boolean;
  supportsObservations: boolean;
  supportsInputRequired: boolean;
  supportsCancel: boolean;
  supportsIdempotency: boolean;
}
```

## 7.3 execution 语义

### synchronous

Provider MUST NOT 返回 Task。

### task_capable

Provider MAY 返回普通 `CallToolResult` 或 `CreateTaskResult`。

### task_required

Provider 接受调用时 MUST 返回 `CreateTaskResult`。

## 7.4 scheduled 调用规则

包含：

```text
timing.start.mode = scheduled
```

的调用：

- 接受时 MUST 返回 `CreateTaskResult`；
- 拒绝时 MUST 返回 `CallToolResult.isError=true`；
- MUST NOT 同步返回普通成功结果后在后台另行创建执行。

---

# 8. Operation Availability Profile

## 8.1 方法

本 Profile 定义：

```text
io.sdar/taskExecution/checkAvailability
```

Provider 声明 `availability = true` 时 MUST 实现该方法。

## 8.2 Availability 不是资源预留

该方法返回的是 Provider 基于当前信息形成的执行预测，不是：

- 资源锁；
- Task 创建；
- 强制预约；
- 执行授权；
- 未来一定成功的承诺。

实际 `tools/call` 时 Provider仍拥有最终决定权。

## 8.3 请求

```json
{
  "jsonrpc": "2.0",
  "id": 101,
  "method": "io.sdar/taskExecution/checkAvailability",
  "params": {
    "checks": [
      {
        "requestId": "workflow-node-7",
        "operationName": "vehicle_patrol",
        "arguments": {
          "vehicleId": "vehicle-001",
          "routeId": "route-008"
        },
        "timing": {
          "start": {
            "mode": "scheduled",
            "scheduledAt": "2026-07-17T10:00:00+09:00",
            "startToleranceMs": 30000
          },
          "maxElapsedMs": 1200000
        }
      }
    ]
  }
}
```

## 8.4 请求模型

```ts
interface CheckAvailabilityRequest {
  checks: readonly TaskAvailabilityCheck[];
}

interface TaskAvailabilityCheck {
  requestId: string;
  operationName: string;
  arguments:
    | Readonly<Record<string, unknown>>
    | {
        unresolved: true;
        knownArguments: Readonly<Record<string, unknown>>;
        unresolvedPaths: readonly string[];
      };
  timing?: TaskExecutionTiming;
}
```

## 8.5 响应

```json
{
  "jsonrpc": "2.0",
  "id": 101,
  "result": {
    "profileVersion": "1.0",
    "checkedAt": "2026-07-16T12:00:00Z",
    "checks": [
      {
        "requestId": "workflow-node-7",
        "operationName": "vehicle_patrol",
        "availability": "restricted",
        "riskLevel": "high",
        "reasonCode": "PREEMPTIBLE_TASK_ACTIVE",
        "description": "A preemptible task currently occupies the resource.",
        "validUntil": "2026-07-16T12:00:10Z",
        "earliestStartTime": "2026-07-17T10:10:00+09:00",
        "nextAvailableWindows": [
          {
            "startTime": "2026-07-17T10:10:00+09:00",
            "endTime": "2026-07-17T10:40:00+09:00"
          }
        ],
        "estimatedDelayMs": 600000,
        "possibleEffects": [
          "task_preemption",
          "task_pause",
          "start_rejection"
        ]
      }
    ]
  }
}
```

---

# 9. Availability 状态

```ts
type TaskOperationAvailability =
  | "available"
  | "restricted"
  | "disabled"
  | "unknown";
```

## 9.1 available

表示 Provider 当前判断该调用可正常接受。

Provider SHOULD：

- 在 `validUntil` 内保持较高成功概率；
- 实际调用时仍重新仲裁；
- 在状态已变化时返回拒绝，而不是创建无法执行的幽灵 Task。

## 9.2 restricted

表示操作允许被尝试，但可能：

- 暂停其他 Task；
- 抢占资源；
- 延迟启动；
- 在实际调用时拒绝；
- 错过启动窗口；
- 到达最大等待；
- 部分完成。

restricted MUST 返回：

- `reasonCode`；
- `riskLevel`；
- `validUntil`；
- `possibleEffects`。

restricted SHOULD 返回：

- `earliestStartTime`；或
- 非空 `nextAvailableWindows`。

无法预测窗口时 MUST 明确：

```json
{
  "availability": "restricted",
  "reasonCode": "WINDOW_NOT_PREDICTABLE"
}
```

## 9.3 disabled

表示当前不得执行。

Provider：

- MUST NOT 创建 Task；
- MUST 给出稳定 reasonCode；
- SHOULD 给出恢复条件或下次建议检查时间。

## 9.4 unknown

表示 Provider 无法可靠判断。

Provider：

- MUST NOT 把 unknown 表达为 available；
- MUST 在实际调用时完整仲裁；
- SHOULD 返回原因。

---

# 10. 可用时间窗口

## 10.1 模型

```ts
interface TaskAvailableWindow {
  startTime: string;
  endTime: string;
}
```

## 10.2 时间格式

时间 MUST：

- 使用 RFC 3339 / ISO 8601；
- 包含 `Z` 或明确时区偏移；
- 禁止无时区本地时间；
- `startTime < endTime`。

## 10.3 窗口要求

`nextAvailableWindows`：

- MUST 按 `startTime` 升序；
- SHOULD 不重叠；
- SHOULD 合并相邻或重叠窗口；
- SHOULD 至少返回最近一个窗口；
- MAY 限制数量；
- 必须只表示预测，不表示已经创建 Task。

## 10.4 earliestStartTime

如果同时返回 `nextAvailableWindows`：

- `earliestStartTime` SHOULD 等于第一个窗口起点；
- 或位于第一个窗口内部。

## 10.5 validUntil

Provider MUST：

- 确保 `validUntil >= checkedAt`；
- 允许客户端在节点执行前重新检查；
- 不把过期预测描述为当前有效。

---

# 11. 风险字段

```ts
type TaskRiskLevel = "low" | "medium" | "high" | "critical";

type TaskPossibleEffect =
  | "task_preemption"
  | "task_pause"
  | "start_rejection"
  | "start_window_missed"
  | "deadline_reached"
  | "partial_completion";
```

Provider：

- MUST 只返回真实可能发生的影响；
- MUST NOT 隐藏高风险抢占；
- SHOULD 提供稳定 reasonCode；
- SHOULD 给出简短、可展示说明；
- MUST NOT 在说明中泄露其他租户的敏感信息。

---

# 12. Task 时间合同

## 12.1 模型

```ts
interface TaskExecutionTiming {
  start:
    | {
        mode: "immediate";
        startToleranceMs: number;
      }
    | {
        mode: "scheduled";
        scheduledAt: string;
        startToleranceMs: number;
      };
  maxElapsedMs: number | null;
}
```

## 12.2 传输位置

SDAR 在：

```text
tools/call.params._meta["io.sdar/taskExecution"]
```

中传递 timing。

```json
{
  "method": "tools/call",
  "params": {
    "name": "vehicle_patrol",
    "arguments": {
      "vehicleId": "vehicle-001",
      "routeId": "route-008"
    },
    "_meta": {
      "io.sdar/taskExecution": {
        "profileVersion": "1.0",
        "timing": {
          "start": {
            "mode": "scheduled",
            "scheduledAt": "2026-07-17T10:10:00+09:00",
            "startToleranceMs": 30000
          },
          "maxElapsedMs": 1200000
        },
        "idempotencyKey": "workflow-52-node-7"
      }
    }
  }
}
```

## 12.3 校验

Provider MUST 验证：

- `startToleranceMs` 为非负整数；
- `maxElapsedMs` 为正整数或 null；
- scheduled 必须提供合法 scheduledAt；
- 不支持 scheduling 时拒绝 scheduled；
- 不支持 maxElapsed 时拒绝非 null；
- 时间合同与 Tool 能力声明一致。

---

# 13. immediate 语义

Provider 接受调用的时间为 `acceptedAt`。

```text
latestStartAt = acceptedAt + startToleranceMs
deadlineAt = acceptedAt + maxElapsedMs
```

## 13.1 调用阶段拒绝

如果 Provider 在调用时已确定不能执行：

- MUST NOT 创建 Task；
- MUST 返回 `CallToolResult.isError=true`；
- outcome SHOULD 为 `admission_rejected`。

## 13.2 已创建后错过启动窗口

如果 Provider 已创建 Task，但在 `latestStartAt` 前无法开始：

- MUST 安全结束 Task；
- status MUST 为 `completed`；
- `result.isError` MUST 为 `true`；
- outcome MUST 为 `start_window_missed`。

---

# 14. scheduled 语义

## 14.1 创建

Provider 接受 scheduled 调用时：

- MUST 立即创建持久 Task；
- MUST 返回 taskId；
- status MUST 为 `working`；
- Provider 子状态 SHOULD 为 `scheduled`；
- MUST NOT 在 scheduledAt 前实际启动。

SDAR 在收到 taskId 后会立即让对应 Workflow 节点进入远程等待。

## 14.2 时间锚点

```text
notBefore = scheduledAt
latestStartAt = scheduledAt + startToleranceMs
deadlineAt = scheduledAt + maxElapsedMs
```

scheduledAt 前的等待不计入 maxElapsed。

scheduledAt 后以下时间计入：

```text
queued
running
paused
resuming
input_required
```

## 14.3 启动失败

到达 latestStartAt 仍不能执行：

```text
status = completed
result.isError = true
outcome = start_window_missed
```

Provider MUST 在发布终态前确保该 Task 不会后续再启动。

---

# 15. 最大墙钟等待时间

## 15.1 定义

`maxElapsedMs` 是从时间锚点开始，到 Task 必须进入终态的最大墙钟时间。

它不是：

- `ttlMs`；
- HTTP timeout；
- CPU 时间；
- 纯 active duration；
- SDAR 客户端 Timer。

## 15.2 包含的时间

MUST 包含：

- queued；
- running；
- paused；
- resuming；
- input_required；
- Provider 内部重试。

## 15.3 无期限

```text
maxElapsedMs = null
```

表示无业务期限。

## 15.4 到达期限

Provider MUST：

1. 阻止新的副作用；
2. 停止、撤销或隔离底层执行；
3. 确认旧执行不会继续操作资源；
4. 释放资源；
5. 保存最终结果；
6. 将 Task 置为 `completed`；
7. 返回 `deadline_reached`。

如果 Provider 无法保证安全终止：

- MUST 声明 `supportsMaxElapsed=false`；
- MUST 拒绝非 null maxElapsed；
- MUST NOT 假装支持。

---

# 16. restricted 实际调用仲裁

Availability 只是预测，实际 `tools/call` 时 Provider MUST 根据实时资源完成最终仲裁。

## 16.1 接受

Provider 接受受限调用时：

1. 可以暂停或抢占其管理的已有 Task；
2. 必须使内部状态可恢复；
3. 必须持久化新 Task；
4. 必须返回 `CreateTaskResult`。

## 16.2 拒绝

Provider 拒绝时：

- MUST NOT 创建 Task；
- MUST NOT 返回 taskId；
- MUST 返回 `CallToolResult.isError=true`；
- SHOULD 使用 outcome `admission_rejected`；
- SHOULD 返回 retryable 和可选建议时间。

## 16.3 禁止模糊状态

Provider MUST NOT：

- 返回 taskId 但 `tasks/get` 查不到；
- 返回拒绝但后台继续执行；
- 抢占失败却返回 Task 成功；
- 创建 Task 后无确定责任方；
- 让旧执行和新执行同时产生冲突副作用。

---

# 17. Provider 执行子状态

## 17.1 标准状态不扩展

Provider MUST NOT 增加：

```text
scheduled
queued
running
paused
resuming
```

作为 SEP-2663 `status`。

## 17.2 子状态模型

```ts
type ProviderTaskSubstate =
  | "scheduled"
  | "queued"
  | "running"
  | "paused"
  | "resuming"
  | "stopping";
```

## 17.3 观测元数据

```json
{
  "taskId": "task-b",
  "status": "working",
  "_meta": {
    "io.sdar/taskExecution": {
      "profileVersion": "1.0",
      "substate": "paused",
      "observationRevision": 18,
      "observations": [
        {
          "revision": 18,
          "type": "task.paused",
          "occurredAt": "2026-07-16T10:05:00Z",
          "reasonCode": "PREEMPTED_BY_RESTRICTED_TASK"
        }
      ]
    }
  }
}
```

## 17.4 暂停和恢复

暂停：

```text
status = working
substate = paused
```

恢复：

```text
status = working
substate = resuming / running
```

SDAR 不会因 pause/resume 重新进入 Workflow。

---

# 18. 观测事件

```ts
type TaskObservationType =
  | "task.accepted"
  | "task.scheduled"
  | "task.started"
  | "task.paused"
  | "task.resumed"
  | "task.progress"
  | "task.heartbeat";

interface TaskExecutionObservation {
  revision: number;
  type: TaskObservationType;
  occurredAt: string;
  reasonCode?: string;
  message?: string;
  progress?: {
    current?: number;
    total?: number;
    unit?: string;
    percentage?: number;
  };
}
```

Provider MUST：

- 每个 Task 单独维护单调递增 revision；
- 不重复使用 revision；
- 按 revision 升序返回；
- 保证最新 revision 与当前 substate 一致。

以下事件只用于审计、Console、进度和解释，不改变 SDAR Workflow：

```text
task.paused
task.resumed
task.progress
task.heartbeat
```

---

# 19. Task 创建一致性

Provider 返回 `CreateTaskResult` 前 MUST：

- 持久化 Task；
- 持久化 timing；
- 持久化授权上下文；
- 持久化初始状态；
- 确保立即 `tasks/get` 可查询；
- 确保重启后 Task 不丢失。

Provider MUST NOT：

- 先返回 taskId，再异步写数据库；
- 返回临时 taskId 后替换；
- 因负载均衡路由到其他实例而查询不到。

---

# 20. Task ID 与授权

taskId：

- MUST 唯一；
- MUST 难以猜测；
- SHOULD 具有至少 128 bit 随机熵；
- MUST 与调用者授权上下文绑定；
- MUST NOT 仅依赖自增 ID 作为访问控制。

`tasks/get/update/cancel` MUST：

- 验证调用者有权访问；
- 防止跨用户或跨租户访问；
- 防止不同 execution mode 混用；
- 防止 simulation Task 被 live 上下文操作。

---

# 21. tasks/get Profile

Provider MUST：

- 返回标准 DetailedTask；
- 返回当前完整标准状态；
- 终态时返回最终 result/error；
- 返回合理 `pollIntervalMs`；
- 返回当前 SDAR 子状态和最新观测；
- 不因读取触发副作用；
- 支持重复调用。

Provider SHOULD：

- paused/scheduled 时提高 pollInterval；
- 接近 scheduledAt 时降低；
- 不要求持续低于 250ms 的轮询。

---

# 22. input_required Profile

Provider 使用：

```text
status = input_required
```

并返回标准 `inputRequests`。

要求：

- Key 在单个 Task 生命周期内唯一；
- 已回答 Key 不复用；
- 未满足前重复 `tasks/get` 返回稳定请求；
- 支持 `tasks/update`；
- `tasks/update` 成功返回空确认；
- 输入可以部分回答；
- 重复回答必须幂等或忽略；
- unknown Key 不得产生副作用；
- unknown taskId 返回无效参数错误。

`input_required` 时间计入 maxElapsed。

---

# 23. cancel Profile

`tasks/cancel` 是 Ack-only。

Provider MUST：

- 记录取消请求；
- 后续通过 `tasks/get` 返回真实状态；
- 在安全停止前不得返回 `cancelled`；
- 资源释放后才能进入 `cancelled`；
- 终态不可逆；
- 重复 cancel 幂等。

Provider MAY 最终返回：

```text
completed
failed
cancelled
```

---

# 24. 错误映射

## 24.1 JSON-RPC Error

用于：

- 无效请求；
- 未知 Tool；
- unknown taskId；
- 缺少能力；
- 授权失败；
- Provider 内部协议错误。

## 24.2 CallToolResult.isError

用于：

- admission_rejected；
- start_window_missed；
- deadline_reached；
- business_failure；
- partial_completion；
- 参数业务校验；
- 资源业务拒绝。

## 24.3 Task failed

仅用于 Task 执行中的底层请求产生 JSON-RPC Error，无法形成正常 Tool Result。

禁止使用 failed 表达普通业务异常。

---

# 25. 结构化业务结果

```ts
type SdarTaskBusinessOutcome =
  | "success"
  | "admission_rejected"
  | "start_window_missed"
  | "deadline_reached"
  | "partial_completion"
  | "business_failure";

interface SdarTaskBusinessResult {
  outcome: SdarTaskBusinessOutcome;
  reasonCode: string;
  message?: string;
  retryable: boolean;
  acceptedAt?: string;
  scheduledAt?: string;
  actualStartedAt?: string;
  completedAt: string;
  deadlineAt?: string;
  partialResult?: unknown;
  alternatives?: readonly {
    suggestedStartTime?: string;
    operationName?: string;
    arguments?: Readonly<Record<string, unknown>>;
    description?: string;
  }[];
}
```

Provider SHOULD 放入 `CallToolResult.structuredContent`，并在 `content` 提供简明文本。

---

# 26. admission_rejected 示例

```json
{
  "content": [
    {
      "type": "text",
      "text": "The operation was rejected because a non-preemptible task is active."
    }
  ],
  "isError": true,
  "structuredContent": {
    "outcome": "admission_rejected",
    "reasonCode": "RESOURCE_NOT_PREEMPTIBLE",
    "retryable": false,
    "completedAt": "2026-07-16T10:00:00Z"
  }
}
```

该结果由 `tools/call` 同步返回，不创建 Task。

---

# 27. start_window_missed 示例

```json
{
  "status": "completed",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "The task could not start within the requested start window."
      }
    ],
    "isError": true,
    "structuredContent": {
      "outcome": "start_window_missed",
      "reasonCode": "RESOURCE_UNAVAILABLE_AT_START_TIME",
      "retryable": true,
      "scheduledAt": "2026-07-17T10:00:00+09:00",
      "completedAt": "2026-07-17T10:00:30+09:00",
      "alternatives": [
        {
          "suggestedStartTime": "2026-07-17T10:10:00+09:00"
        }
      ]
    }
  }
}
```

---

# 28. deadline_reached 示例

```json
{
  "status": "completed",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "The task was safely stopped after reaching its maximum elapsed time."
      }
    ],
    "isError": true,
    "structuredContent": {
      "outcome": "deadline_reached",
      "reasonCode": "MAX_ELAPSED_TIME_REACHED",
      "retryable": true,
      "actualStartedAt": "2026-07-17T10:00:05+09:00",
      "deadlineAt": "2026-07-17T10:20:00+09:00",
      "completedAt": "2026-07-17T10:20:00+09:00"
    }
  }
}
```

---

# 29. 幂等调用

SDAR MAY 传递 `idempotencyKey`，位于：

```text
tools/call.params._meta["io.sdar/taskExecution"]
```

支持幂等的 Provider MUST：

- 将 authorization context、operationName 和 idempotencyKey 绑定；
- 相同 Key 返回原同步结果或原 taskId；
- 不产生重复副作用；
- 参数哈希不一致时返回冲突错误；
- 保存足够长的去重记录；
- scheduled 重试不得创建多个预约 Task。

---

# 30. Provider 重启恢复

Provider 重启后 MUST：

- 保留 working Task；
- 保留 scheduledAt；
- 保留 maxElapsed 和 deadlineAt；
- 保留暂停和恢复关系；
- 保留 inputRequests；
- 保留最终结果；
- 不重复执行；
- 不静默丢失；
- 不把 working Task 无依据改成 completed。

Provider 无法恢复实际执行时 MUST 进入明确 failed，禁止伪造业务成功。

---

# 31. TTL

`ttlMs` 只表示 Task Handle 保留期限，不表示 scheduledAt、maxElapsed 或 deadlineAt。

Provider：

- SHOULD 不清理非终态 Task；
- 活跃 Task 使用有限 TTL 时 MUST 续期；
- 终态结果 MUST 至少保留 ttlMs；
- SHOULD 保留终态 24 小时以上；
- Task 过期后 MUST 返回明确无效参数错误。

---

# 32. 通知

Provider MAY 支持 `notifications/tasks`。

若支持：

- 必须发送完整 DetailedTask；
- 必须与 `tasks/get` 一致；
- 终态通知包含最终结果；
- 包含 SDAR Profile `_meta`；
- 通知丢失不能影响查询；
- SDAR 仍可使用低频轮询兜底。

---

# 33. Streamable HTTP 路由

对于：

```text
tasks/get
tasks/update
tasks/cancel
```

Provider MUST 支持 SEP-2663 规定的路由信息：

```text
Mcp-Name = taskId
Mcp-Method = method
```

---

# 34. Simulation 与 Historical Replay

SDAR 会携带：

```http
X-SDAR-Execution-Mode: simulation
X-SDAR-Simulation-Id: <stable-id>
```

或：

```http
X-SDAR-Execution-Mode: historical-replay
X-SDAR-Simulation-Id: <stable-id>
```

Provider MUST：

- 在 Task 创建时保存 execution mode；
- 在 get/update/cancel 时保持相同上下文；
- 防止 simulation/replay 控制真实资源；
- 不允许跨 mode 操作 Task；
- 审计中保留 mode 和 simulation ID；
- 不把 Header 泄露进业务输出。

---

# 35. 安全要求

Provider MUST：

- 验证 arguments；
- 验证 timing；
- 验证 taskId 所有权；
- 验证 execution mode；
- 对 availability 查询授权；
- 防止跨租户 taskId 访问；
- 防止 idempotency 重放；
- 限流；
- 日志脱敏；
- 清理 statusMessage；
- 不泄露其他 Task 的敏感信息；
- 审计调用、仲裁、暂停、恢复和终态；
- 防止 SSRF、命令注入和任意代码执行。

Provider SHOULD 对资源控制使用 fencing token 或等效机制。

---

# 36. 一致性要求

## 36.1 创建顺序

```text
持久化 Task
→ Task 可查
→ 返回 taskId
```

## 36.2 restricted 仲裁

```text
资源仲裁完成
→ 旧 Task 状态处理完成
→ 新 Task 持久化
→ 返回 taskId
```

## 36.3 终态发布

```text
底层执行停止
→ 资源释放
→ 结果持久化
→ Task 终态
→ 对外可见
```

## 36.4 终态不可逆

Provider MUST NOT：

- completed 后返回 working；
- cancelled 后恢复；
- failed 后继续执行；
- 终态后产生新的资源副作用。

---

# 37. Profile 合规等级

## P0 — SEP-2663 Core

- 标准 Tasks 生命周期；
- get/update/cancel；
- 持久化和终态。

## P1 — Availability

- `checkAvailability`；
- 四种可用性；
- validUntil；
- riskLevel。

## P2 — Scheduling

- immediate；
- scheduled；
- startTolerance；
- maxElapsed；
- 可用时间窗口；
- start_window_missed；
- deadline_reached。

## P3 — Restricted Arbitration

- restricted 实际调用仲裁；
- 拒绝不创建 Task；
- Provider 内部暂停/恢复；
- 观测子状态。

## P4 — Full SDAR Provider

- input_required；
- cancel；
- observation revision；
- idempotency；
- 重启恢复；
- Simulation/Replay 隔离；
- 完整合规测试。

具身控制 Provider SHOULD 达到 P4。

---

# 38. 合规测试

## 38.1 SEP-2663

- [ ] 返回 Task 前持久化
- [ ] 立即 get 可查
- [ ] 标准五种状态
- [ ] update Ack
- [ ] cancel Ack
- [ ] 终态不可逆
- [ ] 业务错误 completed + isError
- [ ] failed 只用于 JSON-RPC execution error

## 38.2 Availability

- [ ] available
- [ ] restricted
- [ ] disabled
- [ ] unknown
- [ ] validUntil
- [ ] earliestStartTime
- [ ] nextAvailableWindows
- [ ] 参数变化影响结果
- [ ] 时间变化影响结果

## 38.3 Scheduling

- [ ] immediate
- [ ] scheduled
- [ ] scheduled 接受必返回 Task
- [ ] 不早于 scheduledAt
- [ ] startTolerance
- [ ] start_window_missed
- [ ] maxElapsed null
- [ ] deadline_reached
- [ ] pause/input 时间计入

## 38.4 Restricted

- [ ] 接受并创建 Task
- [ ] 拒绝且不创建 Task
- [ ] 暂停旧 Task
- [ ] 恢复旧 Task
- [ ] pause/resume 保持 working
- [ ] 抢占失败不产生模糊执行

## 38.5 Input/Cancel

- [ ] input_required
- [ ] update 幂等
- [ ] 多轮输入
- [ ] cancel Ack
- [ ] 安全停止后 cancelled
- [ ] 重复 cancel 幂等

## 38.6 可靠性

- [ ] Provider 重启
- [ ] Worker 重启
- [ ] 数据库短暂故障
- [ ] 重复 tools/call
- [ ] 重复 get
- [ ] 重复通知
- [ ] 无重复副作用
- [ ] scheduled 恢复
- [ ] deadline 恢复

## 38.7 安全

- [ ] taskId 授权隔离
- [ ] 跨用户拒绝
- [ ] execution mode 隔离
- [ ] timing 校验
- [ ] idempotency 冲突
- [ ] 日志脱敏
- [ ] 限流

---

# 39. Provider 接入交付物

Provider 接入前应提供：

1. MCP Server 地址；
2. MCP 协议版本；
3. SEP-2663 实现 revision；
4. SDAR Profile 版本；
5. 合规等级；
6. Tool 清单；
7. input/output Schema；
8. Tool Profile 元数据；
9. Availability 说明；
10. 可用时间窗口计算规则；
11. restricted 仲裁说明；
12. scheduled 说明；
13. maxElapsed 安全停止说明；
14. pause/resume 观测说明；
15. input_required 说明；
16. cancel 说明；
17. TTL 和终态保留说明；
18. 幂等策略；
19. 授权和 taskId 隔离；
20. 重启恢复说明；
21. Simulation/Replay 隔离说明；
22. 合规测试报告；
23. 测试环境或 Mock Provider；
24. 已知限制。

---

# 40. 最终 Profile 原则

1. SEP-2663 是 Task 生命周期标准底座。
2. SDAR Profile 不重新定义标准 Task 状态。
3. Provider 是资源和实际执行态权威。
4. Availability 是预测，实际调用最终仲裁。
5. restricted 应返回可用时间信息。
6. scheduled 接受后必须创建远程 Task。
7. 受限调用拒绝时不得创建 Task。
8. pause/resume 只作为观测。
9. maxElapsed 由 Provider 管理。
10. start_window_missed 和 deadline_reached 使用 completed + isError。
11. failed 只用于 JSON-RPC execution error。
12. Task 返回前必须持久化并可立即查询。
13. 终态前必须安全停止执行并释放资源。
14. SDAR 不维护 Provider 的资源锁和实际计时。
15. Profile 扩展必须放在 namespaced `_meta` 或明确扩展方法中。
16. Profile 版本变化必须显式升级。
