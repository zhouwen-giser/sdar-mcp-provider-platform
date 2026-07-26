# v1.1.0 Release Evidence

Date: 2026-07-18

Verified implementation commit: `a8195fea874159b482934aad2709008a0ac00c4e`

## Phase commits

| Phase    | Commit              | Deliverable                                   |
| -------- | ------------------- | --------------------------------------------- |
| H0       | `2a30894`           | OpenTelemetry foundation                      |
| H1       | `27a124a`           | stable Provider Ops envelope                  |
| H2       | `16a3aad`           | committed Task lifecycle events               |
| H3       | `55c4d52`           | durable command dispatch events               |
| H4       | `6b47a92`           | payload-free Adapter RPC spans                |
| H2-H4    | `23ebfcb`-`a7c241e` | contract alignment fixes                      |
| H5       | `74d3af8`           | scheduler, recovery and TTL events            |
| H6       | `0afeda9`           | bounded Provider metrics                      |
| H7       | `c543c4d`           | exporter failure isolation                    |
| H8       | `626d227`           | export-boundary sanitizer                     |
| H9       | `4db5540`           | optional dev-stack boundary decision          |
| Docs     | `7bb6ab3`           | v1.1 operations contract and release metadata |
| Gate fix | `a8195fe`           | same-scan recovery accounting regression fix  |

## Executed gates

| Command                                               | Result                   |
| ----------------------------------------------------- | ------------------------ |
| `pnpm verify`                                         | PASS, 268 seconds        |
| `pnpm test:rc2:red`                                   | PASS, 6 tests            |
| `vitest run` for migration/rc.1/rc.2 forward upgrades | PASS, 4 tests in 3 files |
| `vitest run` for lease-expiry and start-window races  | PASS, 2 tests in 2 files |

The first aggregate run exposed a recovery scan ordering regression: Tasks published while
recovering uncertain admissions had been enumerated too early and were not reconciled in the same
scan. Commit `a8195fe` restores post-admission enumeration and adds a focused regression. The full
aggregate gate was then rerun from the beginning and passed.

## Generated artifacts

- `reports/sbom/runtime-v1.cdx.json`: CycloneDX 1.6, 220 production components.
- `reports/image/runtime-v1.1.json`: reproducible, non-root, 99,772,087 bytes.
- `reports/capacity/capacity-v1.1.json`: two-replica PostgreSQL/gRPC capacity evidence.
- `reports/conformance/typescript.json` and `reports/conformance/python.json`: passed reference
  Adapter conformance evidence.

Merged PR #8 remains the rc.3 publication record. Draft PR #9 targets `main`, GitHub reports it
as mergeable, and protected run `29602577183` passed `runtime-ci` (3m41s) and `runtime-compose`
(1m03s). No tag is created by this delivery task.
