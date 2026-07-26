# rc.2 Mandatory Regression Test Matrix

所有测试必须真实执行。`skip`、`todo`、仅生成报告不运行、捕获异常后无断言都视为失败。

| ID | 场景 | 最低层级 | 必须断言 |
|---|---|---|---|
| T-001 | cancel transport failure persists request | PostgreSQL integration | `tasks/cancel` 返回 working/stopping；command 可恢复；无重复 command |
| T-002 | cancel retryable rejection | integration/recovery | 重试退避；Task 不永久卡死；重启后继续 |
| T-003 | cancel permanent rejection | integration | 用户 cancel 恢复权威运行态、清除标记、可再次取消 |
| T-004 | deadline stop transport failure | recovery | 保持 STOPPING；重试；不发布 deadline terminal |
| T-005 | deadline permanent safe-stop failure | integration/security | 进入明确 failed + stable reason + alert/outbox，不伪造停止 |
| T-006 | concurrent duplicate cancel | PostgreSQL concurrency | 单一 command sequence/单一副作用 |
| T-007 | immediate queued past tolerance | integration/fake clock | 先安全停止，后 `start_window_missed` |
| T-008 | immediate start response arrives after latestStartAt | integration | 不把已超窗执行发布为正常 working；安全补偿 |
| T-009 | immediate running before tolerance | integration | 写 actualStartedAt；不误终止 |
| T-010 | scheduled retryable rejection then success | scheduler | tolerance 内重试且只启动一次 |
| T-011 | scheduled repeated retryable rejection until window | scheduler | 最终 start_window_missed，无晚启动 |
| T-012 | scheduled nonretryable rejection | integration | 按冻结矩阵返回正确业务终态和 observation |
| T-013 | multi-runtime schedule attempt | PostgreSQL concurrency | 每个 invocationAttempt 唯一，无重复副作用 |
| T-014 | runtime terminal transition observation/outbox | integration | revision 单调、最新状态一致、outbox 原子写入 |
| T-015 | adapter and runtime revisions separated | unit/integration | Runtime transition 不污染 adapterRevision；observationRevision 单调 |
| T-016 | full observation payload | integration | type/time/reason/message/progress/substate 正确保存 |
| T-017 | manifest operation removed after task creation | recovery | 使用 snapshot 完成恢复/调度 |
| T-018 | manifest schema changed after task creation | recovery | 旧 Task 使用旧 snapshot，新调用使用新 schema |
| T-019 | snapshot taskId mismatch | security/contract | 拒绝写入、审计 conflict |
| T-020 | externalExecutionId mismatch | security/contract | 拒绝写入、Task 保持原状态 |
| T-021 | command sequence mismatch | security/contract | Ack 不生效、command 待处理/冲突 |
| T-022 | reconcile context/hash mismatch | recovery/security | conflict，不绑定错误执行 |
| T-023 | active task finite TTL | integration | 不清理非终态，按策略续期/保护 |
| T-024 | terminal task before TTL | integration | 可查询结果 |
| T-025 | terminal task after TTL | integration/wire | 返回明确 expired Invalid Params |
| T-026 | multi-runtime TTL cleanup | PostgreSQL concurrency | 单次清理，无竞态删除 |
| T-027 | Adapter down during tasks/get | integration | 返回持久状态 + degraded meta，不改变 Task |
| T-028 | Adapter identity error during tasks/get | security | 返回协议错误/冲突，不降级掩盖 |
| T-029 | cancel durable ack latency | E2E | Adapter 超时条件下 cancel 仍快速返回持久 Ack |
| T-030 | dispatcher restart | recovery | PENDING/RETRY command 重启后继续，sequence 不变 |
| T-031 | output schema success valid | unit/integration | 发布成功 |
| T-032 | output schema success invalid | contract | 不发布非法成功，进入稳定 technical failure |
| T-033 | partial result validation | contract | partial payload 按定义校验 |
| T-034 | synchronous technical failure wire | MCP E2E | JSON-RPC Error，不是非法 CallToolResult |
| T-035 | async technical failure wire | MCP E2E | Task failed + error |
| T-036 | business failure wire | MCP E2E | completed/isError 或同步 isError，非 failed |
| T-037 | unknown tool error code | wire E2E | 明确 JSON-RPC code/data |
| T-038 | unknown/expired task error code | wire E2E | Invalid Params，且授权隔离不泄露存在性 |
| T-039 | capability not supported error code | wire E2E | 稳定 code/message |
| T-040 | ttl/poll field compatibility | MCP schema/SDAR client | 官方 Schema 和 SDAR meta 都通过 |
| T-041 | Adapter becomes unavailable after startup | health E2E | readiness 503，database 仍 ready |
| T-042 | Adapter recovers | health E2E | readiness 自动恢复 |
| T-043 | rate-limit state bounded | unit/load | 过期窗口清理，Map 不无界增长 |
| T-044 | slow Adapter with DB pool pressure | capacity/integration | 不持有锁/连接等待 RPC，普通查询可用 |
| T-045 | Docker reproducible production image | CI | frozen lockfile、prod deps、non-root、smoke |
| T-046 | Streamable HTTP repeated requests/session | MCP E2E | 设计与声明一致，无伪 session 能力 |
| T-047 | rc.1 database forward migration | migration | rc.1 schema/data 升级 rc.2 后 Task 可读/恢复 |
| T-048 | TypeScript Adapter expanded conformance | conformance | 全部适用场景通过 |
| T-049 | Python Adapter expanded conformance | conformance | 与 TS 语义一致 |
| T-050 | final no-regression release gate | CI | 旧测试 + 新测试 + Compose + Buf + SBOM 全通过 |
