# UGV diagnostic SMPP handoff v1

This immutable handoff lets an upstream evaluator consume standard SMPP and Telemetry facts without direct Provider access. It declares capabilities and authority boundaries only; it does not claim a Benchmark, Goal or evaluation verdict.

The legacy Provider-direct assumptions are superseded as follows:

| Provider-direct capability | SMPP replacement                                        |
| -------------------------- | ------------------------------------------------------- |
| `PV-IDENTITY-CLOSURE`      | `SMPP-TASK-IDENTITY-CLOSURE`, `SMPP-MISSION-RELATION`   |
| `PV-IDEMPOTENCY-QUERY`     | `SMPP-TASK-IDEMPOTENCY`                                 |
| `PV-DROP-AFTER-COMMIT`     | `SMPP-DISPATCH-UNCERTAINTY`, `SMPP-TASK-RECONCILIATION` |
| `PV-POSITION-SPEED`        | `SMPP-PROVIDER-EVIDENCE`                                |
| `PV-BUSINESS-TERMINAL`     | `SMPP-BUSINESS-TERMINAL`                                |

Task → Execution and Execution → DeviceMission relationships must come from the qualified Telemetry authority rules. Correlation hints, unresolved Mission facts and conflicts are never relation authority.
