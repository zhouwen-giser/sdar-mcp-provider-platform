# H6 Test Results

Executed on 2026-07-17 against the locked SDK, TypeScript gRPC Adapter and isolated PostgreSQL
17 container. No test was skipped.

| Command                    | Result | Tests / evidence | Notes                                     |
| -------------------------- | ------ | ---------------: | ----------------------------------------- |
| `pnpm format:check`        | PASS   |              n/a | all tracked text                          |
| `pnpm lint`                | PASS   |              n/a | ESLint                                    |
| `pnpm typecheck`           | PASS   |              n/a | TypeScript no-emit                        |
| Linux `pnpm build`         | PASS   |              n/a | protobuf generation and build emit        |
| `pnpm test:unit`           | PASS   |               26 | includes retained output validator/limits |
| `pnpm test:contract`       | PASS   |                4 | Adapter protocol contract                 |
| `pnpm test:rc2:red`        | PASS   |                6 | structural hardening guards               |
| `pnpm test:integration`    | PASS   |               54 | includes 10 H6 wire tests                 |
| `pnpm test:recovery`       | PASS   |                8 | durable restart/recovery paths            |
| `pnpm test:security`       | PASS   |                6 | authentication and limits                 |
| `pnpm test:e2e`            | PASS   |                2 | real MCP HTTP stack                       |
| push runtime `29539952514` | PASS   |        full gate | verify, Buf and Compose                   |
| PR runtime `29539965808`   | PASS   |        full gate | verify, Buf and Compose                   |
| PR quality `29539965866`   | PASS   |     focused gate | repository quality                        |
| PR Compose `29539965781`   | PASS   |     focused gate | governance Compose                        |

The remote `pnpm verify` executions include build, proto generation/check, dependency audit,
SBOM, deployment/container checks, all test families, existing TypeScript/Python P0-P4
conformance and capacity baseline. Buf 1.57.2 lint and breaking checks against `origin/main`
also passed. H8 still owns the expanded conformance matrix.

## Required matrix evidence

| Test  | Black-box evidence                                                              | Result |
| ----- | ------------------------------------------------------------------------------- | ------ |
| T-031 | official client accepts valid sync, inline and async output                     | PASS   |
| T-032 | invalid sync/inline are JSON-RPC errors; async Task stores failed/error         | PASS   |
| T-033 | valid partial is completed/isError; invalid partial is failed contract error    | PASS   |
| T-034 | synchronous Adapter transport failure is Internal Error                         | PASS   |
| T-035 | published technical failure is Task failed plus structured error                | PASS   |
| T-036 | business failure is completed and final CallToolResult has isError              | PASS   |
| T-037 | unknown Tool is Invalid Params with stable UNKNOWN_TOOL data                    | PASS   |
| T-038 | unknown/expired Tasks have distinct stable, authorization-safe errors           | PASS   |
| T-039 | unsupported cancellation is Invalid Params with CANCEL_NOT_SUPPORTED            | PASS   |
| T-040 | official ttl/pollInterval, namespaced aliases and malformed/bound TTL validated | PASS   |

## Retained failed command

The local Docker-on-Windows aggregate `pnpm build && pnpm proto:check` completed build, then
`proto:check` detected a CRLF-only generated-comment difference caused by the host checkout. It
exited 1 and is retained as a failed command. Both remote Linux runtime runs passed
`pnpm proto:check`, Buf lint and Buf breaking; no local failure is relabeled as success.
