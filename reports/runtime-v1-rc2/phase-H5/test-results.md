# H5 Test Results

Executed on 2026-07-17 against the repository test stack and an isolated PostgreSQL 17
container. No test was skipped. Remote workflow ids will be added only after actual runs finish.

| Command                                   | Result |          Tests | Notes                                       |
| ----------------------------------------- | ------ | -------------: | ------------------------------------------- |
| `pnpm format:check`                       | PASS   |            n/a | all tracked text after H5 formatting        |
| `pnpm lint`                               | PASS   |            n/a | ESLint after expired-error mapping          |
| `pnpm typecheck`                          | PASS   |            n/a | TypeScript no-emit                          |
| Linux `pnpm build`                        | PASS   |            n/a | protobuf generation and build emit          |
| `pnpm audit:dependencies`                 | PASS   |        0 known | high-severity threshold                     |
| `pnpm deployment:check`                   | PASS   |    8 manifests | Kubernetes validation                       |
| `pnpm container:check`                    | PASS   |    build check | Compose config and Dockerfile check         |
| `pnpm test:unit`                          | PASS   |             25 | six files                                   |
| `pnpm test:contract`                      | PASS   |              4 | Adapter protocol contract                   |
| `pnpm test:integration`                   | PASS   |             44 | PostgreSQL/gRPC/MCP, including T-023..T-028 |
| `pnpm test:recovery`                      | PASS   |              8 | durable restart/recovery paths              |
| `pnpm test:security`                      | PASS   |              6 | authentication and limits                   |
| `pnpm test:e2e`                           | PASS   |              2 | real MCP HTTP stack                         |
| `pnpm test:rc2:red`                       | PASS   |              6 | structural hardening guards                 |
| Linux `pnpm test:conformance`             | PASS   |       P0-P4 x2 | TypeScript and Python reference Adapters    |
| Linux `pnpm capacity:baseline`            | PASS   | 125 operations | fresh report saved                          |
| Buf lint                                  | PASS   |            n/a | Buf 1.57.2 container                        |
| Buf breaking vs `origin/main`             | PASS   |            n/a | no protobuf break                           |
| implementation push runtime `29520205271` | PASS   |      full gate | `pnpm verify`, Buf and Compose              |
| implementation PR runtime `29520212409`   | PASS   |      full gate | `pnpm verify`, Buf and Compose              |
| implementation PR quality `29520211902`   | PASS   |   focused gate | repository quality workflow                 |
| implementation PR Compose `29520211382`   | PASS   |   focused gate | governance Compose workflow                 |

## Required matrix evidence

| Test  | Evidence                                                                                                | Result |
| ----- | ------------------------------------------------------------------------------------------------------- | ------ |
| T-023 | two due-cleaner passes renew an active finite-TTL Task without expiry                                   | PASS   |
| T-024 | terminal Task has fixed retention anchors and remains result-queryable                                  | PASS   |
| T-025 | official MCP get/result/cancel/update return Invalid Params `TASK_EXPIRED`; other tenant sees not found | PASS   |
| T-026 | two concurrent SKIP LOCKED cleaners expire and purge exactly once with zero residue                     | PASS   |
| T-027 | transient Adapter Get returns unchanged persisted Task plus stale metadata and deferred Reconcile       | PASS   |
| T-028 | wrong Adapter execution identity is thrown and persisted Task remains unchanged                         | PASS   |

## Environment failures retained as evidence

The first database invocation used `127.0.0.1:5432`, which was a different local PostgreSQL
instance and rejected authentication. It was rerun against the isolated container's actual
published port `57611`, where all 44 tests passed. The first aggregate `pnpm verify` stopped at
the locally installed Windows `protoc.exe`, which exits `0xC0000135` because the published binary
imports debug Visual C++ runtime DLLs. A standalone Windows SBOM check also could not resolve
`pnpm.cmd`. These are not counted as passing runs. Build, conformance and capacity then passed in
Linux; the branch/PR Linux workflow remains the required aggregate `pnpm verify` evidence.
