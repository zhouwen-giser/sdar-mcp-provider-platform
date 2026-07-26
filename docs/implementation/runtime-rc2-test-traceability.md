# Runtime rc.2 mandatory test traceability

This matrix maps the frozen T-001 through T-050 scenarios to executable repository evidence. A
phase report supplies the commit and remote run; the final T-050 row becomes PASS only after the
report-containing release Head passes every push and PR workflow. No row is N/A or skipped.

| ID    | Scenario                               | Executable evidence                                                 | Status |
| ----- | -------------------------------------- | ------------------------------------------------------------------- | ------ |
| T-001 | cancel transport failure               | `task-lifecycle-postgres`, `runtime-recovery-postgres`              | PASS   |
| T-002 | cancel retryable rejection             | `task-lifecycle-postgres`, `runtime-recovery-postgres`              | PASS   |
| T-003 | cancel permanent rejection             | `task-lifecycle-postgres`                                           | PASS   |
| T-004 | deadline stop transport failure        | `task-lifecycle-postgres`, `runtime-recovery-postgres`              | PASS   |
| T-005 | mandatory safe-stop permanent failure  | `task-lifecycle-postgres`, security suite                           | PASS   |
| T-006 | concurrent duplicate cancel            | `task-lifecycle-postgres` PostgreSQL concurrency                    | PASS   |
| T-007 | immediate queued past tolerance        | `task-lifecycle-postgres` fake-clock compensation                   | PASS   |
| T-008 | immediate response after latest start  | `task-lifecycle-postgres` late-response compensation                | PASS   |
| T-009 | immediate running within tolerance     | `task-lifecycle-postgres` actual-start anchor                       | PASS   |
| T-010 | scheduled retry then success           | `task-lifecycle-postgres` scheduler retry                           | PASS   |
| T-011 | scheduled retry until window closes    | `task-lifecycle-postgres` bounded window                            | PASS   |
| T-012 | scheduled permanent rejection          | `task-lifecycle-postgres` rejection observation                     | PASS   |
| T-013 | multi-runtime scheduled attempt        | `task-lifecycle-postgres` dual-worker claim                         | PASS   |
| T-014 | terminal transition Observation/Outbox | `task-lifecycle-postgres` atomic transition                         | PASS   |
| T-015 | Runtime/Adapter revisions separated    | `task-lifecycle-postgres`, rc.2 red guards                          | PASS   |
| T-016 | complete observation payload           | `task-lifecycle-postgres`                                           | PASS   |
| T-017 | removed Manifest operation recovery    | `operation-snapshot-postgres`, recovery suite                       | PASS   |
| T-018 | changed Manifest schema recovery       | `operation-snapshot-postgres`, recovery suite                       | PASS   |
| T-019 | Snapshot task identity mismatch        | security and lifecycle integration                                  | PASS   |
| T-020 | external execution identity mismatch   | security and lifecycle integration                                  | PASS   |
| T-021 | command sequence mismatch              | lifecycle integration and both conformance reports                  | PASS   |
| T-022 | Reconcile context/hash mismatch        | recovery and security suites                                        | PASS   |
| T-023 | active finite-TTL retention            | `task-lifecycle-postgres` TTL cleaner                               | PASS   |
| T-024 | terminal Task before TTL               | `task-lifecycle-postgres` authorized reads                          | PASS   |
| T-025 | terminal Task after TTL                | lifecycle and MCP wire integration                                  | PASS   |
| T-026 | multi-runtime TTL cleanup              | `task-lifecycle-postgres` dual-cleaner claim                        | PASS   |
| T-027 | Adapter down during tasks/get          | `task-lifecycle-postgres` degraded read                             | PASS   |
| T-028 | identity error during tasks/get        | `task-lifecycle-postgres`, security suite                           | PASS   |
| T-029 | durable cancel Ack latency             | Runtime stack E2E and lifecycle integration                         | PASS   |
| T-030 | dispatcher restart                     | `runtime-recovery-postgres`                                         | PASS   |
| T-031 | valid output schema                    | lifecycle integration                                               | PASS   |
| T-032 | invalid success output                 | lifecycle and MCP wire integration                                  | PASS   |
| T-033 | partial result validation              | lifecycle integration                                               | PASS   |
| T-034 | synchronous technical wire failure     | `mcp-wire-contract-postgres`                                        | PASS   |
| T-035 | asynchronous technical wire failure    | `mcp-wire-contract-postgres`                                        | PASS   |
| T-036 | business failure wire channel          | `mcp-wire-contract-postgres`                                        | PASS   |
| T-037 | unknown Tool error                     | `mcp-wire-contract-postgres`                                        | PASS   |
| T-038 | hidden/expired Task error              | `mcp-wire-contract-postgres`, lifecycle integration                 | PASS   |
| T-039 | unsupported capability error           | `mcp-wire-contract-postgres`                                        | PASS   |
| T-040 | official ttl/poll compatibility        | `mcp-wire-contract-postgres`, official client                       | PASS   |
| T-041 | Adapter outage readiness               | Runtime E2E component health                                        | PASS   |
| T-042 | Adapter readiness recovery             | Runtime E2E component health                                        | PASS   |
| T-043 | bounded rate-limit state               | `rate-limiter` unit tests                                           | PASS   |
| T-044 | slow Adapter under pool pressure       | H7 integration plus rc.2 real Adapter capacity/pool-one publication | PASS   |
| T-045 | reproducible production image          | `container:check`, `reports/image/runtime-v1-rc2.json`              | PASS   |
| T-046 | stateless repeated Streamable HTTP     | Runtime stack E2E with official clients                             | PASS   |
| T-047 | rc.1 data forward migration            | `rc1-forward-upgrade-postgres` 001-006 -> 012, repeated migration   | PASS   |
| T-048 | TypeScript expanded conformance        | `reports/conformance/typescript.json`, 17/17                        | PASS   |
| T-049 | Python expanded conformance            | `reports/conformance/python.json`, 17/17                            | PASS   |
| T-050 | final no-regression release gate       | `pnpm verify:rc2`, Buf rc.1 breaking, three-image Compose           | PASS   |

## Evidence grouping

H1 through H8 phase reports record their implementation and report-containing remote run ids.
H9 records the final exact counts, release run ids, PR state and tag decision in
`reports/runtime-v1-rc2/final-delivery-report.md`.
