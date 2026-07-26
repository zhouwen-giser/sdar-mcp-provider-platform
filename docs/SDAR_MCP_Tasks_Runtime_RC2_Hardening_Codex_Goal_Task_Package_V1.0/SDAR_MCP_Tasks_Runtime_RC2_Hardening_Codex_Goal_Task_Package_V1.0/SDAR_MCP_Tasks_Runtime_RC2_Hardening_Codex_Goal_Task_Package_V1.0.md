# SDAR MCP Tasks Provider Runtime v1.0.0-rc.2
## Codex Goal Mode 可靠性加固与问题修复任务包

**任务包版本：** 1.0  
**日期：** 2026-07-16  
**目标仓库：** `https://github.com/zhouwen-giser/sdar-mcp-tasks-provider-runtime`  
**目标分支：** `feature/mcp-tasks-provider-runtime-v1`  
**现有 PR：** `#1`  
**不可变基线：** `v1.0.0-rc.1` / Head `51d68926ba1bc9e935438e750582693aea3ecf4d`  
**目标交付：** `v1.0.0-rc.2`  
**执行方式：** Codex 先 `/plan`，随后进入 `/goal` 连续完成 H0-H9，直到所有 Definition of Done 达成。

---

# 0. Goal 总指令

你不是重新实现 Runtime，也不是只修改报告。你要在 rc.1 的真实实现基础上，修复代码审查发现的状态机、时间合同、恢复、一致性、协议和运维缺陷，保留已有正确能力和已有测试。

必须交付：

```text
v1.0.0-rc.1 可运行基线
        +
控制命令可靠状态机
        +
immediate/scheduled 启动窗口完整语义
        +
统一 Task Transition / Observation / Outbox
        +
immutable Operation Snapshot 恢复
        +
Adapter 身份与序列校验
        +
TTL、可靠 tasks/get、明确 JSON-RPC 错误
        +
output schema 与 wire shape 校验
        +
运行时健康、连接池、镜像与 MCP session 加固
        +
扩展 P0-P4 回归与双语言合规测试
        =
v1.0.0-rc.2
```

## 0.1 禁止行为

- 禁止删除、移动、覆盖或重打 `v1.0.0-rc.1` Tag；
- 禁止 force-push、rebase 已推送历史、直接提交 `main`；
- 禁止把问题通过放宽断言、删除测试、修改 Profile 含义或隐藏错误来“解决”；
- 禁止只写 ADR、接口、TODO 或伪代码；
- 禁止用内存状态代替 PostgreSQL 持久权威；
- 禁止把 Adapter RPC Ack 当成资源已经安全停止；
- 禁止在数据库事务、session advisory lock 或占用连接期间等待慢外部 RPC；
- 禁止新代码绕过 Task Repository 的事务一致性；
- 禁止当前 Manifest 覆盖历史 Task 绑定的 Operation Snapshot；
- 禁止宣称 P0-P4 完整通过而测试矩阵仍有空缺；
- 禁止生成 rc.2 Tag 后再向同一 Tag 覆盖提交。

## 0.2 权威输入顺序

冲突时按以下顺序决定：

1. `references/SDAR_MCP_Tasks_Provider_Profile_V1.0.md`；
2. `references/SDAR_MCP_Tasks_Runtime_Design_V1.0.docx`；
3. `references/SDAR_MCP_Tasks_Adapter_Design_V1.0.docx`；
4. `REVIEW_FINDINGS_RC1.md` 中冻结的缺陷和本任务包决策；
5. 仓库当前 Adapter Protocol、数据库兼容性和官方 MCP SDK wire schema；
6. 既有代码风格。

若 Profile 字段与官方 SDK wire schema 有差异，必须采用 H6 的兼容策略，不得悄悄选择一方。

## 0.3 Goal 执行与提交规则

每个 Phase 必须：

1. 同步远程并记录 SHA；
2. 更新 rc.2 ExecPlan 和追踪矩阵；
3. 先补能复现问题的失败测试；
4. 实现代码和迁移；
5. 运行本阶段测试及相关旧测试；
6. 生成 `reports/runtime-v1-rc2/phase-HN/` 报告；
7. 独立 commit；
8. push 到 `origin/feature/mcp-tasks-provider-runtime-v1`；
9. 等待/检查 CI，失败则修复并再次提交；
10. 达到退出门槛后自动进入下一阶段。

推荐 Commit：

