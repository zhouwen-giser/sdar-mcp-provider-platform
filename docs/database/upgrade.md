# Migration and upgrade procedure

rc.1 contains published migrations `001` through `006`; rc.2 appends `007` through `012`; rc.3
appends `013`, the two `014` migrations, `015`, and `016`. v1.1 appends
`017_provider_ops_audit_delivery.sql`（Provider 运维审计持久化投递）和
`018_runtime_trace_context.sql`（Runtime 链路上下文持久化）。
Published files are immutable: Runtime records an LF-normalized SHA-256 checksum and refuses
startup if content changes, while accepting an exact legacy raw-checkout hash already recorded
by older Windows installations. Never edit, delete or renumber 001-018（禁止修改、删除或重新编号
任何已发布迁移）。

1. Verify a restorable, consistent PostgreSQL backup and Adapter compatibility.
2. Install dependencies/build the exact release and run tests against a restored
   staging copy.
3. Apply migrations once with `DATABASE_URL=... pnpm db:migrate`, or run the
   release image with command `node dist/apps/runtime/src/migrate.js`.
4. Check the returned version/checksum list, then roll Runtime replicas with
   `maxUnavailable=0` and watch readiness/recovery/Adapter metrics.
5. Run an MCP synchronous call and a durable Task smoke before completing the
   rollout.
6. Confirm Recovery（恢复器）, Command Dispatcher（命令调度器）, Scheduler（定时启动器） and
   TTL Cleaner（句柄清理器） readiness; inspect pending
   command, STARTING/WAITING_START_CONFIRMATION/SCHEDULED, expired-handle, unpublished Outbox and
   recovery-backoff counts before declaring success.
7. 检查 `provider_ops_delivery` 中 `PENDING`、`CLAIMED`、`RETRY_WAIT` 状态的 Audit backlog
   （审计积压），并确认 `telemetry_audit_oldest_age_seconds`（最老审计年龄秒数）没有持续增长。
   Audit backlog 不影响 readiness，但必须在发布验收中记录。

CI constructs an actual rc.1 database at 001-006 with admissions, all nonterminal/terminal Task
classes, command, Observation, Outbox, idempotency and real Adapter snapshot data. It then applies
007-018 twice and proves Recovery -> Dispatcher -> Scheduler continuation plus historical reads,
durable Provider Ops delivery, and persisted Trace Context. The v1.1 gate also verifies the
rc.2-to-v1.1 migration set and runs the two-replica command, Provider delivery, and start-window
races before release evidence is regenerated.

The migrator serializes through a PostgreSQL advisory lock, so concurrent
invocations are safe. Runtime also invokes it during startup. There is no
automatic down migration: application rollback is permitted only while the old
binary understands every applied schema. Otherwise restore the pre-upgrade
backup to a separate database and reconcile external Adapter executions before
cutover.
