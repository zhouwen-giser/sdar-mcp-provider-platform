# Runtime v1.1 Telemetry Completion ExecPlan

Status: complete

Base: `origin/main@43c0ced9caf560dab0d5a1427b10f385045d0847`

Branch: `fix/runtime-v1.1-telemetry-completion`

Target: `v1.1.0` (no `v1.1*` tag existed at H0 preflight)

## Scope and invariants

This plan closes the approved v1.1 Provider Telemetry Channel and durable Provider Ops delivery
gaps. It does not change MCP Task, command arbitration, scheduler, recovery or TTL business
semantics. Runtime remains independent of ClickHouse and SDAR Core. Collector failure is never a
readiness dependency and can never roll back a Task or command transaction.

Existing migrations are immutable. New persistence changes use migrations 017 and later. rc.2,
rc.3 and merged v1.1 evidence remain immutable. A real Collector/OTLP wire stack and historical
final-report repair are explicitly out of scope.

## Schema and compatibility strategy

- Provider Ops envelope schema version becomes `1.1.0`.
- Canonical record types use dotted names. A previous underscore name may appear only in
  `attributes.legacyRecordType`; records are never dual-emitted.
- `recordId` derives from stable business/event keys. `recordHash` excludes delivery metadata,
  including Runtime instance and emission time.
- A new Runtime-hosted `ProviderTelemetryIngress` service is added in a separate telemetry proto;
  the Adapter service direction remains unchanged. New fields use new field numbers and existing
  Adapter messages are not renumbered.
- Migration 017 adds durable Provider Ops delivery. Migration 018 adds persisted trace context.

## Ordered phases

| Phase | Deliverable                                               | Primary regression evidence         | Status   | Commit               |
| ----- | --------------------------------------------------------- | ----------------------------------- | -------- | -------------------- |
| H0    | clean main baseline, red completion guards, this ExecPlan | baseline plus red suite             | complete | `a01ae20`            |
| H1    | canonical envelope, event names, stable identity/time     | envelope/legacy/replay tests        | complete | `bc5da25`            |
| H2    | durable audit capture and lease-safe publisher            | PostgreSQL retry/race tests         | complete | `19c5442`            |
| H3    | Runtime ProviderTelemetryIngress and validation           | provider ingress/conformance tests  | complete | `3589e74`            |
| H4    | real root/RPC trace propagation and persistence           | trace parent/restart tests          | complete | `c3d8cbc`            |
| H5    | complete Task and command transition audit coverage       | lifecycle matrix tests              | complete | `acd4850`            |
| H6    | scheduler/recovery/TTL per-Task envelopes                 | component envelope tests            | complete | `5b911f0`            |
| H7    | sanitizer limits and trace failure isolation              | privacy/execute-once tests          | complete | `e795267`            |
| H8    | bounded metric values and drop/export/backlog accounting  | metric cardinality/failure tests    | complete | `40e18d9`            |
| H9    | secure production OTLP configuration                      | HTTPS/header/mTLS tests             | complete | `51244b6`            |
| H10   | dual-language examples, docs, full gate, push and PR      | `pnpm verify:v1.1` and protected CI | complete | `143c711`, `38e9acd` |

## Verification ledger

| Date       | Command                                              | Result                                                                           |
| ---------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| 2026-07-18 | tag preflight: `git tag --list "v1.1*"`              | PASS, no tag                                                                     |
| 2026-07-18 | `pnpm verify:v1.1` on clean merged main              | PASS, 375.2 seconds                                                              |
| 2026-07-18 | baseline test counts                                 | 49 unit, 4 contract, 164 integration, 9 recovery, 18 security, 4 E2E, 6 rc.2 red |
| 2026-07-18 | completion regression guard before implementation    | RED as expected, 7/7 failed                                                      |
| 2026-07-18 | H1 typecheck, lint and envelope/outbox focused tests | PASS, 18 tests                                                                   |
| 2026-07-18 | H2 PostgreSQL task lifecycle and delivery races      | PASS, 118 tests (110 lifecycle, 4 delivery, 4 upgrade/telemetry)                 |
| 2026-07-18 | H2 typecheck, lint and format check                  | PASS                                                                             |
| 2026-07-18 | H3 ingress, configuration and production security    | PASS, 30 tests                                                                   |
| 2026-07-18 | H3 gRPC wire, multi-replica idempotency and build    | PASS                                                                             |
| 2026-07-18 | H4 real spans, propagation, restart persistence      | PASS, 131 focused tests                                                          |
| 2026-07-18 | H4 migration 018 forward upgrade                     | PASS                                                                             |
| 2026-07-18 | H5 Task/command lifecycle PostgreSQL matrix          | PASS, 115 tests                                                                  |
| 2026-07-18 | H5 typecheck, lint and format check                  | PASS                                                                             |
| 2026-07-18 | H6 scheduler/recovery/TTL PostgreSQL regressions     | PASS, 124 tests                                                                  |
| 2026-07-18 | H6 aggregate-metric and stable-ID unit regressions   | PASS, 2 tests                                                                    |
| 2026-07-18 | H7 privacy, failure-isolation and ingress allowlist  | PASS, 24 focused tests                                                           |
| 2026-07-18 | H7 completion guard status                           | PASS for H7; only H8/H9 guards remain red                                        |
| 2026-07-18 | H8 bounded labels, queue/export failure, audit retry | PASS, 10 focused tests                                                           |
| 2026-07-18 | H8 completion guard status                           | PASS for H8; only H9 guard remains red                                           |
| 2026-07-18 | H9 production HTTPS, header-file and mTLS security   | PASS, 31 focused tests plus typecheck and lint                                   |
| 2026-07-18 | H9 Kubernetes secret-file deployment templates       | PASS, credentials absent from ConfigMap                                          |
| 2026-07-18 | migration 017/018 forward upgrade fixtures           | PASS, rc.1 and pre-012 fixtures preserved; 19 migrations applied                 |
| 2026-07-18 | multi-replica Provider delivery and command races    | PASS, idempotent ingress/delivery and 32 slow commands execute once              |
| 2026-07-18 | TypeScript and Python Provider conformance           | PASS, both reports regenerated                                                   |
| 2026-07-18 | release evidence regeneration                        | PASS, SBOM (220 components), image, capacity and conformance reports refreshed   |
| 2026-07-18 | `pnpm verify:v1.1` final full gate                   | PASS, 278 seconds; 71 unit, 6 contract, 188 integration, 9 recovery, 28 security |
| 2026-07-18 | release scans                                        | PASS, no `.skip`/`.only`; legacy names only in negative guards                   |
| 2026-07-18 | publication                                          | PASS, branch pushed and Draft PR #10 created                                     |

This file is updated with real phase SHAs and verification results as work progresses. A phase is
complete only after its focused tests and static gates pass and its commit exists.