```text
fix(control): harden durable cancellation and command dispatch
fix(timing): enforce immediate and scheduled start windows
refactor(task): unify transitions observations and outbox
fix(recovery): bind tasks to immutable operation snapshots
fix(protocol): validate adapter identity and MCP wire errors
feat(ttl): implement task handle retention lifecycle
fix(runtime): degrade reads safely and harden health checks
build(release): prepare runtime v1.0.0-rc.2
```

---

# 1. H0 — 基线核验、红灯测试与 rc.2 ExecPlan

## 1.1 启动命令

```bash
git fetch origin --tags --prune
git checkout feature/mcp-tasks-provider-runtime-v1
git pull --ff-only origin feature/mcp-tasks-provider-runtime-v1
git status --short
git log --oneline --decorate -30
git show v1.0.0-rc.1 --no-patch
git diff --stat v1.0.0-rc.1..HEAD
gh pr view 1 --json number,state,isDraft,headRefName,baseRefName,statusCheckRollup,url || true
```

不得假定任务包中的 Head 仍然是最新值。若用户或并行任务已有提交，保留并审查它们。

## 1.2 必须生成

```text
docs/implementation/runtime-rc2-hardening-exec-plan.md
docs/implementation/runtime-rc2-requirement-traceability.md
docs/implementation/runtime-rc2-baseline-assessment.md
reports/runtime-v1-rc2/phase-H0/*
```

## 1.3 基线验证

至少运行：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test:unit
pnpm test:contract
```

有 PostgreSQL/Docker 时运行完整 `pnpm verify`。本机环境受限时不得跳过交付，必须用 GitHub Actions 验证并保存 run id。

## 1.4 红灯测试

在改实现前，至少新增能稳定复现以下问题的测试：

- Adapter cancel 返回 `accepted=false` 后 Task 卡 STOPPING；
- immediate queued 超过 startTolerance；
- scheduled retryable reject 未重试；
- start_window_missed 无 observation/outbox；
- 删除当前 Manifest Operation 后旧 Task 恢复失败；
- snapshot/ack identity mismatch 被接受。

这些测试必须在 rc.1 代码上失败，并在 H0 报告记录预期失败，不允许为了保持 CI 绿色而跳过。可以先放在独立 rc2 test command，H1 起逐步转绿；每个阶段远程分支仍必须能编译。

## H0 退出门槛

- [ ] 真实 Head、PR、Tag 和 CI 已核验；
- [ ] rc.2 ExecPlan/追踪矩阵已入库；
- [ ] 六类核心缺陷有可复现测试；
- [ ] 不存在未解释的工作区修改；
- [ ] H0 报告、commit、push 完成。

---

# 2. H1 — Durable Control Command 状态机

目标：彻底修复 cancel/deadline 拒绝、超时和重启后永久 STOPPING 问题，并使 `tasks/cancel` 成为真正的持久 Ack。

## 2.1 数据模型

通过前向追加迁移扩展 `task_command`，推荐至少包含：

```text
state:
  PENDING
  CLAIMED
  RETRY_WAIT
  ACKNOWLEDGED
  REJECTED
  EXHAUSTED

