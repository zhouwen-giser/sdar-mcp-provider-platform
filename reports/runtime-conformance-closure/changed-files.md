# Changed Files

This ledger is maintained from the execution-time base `c5594e4cb59f77421a8aa107defa6054ca61a768`.

## Baseline and planning

- `docs/implementation/runtime-conformance-closure-exec-plan.md`
- `reports/runtime-conformance-closure/baseline.json`
- `reports/runtime-conformance-closure/failing-cases.md`
- `reports/runtime-conformance-closure/changed-files.md`
- `reports/runtime-conformance-closure/upstream-merges.md`

## H0 red tests

- `package.json` (closure-only test scripts; existing Provider scripts retained)
- `tests/runtime-conformance-closure/mrtr-inbox.test.ts`
- `packages/task-engine/src/command-dispatcher.ts`

## H2 frozen error mapping

- `packages/mcp-protocol/src/sep2663/error-mapper.ts`
- `packages/mcp-protocol/src/sep2663/handler.ts`
- `packages/mcp-protocol/src/index.ts`

## H3-H5 notification identity and projection

- `packages/mcp-protocol/src/sep2663/notifications.ts`
- `packages/mcp-protocol/src/sep2663/handler.ts`
- `packages/task-engine/src/detailed-task.ts`
- `tests/runtime-conformance-closure/notification-identity.test.ts`
- `tests/protocol-conformance/notifications.test.ts`
- `tests/e2e/runtime-stack.test.ts`
- `tests/runtime-conformance-closure/mrtr-recovery.test.ts`
- `tests/runtime-conformance-closure/error-mapping.test.ts`
- `tests/runtime-conformance-closure/notification-identity.test.ts`
- `tests/runtime-conformance-closure/notification-capacity.test.ts`
- `tests/runtime-conformance-closure/notification-batch.test.ts`
- `tests/runtime-conformance-closure/notification-equality.test.ts`

## H1 durable MRTR acceptance

- `migrations/022_mrtr_response_inbox.sql`
- `packages/persistence-postgres/src/tasks.ts`
- `packages/task-engine/src/engine.ts`
- `tests/runtime-conformance-closure/mrtr-inbox.test.ts`

## H6-H7 notification capacity and observability

- `.env.example`
- `apps/runtime/src/config.ts`
- `apps/runtime/src/runtime.ts`
- `deploy/kubernetes/config-map.json`
- `docs/operations/configuration.md`
- `packages/mcp-protocol/src/sep2663/notifications.ts`
- `packages/persistence-postgres/src/tasks.ts`
- `packages/task-engine/src/engine.ts`
- `tests/runtime-conformance-closure/notification-batch.test.ts`
- `tests/runtime-conformance-closure/notification-capacity.test.ts`
- `tests/unit/config.test.ts`

## H8 conformance evidence

- `packages/conformance-testkit/src/runner.ts`
- `tests/e2e/runtime-stack.test.ts`
- Runtime PostgreSQL test cleanup and migration-count assertions under `tests/integration/**`
- `tests/recovery/runtime-recovery-postgres.test.ts`
- Runtime and frozen reports listed in the final delivery report

Protected Home Assistant Climate Provider application, tests, deployment, report, and report-generator paths remain zero-diff from `origin/main`.
