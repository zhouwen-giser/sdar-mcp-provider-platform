# ADR: trajectory reception evidence and retained-history proof v1

Status: implemented; frozen final acceptance pending.
Date: 2026-10-12. Updated: 2026-10-13. Owner: SMPP.

## Context

SDAR ADR-156 prohibits assigning Context.updatedAt, Event.providerRecordedAt or
Artifact.updatedAt to every trajectory point. Existing SMPP sampled GeoJSON and
Provider summaries cannot establish complete source history. The current MQTT
ingress can discard duplicate/stale messages before publishing a snapshot, so
adding timestamps only to the projector would miss reception evidence.

## Decision

1. Add an opt-in receipt journal at the actual MQTT message entrance. A Provider
   sample/reception identity is generated once there and retained with original
   topic, wire-byte SHA-256, transport metadata, actual Provider reception time,
   clock owner/precision and process-monotonic ordinal. Database recording time
   has a different owner/stage; exact commit time is not fabricated.
2. Preserve source-reported time/sequence with original paths, units, time base,
   conversion and quality. Missing data stays absent. A reported clock is not a
   synchronized clock, and a Provider sequence is not a device generation sequence.
3. Keep existing TaskBusiness trajectory geometry and frozen wire assets intact.
   Sidecars map newly introduced geometry coordinates to actual receipt IDs.
   Legacy coordinates have unknown evidence. Native Mission IDs reported in the
   same message differ from Provider projection/correlation; current Mission state
   never becomes a fabricated source-message ownership fact.
4. Expose new resource-bound, synchronous read operations with separately versioned
   schemas and discovery. No control command, automatic replay or execution grant
   is introduced. Task-specific sidecars require the existing execution/authorization
   binding; other devices and unrelated task identities are rejected.
5. Seal finite retained ranges at a committed high watermark. Ordered canonical
   receipt hashes form a SHA-256 chain; an Ed25519 signature authenticates scope,
   boundaries, counts, anchors, completeness/quality claims and snapshot identity.
   The verifier requires an externally pinned public key and expected scope.
   Hash/count consistency alone cannot authenticate a forged Provider manifest.
6. Bind bounded pagination/resumption to that stable snapshot and caller. Appends
   cannot change its result. Pruned/missing entries invalidate completeness and
   are explicit; recovery and disconnected/unclean sessions remain visible.
7. Use new forward owner migrations with retained history and least privileges.
   Hosted GOWM changes run only through explicit owner installation; startup
   verifies the extension when enabled. An old service/database with it disabled
   continues to work without manufacturing evidence.

## Claims and limits

A complete bounded committed receipt set means all retained entries in that
declared Provider range have been returned and verified. It does not mean every
device-produced sample arrived, or that a crash before durable admission lost
nothing. Those are separate coverage claims. Device-generation completeness
requires trustworthy producer identity/epoch and start/end or equivalent sequence
attestations. The currently inspected producer lacks that contract, so this
extension must report that level as unknown/incomplete with concrete reasons.

The Provider clock establishes when its own entrance observed a message; it does
not establish device acquisition time or calibrated absolute clock accuracy.
UTC representation, resolution and synchronization quality are explicit.

Local simulated producer data will be labeled SIMULATED. No real-device
qualification, selected-site inspection or deployment is part of this decision.

## Acceptance

Per-point provenance, upgrade/retry/rollback, crash/restart, disconnect/recovery,
same-millisecond observations, duplicate/out-of-order/late packets, missing and
regressing clocks, sequence gaps, cross-device/Mission mixing, stable bounded
pages, retention, legacy data, forged proofs, permission checks and frozen-asset
compatibility all require actual regressions. An isolated PostgreSQL and MQTT
public readback must pass. Formal milestones run full repository gates and deliver
source/asset identities plus original logs and an acceptance matrix for SDAR.

Implementation now supplies `vehicle_get_trajectory_history` and
`vehicle_get_trajectory_evidence` through the existing synchronous public read
transport. Native forward migration 033 preserves old 030/031/032, while new
hosted 031 is installed transactionally by its owner. Local public MQTT/MCP,
PostgreSQL, SIGKILL/restart, transport outage, retention and isolated full GOWM
qualification have passed. Final acceptance is written to
`reports/trajectory-time-history-v1/ACCEPTANCE.json` only after the frozen source's
complete gate, history regressions, UGV TaskBusiness gate and independent public
intake checks all pass. Earlier failures remain recorded. Actual SDAR interop,
real-device qualification, site operations and deployment remain NOT_RUN.