attempt_count
next_attempt_at
claim_owner
claim_until
last_error_code
last_error_message
priority / stop_reason
previous_task_state or restore anchor
```

字段名称可按仓库风格调整，但必须支持：

- 多实例安全 claim；
- lease 过期重领；
- retry/backoff；
- 稳定 command sequence；
- 用户取消与 deadline/start-window stop 的优先级；
- 崩溃后恢复；
- permanent rejection 的明确处理。

## 2.2 Command Dispatcher

新增独立持久 Worker，不能依赖 HTTP 请求生命周期：

```text
claim due command in short transaction
→ release DB connection
→ call Adapter RPC
→ validate Ack identity/sequence
→ commit Ack/retry/reject transition
```

`tasks/cancel`：

```text
validate authorization and task state
→ persist cancel intent + command + observation/outbox
→ return current DetailedTask working/stopping
```

不得同步等待 Adapter 完成后才返回 durable Ack。

## 2.3 拒绝策略

### 用户取消

- Transport/transient：`RETRY_WAIT`；
- Adapter 明确永久拒绝：调用 Get/Reconcile 获取权威 Snapshot；
- 恢复为 Snapshot 映射状态；
- 清除 `cancel_requested/stop_reason`；
- 记录 `task.cancel_rejected` observation/outbox；
- 允许后续新 cancel sequence；
- 若身份冲突，不恢复，进入安全 conflict/failure 路径。

### Deadline / Start-window 安全停止

- transient/retryable：保持 STOPPING 并持续重试；
- 不允许回到正常 running；
- 到达可配置重试上限仍无安全停止证明：`failed`，reason `SAFE_STOP_UNCONFIRMED`（或 ADR 冻结的稳定代码）；
- 写 critical metric/log/outbox；
- 不得发布 `deadline_reached` 或 `start_window_missed` 成功补偿结果。

## 2.4 并发与优先级

- 同一 Task 只允许一个有效 stop command；
- deadline 可提升已有用户 cancel 的 stopReason，但不得创建重复副作用；
- cancel 与自然完成竞争：自然成功终态仍可胜出；
- 终态后 dispatcher 必须把未完成 command 安全关闭，不再调用 Adapter；
- pause/resume/update 不能越过正在停止的 Task。

## H1 强制测试

`T-001`～`T-006`、`T-029`、`T-030`。

## H1 退出门槛

- [ ] cancel HTTP/MCP 请求不等待慢 Adapter；
- [ ] cancel/deadline 不会永久卡 STOPPING；
- [ ] command dispatcher 多实例、重启、重试测试通过；
- [ ] 无数据库连接跨 Adapter RPC 持有；
- [ ] 旧 cancel/自然完成测试仍通过。

---

# 3. H2 — 完整 Start Window 与调度重试

## 3.1 启动状态语义

建立明确字段：

```text
acceptedAt
notBefore
latestStartAt
actualStartedAt
startStopRequestedAt
invocationAttempt
nextStartAttemptAt
```

`actualStartedAt` 只能在 Adapter Snapshot 明确进入 `RUNNING`，或业务定义明确说明已发生实际执行时写入。`ACCEPTED/SCHEDULED/QUEUED` 不得自动写实际启动时间。

## 3.2 Immediate Watchdog

持久扫描：

```text
nonterminal
AND actual_started_at IS NULL
AND latest_start_at <= now
AND mode = immediate
```

分支：

1. 尚未调用 Adapter/无 external execution：原子发布 `start_window_missed`；
2. 已有 external execution：创建高优先级 `START_WINDOW_MISSED` stop command；
3. 获得 safe-stop/CANCELLED proof 后，才发布 `completed + isError + start_window_missed`；
4. safe-stop 不可确认按 H1 critical failure 处理。

## 3.3 StartOperation 响应晚到

如果 RPC 返回时已经超过 `latestStartAt`：

- rejected/no side effect：发布 window missed；
- accepted and not started：进入 compensating stop；
- Adapter 声明已 running：进入 compensating stop，并记录 late start violation；
- 不得正常返回 working 后忽略窗口。

## 3.4 Scheduled Retry

Adapter 返回 retryable reject 或 transient error：

```text
now < latestStartAt
→ release claim
→ increment invocationAttempt
→ persist nextStartAttemptAt with bounded backoff/jitter
→ retry
```

到达窗口：`start_window_missed`。非 retryable rejection 按 ADR 的稳定业务终态矩阵处理，并写完整 observation/outbox。

所有 start attempts 必须使用相同 taskId/argumentHash/context；Adapter 必须利用 `invocationAttempt` 和身份实现幂等。

## 3.5 多实例

- `SKIP LOCKED`/lease claim；
- claim 过期后 Reconcile 再决定是否重试 Start；
- 不得因 claim 超时直接再次产生资源副作用；
- response-loss 继续使用 Reconcile。

## H2 强制测试

`T-007`～`T-013`。

## H2 退出门槛

- [ ] immediate startTolerance 真正生效；
- [ ] scheduled retryable reject 能在窗口内重试；
- [ ] 窗口后绝不启动；
- [ ] actualStartedAt 语义正确；
- [ ] 双 Runtime/response-loss 无重复副作用。

---

# 4. H3 — 统一 Transition、Observation Revision 与 Outbox

## 4.1 分离两个 Revision

必须区分：

```text
adapter_revision
observation_revision (Runtime-owned, per Task monotonic)
```

Adapter revision 仅用于拒绝旧 Snapshot；Runtime 的 scheduled、cancel_requested、retry、window_missed、deadline、recovery 等事件必须能分配自己的 observation revision。

## 4.2 统一 Transition API

所有 Task 状态变化必须通过单个 Repository/Service 入口，支持：

- `SELECT ... FOR UPDATE`；
- 终态不可逆；
- expected version/CAS；
- 分配 observation revision；
- 更新 Task；
- 插入完整 Observation；
- 插入 Outbox；
- 同一事务提交；
- 幂等 event key，防止重复写入。

禁止存在“只 UPDATE provider_task 不写 observation/outbox”的状态变化方法。

## 4.3 Observation 完整内容

至少持久化：

```text
revision
type
occurredAt
reasonCode
message
substate
progress
source = runtime|adapter
adapterRevision (optional)
payload/alternatives
```

最新 Observation 必须与当前 Task 状态一致。终态 Observation 类型不可继续使用含糊的 `task.progress`，应使用稳定 terminal event，例如 `task.completed/task.failed/task.cancelled`，或在 Profile namespace 明确扩展。

## 4.4 Outbox

- 每次 externally visible transition 写 Outbox；
- Outbox payload 能构造完整 DetailedTask 或稳定引用；
- delivery 失败不影响 `tasks/get`；
- 重复发布幂等；
- 如当前不提供 notifications/tasks，文档明确 Outbox 的用途和后续投递边界。

## H3 强制测试

`T-014`～`T-016`，并重新运行所有 lifecycle、deadline、cancel、input tests。

## H3 退出门槛

- [ ] Runtime/Adapter revision 分离；
- [ ] 不存在无 Observation/Outbox 的可见状态变化；
- [ ] 最新 revision 与状态一致；
- [ ] 终态不可逆和重复 Snapshot 测试通过。

---

# 5. H4 — Immutable Operation Snapshot 与 Adapter Identity

## 5.1 Snapshot Repository

新增读取和重建：

```ts
loadOperationSnapshot(snapshotId)
validateStoredDefinition(snapshot)
```

Task Engine/Scheduler/Recovery 需要一个 `ResolvedTaskOperation`，来源为 Task 的 `operation_snapshot_id`，而不是当前 Manifest。

## 5.2 使用范围

历史 Task 的以下逻辑使用 snapshot：

- operation execution kind；
- capabilities：cancel/pause/resume/input/maxElapsed；
- input/output schema；
- resource binding；
- Adapter operation name/version binding；
- timing 合同；
- 结果映射/校验。

当前 Manifest 只负责：

- `tools/list`；
- 新 `tools/call`；
- 新 Task 的 snapshot 创建。

## 5.3 Snapshot 升级场景

测试：

```text
create task using manifest v1
→ persist/schedule/input wait
→ restart runtime with manifest v2
→ v2 removes/changes operation
→ old task continues using snapshot v1
→ new call follows manifest v2
```

若 Adapter 不再支持旧 Operation，必须形成显式 recovery failure，不能永久 deferred。

## 5.4 Adapter Identity Validator

集中校验所有 Adapter 返回：

```text
expected taskId
expected externalExecutionId
operationName
argumentHash
execution mode/simulation id
commandSequence
adapter revision monotonicity
```

Start accepted：

- accepted external id 与 initial snapshot id 一致；
- snapshot taskId 一致；
- external id 非空且 provider 内唯一。

Get/Reconcile：

- 请求传入已知 externalExecutionId；
- response 不允许换绑；
- mismatch 记录 audit/metric/outbox；
- 不更新 Task。

Command Ack：sequence 必须完全相同；错误 sequence 不得把 command 标记成功。

## H4 强制测试

`T-017`～`T-022`。

## H4 退出门槛

- [ ] 历史 Task 不依赖当前 Manifest；
- [ ] identity mismatch 全部被拒绝；
- [ ] Reconcile 不能错误绑定其他执行；
- [ ] 升级/删除 Operation 的恢复测试通过。

---

# 6. H5 — TTL 生命周期与可靠读取

## 6.1 TTL 语义

按照 Profile：

- TTL 是 Task Handle 保留期限，不是 deadline；
- 非终态 Task 不清理；
- 有限 TTL 的活跃 Task需续期或推迟 expiry；
- 终态从完成后至少保留 TTL；
- 默认终态建议不少于 24h；
- 过期后返回明确 Task expired/Invalid Params；
- 不泄露跨租户 Task 是否存在。

推荐新增：

```text
handle_expires_at
terminal_at
expired_at / purge_after
```

或等价设计。必须写 ADR 解释续期和物理清理分离：先逻辑过期，再异步 purge。

## 6.2 Cleaner

- PostgreSQL claim/skip locked；
- 多 Runtime 安全；
- 分批清理；
- 清理 Observation/Input/Command/Outbox 的 FK 策略清楚；
- 终态结果在 retention 前不删除；
- 指标：expired/purged/error。

## 6.3 tasks/get 降级读取

当前 Task 非终态时：

1. 先读取 PostgreSQL；
2. 可尝试 Adapter refresh；
3. Adapter transport/transient failure：返回持久状态；
4. `_meta.io.sdar/taskExecution` 增加：
   - `snapshotFreshness: "stale"`；
   - `lastConfirmedAt`；
   - `degradedReasonCode`；
5. 触发/等待后台 Reconcile，不在 read 中产生业务副作用；
6. identity conflict/contract violation 不可被降级掩盖。

读取失败不应把 Task 错误改成 failed。

## H5 强制测试

`T-023`～`T-028`。

## H5 退出门槛

- [ ] TTL 可执行、可升级、可清理；
- [ ] 非终态不被误删；
- [ ] expired wire error 明确；
- [ ] Adapter 临时掉线时 tasks/get 仍可用；
- [ ] conflict 不被 stale fallback 隐藏。

---

# 7. H6 — MCP Wire、错误映射与结果 Schema

## 7.1 集中错误模型

建立 Runtime error hierarchy，例如：

```text
InvalidParamsError
TaskNotFoundOrUnauthorizedError
TaskExpiredError
CapabilityNotSupportedError
AdapterContractError
AdapterTransientError
TechnicalExecutionError
BusinessToolError
```

在 `mcp-protocol` 边界映射为：

- JSON-RPC Error；
- `CallToolResult.isError`；
- Task `failed/error`；
- Task `completed/result.isError`。

必须根据当前锁定的 `@modelcontextprotocol/sdk` 实际 API 使用 typed Protocol Error/McpError，不要凭猜测导入不存在的类。

## 7.2 冻结错误通道

| 场景 | 通道 |
|---|---|
| unknown tool / malformed params / unsupported timing | JSON-RPC Error |
| unknown、unauthorized、expired task | JSON-RPC Error，不泄露存在性 |
| synchronous technical failure | JSON-RPC Error |
| task-capable 在 Task 发布前 technical failure | JSON-RPC Error |
| 已发布 Task technical failure | `failed` + standard error |
| admission/business reject | `CallToolResult.isError=true` 或 Task completed business result |
| deadline/window/partial/business failure | Profile 定义的 completed + result.isError |

## 7.3 outputSchema

Operation Registry 保留 input/output validators 和 schema version。校验：

- synchronous success structuredContent；
- TASK_CAPABLE inline success；
- asynchronous success final result；
- partialResult（如 schema 允许）；
- Adapter result 的 JSON limits。

非法 Adapter success result：不得发布 success；形成 Adapter contract technical failure，并带稳定 reasonCode。

## 7.4 ttl/poll Compatibility ADR

冻结方案：

- 标准 MCP top-level 采用官方 SDK Schema：`ttl`、`pollInterval`；
- 在 `_meta["io.sdar/taskExecution"]` 提供 `ttlMs`、`pollIntervalMs` 兼容别名（若 SDAR 客户端仍需要）；
- 更新 `api-reference.md`、Profile compatibility note 和测试；
- 客户端输入的 ttl 需严格验证；
- 不添加不被 Schema 接受的任意 top-level 字段。

## H6 强制测试

`T-031`～`T-040`，全部以真实 MCP client/wire schema 验证，不只调用 TaskEngine 方法。

## H6 退出门槛

- [ ] 所有 wire error code 有黑盒断言；
- [ ] technical failure 不再返回非法 CallToolResult；
- [ ] output schema 生效；
- [ ] 官方 MCP 和 SDAR 客户端兼容测试通过。

---

# 8. H7 — Runtime、数据库、镜像与 Session 加固

## 8.1 Health 模型

Readiness 独立展示：

```text
database
adapter
recovery
scheduler
commandDispatcher
ttlCleaner
```

- 定时轻量 Adapter health/Describe/Get capability probe；
- 掉线超过阈值 readiness=503；
- Adapter 掉线不能标记 database failed；
- scheduler/dispatcher 异常分别标记；
- 恢复后自动 ready；
- liveness 只反映进程死锁/不可恢复内部错误。

## 8.2 Rate limiting

至少实现一个：

- 使用维护成熟的 Fastify plugin 并配置有界存储；
- 自研 Map 加 TTL wheel/周期清理/最大 key 数。

生产多副本时说明本地限制不是全局限制；如需要全局必须可配置 Redis/网关层，但 rc.2 不强制新增 Redis。

## 8.3 Idempotency 连接池

重构当前 session advisory lock：

- 短事务建立/claim idempotency record；
- lease owner/expiry；
- 释放连接后调用 Adapter；
- 完成时 CAS；
- 其他请求查询 COMPLETE，或等待/重试 PENDING；
- owner 崩溃后 Reconcile；
- 不允许外部 RPC 占用 pool client。

增加慢 Adapter 并发测试，证明 pool 中仍能执行 tasks/get、health、其他 operation。

## 8.4 Docker

- `pnpm install --frozen-lockfile`；
- build 与 production dependencies 分离；
- 使用 `pnpm deploy --prod`、prune 或等价做法；
- runtime 镜像不包含测试、references、dev dependencies；
- Proto/migrations/必要 CA 文件存在；
- non-root；
- Compose/TS/Python images 仍通过；
- 更新 SBOM 和 image size baseline。

## 8.5 Streamable HTTP Session

先核验固定 SDK 当前能力，并写 ADR。必须完成二选一，但不得模糊：

### A. Stateful session

- Session ID 生成/验证；
- Server/Transport 按 session 复用；
- 并发请求安全；
- idle expiry/cleanup；
- shutdown close；
- notifications/tasks 只有在真实支持后声明。

### B. 明确 stateless

- 按规范配置 stateless transport；
- 不声明 notifications/tasks/session dependent 能力；
- 每次请求独立但符合 SDK 推荐模式；
- repeated POST/multiple clients 测试；
- 文档明确限制。

优先选择实现成本与当前 Profile相符的最小正确方案，不得无依据扩大成复杂集群 session store。

## H7 强制测试

`T-041`～`T-046`。

## H7 退出门槛

- [ ] Health 故障归因正确；
- [ ] rate limiter 有界；
- [ ] 慢 Adapter 不耗尽 DB pool；
- [ ] production image 可复现且精简；
- [ ] MCP session/stateless 声明与实现一致。

---

# 9. H8 — 迁移、Recovery、Conformance 全面扩展

## 9.1 数据库升级

所有 rc.2 schema 变化使用追加迁移，不修改已发布 migration checksum。

必须构造 rc.1 数据夹具：

- admission pending/uncertain；
- working/queued/input/stopping；
- scheduled；
- terminal with ttl；
- pending command；
- observation/outbox。

执行 rc.2 migration 后验证：

- 数据无丢失；
- 新字段有正确回填；
- 历史 Task 可读；
- Recovery/Dispatcher/Scheduler 能继续；
- migration 可重复启动且 checksum 正确。

## 9.2 Recovery 顺序

建议启动顺序：

```text
migrate
→ load current Manifest and snapshots
→ recover idempotency/admissions
→ recover Task identities
→ recover pending commands
→ run start-window/deadline scans
→ run TTL logical expiry
→ ready
```

顺序必须避免：

- 未 Reconcile 就重复 Start；
- command dispatcher 在 Task identity 未确认前调用；
- deadline/window terminal 提前发布；
- current Manifest 破坏旧 Task。

## 9.3 Conformance Testkit

重构报告分层：

```text
Runtime Profile conformance
Adapter protocol conformance
Resource-specific safety qualification (external/not claimed by Mock)
```

TypeScript 和 Python Adapter 至少运行所有与 Adapter 协议相关的新测试：

- identity mismatch；
- command sequence；
- response loss；
- retryable reject；
- safe stop reject/transient；
- output mismatch；
- multi-round input；
- restart binding。

`P0-P4` 每级测试名称必须和 Profile 条款一一映射，不得把 10 个 happy path 继续称作“完整合规”。

## 9.4 故障注入

覆盖：

- Runtime 在持久 intent 后崩溃；
- Adapter side effect 后响应丢失；
- Task transition transaction 失败；
- DB 短暂不可用；
- Adapter timeout/reject/wrong identity；
- Dispatcher/Scheduler claim owner 崩溃；
- Runtime 多实例竞争；
- Manifest v1→v2。

## H8 强制测试

`T-047`～`T-049`，以及全部 T-001～T-046 回归。

## H8 退出门槛

- [ ] rc.1 数据可前向升级；
- [ ] Recovery 顺序和多实例测试通过；
- [ ] TS/Python expanded conformance 通过；
- [ ] 报告不再过度声明；
- [ ] 全部追踪项有实现和测试证据。

---

# 10. H9 — 文档、发布门槛与 rc.2 Tag

## 10.1 文档更新

至少更新：

```text
README.md
CHANGELOG.md
docs/protocol/api-reference.md
docs/protocol/mcp-runtime.md
docs/protocol/adapter-v1.md
docs/implementation/task-state-machine.md
docs/implementation/state-reason-mapping.md
docs/operations/configuration.md
docs/operations/runbook.md
docs/operations/security-recovery.md
docs/database/migrations.md
docs/database/upgrade.md
docs/conformance/adapter-testkit.md
```

增加 ADR：

- control command rejection/retry；
- Runtime observation revision；
- operation snapshot recovery；
- TTL retention；
- MCP wire field compatibility；
- Streamable HTTP session/stateless mode；
- idempotency claim without external RPC under DB lock。

## 10.2 Release Gate

必须执行并成功：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm proto:check
pnpm audit:dependencies
pnpm sbom:check
pnpm deployment:check
pnpm container:check
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:recovery
pnpm test:security
pnpm test:e2e
pnpm test:conformance
pnpm capacity:baseline
buf lint proto
buf breaking proto --against <rc1-compatible-baseline>
```

