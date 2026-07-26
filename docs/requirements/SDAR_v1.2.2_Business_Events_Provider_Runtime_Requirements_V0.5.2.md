# SDAR v1.2.2 Business Events

# SDAR MCP Tasks Provider Runtime 需求 V0.5.2

> **文档状态：** Requirements Contract Frozen
> **目标 Profile：** `io.sdar/businessEvents` Profile 1.0
> **适用仓库：** `zhouwen-giser/sdar-mcp-tasks-provider-runtime`
> **最低代码基线：** `ee14d2fa2b5130d3c7c016c71737175a124d5134`
> **执行基线：** 实施时最新 `origin/main`，且必须包含最低代码基线
> **替代关系：** 本文完整替代 V0.4、V0.4.1、V0.5 和 V0.5.1，不需要引用前序文档解释规范含义
> **职责边界：** Provider Runtime 发布事实和候选关联；SDAR 判断影响、目标达成、恢复与重规划

V0.5.2 正式批准 PDR-BE-01～PDR-BE-14，并将其推荐值提升为不可由实现阶段改选的规范性合同。本版本冻结 Requirements Contract，授权进入 JSON Schema、Adapter Proto、Migration DDL 与测试骨架阶段；Business Events Profile 1.0 仍须在实现、Conformance 和真实 SDAR 互操作通过后才能标记 Frozen。

---

# 1. 最终结论

```text
总体架构：可实现
业务事件模型：三层模型
需求合同状态：Requirements Contract Frozen
项目决策状态：PDR-BE-01～PDR-BE-14，14/14 approved
协议资产状态：授权进入 Schema/Proto/DDL Skeleton 阶段
正式 Codex 实施前置：Skeleton Review 通过
Profile 状态：尚未 Frozen
```

## 1.1 V0.5.2 冻结决策

V0.5.2 正式批准并冻结：

1. 所有跨 Runtime/Generation/Source 的写事务遵循统一的 PostgreSQL 全局锁顺序；
2. Rotation Drain 使用必填 `lastReplayableSequence`，仅 Continuous Generation 提供 `lastContinuousSequence`；
3. Poison Source Fact 保存在 Inbox Raw/Reject 结构中，非法 Fact 不进入 Immutable Event Log；
4. Blocked Source 使 Ingest Not Ready，但不隐藏已持久化历史 Replay，并通过 `degradedSourceIds` 明示；
5. Profile 1.0 支持 1～16 个显式 Source，Source Roster 或可靠性语义变化触发 Rotation；
6. Profile 1.0 同时支持 Durable 与 Best-effort Source，并在 Discovery/Ack 中如实降级；
7. Adapter Proto 增加 `StreamBusinessEvents`，TypeScript/Python Adapter 同步升级并纳入 Golden Conformance；
8. Retention、History Horizon、清理周期和容量配置采用本文固定公式与范围；
9. Relation Pagination 使用 PostgreSQL 持久化 Opaque Token，不使用 Replica-local Stateless Token；
10. 提供显式 Operator Rotation，PITR 后由运维调用，不声明 Runtime 自动识别；
11. `BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY=false` 为默认值，部署可显式改为 `true`；
12. Requirements Contract 在本版本冻结，Profile 仅在实现、Conformance 和真实 SDAR Interop 后 Frozen；
13. 实施从执行时最新 `origin/main` 开始，`ee14d2f` 为最低必含祖先；
14. `BUSINESS_EVENTS_ENABLED=false` 默认关闭，按开发、测试、互操作、生产灰度顺序启用。

上述决策是规范性合同，不得由 Codex、Adapter 或单一实现人员改选替代方案。

三层模型：

```text
Adapter Source Event
        ↓
Runtime Durable Source Inbox
        ↓
Runtime Immutable Stored Event
        ↓
Authorization-specific Wire Projection
        ↓
SDAR Impact Judgment
```

连续性控制独立于业务事件：

```text
Source Continuity Loss
        ↓
Atomic Runtime Stream Rotation
        ↓
Persisted Generation History
        ↓
Continuity Control Notification
        ↓
Old Cursor Drain/Reset
```

Task Notification 与 Business Event 必须保持独立的：

* Method；
* Schema；
* Cursor；
* Stream Generation；
* Sequence；
* Replay 状态；
* Readiness；
* Metrics；
* Conformance。

允许共享：

* POST SSE Transport；
* Bounded Writer；
* Authorization Resolver；
* PostgreSQL Pool；
* Observability 基础设施。

---

# 2. 责任边界

## 2.1 Adapter 负责

* 稳定 `sourceId`；
* 稳定 `sourceStreamId`；
* 稳定 `sourceEventId`；
* Source Sequence 顺序；
* Source Fact 内容；
* Durable Source Replay；
* Source Cursor Expired；
* Source Stream Reset；
* Source Event 幂等重发。

## 2.2 Provider Runtime 负责

* Source Capability 校验；
* Source Event 解码；
* Source Inbox 持久化；
* Source Ordering；
* Source Cursor；
* Task Mapping；
* Resource Association；
* Runtime Event ID；
* Runtime Sequence；
* Runtime Stream Generation；
* Authorization Projection；
* Relation Preview/Pagination；
* Replay/Live；
* Continuity Control；
* Retention；
* 多副本一致性。

## 2.3 SDAR 负责

* Event 是否真正影响 Task；
* Task Goal 是否达成；
* Skill Goal 是否达成；
* User Goal 是否达成；
* Workflow 是否恢复、暂停、取消或重规划；
* Outcome Judge；
* Completion Contract；
* Recovery Admission；
* A2A Task 完成判断。

Provider Runtime 不得发布：

* Goal ID；
* Skill ID；
* Workflow ID；
* SDAR Outcome；
* “该事件一定影响任务”的结论。

---

# 3. Profile Scope

Business Event Fact 只支持：

```ts
type BusinessEventScope = "task" | "resource";
```

不支持 `system` Scope。

Source Gap、Stream Reset、Operator Rotation 等属于控制面连续性事实，通过：

```text
notifications/io.sdar/businessEvents/continuity
```

发送，不进入 Business Event Log，不分配 Business Event ID 或 Runtime Event Sequence。

---

# 4. Source Capability

每个 Provider Runtime 支持 1～16 个显式 Adapter Source。

```ts
interface AdapterBusinessEventsCapability {
  sourceId: string;
  sourceStreamId: string;

  deliverySemantics:
    | "durable_at_least_once"
    | "best_effort_live";

  replaySupported: boolean;
  sourceRetentionMs: number;

  maxEventBytes: number;
  maxPayloadDepth: number;
  maxPayloadNodes: number;
  maxPayloadStringBytes: number;
}
```

## 4.1 Source ID

```text
长度：1..128
Pattern：^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$
区分大小写
普通重启、Pod 重建、Replica 切换不变
禁止使用 Credential、Endpoint、Pod Name 或随机进程 ID
```

## 4.2 Source Stream ID

```text
格式：小写规范 UUID
表示 Source Event Log 世代
普通重启不变
Source Log 重建、灾备恢复、Cursor 不兼容时必须改变
```

## 4.3 Durable Source

```text
deliverySemantics=durable_at_least_once
replaySupported=true
sourceRetentionMs>0
```

## 4.4 Best-effort Source

```text
deliverySemantics=best_effort_live
replaySupported=false
```

Best-effort Source 不保证 Runtime 停机期间事件不丢失。

---

# 5. Generation Source Roster

每个 Runtime Stream Generation 必须冻结一份 Source Roster。

