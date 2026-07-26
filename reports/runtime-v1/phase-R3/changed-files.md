# Phase R3 Changed Files

- `migrations/002_task_lifecycle.sql`: lifecycle, observation, input, idempotency, outbox, lease schema.
- `packages/domain`: internal/task/MCP state model and Adapter mapping.
- `packages/task-engine`: admission-first call/get lifecycle orchestration.
- `packages/persistence-postgres`: task repository, terminal CAS, transactional observation/outbox.
- `packages/mcp-protocol`, `apps/runtime`, `packages/adapter-protocol`: MCP task routing and Adapter execution context.
- `examples/mock-adapter-typescript`: durable `task_required` and dual-mode `task_capable` operations.
- `tests/unit`, `tests/integration`: mapping, lifecycle, restart, isolation, MCP and crash-window evidence.
- `docs/database`, `docs/protocol`, `docs/implementation`, traceability matrices: R3 contracts/evidence.
- `Dockerfile`, `vitest.config.ts`, workspace lockfile: new packages and serialized database integration.

Proto changes: none. Migration changes: append-only `002_task_lifecycle.sql` added; no published migration modified.
