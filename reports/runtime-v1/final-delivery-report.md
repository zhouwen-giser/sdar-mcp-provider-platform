# SDAR MCP Tasks Runtime V1.0 Final Delivery Report

Release candidate: `v1.0.0-rc.1`  
Branch: `feature/mcp-tasks-provider-runtime-v1`  
Ready PR: [#1](https://github.com/zhouwen-giser/sdar-mcp-tasks-provider-runtime/pull/1)  
Authoritative release gate: GitHub Actions `29501239305`

## 1. Definition of Done

| Definition of Done item                                | Result | Evidence                                                                                                            |
| ------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------- |
| Independently deployable Streamable HTTP Runtime       | PASS   | non-root Runtime image, `/mcp`, Compose and Kubernetes                                                              |
| Profile/Adapter MUST code and test mapping             | PASS   | maintained requirement matrices and P0-P4 reports                                                                   |
| Finite Manifest-derived Tools, no instance Tools       | PASS   | registry/MCP catalog integration and security tests                                                                 |
| synchronous/task_capable/task_required                 | PASS   | MCP/integration/conformance suites                                                                                  |
| Persisted and immediately queryable Task before return | PASS   | PostgreSQL lifecycle/crash-window tests                                                                             |
| Four-state Availability and time windows               | PASS   | domain, gRPC and MCP tests                                                                                          |
| scheduled/startTolerance/maxElapsed with restart       | PASS   | fake-clock, claim and recovery tests                                                                                |
| input_required/update/cancel                           | PASS   | multi-round input and control tests                                                                                 |
| No premature cancel/deadline terminal                  | PASS   | Ack-only STOPPING/natural-completion/deadline tests                                                                 |
| Business versus technical result mapping               | PASS   | state matrix and terminal integration tests                                                                         |
| Idempotency/admission crash/Outbox/revision            | PASS   | concurrent PostgreSQL, Reconcile and delivery tests                                                                 |
| Runtime/Adapter/database recovery                      | PASS   | mandatory recovery suite on PostgreSQL 17                                                                           |
| Authorization and execution-mode isolation             | PASS   | trusted/JWT/cross-context security suite                                                                            |
| TypeScript and Python parity                           | PASS   | 10 P0-P4 cases per language, both JSON reports passed                                                               |
| One-command Compose example                            | PASS   | both images, stack readiness and cleanup in CI                                                                      |
| Independent Phase commits/reports/pushes               | PASS   | R0-R9 SHA table and per-Phase directories                                                                           |
| Complete `pnpm verify`; no skipped/TODO fallback       | PASS   | Actions `29501239305`; repository scan found none                                                                   |
| Docs/Migration/Proto/deploy/operations/upgrade         | PASS   | release documentation and checks listed below                                                                       |
| Draft PR Ready and RC ref                              | PASS   | PR #1 `draft=false`; non-overwriting `v1.0.0-rc.1` release ref targets this report-containing commit after final CI |

## 2. Actual architecture

```text
MCP client
  -> Fastify / official MCP Streamable HTTP boundary
  -> Manifest registry + Task Engine
       -> PostgreSQL authority
          (snapshot, intent, task, idempotency, timing, command,
           input, observation, outbox, lease, migration)
       -> versioned gRPC gateway -> resource Adapter -> resource system

Durable scheduler/recovery workers -> PostgreSQL claims/locks -> Adapter RPCs
Metrics/readiness/logging observe the same confirmed state.
```

`apps/runtime` is the independently deployable process. `packages/mcp-protocol`
contains official SDK types; domain/persistence remain SDK-independent.
`packages/task-engine` owns admission, lifecycle, timing, controls and recovery.
`packages/persistence-postgres` is the authority, while
`packages/adapter-protocol` owns generated gRPC/Protobuf bindings. The
TypeScript/Python examples demonstrate language-neutral Adapter conformance.

Differences from optional design variants are intentional: low-level SDK Server
handling preserves Adapter-owned JSON Schema; recovery polling is authoritative
while event streaming remains an optimization; production deployment uses
dependency-free Kubernetes JSON manifests instead of Helm; reference Adapters
use atomic JSON only as durable examples, while production Adapters bind to the
resource team's transactional store.

## 3. MCP, Profile and Adapter surfaces

HTTP: `POST /mcp`, `GET /health/live`, `GET /health/ready`, `GET /metrics`, and
operational `GET /internal/provider`.

MCP/Profile methods: initialization, `tools/list`, `tools/call`, `tasks/get`,
`tasks/result`, `tasks/cancel`, `io.sdar/taskExecution/checkAvailability`,
`tasks/update`, `tasks/pause`, and `tasks/resume`. Conditional Profile methods
are published only when the immutable operation capability allows them.

Adapter RPCs: `DescribeProvider`, `CheckAvailability`, `StartOperation`,
`GetExecution`, `RequestCancel`, `ReconcileExecution`, conditional
`UpdateExecution`, `PauseExecution`, `ResumeExecution`, and optional
`StreamExecutionEvents`/`ListResources`. Stable task/argument/context identity,
Snapshot revision and command sequence are part of the protocol contract.

## 4. Database migrations

1. `001_operation_snapshot.sql` — immutable Manifest operation snapshots.
2. `002_task_lifecycle.sql` — admission, Task, observation, Outbox, input,
   idempotency and lease foundation.
3. `003_idempotency.sql` — pending/complete records, stable taskId and context.
4. `004_durable_timing.sql` — scheduled visibility, claims and deadlines.
5. `005_task_controls.sql` — command sequences/journal and stable input metadata.
6. `006_recovery_hardening.sql` — recovery anchors, attempts and partial indexes.

The migrator uses an advisory lock and immutable SHA-256 checksums. Run
`DATABASE_URL=... pnpm db:migrate`; down migration is deliberately unsupported.

## 5. State, timing and result mapping

Nonterminal Adapter states map to MCP `working` with scheduled/queued/starting/
running/paused/resuming/stopping substates. `WAITING_INPUT` maps to
`input_required`. `SUCCEEDED`, `BUSINESS_FAILED` and `PARTIALLY_COMPLETED` map
to MCP `completed` with distinct structured outcomes; only
`TECHNICAL_FAILED` maps to `failed`, and safe-stop proof maps to `cancelled`.
Stored terminal state is irreversible and Adapter revisions must increase.

Scheduled Tasks are published before side effects, are never started early,
and use PostgreSQL claims across replicas. Start-window miss completes without
an Adapter call. Deadline first persists STOPPING/command intent, then waits for
Adapter proof. `maxElapsed=null` persists no deadline.

## 6. Security, consistency and recovery

Development, trusted-header and HS256 JWT authentication are implemented.
Authorization hash, execution mode and simulation id participate in every Task
predicate and Adapter identity. Production gRPC supports required mTLS.
Request/body/argument/schema bounds, rate limiting, endpoint immutability,
redaction, non-root containers and Kubernetes security contexts are enforced.

Admission intent precedes Adapter start. Published Task/initial observation/
Outbox commit atomically before taskId return. Idempotency and scheduler use
PostgreSQL locks/claims. Recovery scans uncertain admission, every nonterminal
Task and pending controls; NOT_FOUND, transient and conflict are distinct.
Outbox delivery is retryable and current Task query correctness is independent
of notification delivery.

## 7. Verification results

Actions `29501239305` executed the aggregated release gate on Node 22.23.1,
PostgreSQL 17 and Docker:

| Gate                                                         | Result                                        |
| ------------------------------------------------------------ | --------------------------------------------- |
| format, lint, strict typecheck, build, generated Proto drift | PASS                                          |
| dependency audit                                             | PASS, no known vulnerabilities                |
| CycloneDX SBOM                                               | PASS, 184 production components and lock hash |
| Kubernetes/container checks                                  | PASS, 8 manifests and Dockerfile/Compose      |
| unit                                                         | PASS, 24 tests                                |
| contract                                                     | PASS, 4 tests                                 |
| PostgreSQL integration                                       | PASS, 19 tests                                |
| recovery                                                     | PASS, 6 tests                                 |
| security                                                     | PASS, 6 tests                                 |
| independently initialized Runtime E2E                        | PASS, 2 tests                                 |
| TypeScript/Python P0-P4                                      | PASS, 10 cases each                           |
| Buf lint/compatibility                                       | PASS                                          |
| full Compose images/readiness/cleanup                        | PASS                                          |

Capacity evidence on a 4-logical-CPU Actions runner recorded 130.94 sequential
synchronous calls/s (p95 18.17 ms) and 19.49 durable create-plus-get lifecycles/s
(p95 217.68 ms). This is a regression baseline, not a production SLO.

## 8. Phase commits and GitHub evidence

| Phase | Primary commit | Acceptance/evidence             | Exit Actions                     |
| ----- | -------------- | ------------------------------- | -------------------------------- |
| R0    | `3b5cfbf`      | plan, assessment, traceability  | baseline phase                   |
| R1    | `5437a26`      | `16c88d5`                       | `29491300859`                    |
| R2    | `11ed06c`      | same                            | `29492195557`                    |
| R3    | `98cc5a0`      | `db21497`, `0fe3bcf`            | `29493388233`                    |
| R4    | `8c23d2d`      | `df5898e`, `b128f1b`            | `29494627933`                    |
| R5    | `28d35d9`      | `66f1956`                       | `29495711506`                    |
| R6    | `3b896ca`      | `e619a1d`, `66a55f6`            | `29497170920`                    |
| R7    | `bb5e941`      | `e5736f7`, `687949d`            | `29498655990`                    |
| R8    | `9d603a6`      | `18a28dd`, `380487c`, `da3f31c` | `29499994468`                    |
| R9    | `f2d38a7`      | `c398cc0`, final report commit  | `29501239305` plus final-head CI |

Every phase was pushed to `origin/feature/mcp-tasks-provider-runtime-v1`; no
force push or history rewrite occurred. PR #1 was created as Draft after the R9
gate and marked Ready only after both push and pull-request checks passed.

## 9. Deployment and local commands

```bash
corepack enable
pnpm install --frozen-lockfile
docker compose up --build --wait
curl --fail http://127.0.0.1:8080/health/ready

DATABASE_URL=postgresql://... pnpm db:migrate
TEST_DATABASE_URL=postgresql://... pnpm verify
pnpm deployment:check
```

Production manifests and replacement/secret prerequisites are in
`deploy/kubernetes/README.md`. Configuration, runbook, upgrade, Adapter, API,
state/reason, conformance and capacity documentation live under `docs/`.

## 10. Known limits, not hidden incompleteness

- The capacity result is sequential and resource-free; each Adapter owner must
  load-test its real side effects, concurrency and database topology.
- Kubernetes manifests require externally managed PostgreSQL, Adapter, ingress
  and secret objects; placeholder values cannot be deployed unchanged.
- Atomic JSON reference stores prove cross-process durability but are examples,
  not a production multi-process resource database.
- Event streaming and inventory RPCs are optional optimizations; correctness
  uses Get/Reconcile and finite operation manifests without them.
- The local workstation lacks Docker socket and Python pip access. No suite was
  skipped: GitHub Actions supplied the authoritative Docker/Python/PostgreSQL
  results and committed artifacts.

There are no remaining implementation TODOs, skipped tests, unexplained
compatibility branches, silent prerequisite fallbacks, or unresolved normative
conflicts for Runtime V1.0 RC.