新增 rc.2 聚合命令，例如 `pnpm verify:rc2`，必须包含本任务包全部测试。

## 10.3 Capacity Baseline

除现有 sequential baseline 外，至少记录：

- 慢 Adapter 下 DB pool 可用性；
- dispatcher throughput；
- scheduled/watchdog scan；
- 100/500/1000 nonterminal Task recovery scan；
- observation/outbox 增长；
- image size。

这不是生产 SLO，但用于防止 rc.2 严重退化。

## 10.4 PR 与 Tag

1. 更新 PR #1 标题/描述为 rc.2 hardening；
2. PR 描述列出 F-001～F-019 closure；
3. push 最终报告；
4. 等待 branch push 和 PR workflows 全部成功；
5. 创建 annotated Tag：

```bash
git tag -a v1.0.0-rc.2 -m "SDAR MCP Tasks Provider Runtime v1.0.0-rc.2"
git push origin v1.0.0-rc.2
```

Tag 必须指向：

- 包含最终报告；
- CI 已通过；
- 无未提交修改；
- 不再需要 tag 后补丁的提交。

## H9 退出门槛

- [ ] `reports/runtime-v1-rc2/final-delivery-report.md` 完成；
- [ ] F-001～F-019 全部有 closure/result/residual risk；
- [ ] T-001～T-050 全部 PASS 或明确 N/A 且有规范依据；
- [ ] PR #1 checks 全绿；
- [ ] rc.2 Tag 已推送且不可覆盖；
- [ ] README/CHANGELOG/升级文档正确；
- [ ] 无 TODO、skip、未解释 fallback。