```text
provider_business_event_generation_source
-----------------------------------------
provider_id
runtime_stream_id

source_id
source_stream_id
delivery_semantics

joined_at_runtime_sequence
left_at_runtime_sequence

created_at
```

同一 Generation 内以下属性不可原地改变：

* Source 集合；
* Source ID；
* Source Stream ID；
* Delivery Semantics；
* Continuity Class。

发生以下变化时必须 Rotation：

```text
新增 Source
删除 Source
Durable ↔ Best-effort
Source Stream ID 改变
Source Capability 不兼容变更
```

这样一个 Generation 的：

```text
sources[]
continuityClass
continuousSinceSequence
```

才具有固定语义。

---

# 6. Discovery

```json
{
  "io.sdar/businessEvents": {
    "profileVersion": "1.0",
    "delivery": "post_sse",
    "scopes": ["task", "resource"],
    "resumeMode": "stream_sequence",
    "maxRelatedTaskIds": 256,
    "retentionMs": 604800000,
    "authorizationModel": "subscription_snapshot_projection",
    "relationOverflow": "paged_query",
    "streamCancellation": "connection_close",
    "continuityClass": "all_durable",
    "sources": [
      {
        "sourceId": "adapter.vehicle",
        "deliverySemantics": "durable_at_least_once"
      }
    ]
  }
}
```

`sources[]`：

* 来自 Current Generation Source Roster；
* 按 `sourceId` 字典序稳定排序；
* 不包含动态健康；
* 不包含 Credential、Endpoint 或 Source Cursor。

`continuityClass`：

```text
all_durable
→ 所有 Source 均 durable_at_least_once

mixed
→ Durable 与 Best-effort 并存

best_effort_only
→ 全部 Source 均 best_effort_live
```

临时 Source 故障不得改变 Discovery Shape。

---

# 7. Identifier Contract

| 字段                    | 合同                                           |
| --------------------- | -------------------------------------------- |
| `sourceEventId`       | 1～256；`^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$` |
| `eventType`           | 1～128；`^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$` |
| `externalExecutionId` | 1～512；`^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,511}$` |
| `resourceRef`         | 1～512；URI-safe ASCII；禁止空格、控制字符和凭据            |
| `description`         | UTF-8，1～4096 字符；禁止 C0 控制字符，TAB/LF/CR 除外      |
| `reasonCode`          | 可选，1～128；与 `eventType` 相同 Pattern            |
| `streamId`            | 小写规范 UUID                                    |
| `sourceStreamId`      | 小写规范 UUID                                    |

Identifier 不执行语言相关大小写转换。

Hash 前字符串执行 Unicode NFC；Identifier 本身限制为 ASCII。

---

# 8. Sequence Contract

## 8.1 表示

`sourceSequence` 和 `runtimeSequence`：

```text
PostgreSQL bigint
范围：1..9223372036854775807
Wire：Decimal String
禁止前导零
Pattern：^[1-9][0-9]{0,18}$
JavaScript 禁止转换为 Number
```

Cursor `afterSequence` 额外允许 `"0"`：

```text
^(0|[1-9][0-9]{0,18})$
```

## 8.2 Source Ordering

同一：

```text
providerId + sourceId + sourceStreamId
```

必须满足：

1. 第一个 Sequence 大于等于 1；
2. Adapter 按 Source Sequence 升序发送；
3. 新 Event Sequence 必须大于 `lastPersistedSourceSequence`；
4. 数字跳号允许；
5. 已知重复可以小于或等于 Cursor，但 Source Identity 和 Hash 必须一致；
6. 未知的较小 Sequence 属于 Regression；
7. 较大 Sequence 出现后，不允许再首次发送更小 Sequence；
8. Profile 1.0 不支持乱序 Source。

---

# 9. Deterministic Runtime Event ID

```text
eventId =
base64url-no-padding(
  SHA-256(
    UTF8(providerId)
    + 0x00
    + UTF8(sourceId)
    + 0x00
    + UTF8(sourceStreamId)
    + 0x00
    + UTF8(sourceEventId)
  )
)
```

约束：

```text
长度：43
Pattern：^[A-Za-z0-9_-]{43}$
区分大小写
无 Padding
```

TypeScript、Python、Runtime 和 Testkit 必须使用相同 Golden Vector。

---

# 10. Dual Hash

## 10.1 Source Canonical Hash

用于判断 Adapter 重发是否一致。

包含：

```text
providerId
sourceId
sourceStreamId
sourceEventId
sourceSequence
scope
externalExecutionId/resourceRef
eventType
occurredAt
description
severityHint
reasonCode
canonical rawPayload
```

不包含：

```text
MCP taskId
candidateRelatedTaskIds
runtimeSequence
runtime streamId
Runtime eventId
createdAt/expiresAt
Authorization Projection
```

## 10.2 Stored Event Hash

Mapping/Association 完成后计算。

包含：

```text
sourceCanonicalHash
eventId
mapped taskId 或 resourceRef
candidateRelatedTaskIds
candidateRelatedTaskCount
```

不包含：

```text
runtimeSequence
runtime streamId
subscriptionId
Authorization 过滤结果
Replay 时间
Replica ID
```

## 10.3 Canonicalization

使用：

```text
SHA-256(RFC 8785 JCS canonical UTF-8 JSON)
```

Hash Wire：

```text
sha256:<64 lowercase hex>
```

`occurredAt` 在 Hash 输入中固定为：

```text
UTC RFC3339Nano
```

规则：

* 转换为 UTC；
* 保留实际纳秒精度；
* 无小数时使用 `Z`；
* 有小数时删除无意义尾随零；
* 不允许不同文本表示相同 Timestamp 后产生不同 Hash。

---

# 11. Adapter Source RPC

```proto
rpc StreamBusinessEvents(StreamBusinessEventsRequest)
  returns (stream AdapterBusinessEvent);

message StreamBusinessEventsRequest {
  RequestMetadata metadata = 1;
  string source_id = 2;
  string source_stream_id = 3;
  optional uint64 after_source_sequence = 4;
}

message AdapterBusinessEvent {
  string source_event_id = 1;
  uint64 source_sequence = 2;
  string source_stream_id = 3;

  string scope = 4;
  google.protobuf.Timestamp occurred_at = 5;
  string event_type = 6;
  string description = 7;

  optional string external_execution_id = 8;
  optional string resource_ref = 9;

  string severity_hint = 10;
  string reason_code = 11;
  google.protobuf.Struct raw_payload = 12;
}
```

Gateway 必须验证：

```text
event.sourceStreamId
==
request.sourceStreamId
==
Manifest.sourceStreamId
```

不一致按 `SOURCE_STREAM_RESET` 处理。

## 11.1 Durable Request

首次连接：

```text
after_source_sequence absent
```

重连：

```text
after_source_sequence = lastPersistedSourceSequence
```

## 11.2 Best-effort Request

每次连接：

```text
after_source_sequence MUST absent
```

Runtime 可以持久化已见 Identity 用于去重，但不能要求 Adapter Replay。

---

# 12. Source State：单一权威

删除独立的 `adapter_business_event_cursor` 表。

唯一权威：

```text
adapter_business_event_source_state
-----------------------------------
provider_id
source_id
source_stream_id

delivery_semantics
status

last_persisted_source_sequence
last_finalized_source_sequence

lease_owner
lease_until
fencing_token

last_seen_at
last_error
updated_at
```

状态：

```text
active
degraded
unavailable
blocked_contract_violation
blocked_identity_conflict
continuity_loss_pending
```

Source Cursor、Finalization Cursor、Lease 和 Fencing 全部由该表权威维护。

---

# 13. Multi-replica Lease Fencing

每次 Source Lease 获得或转移：

