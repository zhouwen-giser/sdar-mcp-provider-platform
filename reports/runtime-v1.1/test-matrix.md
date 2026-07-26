# v1.1.0 Test Matrix

Date: 2026-07-18

Verified implementation commit: `a8195fea874159b482934aad2709008a0ac00c4e`

Aggregate command: `pnpm verify`

Result: PASS (268 seconds, PostgreSQL and Docker Desktop)

| Gate                            | Result | Evidence                                                         |
| ------------------------------- | ------ | ---------------------------------------------------------------- |
| Formatting, lint and types      | PASS   | Prettier, ESLint and TypeScript completed without errors         |
| Build and generated Proto drift | PASS   | pinned Docker fallback regenerated identical Proto output        |
| Dependency audit and SBOM       | PASS   | no known vulnerabilities; 220 production components              |
| Deployment and image            | PASS   | 8 Kubernetes manifests; two reproducible non-root images         |
| Unit                            | PASS   | 49 tests                                                         |
| Contract                        | PASS   | 4 tests                                                          |
| Integration                     | PASS   | 164 tests in 19 files                                            |
| Recovery                        | PASS   | 9 tests                                                          |
| Security                        | PASS   | 18 tests in 4 files                                              |
| E2E                             | PASS   | 4 tests                                                          |
| Adapter conformance             | PASS   | TypeScript and Python reference Adapters                         |
| Capacity                        | PASS   | two replicas, 1,000 Tasks, 15-second Adapter delay, 500 commands |
| rc.2 red regression guards      | PASS   | explicit follow-up: 6 tests                                      |
| Forward migration upgrade       | PASS   | explicit follow-up: 4 tests in 3 files                           |
| Multi-replica lease/start races | PASS   | explicit follow-up: 2 tests in 2 files                           |

## Telemetry phase regressions

| Phase | Coverage                                                                | Result |
| ----- | ----------------------------------------------------------------------- | ------ |
| H0    | SDK init, stable resource attributes and idempotent shutdown            | PASS   |
| H1    | envelope validation, deterministic UUIDv5 and canonical record hash     | PASS   |
| H2    | committed lifecycle events; rollback produces no audit event            | PASS   |
| H3    | command dispatch state, duplicate, retry and supersede facts            | PASS   |
| H4    | payload-free Adapter RPC success/error spans with bounded attributes    | PASS   |
| H5    | scheduler, recovery and TTL event callbacks; recovery scan ordering     | PASS   |
| H6    | metric catalog, values, gauges and low-cardinality attribute allowlist  | PASS   |
| H7    | collector down, timeout, serialization and queue saturation isolation   | PASS   |
| H8    | recursive secret/input/authorization sanitization at export boundaries  | PASS   |
| H9    | repository boundary scan; no ClickHouse or SDAR Core runtime dependency | PASS   |

All counts are executed tests. In-memory race doubles prove deterministic concurrency behavior;
the capacity gate separately exercises two real Runtime instances sharing PostgreSQL and one real
gRPC Adapter.