---

# 11. 冻结的状态与结果矩阵

## 11.1 Stop Matrix

| Stop 原因 | Adapter 结果 | Runtime 行为 |
|---|---|---|
| USER_REQUESTED | transient/timeout | RETRY_WAIT，Task working/stopping |
| USER_REQUESTED | accepted | 等待 Snapshot safe-stop proof |
| USER_REQUESTED | permanent rejected | Reconcile，恢复权威状态，记录 cancel_rejected |
| DEADLINE_REACHED | transient/timeout | 持续 retry，Task working/stopping |
| DEADLINE_REACHED | accepted + CANCELLED proof | completed + deadline_reached |
| DEADLINE_REACHED | permanent rejected/exhausted | failed + SAFE_STOP_UNCONFIRMED |
| START_WINDOW_MISSED | no external execution | completed + start_window_missed |
| START_WINDOW_MISSED | execution exists | stop then start_window_missed |
| START_WINDOW_MISSED | safe stop unconfirmed | failed + SAFE_STOP_UNCONFIRMED |

## 11.2 Adapter State Matrix

| Adapter state | MCP state | actualStartedAt |
|---|---|---|
| ACCEPTED | working/accepted or queued | no |
| SCHEDULED | working/scheduled | no |
| QUEUED | working/queued | no |
| RUNNING | working/running | set once |
| PAUSED | working/paused | preserve |
| RESUMING | working/resuming | preserve |
| WAITING_INPUT | input_required | preserve if previously started |
| STOPPING | working/stopping | preserve |
| SUCCEEDED | completed | preserve/set if evidence says executed |
| BUSINESS_FAILED | completed + isError | preserve |
| PARTIALLY_COMPLETED | completed + isError | preserve |
| CANCELLED | cancelled, except deadline/window compensation mapping | preserve |
| TECHNICAL_FAILED | failed | preserve |

