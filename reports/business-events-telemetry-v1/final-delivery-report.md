# SDAR Business Events Telemetry V1 — Final Delivery Report

## Delivery identity

- Baseline: `8a81b1b02971fb124ed96372c440c449f9087c99` (PR #19 merge commit and ancestor).
- Requirements: `SDAR_v1.2.2_Business_Events_Provider_Runtime_Requirements_V0.5.2.md`.
- Requirements SHA-256: `a17ee1552bc5b516dabdcc24db2fe9fd2d3deaf74688eae51e2fdc0c6a24cc0f`.
- Provider Ops contract remains `sdar.provider.ops.event/1.1.0`.
- Defaults remain `BUSINESS_EVENTS_ENABLED=false` and
  `BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY=false`.

## Delivered supplement

The Runtime now has a frozen per-metric policy, a bounded Manifest-derived `sourceId` roster,
Prometheus/OTLP dual emission, multi-series Observable Gauges and complete Publication Barrier
reset paths. Business Event Source, Intake, Mapping, Publication, Stream, Continuity and Relation
audits use the existing `provider_ops_delivery` and stable Provider Ops Envelope identities.
Required audits are inserted inside the corresponding authority transaction; Collector delivery
remains asynchronous and retryable.

Streaming gRPC now propagates W3C context through a dedicated client Span. Source Connect,
Intake, Prepare, Finalize, Rotation, Listen, Replay/Live Batch, Relation and Operator flows use
safe spans and diagnostic events. A Business Event-specific allowlist removes raw envelopes and
payloads, task/resource relations, projection/auth material, credentials, exception messages and
stacks from Audit, Log and Trace output.

## Verification and claim boundary

The telemetry unit, PostgreSQL integration, actual OTel exporter security, protocol lock, Frozen
74, Runtime Closure/Follow-up and PR #16 regression gates passed locally. The complete
`verify:business-events` and `verify:v2` gates also passed; `runtime-verification.json` records the
final command, timing and evidence set.

This work preserves the claim `Business Events Runtime Component Conformant`. It does not claim
real SDAR interoperability and does not promote the Runtime to `SDAR ↔ Provider Business Events
Interop Certified`.

The branch is intended for one Draft PR. No release tag is created, no auto-merge is enabled, and
the PR #19 historical reports under `reports/business-events-profile-v1/` are unchanged.
