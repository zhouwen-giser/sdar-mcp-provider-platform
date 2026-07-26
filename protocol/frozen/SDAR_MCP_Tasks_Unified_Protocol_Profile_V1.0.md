# SDAR MCP Tasks 统一协议字段规范 V1.0

> **状态：** Contract Frozen（协议合同已冻结）  
> **冻结日期：** 2026-07-18  
> **实现状态：** Runtime、SDAR、PMS 尚需分别达到 Component Conformant；端到端通过后再标记 Interop Certified。  
> **冻结决策：** 采用 Evidence 方案 A；Provider 只发布客观 `evidenceType`，Skill `requirementId` 仅存在于 SDAR 内部。Task Status Notification 纳入 SDAR Runtime V1 强制能力。  
> **适用范围：** SDAR、SDAR MCP Tasks Provider Runtime、Provider Adapter、PMS  
> **标准基线：** MCP Stateless Base、SEP-2663 Tasks Extension Final、SEP-986 Tool Name、`io.sdar/taskExecution`、`io.sdar/evidence`。  
> **冻结方式：** 绑定指定 MCP Source Commit 和 Schema Git Blob；不等待上游 `2026-07-28` 的后续发布状态。
>
> **MCP Base Protocol Version：** `2026-07-28`  
> **MCP Source Repository：** `modelcontextprotocol/modelcontextprotocol`  
> **MCP Source Commit：** `26897cc322f356487da89113451bd16b520b9288`  
> **MCP Draft Schema Path：** `schema/draft/schema.json`  
> **MCP Draft Schema Git Blob：** `cc44564e33305dbc07e820cdd0a97648f3852019`  
> **SEP-2663：** Final，使用上述 Source Commit 中的 `seps/2663-tasks-extension.md`  
> **SEP-986：** 使用上述 Source Commit 中的对应 Final SEP 文本
>
> **冻结含义：** 本文的字段、方法、状态、错误和约束自冻结起保持不变。上游后续 RC、Final 或 `main` 变化不得自动进入 V1.0；任何语义变化必须发布 V1.1 或更高协议版本。共享 JSON Schema 和 Conformance Case 是本文的派生产物，不得改变本文语义。  
> **完整性标识：** 本文发布时同时生成独立 `.sha256` 文件；Protocol Package 发布时另行生成各 Schema 的 SHA-256 Lock。

---

# 1. 冻结结论

本版本现在冻结的是**协议合同**，不是实现完成状态。

冻结内容包括：

- 外部 MCP Source Commit、Schema Git Blob 和协议版本；
- `Skill.taskType == Tool.name` 的精确绑定；
- SEP-2663 每请求 Capability、Server-directed Task 和扁平 Task Shape；
- `tasks/get`、`tasks/update`、`tasks/cancel`；
- `subscriptions/listen`、Subscription Ack 和 `notifications/tasks`；
- `io.sdar/taskExecution` 的 Task Behavior、Availability、Timing 和 Observation；
- `io.sdar/evidence` 的结构化 Evidence Item；
- PMS 的检查、报告和阻断职责；
- Legacy Handler 与 SEP-2663 Handler 的显式隔离。

不再等待：

- 上游 `2026-07-28` 的后续发布状态；
- Runtime、SDAR 或 PMS 完成代码迁移；
- 全部端到端 Conformance 通过。

上述实现活动分别属于：

```text
Contract Frozen
  → Component Conformant
  → Interop Certified
```

Evidence 冻结采用方案 A：

```text
Provider
  → 发布 evidenceType 和客观事实引用

Skill
  → 使用本地 requirementId 声明所需 evidenceType

SDAR
  → 在本地将 requirementId 与 Provider Evidence 匹配
```

Provider Wire 中不得出现 Skill 本地 `requirementId`。

# 2. 协议分层

```text
MCP Stateless Base
├── per-request Client Capabilities
├── server/discover
├── Result / _meta
└── Streamable HTTP routing headers

SEP-2663 Tasks Extension
├── io.modelcontextprotocol/tasks
├── CreateTaskResult
├── tasks/get
├── tasks/update
├── tasks/cancel
├── subscriptions/listen
├── notifications/subscriptions/acknowledged
├── notifications/tasks
├── ttlMs / pollIntervalMs
└── inputRequests / inputResponses

SDAR Provider Profiles
├── io.sdar/taskExecution
│   ├── taskBehavior
│   ├── Availability
│   ├── scheduling / maxElapsed
│   ├── observations
│   └── idempotency
└── io.sdar/evidence
    └── structured Evidence Items
```

原则：

1. SEP-2663 已定义的字段不得在 `io.sdar/*` 下重复；
2. SDAR Profile 只补充标准未覆盖的领域能力；
3. 旧实验 Tasks 与 SEP-2663 不在同一 Wire Handler 内混用；
4. PMS 不执行兼容转换；
5. SDAR、Runtime 和 PMS 必须使用同一共享协议包；
6. V1.0 的外部标准含义由固定 Source Commit 决定，不随上游 `main` 漂移；
7. Runtime V1 必须同时支持 Polling 和 Task Status Notification，二者使用相同 `DetailedTask` 权威映射。

---

# 3. 协议基线、发现与每请求协商

## 3.1 Contract Frozen 外部基线（方案 B）

V1.0 使用以下不可变外部基线：

```yaml
protocolVersion: "2026-07-28"
sourceRepository: modelcontextprotocol/modelcontextprotocol
sourceCommit: 26897cc322f356487da89113451bd16b520b9288
schemaPath: schema/draft/schema.json
schemaGitBlob: cc44564e33305dbc07e820cdd0a97648f3852019
```

规则：

1. Source Commit 和 Git Blob 锁定上游源码与 Schema 字节，是 Contract Frozen 的外部基线；
2. 不等待上游 `2026-07-28` 的后续 RC、Final 或发布时间；
3. Protocol Package 构建时必须从固定 Blob 计算 `mcpSchemaSha256`，用于组件发布完整性校验；
4. SHA-256 未生成不改变本文的 Contract Frozen 状态，但对应 Runtime、SDAR 或 PMS 不得标记 Component Conformant；
5. 上游后续版本与固定 Commit 存在差异时，V1.0 不自动跟随；
6. 需要吸收上游差异时，发布 V1.1 或更高协议版本并重新执行差异评审和 Conformance。

## 3.2 Extension ID

```text
io.modelcontextprotocol/tasks
```

SDAR 自定义 Profile ID：

```text
io.sdar/taskExecution
io.sdar/evidence
```

## 3.3 标准 Request `_meta`

所有 Client Request 的 `params._meta` 必须使用固定 MCP Schema 的 `RequestMetaObject`：

```json
{
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": {
    "name": "sdar",
    "version": "1.0.0"
  },
  "io.modelcontextprotocol/clientCapabilities": {
    "extensions": {
      "io.modelcontextprotocol/tasks": {}
    }
  }
}
```

冻结规则：

| 字段 | MCP 固定基线 | SDAR V1 |
|---|---|---|
| `io.modelcontextprotocol/protocolVersion` | required | required，固定为 `2026-07-28` |
| `io.modelcontextprotocol/clientInfo` | required | required；仅用于实现身份、审计和问题定位，不作为安全身份 |
| `io.modelcontextprotocol/clientCapabilities` | required | required；相关请求必须声明 Tasks Extension |
| `io.modelcontextprotocol/logLevel` | optional | 未发送时 Server 不得发送请求级日志通知 |

缺少任一必需 Request Meta：

```text
JSON-RPC: -32602 Invalid Params
HTTP: 400 Bad Request
```

不得根据先前请求、HTTP Keep-Alive、Session、连接或缓存推断本次请求的版本、Client Info 或 Capability。

## 3.4 `server/discover`

Server 必须实现：

```json
{
  "jsonrpc": "2.0",
  "id": "discover-1",
  "method": "server/discover",
  "params": {
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "sdar",
        "version": "1.0.0"
      },
      "io.modelcontextprotocol/clientCapabilities": {
        "extensions": {
          "io.modelcontextprotocol/tasks": {}
        }
      }
    }
  }
}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "id": "discover-1",
  "result": {
    "resultType": "complete",
    "supportedVersions": ["2026-07-28"],
    "capabilities": {
      "tools": {},
      "extensions": {
        "io.modelcontextprotocol/tasks": {},
        "io.sdar/taskExecution": {
          "profileVersion": "1.0",
          "taskNotifications": true
        }
      }
    },
    "_meta": {
      "io.modelcontextprotocol/serverInfo": {
        "name": "sdar-mcp-tasks-provider-runtime",
        "version": "1.0.0"
      }
    },
    "instructions": "This server provides SDAR task-capable tools.",
    "ttlMs": 3600000,
    "cacheScope": "public"
  }
}
```