## 11.3 Result Channel Matrix

| 情况 | Wire/Task 结果 |
|---|---|
| synchronous success | CallToolResult success |
| synchronous business reject/failure | CallToolResult isError |
| synchronous technical failure | JSON-RPC Error |
| task_required accepted | CreateTaskResult |
| task_capable terminal business success | inline CallToolResult |
| task_capable technical failure before Task | JSON-RPC Error |
| published Task business failure | completed + result.isError |
| published Task technical failure | failed + error |
| unknown/expired/unauthorized task | JSON-RPC Error, no existence leak |

---

# 12. Definition of Done

Codex 只有在全部满足时才能宣告 Goal 完成。

## 12.1 功能

- [ ] cancel/deadline rejection 不再卡 STOPPING；
- [ ] durable command dispatcher 完成；
- [ ] immediate startTolerance 与补偿停止完成；
- [ ] scheduled retry/backoff/window 完成；
- [ ] Runtime-owned Observation revision 完成；
- [ ] 所有 transition 原子写 Task/Observation/Outbox；
- [ ] immutable Operation Snapshot 用于历史 Task；
- [ ] Adapter identity/sequence 全面校验；
- [ ] TTL/expiry/purge 完成；
- [ ] tasks/get Adapter 故障降级完成；
- [ ] outputSchema 校验完成；
- [ ] JSON-RPC 与 technical/business wire mapping 完成；
- [ ] ttl/poll compatibility 完成；
- [ ] readiness/rate-limit/DB pool/Docker/session 加固完成。