```text
fencing_token = fencing_token + 1
```

任何 Source 写操作必须校验：

```text
providerId
sourceId
sourceStreamId
leaseOwner
fencingToken
leaseUntil > databaseNow
```

适用于：

* Source Inbox Insert；
* Source Cursor 前移；
* Source Status；
* Stream Reconnect；
* Poison Event；
* Gap/Reset；
* Manifest Source Replacement。

旧 Lease Owner 即使恢复执行，也不得通过数据库 CAS。

## 13.1 全局数据库锁顺序

凡同一事务获取两个以上业务事件权威对象的行锁，必须按以下顺序：

```text
1. provider_business_event_runtime_state
2. provider_business_event_stream_generation
3. adapter_business_event_source_state
4. adapter_business_event_inbox
5. provider_business_event
6. provider_task_resource_binding / provider_task_visibility_tombstone
7. provider_business_event_relation_projection
```

规则：

* 事务可以跳过不需要的层级，但不得逆序获取；
* Generation Source Roster 在 Generation 创建后不可变，正常读取不要求 `FOR UPDATE`；
* Intake Transaction 只允许锁 Source State 和 Inbox，不得继续获取 Runtime State 或 Generation 锁；
* Finalizer、Rotation、Retention 和 Operator Rotation 必须遵循同一顺序；
* 锁竞争失败或序列化失败必须重读权威状态后有界重试；
* 不允许以进程内 Mutex 代替 PostgreSQL 行锁顺序。

并发验收必须覆盖：

```text
Finalizer 与 Rotation 同时处理同一 Source
→ 不发生数据库死锁
→ 只有一个事务提交权威结果
→ 失败方重读 Generation 后安全退出或重试
```

---

# 14. Source Inbox State Machine

```text
received
pending_mapping
ready
continuity_loss_pending
rejected
mapping_failed
published
terminal_skipped
```

## 14.1 非终态

```text
received
pending_mapping
ready
continuity_loss_pending
```

## 14.2 正常终态

```text
published
```

## 14.3 Best-effort 允许终态

```text
terminal_skipped
```

只允许：

* Best-effort Source Mapping Failure；
* Profile 明确允许的非业务测试 Event；
* 经批准的无业务价值 Source Fact。

Durable Source 业务 Event 不得静默进入 `terminal_skipped`。

## 14.4 Durable 连续性失败

Durable Source 的：

```text
rejected
mapping_failed
identity conflict
sequence regression
```

必须先进入：

```text
continuity_loss_pending
```

并在原子 Rotation 事务中转为最终失败状态。

## 14.5 Poison Source Fact 持久化形态

`adapter_business_event_inbox` 必须允许保存不满足正式 Business Event Schema 的 Source Fact。

至少包含：

```text
raw_envelope_json              nullable
raw_envelope_hash              required
transport_payload_hash         nullable
decode_status                  decoded | partially_decoded | undecodable
reject_reason                  nullable

normalized_source_event_id     nullable
normalized_source_sequence     nullable
normalized_scope               nullable
normalized_occurred_at         nullable
normalized_event_type          nullable
```

规则：

* 正常 Event 的规范化字段必须完整；
* 可解码但合同非法的 Event 保存 decoded envelope、Raw Envelope Hash 和能够可靠提取的 Identity/Sequence；
* 正式 Identifier、Scope、Timestamp CHECK Constraint 只适用于正常/已规范化 Event，不得阻止保存 Rejected Fact；
* 完全无法解码时，至少保存 Source Connection Identity、Transport Error、接收时间和可获得的 Payload Hash；
* gRPC 库不暴露原始 Payload Bytes 时，`transport_payload_hash` 可以缺失，不得伪造；
* Rejected Fact 不得进入 `provider_business_event`；
* Rejected/Undecodable Fact 的删除时间不得早于关联 Continuity Record。

---

# 15. Source Publication Barrier

Barrier Key：

```text
providerId + sourceId + sourceStreamId
```

不同 Source 可以并行。

同一 Source 中，Runtime Sequence 只能分配给：

```text
Source Sequence 最小的未终结 Inbox Row
```

如果更小 Row 处于：

```text
received
pending_mapping
ready
continuity_loss_pending
```

后续 Row 不得发布。

允许解除 Barrier 的状态：

```text
published
terminal_skipped
```

Durable Source 的 `rejected` 和 `mapping_failed` 只有在 Rotation Transaction 完成后才能视为终结。

---

# 16. Intake Transaction

同一事务：

1. 锁定 Source State；
2. 校验 Lease Owner 和 Fencing Token；
3. 校验 Source Identity；
4. 校验 Source Ordering；
5. 计算 `sourceCanonicalHash`；
6. 检查 Source Event ID/Sequence 唯一约束；
7. 插入 Source Inbox；
8. 前移 `lastPersistedSourceSequence`；
9. 提交。

Intake Transaction 不得获取 Runtime State 或 Stream Generation 锁。后续 Mapping、Finalization 和 Rotation 通过独立事务处理。

Source Fact 一旦完整持久化，Source Cursor 可以前移，即使 Task Mapping 尚未完成。

---

# 17. Finalization Transaction

正常 `ready` Event：

1. 锁定 Provider Runtime State；
2. 锁定 Current Runtime Generation；
3. 锁定 Source State；
4. 锁定目标 Inbox Row；
5. 校验 Lease Owner、Fencing Token 和 Current Pointer；
6. 校验该 Row 是当前 Source 最小未终结 Sequence；
7. 校验 Generation Source Roster；
8. 校验 Generation 仍为 `current`；
9. 生成 Event ID；
10. 计算 Stored Event Hash；
11. 分配 Runtime Sequence；
12. 写 Immutable Event；
13. Inbox → `published`；
14. 更新 `lastFinalizedSourceSequence`；
15. 提交。

不得先分配 Sequence 再异步写 Event。Finalization 失败后必须释放事务并重读 Current Generation，不得持有 Source 锁等待 Rotation。

---

# 18. Continuity Loss 与 Rotation 原子事务

Durable Source 的以下情况：

* Mapping Deadline；
* Poison Event；
* Source Cursor Expired；
* Source Stream Reset；
* Sequence Regression；
* Identity Conflict；
* Data Loss；
* Undecodable Payload；

必须通过同一个事务处理：

1. 锁 Provider Runtime State；
2. 锁 Current Generation；
3. 锁 Source State；
4. 锁相关 Failure Inbox Row（存在时）；
5. 校验 Current Pointer、Lease Owner 和 Fencing Token；
6. Inbox → `continuity_loss_pending`；
7. Source → Blocked/Degraded；
8. 读取：
   ```text
   lastReplayableSequence = oldGeneration.currentSequence
   ```
9. 若旧 Generation 的 Ack Continuity 为 `continuous`：
   ```text
   lastContinuousSequence = lastReplayableSequence
   ```
   否则 `lastContinuousSequence` 缺失；
10. 写 Continuity Record；
11. 旧 Generation → `rotating`；
12. 保存 Reset Metadata；
13. 旧 Generation → `replayable_closed`；
14. 创建新 Generation，Sequence 从 1 开始；
15. 固化新 Generation Source Roster；
16. 更新 Current Pointer；
17. Failure Inbox → `rejected` 或 `mapping_failed`；
18. 更新 `lastFinalizedSourceSequence`；
19. 提交。

在事务提交前：

```text
continuity_loss_pending
```

不得解除 Publication Barrier。

---

# 19. Runtime Stream Generation

## 19.1 Current Pointer

```text
provider_business_event_runtime_state
-------------------------------------
provider_id
current_stream_id
generation_version
updated_at
```

