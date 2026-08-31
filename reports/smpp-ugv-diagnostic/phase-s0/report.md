# Phase S0 Report — Source lock and baseline audit

## Source

- Goal: `sdar-smpp-mcp-tasks-ugv-diagnostic-support-v0.1`
- Base: `main@76b1a8a5307554e11038b0548717aa7fea5c4488`
- Work branch: `codex/smpp-mcp-tasks-ugv-diagnostic-support-v0.1`
- Merge base: `76b1a8a5307554e11038b0548717aa7fea5c4488`
- Task package verification: `PACKAGE_OK`

## Baseline authority inventory

- `TaskEngine.callOperation()` uses `IdempotencyRepository.execute()` and the repository-supplied stable task ID.
- Asynchronous execution persists `admission_intent` before calling `startOperation()`.
- Adapter start errors and invalid/missing accepted responses mark the admission `UNCERTAIN`.
- Existing/recovered admissions call exact `reconcileExecution(taskId, operationName, argumentHash, scope)` before any subsequent physical start.
- `validateAdapterSnapshotIdentity()` checks task, external execution, operation, argument, authorization, execution-mode and simulation identity; conflicts are recorded durably.
- `ProviderOpsOutboxSink` publishes the product Outbox before deriving best-effort ProviderOps lifecycle records.
- `ProviderTelemetryIngress` validates provider, task, external execution and operation identity before transactionally capturing ProviderOps delivery.
- The UGV adapter is already a standard Adapter Protocol/Provider Telemetry implementation and contains no Benchmark-facing endpoint.

## Baseline gaps confirmed

- No Runtime-authoritative standard task/execution binding projection.
- Admission uncertainty is durable but lacks a standard uncertainty document and committed ProviderOps semantic fact.
- Reconciliation outcomes are not exposed as a standard durable audit/read model.
- No generic after-commit response-loss transport seam.
- Business terminal axes are not normalized into the required four-axis document.
- Provider observations are accepted, but evidence references and mission relations are not normalized as frozen logical contracts.
- Runtime has no provider-independent `/v1/diagnostics/capabilities` surface.

## Tests

Isolated PostgreSQL: `postgres:17-alpine`, loopback port `55432`, temporary in-memory data volume.

| Check | Result |
|---|---:|
| `pnpm protocol:check` | PASS — 11 schemas, 74 frozen cases, 44 lock files |
| `pnpm test:runtime:closure` | PASS — 7 files, 29 tests |
| `pnpm test:runtime:followup` | PASS — 9 files, 29 tests |
| focused task/ProviderTelemetry/ProviderOps integration | PASS — 4 files, 145 tests |

Focused integration command covered `task-lifecycle-postgres`, `provider-telemetry-ingress-postgres`, `telemetry-commit-boundary-postgres`, and `telemetry-committed-lifecycle`.

## Boundary evidence

- No Benchmark repository was read-write mounted or modified.
- No Provider-direct Benchmark API is present in the audited paths.
- No Domain Projection or direct ClickHouse write is used.
- Frozen MCP/SEP-2663 and Adapter contracts passed their baseline lock checks.

## Remaining risks/blockers

- ProviderOps 1.1.0 consumer compatibility for uncertainty, reconciliation and exact mission relation must be checked read-only at S10/S13.
- Mission identity must remain unresolved unless Provider Telemetry supplies an authoritative standardized identity.

## Exit gate

PASS