## 12.2 数据与可靠性

- [ ] rc.1 migration checksum 未改；
- [ ] rc.1 数据前向升级测试通过；
- [ ] 不持有 DB connection 等待 Adapter RPC；
- [ ] 多实例 scheduler/dispatcher/cleaner 安全；
- [ ] response loss/restart/claim expiry 无重复副作用；
- [ ] 终态不可逆；
- [ ] 安全停止未确认时不伪造业务终态。

## 12.3 测试

- [ ] T-001～T-050 全部有真实自动化证据；
- [ ] 旧 rc.1 测试全部通过；
- [ ] TS/Python expanded conformance 通过；
- [ ] MCP wire 黑盒错误码通过；
- [ ] Compose、Docker、PostgreSQL 17、Buf、SBOM、audit 通过；
- [ ] 无 skip/TODO/降低断言。

## 12.4 工程与发布

- [ ] 每 Phase 独立 commit/push/report；
- [ ] 追踪矩阵已填真实 SHA/测试；
- [ ] PR #1 更新并 checks 全绿；
- [ ] 最终报告如实列出限制；
- [ ] `v1.0.0-rc.2` annotated Tag 指向已验证最终提交；
- [ ] `v1.0.0-rc.1` 未被修改。

---

# 13. 预计实施量与阶段优先级

该任务属于 rc.1 可靠性加固，不是简单 bugfix。预计：

| Phase | 建议投入 |
|---|---:|
| H0 | 2～3 人日 |
| H1 | 6～10 人日 |
| H2 | 5～8 人日 |
| H3 | 4～7 人日 |
| H4 | 4～7 人日 |
| H5 | 4～7 人日 |
| H6 | 4～6 人日 |
| H7 | 4～7 人日 |
| H8 | 5～8 人日 |
| H9 | 2～4 人日 |
| 合计 | 40～67 人日 |

Codex 可显著降低重复编码和测试编写成本，但不得省略状态机推理、故障注入和协议黑盒验证。

---

# 14. 完成输出格式

Goal 完成时，Codex 最终回复必须简明列出：

1. rc.2 最终 commit 与 Tag；
2. PR #1 URL 和检查结果；
3. F-001～F-019 closure 摘要；
4. 迁移编号；
5. 测试数量与 GitHub Actions run id；
6. TS/Python conformance 结果；
7. 剩余限制和真实资源 Adapter 上线前必须完成的安全资格测试。

禁止仅回复“全部完成”。
