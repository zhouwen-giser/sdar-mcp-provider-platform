# Changelog

## 1.1.0 - 2026-07-18

- Added optional OpenTelemetry traces, stable Provider Ops events and low-cardinality metrics
  while preserving the existing Prometheus endpoint.
- Derived lifecycle audit events from committed Task/Outbox facts and command events from the
  Durable Command Dispatcher; added payload-free Adapter RPC spans and scheduler/recovery/TTL
  operational events.
- Added deterministic UUIDv5 record ids, RFC 8785/SHA-256 record hashes, bounded exporter queues,
  failure isolation and recursive privacy sanitization.
- Kept Task state, command, scheduling, safe-stop, recovery, readiness, Adapter protocol and
  database migration semantics unchanged. Published rc.2/rc.3 artifacts remain immutable.

## 1.0.0-rc.3 - 2026-07-17

- Reliability hardening for multi-instance lease ownership, start-window correctness,
  production safety and complete Runtime worker lifecycles.
- Added command lease renewal and two-replica dispatch safety, a unified bound-execution start
  watchdog, STOPPING protection, fail-closed production configuration and Manifest drift health.
- Completed Outbox publication, bounded Observation pagination, fair recovery backoff and the
  sanitized Adapter result contract; appended migrations 013 through 015.
- No new product features; v1.0.0-rc.2 migrations and release evidence remain immutable.

## 1.0.0-rc.2 - 2026-07-17

- Hardened durable commands, timing windows, observation revisions, immutable
  operation snapshots, Adapter identity, TTL/read freshness, MCP wire contracts,
  readiness, bounded rate state and idempotency claim leases.
- Added an actual 001-006 rc.1 full-state forward-upgrade fixture and expanded
  17-case-per-language Adapter protocol conformance with explicit partial/not-claimed
  Runtime Profile and resource-safety scopes.
- Fixed committed-Task publication under a one-connection pool by reusing the transaction client
  for post-commit visibility reads; no repository path re-borrows the Pool while retaining that
  client.
- Expanded the release capacity gate with slow-Adapter database progress, durable dispatcher,
  scheduled/watchdog, 100/500/1000 recovery-candidate, Observation/Outbox growth and image
  evidence.
- Fixed first-command UPDATE/PAUSE/RESUME handling to avoid false COMMAND_IN_PROGRESS,
  returning durable PENDING receipts on first request and idempotent resolved results for repeated
  terminal command states; removed legacy command replay semantics from Recovery in favor of
  Dispatcher-only command execution.
- Made outbox published-event retention configurable via OUTBOX_PUBLISHED_RETENTION_MS and
  wired it through runtime config, compose, Kubernetes, and config validation; added retention
  behavior test coverage.

## 1.0.0-rc.1 - 2026-07-16

- Added independently deployable Node.js 22/TypeScript Runtime with MCP
  Streamable HTTP, health/readiness and Prometheus metrics.
- Added PostgreSQL authority, append-only migrations, immutable operation
  snapshots, durable SEP-2663/SDAR task lifecycle, scheduling, safe cancellation,
  input, pause/resume, monotonic observations and transactional Outbox.
- Added versioned gRPC/Protobuf Adapter protocol, recovery/Reconcile, durable
  idempotency and authorization/execution-mode isolation with mTLS/JWT options.
- Added TypeScript and Python reference Adapters and an identical 10-case grouped
  conformance baseline. This baseline did not constitute complete P0-P4 coverage.
- Added multi-stage non-root images, one-command Compose, Kubernetes manifests,
  upgrade/runbook/config/API/Adapter documentation, SBOM, dependency audit,
  security/recovery/E2E suites and capacity baseline.

This is a release candidate. Adapter protocol v1 and database migrations are
forward-additive; production rollout requires resource-specific conformance and
capacity testing.