冻结规则：

1. `supportedVersions` 和 `capabilities` 必须存在；
2. SDAR Runtime 必须声明 Tasks Extension；
3. Runtime V1 必须在 `io.sdar/taskExecution` 能力中声明 `taskNotifications: true`；
4. `serverInfo` 按固定 MCP Schema 放在 Result `_meta` 中；
5. SDAR V1 要求 Server 提供 `serverInfo`，但不得将其作为认证依据；
6. SDAR、Runtime、PMS 以固定 Commit 对应 Schema 为准，不根据在线文档动态选择 Shape。

## 3.5 Client 每请求声明

任何可能返回 Task 的 `tools/call`，以及以下请求，必须在当前请求中声明 Tasks Extension：

```text
tasks/get
tasks/update
tasks/cancel
subscriptions/listen（notifications.taskIds 存在时）
```

Client 未声明 Extension 时：

- Server 不得返回 `CreateTaskResult`；
- 调用 `tasks/get/update/cancel` 必须返回 `-32003`；
- `task_required` Tool 返回 `-32003`；
- `subscriptions/listen` 请求 Task Notification 返回 `-32003`。

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "error": {
    "code": -32003,
    "message": "Missing required client capability",
    "data": {
      "requiredCapabilities": {
        "extensions": {
          "io.modelcontextprotocol/tasks": {}
        }
      }
    }
  }
}
```

PMS：

```text
PROTOCOL_BASELINE_MISMATCH
PROTOCOL_SOURCE_COMMIT_MISMATCH
PROTOCOL_SCHEMA_HASH_MISMATCH
SERVER_DISCOVER_SHAPE_MISMATCH
SERVER_SUPPORTED_VERSIONS_MISSING
TASK_EXTENSION_CAPABILITY_MISSING
TASK_EXTENSION_SERVER_DISCOVERY_MISSING
LEGACY_TASK_CAPABILITY_DECLARATION
PROTOCOL_VERSION_MISSING
PROTOCOL_VERSION_UNSUPPORTED
CLIENT_INFO_MISSING
CLIENT_CAPABILITIES_MISSING
REQUEST_META_SHAPE_MISMATCH
```

---
# 4. Tool Name

## 4.1 SEP-986 基础规则

Tool Name：

- 1～64 字符；
- 区分大小写；
- 允许字母、数字、下划线、连字符、点号和斜杠。

## 4.2 SDAR 严格子集

```regex
^[A-Za-z0-9][A-Za-z0-9_./-]{0,63}$
```

首字符必须为字母或数字，是 SDAR 的额外严格约束，不应描述为 SEP-986 的强制要求。

## 4.3 Task Type 匹配

```text
Skill.taskType == Tool.name
```

- 精确匹配；
- 区分大小写；
- 不支持别名；
- 不支持模糊匹配；
- 不读取 description；
- 不读取 LLM Enhancement Tag；
- PMS 不自动转换 `embodied.move` 与 `embodied_move`。

当前正式 Operation Name：

```text
embodied.move
```

`embodied.move_to` 是 Skill ID，不是 MCP Operation Name。

PMS：

```text
OPERATION_NAME_PATTERN_MISMATCH
OPERATION_NAME_MISMATCH
```

---

# 5. Tool Task Behavior Profile

## 5.1 删除旧字段

不得使用：

```json
{
  "execution": {
    "taskSupport": "optional"
  }
}
```

不得在调用中使用：

```text
task
allow_task
require_task
```

不得继续声明旧实验 Tasks 的：

```text
tasks.requests.*
tasks.cancel
tasks.list
```

## 5.2 SDAR Profile

```json
{
  "_meta": {
    "io.sdar/taskExecution": {
      "profileVersion": "1.0",
      "taskBehavior": "task_required",
      "availability": "dynamic",
      "supportsScheduling": true,
      "supportsMaxElapsed": true,
      "supportsObservations": true,
      "supportsInputRequired": true,
      "idempotency": "server_managed"
    }
  }
}
```

## 5.3 `taskBehavior`

允许：

```text
synchronous_only
server_directed
task_required
```

| 值 | Wire 语义 |
|---|---|
| `synchronous_only` | Tool 不得返回 CreateTaskResult；可返回同步 `CallToolResult` 或 JSON-RPC Error |
| `server_directed` | Server 每次自主决定返回同步 Result 或 CreateTaskResult |
| `task_required` | 已通过协议、权限、输入校验且被 Provider 接纳的执行必须返回 CreateTaskResult；Client 未声明 Tasks 时返回 `-32003` |

`taskBehavior` 是 SDAR Profile 字段，不是 MCP Core 或 SEP-2663 字段。

### `task_required` 的接纳拒绝边界

```text
协议、方法、Schema、身份或授权错误
→ JSON-RPC Error

Provider 在创建 Task 前做出的业务接纳拒绝
→ 同步 CallToolResult
→ resultType = complete
→ isError = true
→ structuredContent.outcome = admission_rejected

被 Provider 接纳的真实执行
→ 必须返回 Flat CreateTaskResult
```

禁止行为：

- `synchronous_only` 返回 CreateTaskResult；
- `task_required` 返回同步成功结果；
- `task_required` 在已接纳执行后用同步业务结果替代 Task；
- Client 未声明 Tasks Extension时返回 Task。

PMS 和运行时统一使用：

```text
TASK_BEHAVIOR_RUNTIME_MISMATCH
```

## 5.4 其他字段

| 字段 | 允许值 |
|---|---|
| `profileVersion` | `"1.0"` |
| `availability` | `not_supported / dynamic` |
| `supportsScheduling` | boolean |
| `supportsMaxElapsed` | boolean |
| `supportsObservations` | boolean |
| `supportsInputRequired` | boolean |
| `idempotency` | `none / client_request_key / server_managed / unknown` |

删除：

```text
execution
supportsCancel
cancellation
supportsIdempotency
```

PMS：

```text
LEGACY_TASK_SUPPORT_FIELD
TASK_BEHAVIOR_PROFILE_MISMATCH
TOOL_PROFILE_FIELD_MISMATCH
```

---

# 6. 标准 Tool 示例

```json
{
  "name": "embodied.move",
  "description": "Move a resource to an authorized target.",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["resourceId", "target"],
    "properties": {
      "resourceId": {
        "type": "string",
        "minLength": 1
      },
      "target": {
        "type": "object",
        "additionalProperties": false,
        "required": ["x", "y"],
        "properties": {
          "x": { "type": "number" },
          "y": { "type": "number" },
          "frame": { "type": "string" }
        }
      }
    }
  },
  "outputSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["resourceId", "status", "finalPosition"],
    "properties": {
      "resourceId": { "type": "string" },
      "status": {
        "enum": ["completed", "failed", "cancelled", "uncertain"]
      },
      "finalPosition": {
        "type": "object",
        "additionalProperties": false,
        "required": ["x", "y"],
        "properties": {
          "x": { "type": "number" },
          "y": { "type": "number" },
          "frame": { "type": "string" }
        }
      }
    }
  },
  "_meta": {
    "io.sdar/taskExecution": {
      "profileVersion": "1.0",
      "taskBehavior": "task_required",
      "availability": "dynamic",
      "supportsScheduling": true,
      "supportsMaxElapsed": true,
      "supportsObservations": true,
      "supportsInputRequired": true,
      "idempotency": "server_managed"
    }
  }
}
```

---

# 7. Availability

Availability 是 SDAR 自定义、只读、无副作用的 Provider Profile 方法。

## 7.1 方法

```text
io.sdar/taskExecution/checkAvailability
```

废弃：

```text
io.sdar/tasks/checkAvailability
```

## 7.2 请求

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "method": "io.sdar/taskExecution/checkAvailability",
  "params": {
    "profileVersion": "1.0",
    "checks": [
      {
        "requestId": "skill-binding:move-resource",
        "operationName": "embodied.move",
        "arguments": {
          "state": "complete",
          "value": {
            "resourceId": "UGV-001",
            "target": { "x": 106.81, "y": 29.72 }
          }
        },
        "timing": {
          "start": {
            "mode": "immediate",
            "startToleranceMs": 5000
          },
          "maxElapsedMs": 600000
        }
      }
    ],
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "sdar",
        "version": "1.0.0"
      },
      "io.modelcontextprotocol/clientCapabilities": {
        "extensions": {
          "io.modelcontextprotocol/tasks": {}
        }
      }
    }
  }
}
```

