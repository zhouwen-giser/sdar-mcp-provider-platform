# H2 Test Results

Executed on 2026-07-16 against isolated PostgreSQL 17 at `127.0.0.1:57611`. No test was
skipped.

| Command                                 | Result       |              Tests | Notes                                        |
| --------------------------------------- | ------------ | -----------------: | -------------------------------------------- |
| `pnpm format:check`                     | PASS         |                n/a | includes synchronized governance files       |
| `pnpm lint`                             | PASS         |                n/a | ESLint                                       |
| `pnpm typecheck`                        | PASS         |                n/a | TypeScript no-emit                           |
| `pnpm test:unit`                        | PASS         |                 25 | includes omitted-timing compatibility window |
| `pnpm test:contract`                    | PASS         |                  4 | Adapter proto contract                       |
| `pnpm test:integration`                 | PASS         |                 32 | 4 files, real PostgreSQL/gRPC                |
| `pnpm test:recovery`                    | PASS         |                  6 | response loss/control restart retained       |
| `pnpm test:security`                    | PASS         |                  6 | 2 files                                      |
| `pnpm test:e2e`                         | PASS         |                  2 | MCP HTTP stack                               |
| `pnpm test:rc2:red`                     | EXPECTED RED |    4 pass / 2 fail | only H4 Snapshot/identity guards remain      |
| push runtime `29511568781`              | PASS         | full `pnpm verify` | quality and Compose                          |
| PR runtime `29511591880`                | PASS         | full `pnpm verify` | quality, Buf and Compose                     |
| PR governance `29511590472/29511590473` | PASS         |     focused checks | quality and Compose                          |

## Required matrix evidence

| Test  | Evidence                                                                            | Result |
| ----- | ----------------------------------------------------------------------------------- | ------ |
| T-007 | queued immediate Task, watchdog, durable stop, CANCELLED proof, window result       | PASS   |
| T-008 | fake-clock response arrives late and publishes directly as compensating stop        | PASS   |
| T-009 | on-time RUNNING writes `actualStartedAt`; later watchdog leaves it running          | PASS   |
| T-010 | retryable scheduled reject, bounded next attempt, attempt 2 succeeds once           | PASS   |
| T-011 | repeated retry reaches window; no second call or late side effect                   | PASS   |
| T-012 | permanent rejection produces business terminal plus observation/outbox              | PASS   |
| T-013 | concurrent workers claim once; response-loss workers Reconcile with one side effect | PASS   |

The first expanded full integration run exposed fork/schema interference; the same tests passed
with one worker, the configuration was made explicit, and the unmodified command then passed
32/32. This is recorded as a fixed test-infrastructure defect, not omitted evidence.
