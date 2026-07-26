# H3 Test Results

Executed on 2026-07-16 against isolated PostgreSQL 17 at `127.0.0.1:57611`. No test was
skipped.

| Command                            | Result       |                    Tests | Notes                                              |
| ---------------------------------- | ------------ | -----------------------: | -------------------------------------------------- |
| `pnpm format:check`                | PASS         |                      n/a | all tracked text after formatting                  |
| `pnpm lint`                        | PASS         |                      n/a | ESLint                                             |
| `pnpm typecheck`                   | PASS         |                      n/a | TypeScript no-emit                                 |
| `pnpm test:unit`                   | PASS         |                       25 | six files                                          |
| `pnpm test:contract`               | PASS         |                        4 | Adapter protocol contract                          |
| `pnpm test:integration`            | PASS         |                       34 | four files, real PostgreSQL/gRPC                   |
| `pnpm test:recovery`               | PASS         |                        6 | startup and response-loss recovery                 |
| `pnpm test:security`               | PASS         |                        6 | two files                                          |
| `pnpm test:e2e`                    | PASS         |                        2 | MCP HTTP stack                                     |
| `pnpm test:rc2:red`                | EXPECTED RED |          4 pass / 2 fail | only H4 Snapshot/identity guards remain            |
| push runtime `29514013921`         | PASS         |                full gate | `pnpm verify`, Buf and both Compose Adapter builds |
| PR runtime `29514017780`           | PASS         |                full gate | `pnpm verify`, Buf and both Compose Adapter builds |
| PR quality `29514019017`           | PASS         |             focused gate | repository quality workflow                        |
| PR Compose `29514017491`           | PASS         |             focused gate | governance Compose workflow                        |
| closure push `29514255881`         | FAIL         | 5 pass / 1 fail security | non-canonical JWT signature alias exposed          |
| `pnpm test:security` x20 after fix | PASS         |           120 assertions | canonical-base64url validation                     |
| repair push `29514585761`          | PASS         |                full gate | `pnpm verify`, Buf and Compose                     |
| repair PR runtime `29514590381`    | PASS         |                full gate | `pnpm verify`, Buf and Compose                     |
| repair PR quality `29514592620`    | PASS         |             focused gate | repository quality workflow                        |
| repair PR Compose `29514590244`    | PASS         |             focused gate | governance Compose workflow                        |

## Required matrix evidence

| Test  | Evidence                                                                       | Result |
| ----- | ------------------------------------------------------------------------------ | ------ |
| T-014 | Runtime terminal transition increments revision and emits matching event       | PASS   |
| T-015 | Runtime cancellation leaves Adapter revision 1 while observation advances to 2 | PASS   |
| T-016 | full fields persisted; PostgreSQL event fault rolls back all three writes      | PASS   |

The format gate first identified the newly edited migration documentation and passed after that
file was formatted. This was corrected before the phase commit and is not reported as a passing
first invocation.