部分参数：

```json
{
  "state": "partial",
  "knownValue": { "resourceId": "UGV-001" },
  "unresolvedPaths": ["/target"]
}
```

路径使用 RFC 6901 JSON Pointer；根路径为 `""`，不得使用 JSONPath `$`。

### 请求约束

| 项目 | 冻结约束 |
|---|---|
| `checks` | 1～64 项 |
| `requestId` | 请求内唯一，1～128 字符，`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$` |
| `operationName` | 必须满足 Tool Name 的 SDAR 严格子集 |
| `knownValue/value` | JSON 最大 1 MiB、深度 32、节点数 10,000 |
| `unresolvedPaths` | 1～128 个唯一 RFC 6901 Pointer，每项最长 512 字符 |
| `startToleranceMs` | 0～86,400,000 的安全整数 |
| `maxElapsedMs` | `null` 或 1～31,536,000,000 的安全整数 |

`arguments` 必须是严格 union：

```text
state=complete → 只能包含 value
state=partial  → 只能包含 knownValue + unresolvedPaths
```

## 7.3 响应

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "result": {
    "resultType": "complete",
    "profileVersion": "1.0",
    "results": [
      {
        "requestId": "skill-binding:move-resource",
        "operationName": "embodied.move",
        "availability": "restricted",
        "riskLevel": "high",
        "reasonCode": "RESOURCE_BUSY",
        "description": "The requested resource is busy.",
        "validUntil": "2026-07-18T03:00:10.000Z",
        "earliestStartTime": "2026-07-18T03:02:00.000Z",
        "nextAvailableWindows": [
          {
            "startTime": "2026-07-18T03:02:00.000Z",
            "endTime": "2026-07-18T03:12:00.000Z"
          }
        ],
        "estimatedDelayMs": 120000,
        "reservationMode": "best_effort",
        "possibleEffects": ["task_pause", "start_rejection"]
      }
    ]
  }
}
```

### 响应枚举

```text
availability:
  available | restricted | disabled | unknown

riskLevel:
  low | medium | high | critical

reservationMode:
  none | best_effort | guaranteed

possibleEffects:
  task_preemption
  task_pause
  start_rejection
  start_window_missed
  deadline_reached
  partial_completion
```

### 响应约束

1. `results` 必须与 `checks` 一一对应，使用 `requestId + operationName` 关联；
2. 不得缺失、重复或增加未请求的结果；
3. `restricted` 必须提供未过期的 `validUntil`，并提供 `earliestStartTime` 或至少一个窗口；
4. `nextAvailableWindows` 最多 32 项，按开始时间升序、不得重叠且 `startTime < endTime`；
5. `guaranteed` 必须提供 1～256 字符的 `reservationRef`；其他模式不得声称已保证预约；
6. `available`、`disabled`、`unknown` 不得携带矛盾的 guaranteed reservation；
7. 所有时间必须为带时区的 RFC 3339；
8. `reasonCode` 最长 128 字符，`description` 最长 2,048 字符；
9. Availability 结果是时点预测，不是资源锁；执行前必须使用完整参数重新检查；
10. Provider 无法证明可用时必须返回 `unknown`，不得猜测 `available`。

PMS：

```text
METHOD_MISMATCH
REQUEST_ENVELOPE_MISMATCH
CORRELATION_FIELD_MISMATCH
PROFILE_VERSION_MISMATCH
ARGUMENT_STATE_MODEL_MISMATCH
AVAILABILITY_RESULT_SET_MISMATCH
AVAILABILITY_RESTRICTED_HINT_MISSING
AVAILABILITY_WINDOW_INVALID
AVAILABILITY_RESERVATION_INVALID
```

# 8. `tools/call`

```json
{
  "jsonrpc": "2.0",
  "id": 20,
  "method": "tools/call",
  "params": {
    "name": "embodied.move",
    "arguments": {
      "resourceId": "UGV-001",
      "target": {
        "x": 106.81,
        "y": 29.72,
        "frame": "WGS84"
      }
    },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "sdar",
        "version": "1.0.0"
      },
      "io.modelcontextprotocol/clientCapabilities": {
        "extensions": {
          "io.modelcontextprotocol/tasks": {}
        }
      },
      "io.sdar/taskExecution": {
        "profileVersion": "1.0",
        "timing": {
          "start": {
            "mode": "scheduled",
            "scheduledAt": "2026-07-18T03:10:00.000Z",
            "startToleranceMs": 30000
          },
          "maxElapsedMs": 600000
        },
        "reservationRef": "reservation-123"
      }
    }
  }
}
```

不允许：

```text
task
mode=allow_task
mode=require_task
execution.taskSupport
```

---

# 9. CreateTaskResult

CreateTaskResult 是扁平 `Result & Task`：

```json
{
  "jsonrpc": "2.0",
  "id": 20,
  "result": {
    "resultType": "task",
    "taskId": "remote-task-001",
    "status": "working",
    "statusMessage": "Operation accepted.",
    "createdAt": "2026-07-18T03:00:00.000Z",
    "lastUpdatedAt": "2026-07-18T03:00:00.000Z",
    "ttlMs": 3600000,
    "pollIntervalMs": 1000,
    "_meta": {
      "io.sdar/taskExecution": {
        "profileVersion": "1.0",
        "runtimeRevision": "1",
        "providerRevision": "1",
        "eventId": "provider-event-1",
        "observedAt": "2026-07-18T03:00:00.000Z",
        "substate": "queued",
        "progress": { "percent": 0 }
      }
    }
  }
}
```

Server 返回前，Task 必须持久创建且立即可通过 `tasks/get` 查询。

禁止：

```json
{
  "resultType": "task",
  "task": {
    "taskId": "..."
  }
}
```

PMS：

```text
CREATE_TASK_RESULT_SHAPE_MISMATCH
TASK_RESULT_DISCRIMINATOR_MISSING
LEGACY_NESTED_TASK_RESULT
LEGACY_TASK_WIRE_DETECTED
```

---

# 10. Task Shape 和 TTL

```ts
interface Task {
  taskId: string;
  status:
    | "working"
    | "input_required"
    | "completed"
    | "cancelled"
    | "failed";
  statusMessage?: string;
  createdAt: string;
  lastUpdatedAt: string;
  ttlMs: number | null;
  pollIntervalMs?: number;
}
```

TTL：

```text
ttlMs = 从 createdAt 起算的 Task 可保留时长
expiresAt = createdAt + ttlMs
```

- `null` 表示无限期；
- 值可以在生命周期中变化；
- Runtime 若续期，应满足 `wireTtlMs = handleExpiresAt - createdAt`；
- 不得 Wire 保持固定值而内部不断延长实际过期时间。

`pollIntervalMs` 是可选轮询建议，不表示 scheduling、deadline 或 maxElapsed。

不得返回：

```text
ttl
pollInterval
```

也不得只在 `_meta` 中返回标准字段别名。

PMS：

```text
TASK_FIELD_MISMATCH
TASK_TTL_SEMANTICS_MISMATCH
TASK_POLL_INTERVAL_FIELD_MISMATCH
TASK_META_ALIAS_PRESENT
```

---

# 11. `tasks/get`

请求：

```json
{
  "jsonrpc": "2.0",
  "id": 30,
  "method": "tasks/get",
  "params": {
    "taskId": "remote-task-001",
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "sdar",
        "version": "1.0.0"
      },
      "io.modelcontextprotocol/clientCapabilities": {
        "extensions": {
          "io.modelcontextprotocol/tasks": {}
        }
      }
    }
  }
}
```

Streamable HTTP 必须同时设置：

```text
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tasks/get
Mcp-Name: remote-task-001
```

Working：

```json
{
  "resultType": "complete",
  "taskId": "remote-task-001",
  "status": "working",
  "createdAt": "2026-07-18T03:00:00.000Z",
  "lastUpdatedAt": "2026-07-18T03:01:00.000Z",
  "ttlMs": 3600000,
  "pollIntervalMs": 1000
}
```

Completed：

```json
{
  "resultType": "complete",
  "taskId": "remote-task-001",
  "status": "completed",
  "createdAt": "2026-07-18T03:00:00.000Z",
  "lastUpdatedAt": "2026-07-18T03:12:00.000Z",
  "ttlMs": 3600000,
  "result": {
    "resultType": "complete",
    "content": [],
    "structuredContent": {},
    "isError": false
  }
}
```

Failed：

```json
{
  "resultType": "complete",
  "taskId": "remote-task-001",
  "status": "failed",
  "createdAt": "2026-07-18T03:00:00.000Z",
  "lastUpdatedAt": "2026-07-18T03:12:00.000Z",
  "ttlMs": 3600000,
  "error": {
    "code": -32603,
    "message": "Underlying request failed."
  }
}
```

---

# 12. Task MRTR Input

`inputRequests` 是 `Map<RequestKey, MCP Server-to-Client Request>`，V1 首期支持 `elicitation/create`。

```json
{
  "resultType": "complete",
  "taskId": "remote-task-001",
  "status": "input_required",
  "createdAt": "2026-07-18T03:00:00.000Z",
  "lastUpdatedAt": "2026-07-18T03:05:00.000Z",
  "ttlMs": 3600000,
  "inputRequests": {
    "approval-1": {
      "method": "elicitation/create",
      "params": {
        "mode": "form",
        "message": "Approve the movement?",
        "requestedSchema": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "approved": { "type": "boolean" }
          },
          "required": ["approved"]
        }
      }
    }
  }
}
```

`tasks/update`：

```json
{
  "jsonrpc": "2.0",
  "id": 31,
  "method": "tasks/update",
  "params": {
    "taskId": "remote-task-001",
    "inputResponses": {
      "approval-1": {
        "action": "accept",
        "content": {
          "approved": true
        }
      }
    },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "sdar",
        "version": "1.0.0"
      },
      "io.modelcontextprotocol/clientCapabilities": {
        "extensions": {
          "io.modelcontextprotocol/tasks": {}
        }
      }
    }
  }
}
```

Ack：

```json
{
  "jsonrpc": "2.0",
  "id": 31,
  "result": {
    "resultType": "complete"
  }
}
```

规则：

- Key 在单个 Task 生命周期中唯一；
- 已回答 Key 不得复用；
- 相同 Key 不得表示不同 Request；
- Client 可以部分回答；
- Server 应忽略未知、已回答或已替代 Key；
- Client 应对重复 Poll 的相同 Key 去重；
- Ack 可以先于状态更新。

禁止旧结构：

```text
inputs
key/description/schema/required 数组
tasks/update 返回 Task Snapshot
```

PMS：

```text
INPUT_REQUEST_MAP_MISMATCH
INPUT_REQUEST_PROTOCOL_SHAPE_MISMATCH
INPUT_RESPONSE_PROTOCOL_SHAPE_MISMATCH
INPUT_REQUEST_KEY_REUSED
TASK_UPDATE_FIELD_MISMATCH
TASK_UPDATE_ACK_MISMATCH
```

---

# 13. `tasks/cancel`

```json
{
  "jsonrpc": "2.0",
  "id": 40,
  "method": "tasks/cancel",
  "params": {
    "taskId": "remote-task-001",
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "sdar",
        "version": "1.0.0"
      },
      "io.modelcontextprotocol/clientCapabilities": {
        "extensions": {
          "io.modelcontextprotocol/tasks": {}
        }
      }
    }
  }
}
```

Ack：

```json
{
  "jsonrpc": "2.0",
  "id": 40,
  "result": {
    "resultType": "complete"
  }
}
```

语义：

- Cancellation 是 cooperative intent；
- Server 对已知、授权、结构合法的 Task 返回空 Ack；
- Adapter 是否支持立即停止不决定 MCP 方法是否存在；
- Adapter 支持停止时，Runtime 持久化 Cancel Command 并异步派发；
- Adapter 不支持停止时，Runtime 仍持久化取消意图和审计事实；
- Ack 后 Task 可以继续是 working；
- 最终可以是 cancelled、completed 或 failed；
- SEP-2663 不要求 Client 继续轮询直到 cancelled。

SDAR 为获取资源状态和审计证据，可以进行有界继续查询；这是 SDAR Client Policy，不是 Provider 的标准义务。

---

# 14. Task Status Notification（Runtime V1 强制）

SEP-2663 将 Task Notification 定义为 Server MAY 能力；SDAR 统一 Profile V1 将其提升为 Runtime 强制能力。

Runtime V1 必须同时支持：

```text
tasks/get Polling
subscriptions/listen + notifications/tasks
```

Notification 是低延迟状态通道，`tasks/get` 仍是断线恢复、最终核对和权威读取接口。

## 14.1 `subscriptions/listen`

Client 使用长连接 Request 订阅指定 Task：

```json
{
  "jsonrpc": "2.0",
  "id": "task-sub-001",
  "method": "subscriptions/listen",
  "params": {
    "notifications": {
      "taskIds": [
        "remote-task-001",
        "remote-task-002"
      ]
    },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "sdar",
        "version": "1.0.0"
      },
      "io.modelcontextprotocol/clientCapabilities": {
        "extensions": {
          "io.modelcontextprotocol/tasks": {}
        }
      }
    }
  }
}
```

规则：

1. `notifications` 必须存在；
2. Task Notification 使用 `taskIds`；
3. 每次最多请求 256 个唯一 Task ID；
4. 重复 Task ID 由 Server 去重；
5. 未声明 Tasks Extension 时返回 `-32003`；
6. `subscriptions/listen` 本身不返回最终 JSON-RPC Result，而是建立长时 Notification Stream。

## 14.2 Streamable HTTP 行为

HTTP 请求：

```text
POST /mcp
Accept: application/json, text/event-stream
Content-Type: application/json
MCP-Protocol-Version: 2026-07-28
Mcp-Method: subscriptions/listen
```

`subscriptions/listen` 没有标准 `params.name` 或 `params.uri`，因此不设置 `Mcp-Name`。

Server 必须返回：

```text
Content-Type: text/event-stream
```

所有通信继续使用 POST，不使用旧的独立 HTTP GET Notification Channel。

## 14.3 Subscription Ack

Server 在流上的第一条消息必须是：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/subscriptions/acknowledged",
  "params": {
    "_meta": {
      "io.modelcontextprotocol/subscriptionId": "task-sub-001"
    },
    "notifications": {
      "taskIds": [
        "remote-task-001"
      ]
    }
  }
}
```

