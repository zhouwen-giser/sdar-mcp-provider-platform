# Phase R5 Changed Files

- `migrations/004_durable_timing.sql`: external binding nullability, not-before/claim fields and due indexes.
- `packages/domain/src/timing.ts`, task domain: Clock, validation, anchors and persisted timing fields.
- `packages/persistence-postgres/src/tasks.ts`: scheduled publication, claims, start/reject/window/deadline transitions.
- `packages/task-engine/src/scheduler.ts`, engine: explicit durable ticks and deadline proof mapping.
- Adapter gateway/TypeScript Mock Adapter: timing transport and RequestCancel proof path.
- MCP boundary/Runtime config: timing metadata and bounded scheduler polling.
- Unit and real PostgreSQL/gRPC/MCP fake-clock integration tests.
- Migration/protocol/traceability documentation and Phase reports.

Proto changes: none. Migration changes: append-only `004_durable_timing.sql`; earlier migrations unchanged.
