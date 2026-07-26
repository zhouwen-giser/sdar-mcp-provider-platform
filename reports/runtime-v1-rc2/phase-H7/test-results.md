# H7 Test Results

Executed 2026-07-17 against PostgreSQL 17, the TypeScript gRPC Adapter, Python Adapter and the
official MCP client. No test was skipped.

| Command / evidence                   | Result |                               Count or detail |
| ------------------------------------ | ------ | --------------------------------------------: |
| `pnpm format:check`, lint, typecheck | PASS   |                                all H7 sources |
| `pnpm test:unit`                     | PASS   |                                            27 |
| `pnpm test:contract`                 | PASS   |                                             4 |
| `pnpm test:rc2:red`                  | PASS   |                                             6 |
| `pnpm test:integration`              | PASS   |                                            57 |
| `pnpm test:recovery`                 | PASS   |                                             8 |
| `pnpm test:security`                 | PASS   |                                             6 |
| `pnpm test:e2e`                      | PASS   |                                             4 |
| TypeScript/Python grouped baseline   | PASS   |  10 cases/language; not full Profile coverage |
| SBOM/deployment/capacity             | PASS   |  184 prod components / 8 manifests / baseline |
| `pnpm container:check`               | PASS   | two builds, non-root, prod-only, reproducible |
| push runtime `29541564999`           | PASS   |          complete `pnpm verify`, Buf, Compose |
| PR runtime `29541566647`             | PASS   |          complete `pnpm verify`, Buf, Compose |
| PR Compose `29541566656`             | PASS   |                            governance Compose |
| PR quality `29541566648`             | PASS   |                            governance quality |

## Required matrix evidence

| Test  | Evidence                                                            | Result |
| ----- | ------------------------------------------------------------------- | ------ |
| T-041 | Adapter outage yields readiness 503 while database remains ready    | PASS   |
| T-042 | restarted Adapter is detected and readiness returns automatically   | PASS   |
| T-043 | unique-key flood never exceeds configured limiter cardinality       | PASS   |
| T-044 | pool max 1 serves SQL while slow Adapter boundary is outstanding    | PASS   |
| T-045 | frozen/prod-only/non-root two-build image and startup payload audit | PASS   |
| T-046 | repeated requests and two official clients remain stateless         | PASS   |

## Retained failures

- Local aggregate build could not execute the bundled Windows `grpc-tools` binary
  (`0xc0000135`). Linux Docker build regenerated protobuf successfully, and both authoritative
  remote runtime runs passed build/proto-check and Buf.
- Initial runtime runs `29541408218` and `29541409694` failed only because a locally inferred
  150 MB image threshold did not match Linux Engine size semantics. The guard was not removed:
  `3d885be` records the measured 327,026,557-byte Linux baseline with a 350 MB regression
  ceiling, and all replacement runs passed.