规则：

1. `subscriptionId` 等于原 `subscriptions/listen` JSON-RPC Request ID；
2. Ack 必须是流上第一条消息；
3. `taskIds` 只包含 Server 已接受的 Task；
4. Server 必须校验当前授权上下文；
5. 未知或未授权 Task ID 不得出现在 Ack 中，也不得通过错误信息暴露是否存在；
6. Ack 中 Task ID 去重并使用稳定排序；
7. 即使没有任何 Task 被接受，也返回空 `taskIds` Ack，然后保持或关闭空流由实现策略决定，但不得泄露拒绝原因。

## 14.4 `notifications/tasks`

Ack 后，Server 发送完整 `DetailedTask`。Completed 示例：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/tasks",
  "params": {
    "taskId": "remote-task-001",
    "status": "completed",
    "createdAt": "2026-07-18T03:00:00.000Z",
    "lastUpdatedAt": "2026-07-18T03:12:00.000Z",
    "ttlMs": 3600000,
    "pollIntervalMs": 1000,
    "result": {
      "resultType": "complete",
      "content": [],
      "structuredContent": {
        "resourceId": "UGV-001",
        "status": "completed",
        "finalPosition": { "x": 106.81, "y": 29.72 }
      },
      "isError": false,
      "_meta": {
        "io.sdar/evidence": {
          "profileVersion": "1.0",
          "items": [
            {
              "evidenceId": "evidence-final-position-001",
              "evidenceType": "position.observation",
              "observedAt": "2026-07-18T03:12:00.000Z",
              "subjectRef": "resource:UGV-001",
              "payloadRef": {
                "kind": "structured_content",
                "jsonPointer": "/finalPosition"
              }
            }
          ]
        }
      }
    },
    "_meta": {
      "io.modelcontextprotocol/subscriptionId": "task-sub-001",
      "io.sdar/taskExecution": {
        "profileVersion": "1.0",
        "runtimeRevision": "42",
        "providerRevision": "17",
        "eventId": "provider-event-17",
        "observedAt": "2026-07-18T03:12:00.000Z"
      }
    }
  }
}
```

`notifications/tasks.params` 是完整 `DetailedTask`：

- `working`：包含工作态 Task；
- `input_required`：包含全部当前未完成的 `inputRequests`；
- `completed`：包含最终 `result`；
- `failed`：包含 JSON-RPC `error`；
- `cancelled`：包含取消终态 Task。

Notification 不是 Result，因此 Notification 的 `params` 不携带顶层 `resultType`；其内嵌 `CallToolResult` 必须携带 `resultType: "complete"`。

Terminal Task 不得携带 `running`、`queued`、`paused` 等非终态 `substate`。V1 的终态 Notification 默认省略 `substate`。

## 14.5 发送顺序与一致性

Runtime V1 必须遵循：

1. Ack 成功后，为每个被接受 Task 至少发送一次当前完整快照；
2. 之后只从已提交的 Task 事实生成 Notification；
3. 同一 Task 的 `runtimeRevision` 不得倒退；
4. 相同 Revision 可以重复发送，Client 必须幂等去重；
5. 不允许同一 Revision 对应不同内容；
6. `lastUpdatedAt`、状态、Result、Error 和 MRTR 内容必须与同一时刻 `tasks/get` 一致；
7. `notifications/progress` 和 `notifications/message` 不得作为 Task Subscription Stream 的替代状态事件；
8. Server 可合并中间状态，但不能在终态之后发送非终态；
9. Terminal Notification 可重复发送。

## 14.6 断线、取消和重连

HTTP：

- Client 关闭 SSE Response Stream 即停止 Subscription；
- Server 检测断开后必须释放 Subscription 内存和队列；
- 不支持 `Last-Event-ID` 恢复；
- 不承诺断线期间的 Notification 重放。

STDIO：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/cancelled",
  "params": {
    "requestId": "task-sub-001"
  }
}
```

