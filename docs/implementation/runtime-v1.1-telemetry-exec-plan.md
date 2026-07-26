# Runtime v1.1 Provider Ops Telemetry ExecPlan

Status: complete

Base: verified rc.3 release head `24cd4e2550f4e0c7e3862d1ed871455d66e47327`

Target: `v1.1.0` on `feature/runtime-v1.1-telemetry`

## Scope and invariants

This release adds Provider Ops Telemetry through OpenTelemetry without changing Task lifecycle,
command, scheduling, recovery, safe-stop, Observation, Outbox, readiness, or persistence
semantics. Runtime exports only to OTLP. It does not depend on or connect to ClickHouse or SDAR
Core. Existing Prometheus text output remains supported.

Telemetry is best effort and fail-open relative to business behavior. Export failure, timeout,
queue saturation, serialization failure, and shutdown failure must not fail a Runtime operation
or change readiness. Audit events are derived from committed facts; API handlers must not invent
Task lifecycle events.

Raw arguments, input values, Adapter payloads, authorization material, passwords, tokens, JWTs,
cookies, and secrets are forbidden. Stable hashes and bounded identifiers explicitly listed by
the envelope contract are allowed. Metric attributes must be bounded and must never include
Task IDs, argument hashes, authorization hashes, user IDs, execution IDs, or correlation IDs.

## Delivery phases

| Phase   | Deliverable                                                 | Required evidence                       | Status   |
| ------- | ----------------------------------------------------------- | --------------------------------------- | -------- |
| H0      | OTel SDK foundation, resource, lifecycle                    | init/resource/shutdown tests            | complete |
| H1      | stable Provider Ops envelope, UUIDv5 ID, RFC 8785 hash      | deterministic ID/hash tests             | complete |
| H2      | committed Task lifecycle audit events                       | commit/rollback integration tests       | complete |
| H3      | command dispatch events                                     | state/duplicate/retry/supersede tests   | complete |
| H4      | Adapter RPC spans                                           | success/error/no-payload tests          | complete |
| H5      | scheduler/recovery/TTL events                               | component event tests                   | complete |
| H6      | low-cardinality OTel metrics                                | value/cardinality/label tests           | complete |
| H7      | bounded failure isolation                                   | collector down/timeout/queue full tests | complete |
| H8      | sanitizer and privacy policy                                | secret/argument/hash security tests     | complete |
| H9      | optional CI-only telemetry dev stack                        | boundary decision and smoke evidence    | complete |
| Docs    | boundary, catalog, configuration, privacy, failure handling | docs drift review                       | complete |
| Release | full verification, evidence, push, PR                       | clean SHA and green CI                  | complete |

## Design decisions

- `ProviderOpsEnvelope` is the stable product schema. OTel logs are a transport mapping only.
- `recordId` is UUIDv5 over record type plus stable aggregate/event/revision identity.
- `recordHash` is SHA-256 over RFC 8785 canonical JSON excluding delivery metadata such as
  `emittedAt`, exporter retry count, and collector timestamps.
- Task audit events are created from persistence transition results after transaction commit.
  Failed or rolled-back transactions produce no event.
- Trace/event/metric calls are non-throwing at the business boundary and use bounded batch
  processors with explicit timeouts and drop accounting.
- H9 is intentionally not implemented for v1.1. CI uses in-memory, timeout, and queue-pressure
  exporters instead of adding a Collector/ClickHouse dev stack. This keeps default compose,
  production images, Runtime dependencies, and network paths free of ClickHouse and SDAR Core.

## Verification ledger

| Date       | Command                                                           | Result |
| ---------- | ----------------------------------------------------------------- | ------ |
| 2026-07-17 | rc.3 `pnpm verify:rc3` before branch creation                     | PASS   |
| 2026-07-18 | H0 format, typecheck, lint and unit (33 tests)                    | PASS   |
| 2026-07-18 | H1 format, typecheck, lint and unit (38 tests)                    | PASS   |
| 2026-07-18 | H2 unit (39), focused integration (5), commit/rollback PostgreSQL | PASS   |
| 2026-07-18 | H3 unit (45) and full PostgreSQL integration (162)                | PASS   |
| 2026-07-18 | H4 unit (47) and real gRPC Adapter foundation                     | PASS   |
| 2026-07-18 | H2 contract alignment unit (47), lifecycle/commit tests (115)     | PASS   |
| 2026-07-18 | H3 contract alignment typecheck and command/lifecycle tests (120) | PASS   |
| 2026-07-18 | H4 contract alignment and real gRPC context tests (4)             | PASS   |
| 2026-07-18 | H5 scheduler/recovery/TTL PostgreSQL component tests (112)        | PASS   |
| 2026-07-18 | H6 OTel metric catalog/value/cardinality tests (7 focused)        | PASS   |
| 2026-07-18 | H7 exporter timeout/queue overflow isolation tests (8 focused)    | PASS   |
| 2026-07-18 | H8 sanitizer/export privacy tests (10 focused)                    | PASS   |
| 2026-07-18 | H9 repository boundary scan: no telemetry-dev/ClickHouse runtime  | PASS   |
| 2026-07-18 | Docs/config/version drift review and regenerated v1.1 SBOM        | PASS   |
| 2026-07-18 | `pnpm verify` after recovery scan ordering fix (268 seconds)      | PASS   |
| 2026-07-18 | rc.2 red regressions (6), migration upgrades (4), races (2)       | PASS   |
| 2026-07-18 | PR #9 protected run 29602577183: runtime-ci and compose           | PASS   |

This plan is updated as implementation and evidence evolve. A phase is complete only after its
tests pass and its commit is created.