## 19.2 Generation History

```text
provider_business_event_stream_generation
-----------------------------------------
provider_id
stream_id

status
  current
  rotating
  replayable_closed
  retired

created_at
closed_at
rotated_to_stream_id

reset_reason
affected_source_ids
gap_detected_at
last_replayable_sequence
last_continuous_sequence nullable

current_sequence
earliest_available_sequence
last_deleted_sequence

continuity_class
retain_until
```

每 Provider 最多一个 `current`。

---

# 20. Rotated Generation Drain Replay

Rotation 不得立即让旧 Stream 全部不可读取。

## 20.1 `replayable_closed`

旧 Generation 在 Retention 内保持：

```text
replayable_closed
```

旧 Cursor 重连时：

1. 校验旧 Generation History；
2. 校验 Cursor Ahead/Expired；
3. Ack 旧 Generation；
4. Replay：

```text
afterSequence < sequence <= lastReplayableSequence
```

5. Replay 完成后发送 Continuity Control；
6. 关闭连接；
7. Client 使用 `newStreamId` 重新订阅。

即使：

```text
afterSequence == lastReplayableSequence
```

也发送 Ack、Continuity Control，然后关闭。

## 20.2 旧 Event 已清理

如果旧 Generation 存在，但所需 Event 已超出保留窗口：

```text
BUSINESS_EVENT_STREAM_RESET
```

Data 包含：

* Previous Stream；
* New Stream；
* Reset Reason；
* Earliest Available；
* Last Continuous Sequence；
* Recovery Action。

## 20.3 Generation History 已清理

```text
resetReason=generation_not_available
```

---

# 21. Continuity Control

Method：

```text
notifications/io.sdar/businessEvents/continuity
```

```ts
interface BusinessEventContinuityNotification {
  profileVersion: "1.0";
  status: "stream_reset";

  previousStreamId: string;
  newStreamId: string;

  reasonCode:
    | "SOURCE_CURSOR_EXPIRED"
    | "SOURCE_STREAM_RESET"
    | "SOURCE_SEQUENCE_REGRESSION"
    | "SOURCE_IDENTITY_CONFLICT"
    | "SOURCE_CONTRACT_VIOLATION"
    | "SOURCE_EVENT_NOT_MAPPED"
    | "SOURCE_PAYLOAD_UNDECODABLE"
    | "SOURCE_DATA_LOSS"
    | "SOURCE_ROSTER_CHANGED"
    | "OPERATOR_STREAM_ROTATION";

  affectedSourceIds: string[];
  gapDetectedAt: string;
  lastReplayableSequence: string;
  lastContinuousSequence?: string;

  _meta: {
    "io.modelcontextprotocol/subscriptionId": string | number;
    "io.sdar/businessEvents": {
      profileVersion: "1.0";
    };
  };
}
```

只能在 Rotation Transaction 提交后发送。

边界规则：

```text
lastReplayableSequence
→ 必填
→ 等于 Rotation 锁定旧 Generation 后读取的 currentSequence
→ 允许 "0"
→ Pattern ^(0|[1-9][0-9]{0,18})$

lastContinuousSequence
→ 仅旧 Generation 的 continuity status=continuous 时存在
→ 值等于 lastReplayableSequence
```

Mixed/Best-effort Generation 只能声明可 Replay 边界，不能伪称 Gap-free Continuous Boundary。

未收到 Continuity Notification 的 Client，仍可通过旧 Cursor Drain/Reset 获得相同事实。

---

# 22. Task Mapping

Task Source Event：

```text
scope=task
externalExecutionId REQUIRED
resourceRef FORBIDDEN
```

映射：

```text
providerId + externalExecutionId
→ provider_task
→ MCP taskId
```

Event 先于 Task 可见：

```text
received
→ pending_mapping
→ bounded retry
```

默认：

```text
BUSINESS_EVENT_MAPPING_DEADLINE_MS=60000
范围：1000..300000
```

## 22.1 Durable Mapping Failure

```text
mapping deadline
→ continuity_loss_pending
→ Atomic Rotation
→ mapping_failed
```

## 22.2 Best-effort Mapping Failure

```text
mapping_failed
→ Source degraded
→ terminal_skipped
```

---

# 23. Poison Event

## 23.1 可识别 Sequence

能够取得可靠：

```text
sourceId
sourceStreamId
sourceEventId
sourceSequence
```

但内容非法：

* Identifier；
* Scope；
* Timestamp；
* Payload；
* Event Type；
* Raw JSON。

处理：

1. 保存 Rejected Source Fact；
2. 保存 Raw Envelope Hash；
3. Source Cursor 可前移；
4. Durable Source执行 Atomic Rotation；
5. Best-effort Source标记 Degraded 并终结。

## 23.2 无法解码 Sequence

* 不前移 Cursor；
* 关闭 gRPC Source Stream；
* Source → `blocked_contract_violation`；
* Durable Source执行 Atomic Rotation；
* 禁止自动无限重连；
* 只有 Source Stream ID 更换或运维解除后恢复。

## 23.3 Identity Conflict/Regression

* 不前移 Cursor；
* Source → `blocked_identity_conflict`；
* Durable Source执行 Atomic Rotation；
* Adapter 必须更换 Source Stream ID 或人工修复。

---

# 24. Event Time 与 Resource Association

Task 与 Resource Event 关联，当且仅当：

```text
binding.providerId == event.providerId
AND binding.resourceRef == event.resourceRef
AND binding.boundAt <= event.occurredAt
AND (
  binding.terminalAt IS NULL
  OR binding.terminalAt >= event.occurredAt
)
```

规则：

* 使用 `occurredAt`；
* 不使用 Ingest Time；
* Event 之后创建的 Task 排除；
* Event 之前终态的 Task 排除；
* Event 时 Active、之后终态的 Task 包含；
* Scheduled 且 Binding 已生效的 Task 包含；
* 禁止扫描全部 Arguments JSON；
* Operation 没有 Resource Binding 时不得猜测。

---

# 25. Event Time Boundary

配置：

```text
BUSINESS_EVENT_MAX_OCCURRED_AGE_MS
BUSINESS_EVENT_MAX_FUTURE_SKEW_MS
BUSINESS_EVENT_CLOCK_SKEW_SAFETY_MS
```

建议默认：

```text
MAX_OCCURRED_AGE_MS=604800000
MAX_FUTURE_SKEW_MS=300000
CLOCK_SKEW_SAFETY_MS=300000
```

启动校验：

```text
MAX_OCCURRED_AGE_MS
>= maxDurableSourceRetentionMs + CLOCK_SKEW_SAFETY_MS
```

超限：

* Durable Source：Source Contract Violation + Rotation；
* Best-effort Source：Rejected + Degraded。

---

# 26. Visibility/Binding Retention

```text
providerBusinessEventHistoryHorizonMs =
  maxSourceRetentionMs
  + businessEventRetentionMs
  + mappingDeadlineMs
  + clockSkewSafetyMs
```

Task 终态时：

```text
binding.retainUntil
>= terminalAt + providerBusinessEventHistoryHorizonMs
```

Event 映射后：

```text
binding/tombstone.retainUntil
>= event.expiresAt
```

配置扩大时，必须通过迁移或后台任务延长现有尚未过期事实，不得只影响新 Task。

---

# 27. Business Event Wire

Method：

```text
notifications/io.sdar/businessEvents
```