重连策略：

1. Client 使用新的 Request ID 重新调用 `subscriptions/listen`；
2. Client 对每个关注 Task 调用一次 `tasks/get` 完成缺口核对；
3. Server 重新发送当前完整快照；
4. Client 按 `runtimeRevision + eventId` 去重；
5. Polling 必须在 Notification 不可用、断线或背压关闭时继续可用。

## 14.7 鉴权和背压

1. Subscription 使用与 `tasks/get` 相同的授权上下文；
2. 每一条 Notification 发送前仍需确认 Task 未跨租户泄露；
3. 每个 Subscription 使用有界队列；
4. 慢消费者造成队列溢出时，Server 应关闭流，而不是阻塞 Task 状态提交；
5. 关闭流后 Client 通过重新订阅和 `tasks/get` 恢复；
6. Notification 故障不得改变 Task、Command 或 Provider 状态；
7. 多副本 Runtime 必须保证任一可达副本可以从共享权威状态生成当前快照。

PMS：

```text
TASK_NOTIFICATION_CAPABILITY_MISSING
TASK_NOTIFICATION_LISTEN_UNSUPPORTED
TASK_NOTIFICATION_REQUEST_SHAPE_MISMATCH
TASK_NOTIFICATION_ACK_MISSING
TASK_NOTIFICATION_ACK_NOT_FIRST
TASK_NOTIFICATION_SUBSCRIPTION_ID_MISSING
TASK_NOTIFICATION_ACK_TASK_SET_MISMATCH
TASK_NOTIFICATION_UNAUTHORIZED_TASK_EXPOSED
TASK_NOTIFICATION_DETAIL_SHAPE_MISMATCH
TASK_NOTIFICATION_REVISION_REGRESSION
TASK_NOTIFICATION_RESULT_MISMATCH
TASK_NOTIFICATION_FORBIDDEN_EVENT_TYPE
TASK_NOTIFICATION_RECONNECT_GAP_UNHANDLED
```

---

# 15. 保留命名空间

SEP-2663 保留：

```text
tasks/
notifications/tasks/
```

标准方法：

```text
tasks/get
tasks/update
tasks/cancel
notifications/tasks
```

必须移除正式能力：

```text
tasks/result
tasks/list
tasks/observations
```

Observation 分页若保留，迁移为：

```text
io.sdar/taskExecution/tasks/observations
```

PMS：

```text
UNSUPPORTED_TASK_METHOD
CUSTOM_METHOD_NAMESPACE_MISMATCH
RESERVED_TASK_METHOD_COLLISION
```

---

# 16. Provider Observations

## 16.1 Metadata Shape

```json
{
  "_meta": {
    "io.sdar/taskExecution": {
      "profileVersion": "1.0",
      "runtimeRevision": "42",
      "providerRevision": "17",
      "eventId": "provider-event-17",
      "observedAt": "2026-07-18T03:05:00.000Z",
      "substate": "running",
      "progress": { "percent": 40 }
    }
  }
}
```

## 16.2 Revision 规则

| 字段 | 必需 | 冻结语义 |
|---|---:|---|
| `runtimeRevision` | 是 | Runtime 权威的 Task 投影 Revision；规范十进制无符号数字字符串 |
| `providerRevision` | 否 | Adapter/Provider Snapshot 的 opaque string；不默认假设可比较 |
| `eventId` | 否 | Provider 事件幂等引用，不替代 Runtime Revision |
| `observedAt` | 否 | Provider 事实观测时间，带时区 RFC 3339 |

`runtimeRevision`：

```regex
^(0|[1-9][0-9]{0,19})$
```

规则：

1. 按无符号整数比较，不按字典序比较；
2. 每次已提交、对外可观察的 Task 状态变化严格递增；
3. CreateTaskResult、`tasks/get` 和 `notifications/tasks` 都必须携带；
4. 相同 `taskId + runtimeRevision` 必须表示完全相同的 DetailedTask；
5. Notification 去重键是 `taskId + runtimeRevision`；
6. `eventId` 不得成为唯一去重依据；
7. Runtime 自身产生的取消意图、输入接纳、TTL 更新或终态提交即使没有 Provider Event，也必须分配新 Runtime Revision；
8. Revision 不得倒退，终态后不得发布非终态 Revision。

## 16.3 子状态和进度

允许子状态：

```text
scheduled
queued
running
paused
resuming
stopping
```

- 子状态只适用于非终态 Task；
- 子状态不改变 SEP-2663 五态；
- progress 不构成 Skill Evidence；
- `percent` 如存在必须为 0～100 的有限数；
- terminal Task 默认省略 `substate` 和可变 progress。

# 17. Evidence Profile（方案 A）

## 17.1 职责边界

Provider 发布客观事实，不感知 Skill 本地要求标识：

```text
Provider Wire Evidence
  = evidenceType + observedAt + payloadRef

Skill Requirement
  = requirementId + evidenceType + required + hardGate

SDAR Local Binding
  = requirementId → 匹配同 evidenceType 的有效 Evidence Item
```

Provider Wire 中禁止 `requirementId`。一个 Evidence Item 可以被多个相同 `evidenceType` 的 Skill Requirement 独立匹配；V1 不通过 Wire 表达 Requirement 的一对一分配。

## 17.2 Result 通道

```json
{
  "resultType": "complete",
  "content": [],
  "structuredContent": {},
  "isError": false,
  "_meta": {
    "io.sdar/evidence": {
      "profileVersion": "1.0",
      "items": []
    }
  }
}
```

## 17.3 Evidence Item

```json
{
  "evidenceId": "evidence-final-position-001",
  "evidenceType": "position.observation",
  "observedAt": "2026-07-18T03:12:00.000Z",
  "subjectRef": "resource:UGV-001",
  "payloadRef": {
    "kind": "structured_content",
    "jsonPointer": "/finalPosition"
  }
}
```

冻结字段：

| 字段 | 必需 | 约束 |
|---|---:|---|
| `evidenceId` | 是 | Provider 范围稳定唯一，1～128 字符 |
| `evidenceType` | 是 | 1～128 字符，建议反向域或领域点分名称 |
| `observedAt` | 是 | 带时区 RFC 3339 |
| `subjectRef` | 否 | 1～512 字符 |
| `payloadRef` | 是 | `structured_content` 或 `uri` union |
| `producer` | 否 | Provider/传感器产生者引用，最多 16 项 |

禁止字段：

```text
requirementId
boolean evidence claim
```

## 17.4 PayloadRef

### 内嵌结构化结果

```json
{
  "kind": "structured_content",
  "jsonPointer": "/finalPosition"
}
```

规则：

- 使用 RFC 6901 JSON Pointer；
- 根对象是当前 `CallToolResult.structuredContent`；
- Pointer 必须实际存在；
- Hard Gate 对应值不得为 JSON `null`；
- Pointer 最长 512 字符。

### 外部证据

