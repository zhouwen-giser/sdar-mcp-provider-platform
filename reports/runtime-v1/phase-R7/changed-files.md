# Phase R7 Changed Files

- `migrations/006_recovery_hardening.sql`: admission anchors, recovery audit fields and partial indexes.
- PostgreSQL Task repository and Task Engine RecoveryManager: scan, per-Task lock, Reconcile, pending command replay and explicit not-found failure.
- Runtime config/application: readiness gating, periodic recovery, mTLS, auth, rate/body/argument limits and metrics endpoint.
- MCP security boundary and Adapter gateway: trusted/JWT identity, correlation propagation and RPC metrics hook.
- Observability package: Prometheus registry and testable redacted logger.
- TypeScript Mock Adapter: idempotent command sequence Acks and response-loss injection.
- Unit/security/recovery tests, CI recovery gate, operations/protocol/database/traceability docs and Phase reports.

Proto changes: none. Migration changes: append-only `006_recovery_hardening.sql`; earlier migrations unchanged.
