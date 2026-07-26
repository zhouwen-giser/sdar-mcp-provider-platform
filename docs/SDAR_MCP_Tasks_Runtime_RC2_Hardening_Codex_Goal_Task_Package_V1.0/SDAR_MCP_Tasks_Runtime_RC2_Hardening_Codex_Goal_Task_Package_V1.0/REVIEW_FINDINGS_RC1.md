# Runtime v1.0.0-rc.1 Code Review Findings

**审查基线：** `feature/mcp-tasks-provider-runtime-v1`，rc.1 Head `51d68926ba1bc9e935438e750582693aea3ecf4d`。  
**用途：** 本文件是修复范围输入，不替代 Codex 对真实仓库的重新核验。

## A. 发布阻断问题

### F-001 Cancel/Deadline 拒绝后 Task 卡在 STOPPING

涉及：

- `packages/persistence-postgres/src/tasks.ts`
- `packages/task-engine/src/engine.ts`
- `packages/task-engine/src/scheduler.ts`
- `packages/task-engine/src/recovery.ts`

现状：取消意图会先写 `STOPPING/cancel_requested=true`；Adapter 返回拒绝后只把 command 标记为 `REJECTED`，Task 状态不恢复，deadline 也不会再次扫描，Recovery 只重放 `PENDING` command。

修复结果必须区分：

- 传输失败/临时失败：持久重试；
- 用户取消永久拒绝：基于权威 Snapshot 恢复当前执行状态，清除取消标记并允许再次请求；
- deadline/start-window 安全停止永久失败：不得恢复继续执行，必须持续重试或进入明确 `failed`，并输出 `SAFE_STOP_UNCONFIRMED`/等价稳定原因及严重告警。

### F-002 Immediate startTolerance 未执行

现状：计算并保存 `latestStartAt`，但 immediate Task 返回 `ACCEPTED/QUEUED/SCHEDULED` 后没有 watchdog；超时后可能永久 queued。

必须实现：

- Adapter 尚未创建执行：可以直接 `start_window_missed`；
- Adapter 已创建但未实际启动：先持久化安全停止命令，取得不会后续启动的证明，再发布 `completed + isError + start_window_missed`；
- `actual_started_at` 只能在 RUNNING 或明确已产生业务执行的状态被确认时写入，不能在仅 accepted/queued 时写入。

### F-003 Scheduled retryable rejection 未在 tolerance 内重试

现状：第一次 `rejected` 就结束 Task。

必须实现：

- `retryable=true` 且未到 `latestStartAt`：持久化退避时间、递增 attempt、恢复可调度状态；
- 达到 `latestStartAt`：`start_window_missed`；
- 非重试拒绝：按冻结的结果矩阵形成明确业务终态；
- 多 Runtime 下每次 attempt 仍只能执行一次。

### F-004 Runtime 生成终态缺少 Observation 与 Outbox

现状：`start_window_missed`、scheduled rejection 等直接更新 Task，未写 Observation/Outbox；scheduled 初始 revision 为 0，可能与 Profile 的最新状态一致性冲突。

必须建立统一事务性 Transition API：

```text
lock Task
→ validate terminal/version
→ allocate Runtime observation revision
→ update Task
→ append full Observation
→ append Outbox
→ commit
```

Runtime-owned observation revision 与 Adapter revision 必须分离。所有状态变化都要有可追踪 revision。

### F-005 Operation Snapshot 只写不用

现状：Recovery/Scheduler 通过当前 Manifest 的 operationName 查找能力，旧 Operation 被删除或改变后，历史 Task 无法可靠恢复。

必须实现：

- 按 `operation_snapshot_id` 读取并校验 immutable Operation definition；
- Scheduler、Recovery、控制能力判断、结果验证优先使用 Task 绑定 snapshot；
- 当前 Manifest 只用于新调用和 Catalog；
- 增加 Manifest 升级、Operation 删除、Schema 变化后的历史 Task 测试。

### F-006 Adapter 响应身份未严格校验

必须验证：

- `snapshot.task_id == expected taskId`；
- `snapshot.external_execution_id == stored/accepted externalExecutionId`；
- `accepted.external_execution_id == initialSnapshot.external_execution_id`；
- `CommandAck.command_sequence == expected sequence`；
- Reconcile 的 operationName、argumentHash、execution context、externalExecutionId 一致；
- 不一致不得写 Task，必须记录安全审计并进入 conflict/deferred。

## B. Profile 完整性问题

### F-007 TTL 只存储未执行

必须实现：

- 非终态 Task 不得因 TTL 被清除；
- 活跃有限 TTL 需要明确续期策略；
- 终态保留至少 ttl；
- 到期后 `tasks/get/update/cancel/result` 返回明确 Invalid Params/Task expired；
- 清理器多实例安全、可观测、可测试；
- 默认保留策略与 Profile 一致，并防止数据库无限增长。