```json
{
  "kind": "uri",
  "uri": "s3://evidence-bucket/task-001/trajectory.json",
  "mediaType": "application/json",
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

规则：

- URI 最长 2,048 字符；
- V1 允许 Scheme：`https`、`s3`、`gs`、`azblob`、`urn`；
- 部署可配置为上述集合的严格子集，不得扩展到未冻结 Scheme；
- Hard Gate 使用 URI Evidence 时必须有 `sha256`；
- `sha256` 是 64 位小写十六进制；
- Runtime 不得自动下载私有 URI 验证内容，SDAR Evidence Resolver 负责按授权读取和验 Hash。

## 17.5 大小限制

```text
items: 0..64
Evidence Profile 总 JSON: <= 262,144 bytes
JSON depth: <= 16
字符串字段: 使用各字段上限
producer: <= 16
```

超过限制时不能静默截断 Hard-Gate Evidence；应将结果视为协议/合同失败。

## 17.6 Adapter Proto 追加

不得替换已有：

```protobuf
google.protobuf.Struct result = 9;
```

追加：

```protobuf
message EvidenceItem {
  string evidence_id = 1;
  string evidence_type = 2;
  string observed_at = 3;
  optional string subject_ref = 4;
  EvidencePayloadRef payload_ref = 5;
  repeated string producer = 6;
}

message ExecutionSnapshot {
  // existing fields
  google.protobuf.Struct result = 9;

  // additive V1 field
  repeated EvidenceItem evidence = 16;
}
```

Runtime 映射：

```text
snapshot.result
→ CallToolResult.structuredContent

snapshot.evidence
→ CallToolResult._meta["io.sdar/evidence"].items
```

适用于同步成功、Remote Task completed、业务错误中的有效证据和 partial completion。

## 17.7 SDAR Hard Gate 匹配

Skill 内部：

```json
{
  "requirementId": "final-position",
  "evidenceType": "position.observation",
  "required": true,
  "hardGate": true
}
```

SDAR 判定：

1. 按 `evidenceType` 搜索 Provider Evidence Items；
2. 验证 Item Schema、时间和 PayloadRef；
3. 验证 Pointer/URI 数据存在且符合领域证据 Schema；
4. 至少一项有效 Item 才满足该 Requirement；
5. Required Hard Gate 未满足时，Task 可以是 completed，但 Skill Execution 不得标记成功；
6. `requirementId` 只用于 SDAR 本地记录和审计，不下发 Provider。

SDAR 内部错误：

```text
SKILL_EVIDENCE_REQUIREMENT_UNSATISFIED
SKILL_EVIDENCE_TYPE_NOT_PROVIDED
SKILL_EVIDENCE_HARD_GATE_FAILED
```

## 17.8 `embodied.move` 结果

```json
{
  "resultType": "complete",
  "content": [
    { "type": "text", "text": "Movement completed." }
  ],
  "structuredContent": {
    "resourceId": "UGV-001",
    "status": "completed",
    "finalPosition": {
      "x": 106.81,
      "y": 29.72,
      "frame": "WGS84"
    }
  },
  "isError": false,
  "_meta": {
    "io.sdar/evidence": {
      "profileVersion": "1.0",
      "items": [
        {
          "evidenceId": "evidence-final-position-001",
          "evidenceType": "position.observation",
          "observedAt": "2026-07-18T03:12:00.000Z",
          "subjectRef": "resource:UGV-001",
          "payloadRef": {
            "kind": "structured_content",
            "jsonPointer": "/finalPosition"
          }
        }
      ]
    }
  }
}
```

PMS：

```text
EVIDENCE_CHANNEL_MISSING
EVIDENCE_SCHEMA_MISMATCH
EVIDENCE_DATA_REFERENCE_INVALID
EVIDENCE_TYPE_MISMATCH
EVIDENCE_PAYLOAD_NOT_FOUND
EVIDENCE_URI_HASH_MISSING
EVIDENCE_PROFILE_LIMIT_EXCEEDED
EVIDENCE_FORBIDDEN_REQUIREMENT_ID
```

# 18. Task 错误语义

## 18.1 JSON-RPC/技术执行错误

```text
Task.status = failed
Task.error = JSON-RPC Error
```

`failed` 只用于底层原请求无法形成正常 Result 的 JSON-RPC 执行错误。

## 18.2 Tool 业务错误

```text
Task.status = completed
Task.result.resultType = complete
Task.result.isError = true
```

只要底层 `tools/call` 正常形成 `CallToolResult`，即使业务失败，Task 仍是 completed。

## 18.3 SDAR 成功判断

SDAR 不得使用 `Task.status == completed` 直接推导业务成功。完整判断：

```text
Task.status
+ result.resultType
+ result.isError
+ structuredContent.outcome
+ Skill Evidence Hard Gate
```

## 18.4 `admission_rejected`

创建 Task 前的业务拒绝统一同步返回：

```json
{
  "resultType": "complete",
  "content": [],
  "structuredContent": {
    "outcome": "admission_rejected",
    "reasonCode": "RESOURCE_UNAVAILABLE",
    "retryable": true
  },
  "isError": true
}
```

不得为纯业务接纳拒绝使用 JSON-RPC Error，也不得先创建无实际执行意图的 Task。

# 19. Streamable HTTP Routing Headers

## 19.1 所有 POST 请求

Client 必须设置：

```text
Accept: application/json, text/event-stream
Content-Type: application/json
MCP-Protocol-Version: 2026-07-28
Mcp-Method: <JSON-RPC method>
```

`MCP-Protocol-Version` 必须与：

```text
params._meta["io.modelcontextprotocol/protocolVersion"]
```

完全一致。

## 19.2 `Mcp-Name`

```text
tools/call
→ Mcp-Name: <params.name>

tasks/get
→ Mcp-Name: <params.taskId>

tasks/update
→ Mcp-Name: <params.taskId>

tasks/cancel
→ Mcp-Name: <params.taskId>
```

`subscriptions/listen` 没有标准 Name 字段，不设置 `Mcp-Name`。

## 19.3 Header、版本和 Body 错误矩阵

| 场景 | HTTP | JSON-RPC |
|---|---:|---:|
| `MCP-Protocol-Version` Header 缺失 | 400 | `-32001 HeaderMismatch` |
| `Mcp-Method` 缺失 | 400 | `-32001 HeaderMismatch` |
| 适用方法缺少 `Mcp-Name` | 400 | `-32001 HeaderMismatch` |
| Header 与 JSON-RPC Body 不一致 | 400 | `-32001 HeaderMismatch` |
| Header 编码或字符非法 | 400 | `-32001 HeaderMismatch` |
| 请求的协议版本不受支持 | 400 | `-32004 UnsupportedProtocolVersion` |
| Body 缺少 `protocolVersion` | 400 | `-32602 Invalid Params` |
| Body 缺少 `clientInfo` | 400 | `-32602 Invalid Params` |
| Body 缺少 `clientCapabilities` | 400 | `-32602 Invalid Params` |
| 所需 Tasks Capability 未声明 | 400 | `-32003 Missing Required Client Capability` |
| 方法不存在 | 404 | `-32601 Method not found` |

`-32001` 示例：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32001,
    "message": "Header mismatch"
  }
}
```

路由层、中间件和业务 Handler 必须使用同一份校验规则，不能一层按 Header 路由、另一层执行不同 Body。

PMS：

```text
MCP_PROTOCOL_VERSION_HEADER_MISSING
MCP_METHOD_HEADER_MISSING
MCP_NAME_HEADER_MISSING
MCP_HEADER_BODY_MISMATCH
MCP_HEADER_VALUE_INVALID
PROTOCOL_VERSION_UNSUPPORTED
REQUEST_META_REQUIRED_FIELD_MISSING
```

# 20. Legacy 协议隔离

旧 `2025-11-25` 实验 Tasks 与 SEP-2663 不 Wire 兼容。

```text
Legacy MCP protocol
→ Legacy Tasks Handler
→ task parameter
→ ttl / pollInterval
→ tasks/result
→ legacy capabilities

SEP-2663 protocol
→ Extension Handler
→ per-request clientCapabilities
→ ttlMs / pollIntervalMs
→ tasks/get/update/cancel
→ flat CreateTaskResult
```

禁止：

- 同一响应同时返回 `ttl` 与 `ttlMs`；
- 在 `_meta` 中附另一套 Task 字段别名；
- 新 Handler 接受旧 `inputs`；
- 旧 Handler 伪装成 SEP-2663；
- PMS 自动将旧请求转成新请求。

---

# 21. PMS 冲突码

PMS 必须区分：

- MCP Stateless Base 违反；
- SEP-2663 违反；
- SDAR Profile 违反；
- 推荐项 Warning。

## 21.1 基线和 Request Meta

