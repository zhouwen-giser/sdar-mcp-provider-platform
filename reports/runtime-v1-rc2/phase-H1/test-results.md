# H1 Test Results

Executed on 2026-07-16 from the H1 worktree against an isolated PostgreSQL 17 container at
`127.0.0.1:57611`. No test was skipped.

| Command                           | Result       |              Tests | Notes                                           |
| --------------------------------- | ------------ | -----------------: | ----------------------------------------------- |
| `pnpm format:check`               | PASS         |                n/a | Prettier portable line-ending gate              |
| `pnpm lint`                       | PASS         |                n/a | ESLint                                          |
| `pnpm typecheck`                  | PASS         |                n/a | TypeScript no-emit                              |
| `pnpm test:unit`                  | PASS         |                 24 | 6 files                                         |
| `pnpm test:contract`              | PASS         |                  4 | Python executable selection made cross-platform |
| `pnpm test:integration`           | PASS         |                 25 | 4 files; real PostgreSQL and gRPC               |
| `pnpm test:recovery`              | PASS         |                  6 | real PostgreSQL; dispatcher restart retry       |
| `pnpm test:security`              | PASS         |                  6 | 2 files                                         |
| `pnpm test:e2e`                   | PASS         |                  2 | real MCP HTTP stack with PostgreSQL             |
| `pnpm test:rc2:red`               | EXPECTED RED |    1 pass / 5 fail | T-029 green; only H2-H4 guards remain red       |
| GitHub Actions push `29509615239` | PASS         | full `pnpm verify` | quality, Buf and Compose jobs passed            |
| GitHub Actions PR `29509616607`   | PASS         | full `pnpm verify` | quality, Buf and Compose jobs passed            |

## Required matrix evidence

| Test  | Evidence                                                                           | Result |
| ----- | ---------------------------------------------------------------------------------- | ------ |
| T-001 | intent-before-RPC, transport loss, retry after dispatcher restart, max-1 pool test | PASS   |
| T-002 | retryable negative Ack enters retry wait, same command succeeds on retry           | PASS   |
| T-003 | permanent user rejection + Reconcile restores running and allocates new sequence   | PASS   |
| T-004 | mandatory deadline transport failure remains stopping and retryable                | PASS   |
| T-005 | permanent mandatory-stop rejection becomes `SAFE_STOP_UNCONFIRMED`                 | PASS   |
| T-006 | three concurrent cancel requests create exactly one active command                 | PASS   |
| T-029 | cancel returns after durable commit without waiting for Adapter RPC                | PASS   |
| T-030 | dispatcher resumes stable command identity after transport loss/restart            | PASS   |

The first local E2E invocation without `TEST_DATABASE_URL` failed fast as designed by
`require-env`; the environment variable was then supplied and the actual 2-test suite passed.
This setup error is not counted as a product-test failure or hidden from the record.
