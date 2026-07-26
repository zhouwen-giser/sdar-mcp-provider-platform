# v1.1.0 Provider Ops Telemetry Final Delivery Report

Date: 2026-07-18

Release branch: `feature/runtime-v1.1-telemetry`

Verified implementation commit: `a8195fea874159b482934aad2709008a0ac00c4e`

Immutable base: `24cd4e2550f4e0c7e3862d1ed871455d66e47327` (`v1.0.0-rc.3` release head)

## Outcome

H0 through H9 and the documentation gate are implemented in order. v1.1 adds Provider Ops
Telemetry over OTLP without changing product business capabilities. Runtime remains independent
of ClickHouse and SDAR Core, and telemetry failures remain isolated from business behavior and
readiness.

The aggregate `pnpm verify` gate passed in 268 seconds after fixing the recovery scan ordering
regression it exposed. The verified gate includes formatting, lint, types, build, generated Proto
drift, dependency audit, SBOM, deployment manifests, reproducible container images, unit,
contract, PostgreSQL integration, recovery, security, E2E, TypeScript/Python Adapter conformance
and the two-replica capacity baseline.

The regenerated capacity evidence records 1,000 concurrent Task admissions across two Runtime
replicas, 500 durable commands with zero duplicate Adapter side effects, 16/16 overdue starts
receiving durable watchdog stop intent, recovery scans at 100/500/1,000 candidates and a
99,772,087-byte reproducible non-root image.

## Release integrity

- No migration was added or modified for v1.1; all rc.1/rc.2/current forward-upgrade tests pass.
- Published rc.2/rc.3 tags, migrations and report directories were not rewritten.
- Current v1.1 evidence is isolated under `reports/runtime-v1.1/`,
  `reports/image/runtime-v1.1.json` and `reports/capacity/capacity-v1.1.json`.
- Merged PR #8 is the immutable rc.3 publication record. Draft PR #9 is the v1.1 publication
  vehicle and is conflict-free. Its initial protected run `29602577183` passed `runtime-ci` and
  `runtime-compose`; merge and tag creation remain outside this delivery task.
