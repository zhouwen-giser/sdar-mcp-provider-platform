# Goal 2 Phase P1 — RuntimeDeployment gate report

- Phase: `P1 RuntimeDeployment`
- Status: `PASSED`
- Closing task: `G2-P1-B08`
- Git commit: this report commit
- Tasks passed: `G2-P1-B01` through `G2-P1-B08`
- External environment gaps: none for P1; local PostgreSQL 17 supplied the database-backed evidence
- Decisions and ADRs: ADR-0001, ADR-0002, ADR-0005
- Next phase readiness: P1 dependants may become READY only through `taskctl`

## Scope delivered

P1 delivers the RuntimeDeployment aggregate and complete desired/observed lifecycle, stable
RuntimeProcess identity and health projection, append-only PMS persistence, revision-fenced
repositories, desired-intent application use cases, Provider-scoped management and process query
APIs, controlled opaque log references, JSON Schema contracts, and the P1 regression gate.

The API never manages PM2 directly. Create/start/stop/restart/scale/reconcile requests only update
desired intent and enqueue reconcile work. RuntimeProcess status uses the domain health matrix:
PM2 `online` alone is not `ACTIVE`, and stale heartbeat evaluation remains explicit.

## Task ledger

| Task | Result | Commit | Primary evidence |
| --- | --- | --- | --- |
| `G2-P1-B01` | PASSED | `2282a55` | aggregate, lifecycle, CAS and idempotency tests |
| `G2-P1-B02` | PASSED | `7d72bff` | RuntimeProcess projection and observed-health matrix |
| `G2-P1-B03` | PASSED | `9e188d3` | append-only PMS migration; PostgreSQL migration tests |
| `G2-P1-B04` | PASSED | `718d436` | PostgreSQL repositories, CAS and transactional UoW |
| `G2-P1-B05` | PASSED | `88e4dd5` | desired-intent application commands, jobs and audit |
| `G2-P1-B06` | PASSED | `43fcfaa` | management API, operation IDs and OpenAPI |
| `G2-P1-B07` | PASSED | `b69b00e` | process status/stale/log-reference API |
| `G2-P1-B08` | PASSED | this report commit | Schema and P1 contract/property gate |

## Gate results

| Command | Result | Evidence or limitation |
| --- | --- | --- |
| `pnpm test:runtime-deployment` | PASS | 5 files, 42 tests |
| `pnpm build` | PASS | protocol generation and TypeScript production build |
| P1 state-machine property contract | PASS | all 144 current/target status pairs evaluated |
| P1 API/domain/repository contract | PASS | five actions, management security, Provider-scoped SQL reads |
| RuntimeDeployment JSON Schema | PASS | domain snapshot/process projection accepted; invalid state/replica and extra secret rejected |
| PMS migration verification from B03 | PASS | real PostgreSQL; 1 file, 6 tests |
| PMS repository verification from B04 | PASS | real PostgreSQL; 4 files, 20 tests |
| PMS API verification from B07 | PASS | real PostgreSQL dependency available; 7 files, 44 tests |

## Security and authority boundary checks

- PMS API receives no Runtime Task, Command, Scheduler, Recovery, Outbox, environment-variable, or
  Secret payload.
- Runtime process logs expose only an opaque `runtime-process:<instanceId>` reference and a fixed
  future tail endpoint. No route accepts a filesystem path or returns file content.
- Every deployment/process read requires Provider scope. Repository contract tests assert that
  Provider ID remains in SQL predicates.
- Writes require the management administrator role and actor-bound audit context; reads require
  reader or administrator.
- Replica validation remains fail-closed at zero or one for V0.1.
- P1 contains no PM2, database provisioning, migration orchestration, or process execution adapter.

## Qualification limits

The domain, Schema, API, and state-machine results are unit/component contract evidence. The PMS
migration and repository results use a real local PostgreSQL 17 instance and are controlled
integration evidence. P1 does not claim PM2 qualification, real Provider resource qualification,
Catalog/Registry certification, or system interoperability; those belong to later phases.

## Residual risks

- The log `tailEndpoint` is intentionally a reserved reference only. A later task must implement
  any tail transport through an allowlisted adapter without accepting arbitrary paths.
- Process liveness/readiness/registration/catalog observations are persisted and projected here;
  later reconciliation tasks remain responsible for collecting those signals.
- V0.1 rejects replicas above one until a stable gateway exists.

## Exit conclusion

All eight P1 task cards and both mandatory closing commands pass. RuntimeDeployment desired and
observed revisions are fenced across domain, persistence, application, API, Schema, and tests.
P1 is closed without infrastructure authority expansion; the exact next task remains controlled by
the dependency graph and `taskctl`.