```text
PROTOCOL_BASELINE_MISMATCH
PROTOCOL_SOURCE_COMMIT_MISMATCH
PROTOCOL_SCHEMA_HASH_MISMATCH
SERVER_DISCOVER_SHAPE_MISMATCH
SERVER_SUPPORTED_VERSIONS_MISSING
PROTOCOL_VERSION_MISSING
PROTOCOL_VERSION_UNSUPPORTED
CLIENT_INFO_MISSING
CLIENT_CAPABILITIES_MISSING
REQUEST_META_SHAPE_MISMATCH
REQUEST_META_REQUIRED_FIELD_MISSING
```

## 21.2 HTTP

```text
MCP_PROTOCOL_VERSION_HEADER_MISSING
MCP_METHOD_HEADER_MISSING
MCP_NAME_HEADER_MISSING
MCP_HEADER_BODY_MISMATCH
MCP_HEADER_VALUE_INVALID
```

## 21.3 Tasks

```text
TASK_EXTENSION_CAPABILITY_MISSING
TASK_EXTENSION_SERVER_DISCOVERY_MISSING
LEGACY_TASK_CAPABILITY_DECLARATION
LEGACY_TASK_WIRE_DETECTED
LEGACY_TASK_SUPPORT_FIELD
TASK_BEHAVIOR_PROFILE_MISMATCH
TASK_BEHAVIOR_RUNTIME_MISMATCH
CREATE_TASK_RESULT_SHAPE_MISMATCH
TASK_RESULT_DISCRIMINATOR_MISSING
LEGACY_NESTED_TASK_RESULT
TASK_FIELD_MISMATCH
TASK_TTL_SEMANTICS_MISMATCH
TASK_POLL_INTERVAL_FIELD_MISMATCH
TASK_META_ALIAS_PRESENT
TASK_UPDATE_FIELD_MISMATCH
TASK_UPDATE_ACK_MISMATCH
INPUT_REQUEST_MAP_MISMATCH
INPUT_REQUEST_PROTOCOL_SHAPE_MISMATCH
INPUT_RESPONSE_PROTOCOL_SHAPE_MISMATCH
INPUT_REQUEST_KEY_REUSED
UNSUPPORTED_TASK_METHOD
CUSTOM_METHOD_NAMESPACE_MISMATCH
RESERVED_TASK_METHOD_COLLISION
```

## 21.4 Availability

```text
METHOD_MISMATCH
REQUEST_ENVELOPE_MISMATCH
CORRELATION_FIELD_MISMATCH
PROFILE_VERSION_MISMATCH
ARGUMENT_STATE_MODEL_MISMATCH
AVAILABILITY_RESULT_SET_MISMATCH
AVAILABILITY_RESTRICTED_HINT_MISSING
AVAILABILITY_WINDOW_INVALID
AVAILABILITY_RESERVATION_INVALID
```

## 21.5 Notifications

```text
TASK_NOTIFICATION_CAPABILITY_MISSING
TASK_NOTIFICATION_LISTEN_UNSUPPORTED
TASK_NOTIFICATION_REQUEST_SHAPE_MISMATCH
TASK_NOTIFICATION_ACK_MISSING
TASK_NOTIFICATION_ACK_NOT_FIRST
TASK_NOTIFICATION_SUBSCRIPTION_ID_MISSING
TASK_NOTIFICATION_ACK_TASK_SET_MISMATCH
TASK_NOTIFICATION_UNAUTHORIZED_TASK_EXPOSED
TASK_NOTIFICATION_DETAIL_SHAPE_MISMATCH
TASK_NOTIFICATION_REVISION_REGRESSION
TASK_NOTIFICATION_RESULT_MISMATCH
TASK_NOTIFICATION_FORBIDDEN_EVENT_TYPE
TASK_NOTIFICATION_RECONNECT_GAP_UNHANDLED
```

## 21.6 Evidence

```text
EVIDENCE_CHANNEL_MISSING
EVIDENCE_SCHEMA_MISMATCH
EVIDENCE_DATA_REFERENCE_INVALID
EVIDENCE_TYPE_MISMATCH
EVIDENCE_PAYLOAD_NOT_FOUND
EVIDENCE_URI_HASH_MISSING
EVIDENCE_PROFILE_LIMIT_EXCEEDED
EVIDENCE_FORBIDDEN_REQUIREMENT_ID
```

删除：

```text
TOOL_TASK_SUPPORT_MISMATCH
EVIDENCE_REQUIREMENT_ID_MISMATCH
```

PMS 禁止自动：

- 将 `embodied.move` 改成 `embodied_move`；
- 转换旧 Nested Task；
- 将 `ttl` 改为 `ttlMs`；
- 将 `inputs` 改为 `inputResponses`；
- 推导旧取消能力；
- 将 boolean Evidence 升级为 Evidence Item；
- 将 Provider Evidence 绑定到 Skill `requirementId`；
- 将旧协议请求转发给新协议 Handler。

# 22. 双方修改清单

## Provider Runtime

1. Tool Name 正则允许 `.` 和 `/`；
2. 绑定协议版本与固定 Source Commit；
3. 实现完整 `server/discover`；
4. 校验每个 Request 的三项必需 Meta；
5. 校验 HTTP Routing Headers；
6. 输出冻结的 `taskBehavior` Profile；
7. 执行时校验 `taskBehavior` 一致性；
8. CreateTaskResult 使用扁平结构；
9. 使用 `ttlMs/pollIntervalMs` 并实现真实 TTL 语义；
10. 实现完整 MRTR `inputRequests/inputResponses`；
11. `tasks/update` 和 `tasks/cancel` 返回空 Ack；
12. 删除非标准 `tasks/result/tasks/list/tasks/observations`；
13. 实现 Runtime Revision 严格递增；
14. Proto 追加不含 `requirementId` 的 Evidence Item；
15. 同步/异步结果统一映射 `resultType`、Structured Content 和 Evidence；
16. 实现 Task Notification、Ack First、鉴权、背压和断线释放；
17. 更新 TypeScript/Python Adapter Testkit；
18. 通过 Component Conformance。

## SDAR

1. 所有 Request 发送三项必需标准 Meta；
2. HTTP 发送并校验标准 Routing Headers；
3. 读取固定版本 `server/discover`；
4. 每次相关请求声明 Tasks Extension；
5. 解析同步 Result/CreateTaskResult 多态；
6. 解析和执行 `taskBehavior`；
7. Availability 使用冻结的 Envelope、Pointer 和约束；
8. 解析 Flat Task、完整 MRTR 和 Cancel Ack；
9. 实现 Notification Client、Ack First、Revision 去重和断线回读；
10. 以 `taskId + runtimeRevision` 去重；
11. Evidence 按方案 A 解析，不期待 Provider `requirementId`；
12. 本地将 Skill Requirement 映射到 `evidenceType`；
13. Hard Gate 验证 Pointer、URI、Hash 和领域 Schema；
14. 更新 Skill Provider 属性推导；
15. 更新 Mock Provider、Contract 和 E2E；
16. 通过 Component Conformance。

## PMS

1. 校验固定 Commit、Blob 和发布的 Schema Lock；
2. 校验 Server Discovery 和每请求 Meta；
3. 校验 HTTP Header/Body；
4. 校验 Tool Name 和 Task Behavior；
5. 校验 Flat Task、TTL、MRTR、Cancel 和保留命名空间；
6. 校验 Availability 完整约束；
7. 校验 Runtime Revision 和 Notification；
8. 校验方案 A Evidence，拒绝 Wire `requirementId`；
9. 输出结构化错误；
10. 禁止自动翻译；
11. 通过 Component Conformance。

# 23. 共享协议包

派生协议包目录：

```text
protocol/
├── protocol-baseline.json
├── protocol-baseline.lock.json
├── mcp-stateless-base.schema.json
├── mcp-streamable-http-routing.schema.json
├── mcp-tasks-sep2663.schema.json
├── mcp-task-notifications-sep2663.schema.json
├── sdar-task-execution-profile-v1.schema.json
├── sdar-availability-v1.schema.json
├── sdar-evidence-v1.schema.json
├── pms-mismatch.schema.json
└── conformance-cases/
```

`protocol-baseline.json` 至少包含：

```json
{
  "protocolVersion": "2026-07-28",
  "sourceRepository": "modelcontextprotocol/modelcontextprotocol",
  "sourceCommit": "26897cc322f356487da89113451bd16b520b9288",
  "sourceSchemaPath": "schema/draft/schema.json",
  "sourceSchemaGitBlob": "cc44564e33305dbc07e820cdd0a97648f3852019",
  "sourceSchemaSha256": "<generated-from-pinned-blob>",
  "sep2663Status": "Final",
  "sdarProfileVersion": "1.0",
  "evidenceBindingMode": "type_only"
}
```

