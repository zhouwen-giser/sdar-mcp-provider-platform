# Frozen Protocol V1 Runtime Test Matrix

Audit date: 2026-07-18

Audited implementation commit: `78fae03`

Command: `pnpm verify:v2`

Result: PASS (exit code 0, 487.1 seconds)

Environment: Windows x64, Node.js v22.14.0, Docker Desktop Linux engine, disposable PostgreSQL at
`127.0.0.1:55499`. Database credentials are intentionally omitted from this report.

| Gate                           | Evidence                                                                                           | Result     |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | ---------- |
| Frozen source integrity        | contract SHA-256 `d33623f33ea2dfbb0ad56868d9911af6c7b37b354a0b17a76798646bded9a845`                | PASS       |
| Pinned MCP schema              | commit `26897cc322f356487da89113451bd16b520b9288`, blob `cc44564e33305dbc07e820cdd0a97648f3852019` | PASS       |
| Derived protocol               | 8 schemas, 74 catalog cases, 13 locked files                                                       | PASS       |
| Protocol tests                 | 14 files, 68 tests                                                                                 | PASS       |
| Frozen catalog                 | C-001 through C-074, real PostgreSQL lifecycle included                                            | 74/74 PASS |
| Formatting/lint/types/build    | Prettier, ESLint, TypeScript and generated Proto checks                                            | PASS       |
| Dependency and delivery policy | audit, 220-component SBOM, 10 Kubernetes manifests                                                 | PASS       |
| Runtime image                  | non-root, 99,844,752 bytes, reproducible filesystem/config                                         | PASS       |
| Unit                           | 18 files, 75 tests                                                                                 | PASS       |
| Contract                       | 2 files, 9 tests                                                                                   | PASS       |
| Integration                    | 21 files, 195 tests                                                                                | PASS       |
| Recovery                       | 1 file, 9 tests                                                                                    | PASS       |
| Security                       | 4 files, 28 tests                                                                                  | PASS       |
| E2E                            | frozen and explicitly isolated Legacy HTTP paths                                                   | PASS       |
| Task Notification              | focused gate 17/17; C-055 uses two HTTP Runtime replicas and shared PostgreSQL                     | PASS       |
| Evidence                       | focused gate 138/138 with no filtered/skipped tests                                                | PASS       |
| Adapter conformance            | TypeScript 20/20 and Python 20/20 expanded Adapter profile                                         | PASS       |
| Component reports              | Runtime 74/74 plus separate TypeScript/Python Adapter reports                                      | PASS       |
| Capacity                       | 100 sync calls, 1,000 admissions, 500 commands, 0 duplicate side effects                           | PASS       |
| rc2 regressions                | 1 file, 6 tests                                                                                    | PASS       |

The capacity process emitted a post-completion warning when a background Provider telemetry retry
observed a PostgreSQL pool that had already been closed. The capacity command had already produced
its complete report and the full gate exited 0. This is recorded as a shutdown-order observation,
not represented as a failed assertion or suppressed test.

Generated conformance reports include timestamps and durations; image byte counts can vary slightly
with Docker metadata. The audited exit code and exact commit are the authoritative result.
