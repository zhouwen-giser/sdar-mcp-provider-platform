# Runtime operations runbook

## Startup and health

Startup applies checksum-protected migrations, validates Adapter Manifest and
provider identity, persists operation snapshots, performs the first recovery
scan, and only then listens. `/health/live` proves the event loop can respond;
`/health/ready` additionally reports `database`, `adapter`, `adapterManifest`, `recovery`,
`scheduler`, `commandDispatcher`, `outboxPublisher`, `outboxCleaner`, and `ttlCleaner`
independently. `providerTelemetryIngress`（Provider 遥测入口）仅在启用时属于就绪依赖；OTLP Collector（遥测收集器）和审计投递积压不属于就绪依赖。响应字段和样例见 [Runtime API 参考](../protocol/api-reference.md#http-健康与管理接口)。
Remove a replica from traffic on any non-ready dependency.

Adapter readiness is a continuous identity-checked probe, not a startup latch. Adapter Manifest
readiness separately compares the current validated hash with the startup hash and latches drift
as failed until restart. An Adapter outage
must change only `adapter` to failed while a successful PostgreSQL probe keeps `database` ready;
recovery is automatic after a valid probe. Scheduler/dispatcher/cleaner failures retain their
own component label. Liveness remains 200 during ordinary dependency outages.

Use `/metrics` for Prometheus scraping. Alert on sustained readiness failure,
growth in `sdar_outbox_pending`, Adapter RPC error outcomes, recovery errors,
rate limiting, and unexpected terminal-failed growth. Correlate structured logs
by `providerId`, `taskId`, `operationName`, execution mode and correlation id;
arguments, credentials and bearer tokens are intentionally absent/redacted.

An Outbox publisher readiness failure means committed lifecycle events remain pending. Restore
the webhook or intentionally select the internal sink; do not bypass unpublished rows to force
TTL purge.

## Routine operations

- Back up PostgreSQL using the platform's physical or verified logical backup;
  Task、intent（接纳意图）、command（命令）、observation（观测）、snapshot（快照）、idempotency（幂等）、Outbox（发件箱）和 `provider_ops_delivery`（Provider 运维投递）表必须作为同一个恢复单元。
- Run `pnpm db:migrate` or the image's migration entry point before a rolling
  upgrade. Multiple invocations serialize on an advisory lock.
- Keep at least two Runtime replicas. Scheduler and recovery work is coordinated
  with PostgreSQL row/advisory locks, so replicas may overlap safely.
- Drain HTTP traffic before termination. A process exit does not lose durable
  tasks; another replica or restarted process scans them.
- Streamable HTTP is stateless: do not configure sticky sessions, expect an
  `Mcp-Session-Id`, or depend on GET/DELETE/resumable notifications.
- Before v1.1 rollout, run `pnpm verify:v1.1`, Buf breaking against `v1.0.0-rc.1`, and the
  three-image Compose build. Archive conformance, capacity, SBOM and image JSON as evidence.
- Size `DATABASE_POOL_MAX` for replicas and probes. The capacity gate proves a max-one pool can
  make SQL progress during a slow Adapter RPC; rising pool waiters still require investigation.

## Incident procedures

For PostgreSQL failure, keep replicas out of readiness, restore connectivity or
the entire consistent backup, and verify migration checksums before admitting
traffic. For Adapter failure, do not delete Runtime tasks: transient reconcile
retains the last fact and retries; a proven `NOT_FOUND` becomes explicit failure.
For response-loss or process crash, restart normally and inspect recovery and
Adapter RPC metrics. Do not manually mark a Task completed unless both the
resource authority and database history have been independently reconciled.

For an Outbox backlog, repair the publisher/consumer and redeliver unpublished
rows; event ids and observation revisions are idempotency keys. For suspected
credential exposure, rotate JWT/database/mTLS secrets, restart replicas, and
audit authentication failures without logging the secret values.

For an OTLP Collector outage, repair or reroute the Collector without draining Runtime traffic.
Exporter queues and timeouts are bounded and drops do not change readiness or durable state.
Confirm recovery with `adapter_rpc_total`, `provider_error_total`, Collector receiver metrics,
and a fresh non-sensitive test event; do not weaken the sanitizer or add raw payload logging.

启用 Provider 遥测入口后，如 `/health/ready`（就绪接口）中的 `providerTelemetryIngress` 失败，应依次检查 `PROVIDER_TELEMETRY_HOST`/`PORT`（监听地址/端口）、三个 TLS 文件、服务端证书用途，以及客户端证书 `CN`（通用名称）是否等于 `PROVIDER_ID` 和 Manifest Provider 标识符。入口初始化失败时不要绕过 mTLS 或临时改用明文；修复 Secret/端口后滚动重启。事件已被接受但 Collector 不可用时，检查 `telemetry_audit_backlog`（审计积压量）和 `telemetry_audit_oldest_age_seconds`（最老积压秒数），无需将 Runtime 摘除流量。

## Rollback

Application rollback is allowed only to a version documented as compatible with
all applied migrations and the Adapter protocol. SQL migrations are append-only;
never delete a migration row or edit an applied file. Restore a pre-upgrade
backup in an isolated database when a schema rollback is unavoidable.