JSON-RPC Envelope：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/io.sdar/businessEvents",
  "params": {
    "streamId": "...",
    "eventId": "...",
    "sequence": "1061",
    "sourceId": "adapter.vehicle",
    "eventType": "vehicle.connectivity.lost",
    "occurredAt": "2026-07-22T01:00:00Z",
    "scope": "task",
    "description": "Vehicle connection was lost.",
    "taskId": "...",
    "_meta": {
      "io.modelcontextprotocol/subscriptionId": 31,
      "io.sdar/businessEvents": {
        "profileVersion": "1.0"
      }
    }
  }
}
```

## 27.1 Common Fields

```ts
interface BusinessEventCommon {
  streamId: string;
  eventId: string;
  sequence: string;

  sourceId: string;
  eventType: string;
  occurredAt: string;
  description: string;

  reasonCode?: string;
  severityHint?: "info" | "warning" | "critical";
  rawPayload?: JsonValue;

  _meta: {
    "io.modelcontextprotocol/subscriptionId": string | number;
    "io.sdar/businessEvents": {
      profileVersion: "1.0";
    };
  };
}
```

## 27.2 Task Scope

```ts
interface TaskBusinessEvent extends BusinessEventCommon {
  scope: "task";
  taskId: string;
}
```

禁止 Resource/Relation 字段。

## 27.3 Resource Scope

```ts
interface ResourceBusinessEvent extends BusinessEventCommon {
  scope: "resource";
  resourceRef: string;

  relatedTaskIds: string[];
  relatedTaskCount: number;
  relationTruncated: boolean;
}
```

`sourceId` 必须在 Wire 中存在，便于 Mixed Continuity 下识别 Source 可靠性等级。

---

# 28. Authorization Snapshot

Profile 1.0 不使用 `authorizationEpoch`，因为当前 Runtime 没有外部授权版本权威。

Subscription Snapshot 固定：

```text
authorizationScopeHash
executionMode
simulationId
credentialExpiry（如可用）
```

当前 Runtime 的 Authorization Context 本身只具备 Hash、Execution Mode 和 Simulation ID，并没有可持久比较的授权版本字段。

规则：

* Stream 内权限扩张不生效；
* 权限变化要求 Client 重连；
* Credential Expiry 可用时，到期关闭；
* 配置最大 Stream Duration；
* Profile 1.0 不声明即时撤权；
* Profile 1.1 可在有外部权威时增加 Authorization Epoch。

---

# 29. Visibility Projection

## 29.1 Task Event

仅当：

```text
task.authorizationContextHash == snapshot.authorizationScopeHash
AND task.executionMode == snapshot.executionMode
AND task.simulationId == snapshot.simulationId
```

发送。

## 29.2 Resource Event

对 `candidateRelatedTaskIds` 逐项过滤。

至少一个可见 Task：

```text
发送 Resource Event
```

零个可见 Task：

```text
跳过
```

无 Resource ACL。

---

# 30. Replay 扫描游标

Runtime 内部必须同时维护：

```text
lastScannedSequence
lastDeliveredSequence
```

规则：

* 每扫描一条持久 Event，无论是否因授权被过滤，都推进 `lastScannedSequence`；
* 只有成功写入 SSE Frame 时推进 `lastDeliveredSequence`；
* 下一批数据库查询使用 `lastScannedSequence`；
* Client Cursor 由 Client 已处理的 Delivered Sequence 决定；
* 授权过滤不得导致重复扫描死循环。

V0.4.1 使用 `lastSentSequence` 继续读取，在存在授权过滤时无法正确推进。

---

# 31. Listen、Cursor 与 Ack

## 31.1 Current Generation

支持：

```text
cursor
或
startPosition
```

两者互斥。

```text
startPosition=latest
startPosition=earliest_available
```

空 Generation：

```text
currentSequence=0
earliestAvailableSequence=1
```

`latest`：

```text
acceptedAfterSequence=currentSequence
```

`earliest_available`：

```text
acceptedAfterSequence=earliestAvailableSequence-1
```

Cursor Expired：

```text
afterSequence < earliestAvailableSequence - 1
```

Cursor Ahead：

```text
afterSequence > currentSequence
```

## 31.2 Ack

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/io.sdar/businessEvents/acknowledged",
  "params": {
    "profileVersion": "1.0",
    "streamId": "...",
    "generationStatus": "current",
    "acceptedAfterSequence": "1058",
    "earliestAvailableSequence": "800",
    "currentSequence": "1061",
    "sourceContinuity": {
      "continuityClass": "all_durable",
      "status": "continuous",
      "continuousSinceSequence": "1",
      "degradedSourceIds": []
    },
    "_meta": {
      "io.modelcontextprotocol/subscriptionId": 31
    }
  }
}
```

旧 `replayable_closed` Generation 的 Ack：

```text
generationStatus=replayable_closed
```

---

# 32. Continuity Mapping

| Generation Source Roster | Ack Status    |
| ------------------------ | ------------- |
| 全部 Durable，且未确认 Gap      | `continuous`  |
| Mixed                    | `best_effort` |
| 全部 Best-effort           | `best_effort` |

只有 `continuous` 返回：

```text
continuousSinceSequence
```

固定为该 Generation 的 `"1"`。

Durable Source 暂时 UNAVAILABLE，但没有确认 Gap：

```text
status=continuous
degradedSourceIds=[...]
```

`degradedSourceIds` 固定表示 Current Generation Source Roster 中所有 Source State 不为 `active` 的 Source ID，并按字典序排序。

Blocked Source 语义：

```text
blocked_contract_violation
blocked_identity_conflict
continuity_loss_pending
```

* 禁止该 Source 继续 Ingest；
* Current/Replayable Generation 中已经持久化的 Event 仍可 Replay；
* `businessEventIngest` 为 `not_ready`；
* Ack 继续表达 Generation 固定的 `continuityClass`，但必须在 `degradedSourceIds` 中列出 Blocked Source；
* 不得因为 Blocked Source 隐藏已持久化历史；
* Source 只有在 Source Stream ID 更换或运维显式解除后恢复。

---

# 33. Relation Preview

```text
maxRelatedTaskIds=256
```

超过：

```text
relatedTaskIds
→ 授权投影稳定字典序前 256

relatedTaskCount
→ 授权投影完整数量

relationTruncated
→ relatedTaskCount > relatedTaskIds.length
```

---

# 34. Relation Projection Token

Profile 1.0 使用 PostgreSQL 持久 Token。

```text
provider_business_event_relation_projection
-------------------------------------------
token_hash

provider_id
stream_id
event_id

authorization_scope_hash
execution_mode
simulation_id

candidate_relation_hash
projection_relation_hash

created_at
expires_at
```

不保存：

```text
last_delivered_task_id
```

Token 只绑定不可变 Projection。

Client 使用：

```text
projectionToken
afterTaskId
limit
```

分页。

相同：

```text
projectionToken + afterTaskId + limit
```

必须返回相同页面。

服务端不得通过更新 Token Cursor 推进分页。

---

# 35. Relation Query

第一页：

```json
{
  "jsonrpc": "2.0",
  "id": 32,
  "method": "io.sdar/businessEvents/relatedTasks/list",
  "params": {
    "streamId": "...",
    "eventId": "...",
    "limit": 256,
    "_meta": {}
  }
}
```

响应：

```json
{
  "resultType": "complete",
  "streamId": "...",
  "eventId": "...",
  "projectionToken": "...",
  "items": ["task-001"],
  "total": 620,
  "nextAfterTaskId": "task-001"
}
```

后续页：

```json
{
  "streamId": "...",
  "eventId": "...",
  "projectionToken": "...",
  "afterTaskId": "task-001",
  "limit": 256,
  "_meta": {}
}
```

Token 至少 128-bit 随机值，数据库只保存 Hash。

Token 过期不得自动生成新第一页。