规则：

1. 本文是 V1.0 Contract 的规范性文本；
2. Source Commit 和 Git Blob 已足以锁定外部源字节，因而不阻止 Contract Frozen；
3. `sourceSchemaSha256` 和所有派生 Schema Hash 是发布完整性字段，必须在 Component Conformance 前生成；
4. 派生 Schema 不得改变本文语义；发现冲突时以本文为准，并修复 Schema；
5. Runtime、SDAR、PMS 发布时必须验证同一 Lock；
6. 任一 Hash 不一致时对应组件不得标记 Conformant；
7. Frozen 后不得原地修改 V1.0 Contract；语义变化发布 V1.1+。

# 24. Conformance 场景

组件达到 Conformant、系统达到 Interop Certified 前至少覆盖：

1. `embodied.move` 精确发现；
2. Tool Name 含点号；
3. Tool Name 含斜杠；
4. `server/discover` 返回固定 `supportedVersions`；
5. `server/discover` 返回 Tasks 和 SDAR Notification Capability；
6. Source Commit 或 Schema Hash 不一致被拒绝；
7. Request 缺少 `protocolVersion`；
8. Request 缺少 `clientCapabilities`；
9. SDAR Request 缺少 `clientInfo`；
10. Client 未声明 Tasks Extension；
11. `task_required` 未声明 Extension；
12. Server 返回同步 Result；
13. Server 返回 Flat CreateTaskResult；
14. CreateTaskResult 创建后立即可查；
15. 旧 Nested Task 被拒绝；
16. `tasks/get` working；
17. `tasks/get` input_required；
18. 部分 `tasks/update`；
19. 未知 Input Key 被忽略；
20. 已回答 Key 重复；
21. Input Key 复用被检测；
22. Cancel Ack；
23. Cancel 后仍 working；
24. Cancel 后 cancelled；
25. Cancel 后 completed；
26. `ttlMs=null`；
27. TTL 延长时 Wire 值同步变化；
28. `pollIntervalMs` 动态变化；
29. completed + `isError=false`；
30. completed + `isError=true`；
31. failed + JSON-RPC Error；
32. Evidence Hard Gate 通过；
33. Evidence 缺失；
34. Evidence Pointer 不存在；
35. URI Evidence 缺 SHA；
36. `tasks/observations` 保留命名空间冲突；
37. PMS 检出旧实验 Tasks；
38. Runtime 重启后 Task 可查询；
39. SDAR 重启后继续查询；
40. 同步与异步 Evidence 结构一致；
41. HTTP 缺少 `MCP-Protocol-Version`；
42. HTTP 缺少 `Mcp-Method`；
43. `tools/call` 或 Task 方法缺少 `Mcp-Name`；
44. Header 与 Body 不一致返回 `-32001`/HTTP 400；
45. `subscriptions/listen` 正确建立 SSE Stream；
46. Task Subscription 缺少 Tasks Capability 返回 `-32003`；
47. `notifications/subscriptions/acknowledged` 是第一条消息；
48. Ack 只返回已授权且已接受的 Task ID；
49. 所有 Subscription 消息包含正确 `subscriptionId`；
50. Ack 后发送当前完整 DetailedTask；
51. `input_required` Notification 包含完整 Input Requests；
52. Completed Notification 包含 Result 和 Evidence；
53. Failed Notification 包含 JSON-RPC Error；
54. 重复 Notification 可被幂等去重；
55. Runtime Revision 不倒退；
56. 终态后不发送非终态；
57. HTTP 关闭 SSE 后释放 Subscription；
58. STDIO `notifications/cancelled` 停止 Subscription；
59. 断线重订阅后通过 `tasks/get` 补齐缺口；
60. 慢消费者队列溢出关闭 Stream 但不阻塞 Task；
61. Task Stream 不发送 `notifications/progress`；
62. Task Stream 不发送 `notifications/message`；
63. 多个并发 Subscription 按 Request ID 正确分流；
64. 未知或未授权 Task 不通过 Ack/Notification 泄露；
65. Notification Snapshot 与同 Revision 的 `tasks/get` 完全一致。

66. MCP Request 缺少 `clientInfo` 返回 `-32602`；
67. 所有 `CallToolResult` 缺少 `resultType` 被拒绝；
68. `task_required` 同步成功被拒绝；
69. `task_required` 同步 `admission_rejected` 被允许；
70. CreateTaskResult、`tasks/get`、Notification 的 Runtime Revision 一致；
71. Provider Evidence 含 `requirementId` 被 PMS 拒绝；
72. SDAR 按 `evidenceType` 本地满足 Skill Requirement；
73. Availability restricted 缺少有效窗口被拒绝；
74. URI Hard-Gate Evidence 缺少合法 SHA-256 被拒绝。

---

# 25. 状态与门禁

## 25.1 Contract Frozen（当前状态）

- [x] 外部 Protocol Version 已固定；
- [x] Source Commit 已固定；
- [x] Source Schema Git Blob 已固定；
- [x] SEP-2663 和 SEP-986 文本已固定；
- [x] Tool、Task、Availability、Notification、Observation、Evidence 和错误语义已冻结；
- [x] Evidence 采用方案 A；
- [x] Legacy 与 SEP-2663 不 Wire 兼容并要求显式隔离；
- [x] 文档发布 SHA-256 随文件生成。

当前正式标识：

```text
Contract Frozen
Pinned to MCP source commit 26897cc322f356487da89113451bd16b520b9288
```

## 25.2 Component Conformant

每个组件独立满足：

- [ ] 共享 JSON Schema 已生成；
- [ ] Protocol Baseline Lock 和各文件 SHA-256 已生成；
- [ ] 组件实现完成协议迁移；
- [ ] Legacy Handler 与 SEP-2663 Handler 显式隔离；
- [ ] 对应 Contract/Conformance Test 全部通过；
- [ ] 没有该组件的 required deferred item。

组件状态分别发布：

```text
Runtime Conformant
SDAR Conformant
PMS Conformant
TypeScript Adapter Conformant
Python Adapter Conformant
```

## 25.3 Interop Certified

- [ ] Runtime、SDAR、PMS 均为 Component Conformant；
- [ ] TypeScript/Python Adapter 至少一个生产目标实现 Conformant；
- [ ] `embodied.move` 真实端到端通过；
- [ ] 全部 74 项场景通过；
- [ ] Task Notification 与 Polling 一致；
- [ ] 没有系统级 required deferred item；
- [ ] 双方更新发布文档和变更日志。

只有达到该门禁，才能对外声称 V1.0 互操作完成。

# 26. 最终冻结关系

```text
协议状态
  = Contract Frozen
  ≠ Component Conformant
  ≠ Interop Certified

外部协议基线
  = MCP 2026-07-28
  + source commit 26897cc322f356487da89113451bd16b520b9288
  + schema Git blob cc44564e33305dbc07e820cdd0a97648f3852019

Skill.taskType
  = Tool.name 精确匹配

每请求协议信息
  = protocolVersion
  + clientInfo
  + clientCapabilities

Task 协商
  = per-request io.modelcontextprotocol/clientCapabilities
  + server/discover

Task 创建
  = Server-directed
  + Flat CreateTaskResult

Tool 稳定执行特性
  = io.sdar/taskExecution.taskBehavior

Availability
  = io.sdar/taskExecution/checkAvailability

Task 生命周期
  = tasks/get / tasks/update / tasks/cancel

Task 时间字段
  = ttlMs / pollIntervalMs

Task 输入
  = inputRequests / inputResponses

Task 通知
  = subscriptions/listen
  + notifications/subscriptions/acknowledged
  + notifications/tasks
  + subscriptionId
  + tasks/get 断线核对

Task 业务结果
  = completed + CallToolResult(resultType=complete)

Task 技术错误
  = failed + JSON-RPC error

Provider Evidence
  = CallToolResult._meta["io.sdar/evidence"].items
  + evidenceType
  - requirementId

Skill Requirement
  = SDAR 本地 requirementId
  → evidenceType 匹配

Runtime Observation 去重
  = taskId + runtimeRevision

Streamable HTTP 路由
  = MCP-Protocol-Version
  + Mcp-Method
  + Mcp-Name（适用方法）

PMS
  = 检查、报告、阻断
  ≠ 协议翻译
```

