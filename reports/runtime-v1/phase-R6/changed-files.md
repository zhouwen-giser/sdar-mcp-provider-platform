# Phase R6 Changed Files

- `migrations/005_task_controls.sql`: stable input metadata, command sequence, durable command journal and pending index.
- Adapter protocol gateway/types/Struct conversion: update, pause, resume and typed input requests.
- PostgreSQL Task/Outbox repositories: transactional commands, stable inputs, observations and publication attempts.
- Task Engine/Scheduler: official result/cancel, Ack-only updates and controls, safe user/deadline stop races.
- MCP boundary: official task result/cancel and Profile update/pause/resume handlers.
- TypeScript Mock Adapter and PostgreSQL integration tests: multi-round input, duplicate controls, natural completion, deadline and observation/outbox scenarios.
- Migration, protocol, plan, traceability and Phase evidence documentation.

Proto changes: none; the R1 Adapter protocol already defined all conditional control RPCs. Migration changes: append-only `005_task_controls.sql`; earlier migrations unchanged.