---

# 36. Relation Error Contract

| 条件                          | Error                                        |
| --------------------------- | -------------------------------------------- |
| Token 过期                    | `BUSINESS_EVENT_RELATION_CURSOR_EXPIRED`     |
| Event 已过期                   | `BUSINESS_EVENT_RELATION_CURSOR_EXPIRED`     |
| Authorization 不匹配           | `BUSINESS_EVENT_AUTHORIZATION_MISMATCH`      |
| Stream Rotation             | `BUSINESS_EVENT_STREAM_RESET`                |
| Event 不存在                   | `BUSINESS_EVENT_NOT_FOUND`                   |
| Relation Hash 不匹配           | `BUSINESS_EVENT_RELATION_PROJECTION_STALE`   |
| Visibility Fact 缺失          | `BUSINESS_EVENT_RETENTION_AUTHORITY_INVALID` |
| `afterTaskId` 不在 Projection | `BUSINESS_EVENT_RELATION_CURSOR_INVALID`     |

---

# 37. Frozen Streamable HTTP

所有 Business Event 请求：

```text
Content-Type: application/json
Accept: application/json, text/event-stream
Mcp-Protocol-Version: 2026-07-28
Mcp-Method: <exact JSON-RPC method>
```

Listen：

```text
Mcp-Method: io.sdar/businessEvents/listen
Mcp-Name: MUST be absent
```

Relation Query：

```text
Mcp-Method: io.sdar/businessEvents/relatedTasks/list
Mcp-Name: <eventId>
```

Capability 位于：

```text
params._meta[
  "io.modelcontextprotocol/clientCapabilities"
].extensions[
  "io.sdar/businessEvents"
]
```

---

# 38. MCP Error Matrix

每个 Error Data：

```json
{
  "reasonCode": "BUSINESS_EVENT_...",
  "retryable": false,
  "recoveryAction": "..."
}
```

| Reason                                       | JSON-RPC | HTTP | Retryable |
| -------------------------------------------- | -------: | ---: | --------- |
| `BUSINESS_EVENT_CAPABILITY_REQUIRED`         | `-32003` |  400 | false     |
| `BUSINESS_EVENT_START_POSITION_REQUIRED`     | `-32602` |  400 | false     |
| `BUSINESS_EVENT_CURSOR_AHEAD`                | `-32602` |  400 | false     |
| `BUSINESS_EVENT_CURSOR_EXPIRED`              | `-32024` |  410 | false     |
| `BUSINESS_EVENT_STREAM_RESET`                | `-32020` |  409 | false     |
| `BUSINESS_EVENT_IDEMPOTENCY_CONFLICT`        | `-32021` |  409 | false     |
| `BUSINESS_EVENT_CAPACITY_EXCEEDED`           | `-32022` |  503 | true      |
| `BUSINESS_EVENT_SOURCE_UNAVAILABLE`          | `-32023` |  503 | true      |
| `BUSINESS_EVENT_RELATION_CURSOR_EXPIRED`     | `-32025` |  410 | false     |
| `BUSINESS_EVENT_AUTHORIZATION_MISMATCH`      | `-32026` |  403 | false     |
| `BUSINESS_EVENT_NOT_FOUND`                   | `-32027` |  404 | false     |
| `BUSINESS_EVENT_SOURCE_SEQUENCE_REGRESSION`  | `-32028` |  409 | false     |
| `BUSINESS_EVENT_RELATION_PROJECTION_STALE`   | `-32029` |  409 | false     |
| `BUSINESS_EVENT_RETENTION_AUTHORITY_INVALID` | `-32030` |  500 | false     |
| `BUSINESS_EVENT_RELATION_CURSOR_INVALID`     | `-32602` |  400 | false     |
| `BUSINESS_EVENT_PAYLOAD_INVALID`             | `-32602` |  400 | false     |
| 未分类内部错误                                      | `-32603` |  500 | true      |

Adapter gRPC Termination 使用独立的 gRPC Status Matrix，不映射成 MCP Client Error。

---

# 39. Bounded Runtime Configuration

建议默认和范围：

| 配置                                           |          默认 |                范围 |
| -------------------------------------------- | ----------: | ----------------: |
| `BUSINESS_EVENTS_ENABLED`                    |     `false` |           boolean |
| `BUSINESS_EVENTS_RETENTION_MS`               | `604800000` | 60000..7776000000 |
| `BUSINESS_EVENTS_POLL_INTERVAL_MS`           |       `500` |        100..10000 |
| `BUSINESS_EVENTS_MAX_SUBSCRIPTIONS`          |       `256` |          1..10000 |
| `BUSINESS_EVENTS_MAX_SUBSCRIPTIONS_PER_AUTH` |        `32` |           1..1000 |
| `BUSINESS_EVENTS_MAX_QUEUE_MESSAGES`         |        `64` |           1..1024 |
| `BUSINESS_EVENTS_MAX_QUEUE_BYTES`            |   `1048576` |    4096..16777216 |
| `BUSINESS_EVENTS_REPLAY_BATCH_SIZE`          |       `256` |           1..1000 |
| `BUSINESS_EVENTS_MAX_STREAM_DURATION_MS`     |   `3600000` |   60000..86400000 |
| `BUSINESS_EVENTS_MAX_EVENT_BYTES`            |     `65536` |     1024..1048576 |
| `BUSINESS_EVENTS_MAX_PAYLOAD_DEPTH`          |        `16` |             1..64 |
| `BUSINESS_EVENTS_MAX_PAYLOAD_NODES`          |      `4096` |        16..100000 |
| `BUSINESS_EVENTS_MAX_PAYLOAD_STRING_BYTES`   |     `16384` |       64..1048576 |
| `BUSINESS_EVENT_MAPPING_DEADLINE_MS`         |     `60000` |      1000..300000 |
| `BUSINESS_EVENT_MAX_FUTURE_SKEW_MS`          |    `300000` |        0..3600000 |
| `BUSINESS_EVENT_CLOCK_SKEW_SAFETY_MS`        |    `300000` |        0..3600000 |
| `BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY` |     `false` |           boolean |

启动时必须交叉验证 Source Manifest、Retention 和 Payload 上限。

---

# 40. Retention

Event：

```text
createdAt = Immutable Event 成功提交时间
expiresAt = createdAt + businessEventRetentionMs
```

Source Inbox：

```text
retainUntil >= max(
  Event expiresAt,
  Source Audit Retention,
  Generation History Retention
)
```

Generation History：

```text
retainUntil >= max(
  businessEventRetentionMs,
  clientCursorRecoveryWindowMs,
  operationalAuditRetentionMs
)
```

`replayable_closed` Generation 的 Event 未到期前不得物理删除。

---

# 41. Readiness

```text
businessEventPersistence
businessEventReplay
businessEventIngest
businessEventFinalizer
businessEventAdapterSources[sourceId]
businessEventRetention
businessEventProjection
```

规则：

```text
Persistence/Replay/Finalizer failed
→ Business Events not ready

Durable Source temporarily unavailable
→ degraded
→ Existing replay remains available
→ no Rotation until confirmed Gap

Best-effort unavailable
→ degraded
→ Continuity Class unchanged

Projection storage unavailable
→ Relation Query not ready
→ Event SSE may remain ready

Retention cleaner failed
→ degraded
→ storage threshold exceeded 后 not ready
```

Tasks Runtime 默认不被 Business Events 拖垮。

---

# 42. Telemetry

至少：

