# Phase R7 Test Results

| Command                     | Result    | Evidence                                                                                |
| --------------------------- | --------- | --------------------------------------------------------------------------------------- |
| format/lint/typecheck/build | PASS      | strict local gates                                                                      |
| `pnpm test:unit`            | PASS      | 6 files, 24 tests including config/body limits/readiness                                |
| `pnpm test:security`        | PASS      | 2 files, 6 tests: JWT/trusted identity, JSON limits, redaction, metrics                 |
| `pnpm test:recovery`        | PASS (CI) | run `29498655990`: response loss, command replay, restart, DB fault, readiness/security |
| Compose smoke               | PASS (CI) | run `29498655990`: Runtime startup recovery/readiness and images                        |

Local Docker/PostgreSQL is unavailable because this environment cannot access the Docker socket. GitHub Actions is the authoritative recovery and Compose gate.

The first recovery run exposed one ambiguous fixture query after joining two tables with `arguments`; fix `e5736f7` qualified the durable Task column and the complete rerun passed.
