# Phase R6 Test Results

| Command                        | Result    | Evidence                                                                           |
| ------------------------------ | --------- | ---------------------------------------------------------------------------------- |
| format/lint/typecheck/build    | PASS      | strict local gates                                                                 |
| `pnpm test:unit`               | PASS      | 6 files, 22 tests                                                                  |
| PostgreSQL control integration | PASS (CI) | run `29497170920`: stable/multi-round input, cancel/deadline race, controls/outbox |
| Official MCP task controls     | PASS (CI) | run `29497170920`: result, update and cancel through SDK client                    |
| Compose smoke                  | PASS (CI) | run `29497170920`: Runtime readiness and both Adapter images                       |

Local Docker/PostgreSQL cannot run because this environment cannot access the Docker socket. GitHub Actions remains the authoritative database and Compose gate.

The first run exposed a test reset omission for the new `task_command` table. Fix `e619a1d` added it to both empty-database reset lists; the complete rerun passed.