### F-008 Adapter 临时故障导致 tasks/get 失败

`tasks/get` 必须是可靠、无副作用读取。Adapter 暂时不可用时：

- 返回 PostgreSQL 最后确认状态；
- 在 namespaced meta 中标记 stale/degraded 与最后确认时间；
- 后台 Recovery 继续 Reconcile；
- 只有协议/身份冲突等不可安全忽略问题才返回错误。

### F-009 Cancel Ack 未与 Adapter RPC 解耦

`tasks/cancel` 应在取消意图和 command 已持久化后立即返回 `working/stopping`，不应因 Adapter RPC 超时让客户端误认为请求未记录。

必须增加持久 Command Dispatcher，支持：

- claim/lease；
- retry/backoff；
- command sequence；
- Adapter Ack 校验；
- Runtime 重启恢复；
- deadline 与用户 cancel 的去重/优先级。

### F-010 outputSchema 未实际校验

Operation Registry 必须保留 output validator。同步结果、Task 成功结果和 partial result 应在发布前校验。错误结果不按成功 output schema 强制校验，但仍需验证标准业务结果结构。

### F-011 Technical failure wire shape 不正确

冻结映射：

- 异步 Task technical failure：`status=failed` + JSON-RPC error object；
- 同步 technical failure：JSON-RPC Error；
- task-capable 在未发布 Task 前发生 technical failure：JSON-RPC Error；
- 普通业务失败：`CallToolResult.isError=true`；
- 禁止把 `{code,message}` 当作普通 CallToolResult 返回。

### F-012 JSON-RPC 错误码未显式映射

建立集中错误类型/映射：

- unknown tool/taskId、非法 timing、非法 input、能力缺失：Invalid Params 或标准适用错误；
- 未授权/跨上下文：不泄露存在性，返回稳定协议错误；
- 内部故障：Internal Error，日志保留 correlation id；
- tools/call 可恢复业务错误继续使用 `isError=true`；
- 以真实 wire-level 黑盒测试断言 code、message、data。

### F-013 Profile 字段与 SDK 字段命名冲突

必须做 ADR 并实现兼容：

- 标准 MCP wire 使用当前官方 SDK 的 `ttl`、`pollInterval`；
- SDAR 兼容字段放入 `io.sdar/taskExecution` namespaced meta，或同步升级 Profile 文档；
- 不在顶层伪造非标准字段；
- 增加 SDAR Client compatibility test。

## C. 工程与运维问题

### F-014 Readiness 未持续探测 Adapter，故障归因错误

- readiness 必须独立展示 database/adapter/recovery/scheduler/dispatcher；
- Adapter 掉线后在可配置时间内变为 not-ready；
- Adapter 故障不能错误标记 database failed；
- liveness 不应因外部依赖短暂失败而杀死进程。

### F-015 Rate limiter Map 无界增长

实现有界清理，或替换为成熟的 Fastify rate-limit；多副本生产限制需文档说明或使用共享后端。

### F-016 幂等锁持有数据库连接等待 Adapter RPC

不得在 session advisory lock/长事务和数据库连接占用期间执行慢外部 RPC。改为：

- 短事务 claim + owner token + lease；
- RPC 在事务外执行；
- 完成时 CAS/transaction；
- 崩溃后 lease 到期和 Reconcile；
- 测试连接池不被慢 Adapter 请求耗尽。

### F-017 Docker 构建不可完全复现且包含开发依赖

- build 使用 frozen lockfile；
- production stage 只包含生产依赖和必要生成物；
- 不复制完整 workspace root dev `node_modules`；
- image 非 root，SBOM/audit 仍通过；
- 添加镜像体积基线和启动 smoke。

### F-018 MCP Streamable HTTP Session 生命周期

依据当前固定 SDK 版本和规范实现明确设计：

- 若支持 session：按 `Mcp-Session-Id` 管理 Server/Transport、过期清理、并发与关闭；
- 若选择规范允许的 stateless 模式：明确禁用依赖 session 的能力，不声称支持通知，增加多请求兼容测试；
- 不允许每个请求重新创建对象却同时声称具备完整持久 session/notification 能力。

## D. 合规声明问题

### F-019 当前 10 项双语言测试不足以声明完整 P0-P4

扩展 conformance testkit，覆盖本任务包 `REGRESSION_TEST_MATRIX.md` 中全部强制用例。最终报告必须区分：

- Runtime Profile conformance；
- Adapter protocol conformance；
- resource-specific safety conformance。

不得用 Mock Adapter happy path 替代真实资源安全验证。