```text
sdar_business_event_source_received_total{sourceId,outcome}
sdar_business_event_source_duplicate_total{sourceId}
sdar_business_event_source_rejected_total{sourceId,reason}
sdar_business_event_source_mapping_failed_total{sourceId}
sdar_business_event_source_blocked_total{sourceId,reason}

sdar_business_event_publication_barrier_waiting{sourceId}
sdar_business_event_finalized_total{sourceId,outcome}

sdar_business_event_stream_rotations_total{reason}
sdar_business_event_continuity_loss_total{reason}
sdar_business_event_continuity_notifications_total{outcome}

sdar_business_event_replay_events_total{outcome}
sdar_business_event_live_events_total{outcome}
sdar_business_event_projection_filtered_total{reason}

sdar_business_event_relation_pages_total{outcome}
sdar_business_event_relation_token_expired_total
```

`sourceId` 最大 16 个，属于有界低基数。

禁止 Metric Label：

* Event ID；
* Task ID；
* Resource Ref；
* Source Event ID；
* Subscription ID；
* Raw Reason 文本；
* Authorization Hash。

---

# 43. Persistence

必须新增或等价实现：

```text
provider_business_event_runtime_state
provider_business_event_stream_generation
provider_business_event_generation_source
provider_business_event_continuity_record

adapter_business_event_source_state
adapter_business_event_inbox

provider_business_event
provider_task_resource_binding
provider_task_visibility_tombstone

provider_business_event_relation_projection
```

不再单独创建：

```text
adapter_business_event_cursor
```

DDL Skeleton 必须额外满足：

* 所有跨表写事务遵守第 13.1 节全局锁顺序；
* `provider_business_event_stream_generation` 同时保存 `last_replayable_sequence` 和可空 `last_continuous_sequence`；
* `adapter_business_event_inbox` 的 Raw/Reject 字段不受正式 Business Event Shape CHECK 阻断；
* `provider_business_event` 只保存完成 Mapping/Association 的合法不可变 Event；
* Source Inbox、Continuity Record 和 Generation History 的外键/删除策略不得破坏旧 Cursor 解释；
* 所有 Sequence 数据库列使用 `bigint`，应用层使用 `bigint`/Decimal String。

---

# 44. 实施阶段

## Phase A：合同资产

* Shared JSON Schema；
* Continuity Schema；
* Adapter Proto；
* Error Catalog；
* Golden Vector；
* Header Contract；
* Requirement Traceability。

## Phase B：Persistence

* Migration；
* Runtime State；
* Generation History；
* Source State；
* Inbox；
* Event Log；
* Binding/Tombstone；
* Relation Projection。

## Phase C：Source Intake

* Manifest；
* gRPC Source Client；
* Lease/Fencing；
* Ordering；
* Dual Hash；
* Poison；
* Durable/Best-effort。

## Phase D：Finalizer

* Publication Barrier；
* Task Mapping；
* Resource Association；
* Runtime Sequence；
* Atomic Rotation；
* Source Roster。

## Phase E：MCP Stream

* Discovery；
* Capability；
* Listen/Ack；
* Current Replay；
* Rotated Drain Replay；
* Continuity Control；
* Live Delivery；
* `lastScannedSequence`。

## Phase F：Relation Query

* Preview；
* Immutable Projection Token；
* Retry-safe Pagination；
* Error Matrix；
* Retention。

## Phase G：Hardening

* Multi-replica；
* Source Lease Takeover；
* Rotation Race；
* Slow Consumer；
* Retention；
* Restore；
* Security；
* Capacity。

## Phase H：SDAR Interop

* Strict Discovery；
* Header；
* Empty Stream；
* Current Cursor；
* Rotated Drain；
* Stream Reset；
* Task Event；
* Resource Event；
* Relation Pagination；
* Mixed Continuity；
* Source Gap；
* Notification Independence。

---

# 45. Profile 1.0 明确不支持

* Source 乱序；
* Gap Ledger；
* 独立 Resource ACL；
* 无 Task 关联的 Resource Subscription；
* 权限扩张后的自动历史补发；
* 即时权限撤销；
* `notifications/cancelled` 取消 Business Event Stream；
* Stateless Projection Token；
* Best-effort Gap-free；
* Runtime 自动发现数据库 PITR；
* Runtime 重建 Adapter 从未保存的历史事件；
* Runtime 判断 Goal/Skill/Workflow 影响；
* 无界 Related Task 列表。

---

# 46. 无法由 Runtime 或协议文本解决的问题

以下事项不能通过继续增加 Runtime 代码解决，只能降低保证、依赖外部系统或要求运维执行。

## 46.1 Adapter 未保存的事件无法恢复

如果 Best-effort Adapter 在 Runtime 停机期间没有持久保存事件，Runtime 无法从 PostgreSQL 恢复从未收到的事实。

正式边界：

```text
best_effort_live
→ 不提供停机期间 Gap-free 保证
```

## 46.2 Runtime 无法自动识别数据库被恢复到旧世代

PITR 后的数据库可能内部完全自洽，但已经回退到旧时间点。Runtime 无法仅靠恢复后的数据库证明发生过回退。

必须由 Operator 执行：

```text
rotateBusinessEventStream(reason)
```

## 46.3 没有外部授权版本权威时，无法即时识别权限变更

当前 Runtime 只有 Authorization Context Hash、Execution Mode 和 Simulation ID，没有可验证的权限版本。

因此 Profile 1.0 只能：

* 固定 Subscription Snapshot；
* 依赖 Credential Expiry；
* 限制最大 Stream Duration；
* 要求权限变化后重连。

不能声明即时撤权。

## 46.4 没有 Resource ACL Authority 时，无法投递无 Task 关联资源事件

Profile 1.0 只能通过相关 Task 的可见性推导 Resource Event 可见性。

没有可见 Task 时：

```text
Resource Event 不发送
```

如果未来需要独立资产监控，必须增加 Resource ACL/Asset Directory Profile。

## 46.5 超出 Event Time 窗口的历史关联无法无限恢复

Runtime 不可能无限保留所有历史 Task Binding。

超过：

```text
BUSINESS_EVENT_MAX_OCCURRED_AGE_MS
```

的 Event 必须拒绝或触发 Source Contract Violation。

## 46.6 Source 提供的 `occurredAt` 真实性无法由 Runtime证明

Runtime可以验证：

* Timestamp 格式；
* Future Skew；
* Maximum Age；
* Source Contract。

但不能证明设备或 Adapter 报告的业务发生时间一定真实。

## 46.7 Provider Runtime 不能判断事件一定影响任务目标

`taskId`、`relatedTaskIds` 只是候选关联。

实际影响仍由 SDAR 根据：

* Goal；
* Skill；
* Workflow；
* Evidence；
* Task State；
* Completion Contract；

判断。

---

# 47. Requirements Contract Freeze 与实施 Gate

## 47.1 Requirements Contract Freeze 已完成

以下项目在 V0.5.2 中视为完成：

- [x] V0.5.2 Requirements Contract 批准；
- [x] V0.5 中列出的不可解决边界被接受；
- [x] PDR-BE-01～PDR-BE-14 全部批准；
- [x] 最低 Git 基线固定为 `ee14d2f` 必含祖先；
- [x] Requirements Contract 状态改为 `Frozen`；
- [x] Codex 不得在实现阶段重新选择 PDR 替代方案。

冻结后允许开展：

```text
JSON Schema Draft
Adapter Proto Draft
Migration DDL Draft
Golden Vector
Contract Test Skeleton
Capacity Model
```

需求合同内容若发生破坏性变化，必须升级 Requirement Version，并重新执行决策审批。

## 47.2 正式 Codex Goal 实施 Gate

进入正式分阶段 Codex Goal 实施任务包前，仍必须具备：

