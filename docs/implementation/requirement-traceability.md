# Runtime V1.0 Requirement Traceability

This is the maintained implementation matrix. Status values are `planned`,
`in progress`, and `verified`; a row becomes verified only when its complete
named gate has produced real evidence.

| Requirement           | Authority                          | Phase(s)       | Implementation paths                                           | Verification paths / gates                                      | Status                                   |
| --------------------- | ---------------------------------- | -------------- | -------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------- |
| RQ-MCP                | Profile 5-8, 21-24, 33             | R2, R3, R6     | `packages/mcp-protocol`, `apps/runtime`                        | MCP Client catalog/call/task control integration                | verified through R6 CI                   |
| RQ-REG                | Runtime 4; Adapter 5               | R2             | `packages/operation-registry`, `packages/persistence-postgres` | registry unit/security and snapshot integration tests           | verified in R2 CI                        |
| RQ-ADAPTER            | Adapter 4-15                       | R1-R8, H4, H8  | Proto, identity gateway and durable TypeScript/Python examples | Proto contract and dual-language 17-case Adapter conformance    | rc.2 H8 CI pending                       |
| RQ-STATE              | Profile 5, 17, 24; Runtime 5       | R3, R6         | `packages/domain`, `packages/task-engine`                      | transition matrix plus PostgreSQL terminal-CAS tests            | verified through R6 CI                   |
| RQ-ADMISSION          | Runtime 6, 8, 10                   | R3, R4, R7     | `packages/task-engine`, `packages/persistence-postgres`        | real PG/gRPC commit-failure and response-loss tests             | verified through R7 CI                   |
| RQ-AVAIL              | Profile 8-11                       | R4             | domain validation, Task Engine, MCP and Adapter gateway        | four-state/window/timeout unit + PG/gRPC/MCP integration        | verified in R4 CI                        |
| RQ-TIME               | Profile 12-15                      | R5             | domain timing, PostgreSQL claims, DurableScheduler             | fake-clock scheduled/window/deadline/multi-worker integration   | verified in R5 CI                        |
| RQ-CANCEL             | Profile 23, 36; Adapter 12         | R6, R7         | task control service, command journal and Adapter gateway      | Ack/STOPPING/safe-stop/natural-race/deadline/replay tests       | verified through R7 CI                   |
| RQ-INPUT              | Profile 22; Adapter 11             | R6             | input repository and task control service                      | stable-key, multi-round, duplicate and unknown-key tests        | verified in R6 CI                        |
| RQ-IDEMP              | Profile 29; Adapter 8, 15          | R3-R5, H7      | durable claim lease, short transactions, stable task identity  | duplicate/conflict, pool pressure, abandonment/recovery         | verified through H7 CI                   |
| RQ-OBS                | Profile 17-18, 32                  | R6             | observation/outbox repositories and publisher                  | revision duplicate/jump/order and delivery tests                | verified in R6 CI                        |
| RQ-RECOVERY           | Profile 30; Runtime 10             | R3, R4, R5, R7 | admission/task/command RecoveryManager and scheduler           | response-loss plus Runtime/Adapter/DB fault suites              | verified in R7 CI                        |
| RQ-PERSIST            | Runtime 8; task package RQ-PERSIST | R2-R7, H1-H8   | append-only 001-012 migrations and PostgreSQL repositories     | full-state 001-006 upgrade plus restart/recovery tests          | rc.2 H8 CI pending                       |
| RQ-SEC                | Profile 20, 34-35; Adapter 16      | R2, R7         | auth, execution context, limits, mTLS, redaction               | JWT/trusted identity, cross-context, injection and log tests    | verified in R7 CI                        |
| RQ-OBSERVABILITY      | Runtime 12                         | R1, R7, R9     | `packages/observability`, Runtime health/metrics               | health/readiness, metrics, trace and redaction tests            | verified through R7; R9 runbook complete |
| RQ-CONFORMANCE        | Profile 37-39; Adapter 19-21       | R8, R9, H8     | Testkit, schema and both durable reference Adapters            | Adapter scope passed; Runtime partial; resource safety external | rc.2 H8 CI pending                       |
| Deployment/operations | Task package R1, R9                | R1, R9         | `Dockerfile`, Compose, `deploy`, operations docs               | image build, Compose health, manifest rendering                 | verified in R9 CI                        |
| Release integrity     | Task package DoD                   | R9             | root scripts, CI, changelog, reports, SBOM                     | `pnpm verify`, audit/SBOM, phase SHA/push evidence              | verified; Ready PR and RC ref            |

## Mandatory scenario ownership

| Scenario family                                        | Primary phase | Required evidence                          |
| ------------------------------------------------------ | ------------- | ------------------------------------------ |
| Capability negotiation, Tool count and execution modes | R2            | MCP contract/E2E                           |
| Accepted/rejected creation and crash windows           | R3-R4         | PostgreSQL + gRPC integration/recovery     |
| Standard/substates, business/technical terminals       | R3, R6        | domain and E2E state matrices              |
| Immediate/scheduled/deadline timing                    | R5            | deterministic Clock + database claim tests |
| Cancel/update/pause/resume                             | R6            | control race and Adapter contract tests    |
| Runtime/Adapter/database/event/outbox faults           | R7            | recovery/fault suite                       |
| Authorization, mode, limits, redaction and mTLS        | R7            | security suite                             |
| TypeScript/Python parity                               | R8, H8        | identical 17-case scoped Adapter reports   |
| Container/deployment/upgrade/audit/capacity            | R9            | release verification report                |

## R0 evidence

- Specifications and the real repository were read in full.
- No AGENTS/PLANS/CI/code/migration/test assets existed to inherit.
- Empty-project `pnpm test` and `pnpm build` failures are recorded in the
  repository assessment.
- All task-package RQ groups and Definition-of-Done delivery areas now have an
  implementation phase, concrete path, and verification gate.
