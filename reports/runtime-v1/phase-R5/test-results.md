# Phase R5 Test Results

| Command                       | Result    | Evidence                                                                                                                            |
| ----------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| format/lint/typecheck/build   | PASS      | strict local gates                                                                                                                  |
| `pnpm test:unit`              | PASS      | 6 files, 22 tests including timing anchors/validation                                                                               |
| PostgreSQL timing integration | PASS (CI) | run `29495711506`: fake Clock, no early start, two workers/one claim, restart-shaped worker, missed window, deadline STOPPING/proof |
| MCP scheduled metadata        | PASS (CI) | run `29495711506`: official client, immediate durable handle, zero early Adapter calls                                              |
| Compose smoke                 | PASS (CI) | run `29495711506`, Runtime readiness and both Adapter images                                                                        |

No timing test sleeps. The real PostgreSQL suite remains mandatory in GitHub Actions.
