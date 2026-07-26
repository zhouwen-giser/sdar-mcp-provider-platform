# Phase R4 Changed Files

- `migrations/003_idempotency.sql`: append-only pending/complete durable idempotency evolution.
- `packages/domain/src/availability.ts`: Profile request/result types and contract validation.
- `packages/persistence-postgres/src/idempotency.ts`: cross-instance advisory-lock execution and stored outcomes.
- `packages/task-engine/src/engine.ts`: Availability, canonical hash, idempotent invocation and Reconcile recovery.
- `packages/adapter-protocol`: CheckAvailability/Reconcile gateway types and RPC calls.
- `packages/mcp-protocol`, `apps/runtime`: custom Profile method and idempotency metadata boundary.
- TypeScript Mock Adapter and unit/PostgreSQL/gRPC/MCP integration tests.
- Runtime protocol/database/traceability documents and Phase reports.

Proto changes: none; R1 contract already contained both RPCs. Migration changes: append-only `003_idempotency.sql`; published migrations unchanged.
