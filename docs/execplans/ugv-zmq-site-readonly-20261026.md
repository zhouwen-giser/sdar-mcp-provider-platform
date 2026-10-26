# Site read-only ZMQ and 7879 planning preview

## Purpose

Deliver actual ZMQ subscriptions and an authenticated MCP planning preview, with explicit
unqualified source evidence and disabled device controls. Only this repository changes.

## Baseline and protection

Start at `15a357a1b0ced1a1b90e9b5edb679646f377ea37` in the existing managed worktree.
Branch: `codex/ugv-zmq-site-readonly-20261026`. Preserve the primary checkout's uncommitted
united packaging files, SDAR sources, database volumes, bindings, PMS and signing keys.

## Decisions

- Add `site_readonly` separately from the unchanged isolated control bootstrap. Construct no
  command transport/control engine, acquire no device writer lease, recover no controls.
- Retain all twelve reviewed operations and add synchronous `vehicle_zmq_plan_route` in
  version 1.1.0 / `zmq_v1_1_0_readonly_13`. Existing control calls and lifecycle methods reject.
- Reuse Socket.IO planning, WGS84 geometry matching and the existing airport transform.
  Record its scene-specific assumptions and source hash; no request-ID correlation claim.
  Three-second preview deadline fits the existing five-second adapter RPC budget.
- Read-only observations do not need a fabricated simulation ID. Authenticated historical
  task reads retain the exact original execution identity and never migrate task ownership.
- Use existing observation/command/audit storage; no frozen migrations or new business tables.
- Validate actual owner startup using the deployed contract and restricted credentials.
  Missing deployment facts remain diagnostic; they cannot grant control admission.

## Work sequence

1. Separate read-only facade/bootstrap, exact catalog, provenance and per-operation blockers.
2. Shared planner, endpoint-scoped serialization, immutable preview result and MCP contract.
3. Chinese console, exact catalog pin, observations, preview diagram/download and audit.
4. Isolated PostgreSQL/MCP/browser/negative tests, actual passive/planning evidence, images,
   candidate services on loopback 19110/19111, gated 19100/19101 handoff and rollback.

## Progress

- [x] Read instructions, verify baseline and protected files; inspect deployed topology.
- [x] Implement read-only Provider and owner startup verification.
- [x] Implement planning preview and exact versioned catalog.
- [x] Implement console and audit integration.
- [ ] Pass source, protocol, PostgreSQL, browser and image verification.
- [ ] Capture actual subscriptions and a geometrically verified 7879 response.
- [ ] Deploy candidate, assess handoff and update site only if conditions hold.
- [ ] Freeze evidence/package hashes, commit and push the delivery branch.

## Validation

Tests must prove zero native commands for controls, lifecycle, reconnect and restart; no
control initialization; malformed/foreign/stale observations; request geometry and planner
timeout/concurrency; no navigation task from a preview; exact catalog drift; authentication,
same-origin, upstream injection and redaction; PostgreSQL identity and owner scoping.
Run typecheck/build/lint/format/frozen protocol plus relevant legacy/native regressions.
Keep argv, cwd, exit status, source and evidence hashes. Never replace field evidence with fixtures.

## Rollout and recovery

Candidate ports 19110/19111 are loopback and fail on conflicts. Existing site is GOWM-shared;
the legacy adapter is repeatedly restarting with timeout errors and is not a proven healthy
fallback. Check tasks, unresolved dispatch/occupancy, leases and writer shutdown before cutover.
Unmet conditions leave a candidate running and an explicit blocked handoff. Retain history and
all state on rollback. HTTP remains the requested LAN transport on 19101.

## Acceptance

Software verification, real observations, real planning, LAN access and historical report reads
have separate statuses. At least one actual geometrically validated 7879 plan is needed for
planning acceptance. Device controls and SDAR patrol acceptance remain subsequent milestones.

## Findings and outcomes

Initial targeted inspection confirms all seven source ports reachable and Socket.IO v4
handshake available at 7879. Reachability/handshake alone does not qualify a planning result.

## Implementation findings — 2026-10-26

The actual GOWM restricted `ugv_smpp_app` role passes the deployed owner contract and binding
verification. Both Provider and Runtime enforce read-only mode: no native command engine,
recovery, schedule, lifecycle outbox dispatch, TTL/outbox cleanup or old link reconciliation.
Catalog/session/idempotency metadata remains the existing Runtime persistence contract.

Real observation sees valid publications from all three components, while localization and
target reports have not been observed. An actual MCP -> 7879 preview matches the operator's
historical navigation coordinate and yields eleven route points; this is not current GNSS.
The preview now retains the accepted raw Socket.IO response plus verifiable hashes.

Site handoff rejects with two active Runtime tasks, two active Provider executions and two
pending commands. No task was stopped or canceled. Existing active handles read in their
original domain; all ten terminal handles are expired and correctly return TASK_EXPIRED.
Finalized history is not rewritten and handle TTLs are not extended.

The first tests exposed a resourceId forwarded into the internal planner's strict request
and cwd-sensitive full-stack fixtures; both are repaired. Initial global ESLint also reports
a pre-existing ignored artifacts/inspection-area-v1/debug/vendor-managed.test.ts outside its
project service. Product source lint is run over apps/packages/scripts/tests/examples; the
ignored debug artifact is preserved. Initial failed logs are retained with final evidence.
