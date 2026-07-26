# v1.0.0-rc.3 Test Matrix

Date: 2026-07-17

Verified implementation commit: `19c818feadf6df7e16250279a14650e56c35ac24`

Aggregate command: `pnpm verify:rc3`

Result: PASS (287.4 seconds, PostgreSQL 17 and Docker Desktop)

| Gate                             | Result | Evidence                                                             |
| -------------------------------- | ------ | -------------------------------------------------------------------- |
| Formatting, lint, types          | PASS   | Prettier, ESLint and TypeScript completed without errors             |
| Production build and Proto drift | PASS   | pinned Docker fallback regenerated identical Proto output on Windows |
| Dependency audit and SBOM        | PASS   | no known vulnerabilities; 184 production components                  |
| Deployment and image             | PASS   | 8 Kubernetes manifests; two reproducible non-root images             |
| Unit                             | PASS   | 29 tests                                                             |
| Contract                         | PASS   | 4 tests                                                              |
| Integration                      | PASS   | 157 tests in 17 files                                                |
| Recovery                         | PASS   | 9 tests                                                              |
| Security                         | PASS   | 16 tests                                                             |
| E2E                              | PASS   | 4 tests                                                              |
| Adapter conformance              | PASS   | TypeScript and Python reference Adapters                             |
| rc.1 regression guards           | PASS   | 6 tests                                                              |
| Capacity                         | PASS   | two replicas, 1,000 Tasks, 15-second Adapter, 500 commands           |

## Phase regressions

| Phase | Regression                                                               | Result |
| ----- | ------------------------------------------------------------------------ | ------ |
| H1    | `lease-expiry-race.test.ts`: two replicas, slow commands, no duplicates  | PASS   |
| H2    | `start-window-race.test.ts`: reconciliation-first bound start watchdog   | PASS   |
| H3    | `stopping-state-regression.test.ts`: no STOPPING regression              | PASS   |
| H4    | `production-config.test.ts`: production fails closed                     | PASS   |
| H5    | `manifest-drift.test.ts`: drift changes readiness                        | PASS   |
| H6    | `outbox-publish-lifecycle.test.ts`: publish/retry/purge lifecycle        | PASS   |
| H7    | `observation-pagination.test.ts`: bounded newest-first pages             | PASS   |
| H8    | `recovery-fairness.test.ts`: failure backoff and new-work fairness       | PASS   |
| H9    | `result-contract-hardening.test.ts`: size, sanitize, schema, MCP mapping | PASS   |

All counts above are real executed tests. In-memory race doubles remain regression tests, while
the capacity gate separately exercised two Runtime instances against real PostgreSQL and a real
gRPC reference Adapter. Adapter conformance remains a reference-Adapter qualification only;
resource-specific production safety is not claimed.