- [ ] Business Event JSON Schema Draft；
- [ ] Continuity Notification JSON Schema Draft；
- [ ] Adapter Proto Draft；
- [ ] Error Catalog；
- [ ] Event ID Golden Vector；
- [ ] JCS Hash Golden Vector；
- [ ] Timestamp Normalization Golden Vector；
- [ ] Migration DDL Draft（含 Poison Inbox、Generation Drain Boundary）；
- [ ] Source State/Fencing 与 Blocked Source Health Review；
- [ ] Publication Barrier SQL 与全局锁顺序 Review；
- [ ] Rotation Transaction、Drain Boundary 与死锁竞争 Review；
- [ ] Rotated Drain Replay Review；
- [ ] Retention 与数据库容量评估；
- [ ] Routing Header Contract Test Skeleton；
- [ ] SDAR Cursor/Reset Contract Test Skeleton；
- [ ] 执行时最新 `origin/main` 基线检查。

上述 Skeleton 可以通过独立设计任务生成；正式产品编码必须在 Skeleton Review 通过后启动。

Profile 1.0 仍需通过实现、Conformance 和真实 SDAR Interop 后才能标记 Frozen。

---

# 48. MCP Provider 项目决策登记

PDR-BE-01～PDR-BE-14 在 V0.5.2 中全部批准。表中“冻结值”具有规范效力。

| ID | 决策事项 | V0.5.2 冻结值 | 状态 | 实施约束 |
|---|---|---|---|---|
| PDR-BE-01 | 全局数据库锁顺序 | Runtime State → Generation → Source State → Inbox → Event/Visibility → Projection | `approved` | 所有跨两类以上权威对象的事务必须遵守；并发测试不得忽略死锁 |
| PDR-BE-02 | Rotation Drain 边界 | 必填 `lastReplayableSequence`；仅 Continuous Generation 提供 `lastContinuousSequence` | `approved` | 旧 Generation 在保留期内使用 `replayable_closed` Drain |
| PDR-BE-03 | Poison Event 存储 | Inbox 保存 Raw Envelope/Hash，规范化字段可空；非法 Fact 不进入 Event Log | `approved` | Durable Poison 必须触发 Continuity Loss；不得因正式 Event CHECK 丢失审计事实 |
| PDR-BE-04 | Blocked Source 服务语义 | Ingest Not Ready；历史 Replay 保留；Ack 通过 `degradedSourceIds` 明示 | `approved` | Blocked Source 不得继续 Ingest，恢复须更换 Source Stream 或运维解除 |
| PDR-BE-05 | 首版多 Source 范围 | 支持 1～16 个显式 Source；Roster 变化触发 Rotation | `approved` | 每个 Generation 冻结 Source Roster，不允许原地变更 |
| PDR-BE-06 | Source 可靠性范围 | 同时支持 Durable 与 Best-effort，在 Discovery/Ack 中如实降级 | `approved` | Mixed/Best-effort 不得声明全局 Gap-free |
| PDR-BE-07 | Adapter Proto 演进方式 | 增加 `StreamBusinessEvents`；TypeScript/Python Adapter 同步升级并执行 Golden Conformance | `approved` | Proto 采用兼容性审查与 generated-diff Gate |
| PDR-BE-08 | Retention 与容量预算 | 使用 History Horizon 公式及本文默认值/范围 | `approved` | 生产启用前必须完成容量基线、清理吞吐和最坏保留量验证 |
| PDR-BE-09 | Relation Token 实现 | PostgreSQL 持久化 Opaque Token；不使用 Replica-local 签名 Token | `approved` | Token 绑定不可变 Projection；分页请求保持幂等 |
| PDR-BE-10 | Stream Rotation 运维接口 | 提供显式 Operator Rotation；PITR 后由运维调用 | `approved` | 操作必须鉴权、审计、幂等、事务原子；不声明自动识别 PITR |
| PDR-BE-11 | Readiness 耦合 | 默认 `BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY=false`，部署可改为 `true` | `approved` | Business Events 子组件仍需独立 Readiness/Degraded 状态 |
| PDR-BE-12 | 发布与冻结策略 | Requirements Contract 先冻结；Profile 在实现、Conformance、真实 SDAR Interop 后 Frozen | `approved` | Contract Frozen 不等于 Runtime Component Conformant 或 Interop Certified |
| PDR-BE-13 | 实施 Git 基线 | 执行时最新 `origin/main`，且 `ee14d2f` 为最低必含祖先 | `approved` | 禁止回退已合并 Frozen Runtime Conformance 修复 |
| PDR-BE-14 | 首版功能开关 | `BUSINESS_EVENTS_ENABLED=false` 默认关闭，分阶段灰度启用 | `approved` | Discovery 仅在功能启用且静态能力有效时声明 Extension |

## 48.1 决策变更治理

PDR 状态现在全部为：

```text
approved
```

任何后续变更必须：

1. 提交新的 PDR Amendment；
2. 说明是否破坏 Wire、Persistence、Conformance 或 SDAR Interop；
3. 破坏性变化升级 Requirement/Profile 版本；
4. 不得由 Codex 在代码中隐式偏离；
5. 不得仅通过环境变量绕过冻结合同。

---

# 49. PDR 实现追踪

| PDR | 主要规范章节 | Skeleton 证据 |
|---|---|---|
| PDR-BE-01 | 13、16、17、18、43 | Lock-order ADR、并发 SQL/Test Skeleton |
| PDR-BE-02 | 18～21、31 | Generation/Continuity Schema、Drain Replay Tests |
| PDR-BE-03 | 14、23、43 | Inbox DDL、Poison Fixtures |
| PDR-BE-04 | 12、21、32、41 | Source State Schema、Readiness Tests |
| PDR-BE-05 | 4～6、19 | Manifest Schema、Generation Roster DDL |
| PDR-BE-06 | 4、6、11、32 | Discovery/Ack Schema、Durable/Best-effort Fixtures |
| PDR-BE-07 | 11、44 | Proto Draft、TS/Python Golden Tests |
| PDR-BE-08 | 25、26、39、40 | Capacity Model、Retention DDL/Report |
| PDR-BE-09 | 34～36 | Projection DDL、Pagination Contract Tests |
| PDR-BE-10 | 18～21、46.2 | Operator API/CLI Contract、Runbook |
| PDR-BE-11 | 41 | Readiness Matrix、Deployment Config |
| PDR-BE-12 | 47、50 | Release/Conformance Gate |
| PDR-BE-13 | 文档头、47 | Ancestor Check Script |
| PDR-BE-14 | 39、41 | Feature Flag Config/Test |

---

# 50. V0.5.2 最终结论

```text
架构疑问：无
协议模型疑问：无
冻结前 P0：已关闭
PDR-BE-01～14：14/14 approved
不可解决边界：已接受并保留
Requirements Contract：Frozen
Schema/Proto/DDL Skeleton：允许启动
正式 Codex 产品实现：Skeleton Review 通过后启动
Profile 1.0：实现、Conformance 和真实互操作通过前不得标记 Frozen
```

推荐推进顺序：

```text
Requirements Contract Frozen
→ JSON Schema / Proto / DDL Skeleton
→ Golden Vector / Contract Test Skeleton
→ Skeleton Review
→ 分阶段 Codex Goal 任务包
→ Implementation / Conformance
→ Real SDAR Interop
→ Profile 1.0 Frozen
```

V0.5.2 是 Provider Runtime Business Events Profile 1.0 的需求合同冻结版本。实现不得重新解释 PDR-BE-01～PDR-BE-14，也不得超出第 45、46 节明确的 Profile 1.0 能力边界。
