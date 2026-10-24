# ZMQ migration phase 5 — formal assembly and release preparation

## Purpose / scope

Connect the native observer/control engine to the existing gRPC Provider, formal MCP Runtime,
TaskExecution and frozen TaskBusiness 1.0-rc2. Publish a separate, strict ZMQ catalog candidate
and an exact SDAR consumer binding. Prepare a reproducible deployment and single-writer handoff.
Real endpoints remain gated by G0; isolated verification is not field qualification.

## Baseline and protected work

SMPP baseline `156c3cc6f8633da569a77479232cc6b60c164c11` in the reused managed worktree;
SDAR baseline `efeb543f` in a separate `skill-driven-agent-runtime-zmq-phase5` worktree.
Both use branch `codex/ugv-zmq-phase5-20261024`. The primary SMPP checkout's uncommitted
united packaging changes and both older SDAR checkouts' evidence remain untouched.

## Interfaces and decisions

- Generalize the gRPC runtime snapshot type; preserve timing and authenticated execution context.
- Keep new public operation identity in executions, results, Context and events. Internal native
  operations remain separately persisted. Reconcile/query never dispatch.
- Publish only implemented native operations. Unsupported legacy parameters/tools fail closed.
- Use frozen Context summary properties for versioned result summaries. No new Artifact type.
  Terminal Context is immutable; late effects use the independent immutable result query.
- Route Provider writes through the established owner store. Never fall back from requested GOWM
  storage. Unresolved occupancy participates in handoff separately from northbound terminal state.
- Candidate catalog/SDAR integration must prove exact schemas, profiles, resource/provider and
  revision/checksum. No automatic physical Skill replay or bypass of confirmation.

## Progress

- [x] 2026-10-24 Read existing formal transport, engine, storage and SDAR repository instructions;
      create isolated phase-5 branches/worktree.
- [x] Implement formal native Provider and strict 12-tool catalog.
- [x] Wire frozen TaskBusiness and owner storage routing; verify scoped SQL with real PostgreSQL.
      Complete owner startup/deployment qualification is still open.
- [x] Implement exact SDAR candidate binding and evidence degradation; verify its readonly
      discovery against the actual isolated formal MCP Runtime.
- [x] Verify formal MCP -> native ZMQ -> durable Task/Context/results, including late effects,
      acknowledged pause/resume and unchanged finalized Context.
- [x] Package candidate tooling/image, admission/handoff/rollback checks; run required gates and
      fix regressions. Archive tests cover reproducibility, executable modes and required inputs.
- [x] Record source/commands/exit codes/evidence hashes and prepare both source/evidence deliveries;
      final commit, remote and package identities are fixed by the external delivery receipt.
- [ ] Accept actual SDAR CAS publication and the native Skill task chain/patrol successor.
- [ ] Qualify GOWM owner deployment, G0 source facts and an idle fenced handoff before cutover.

## Discoveries

The existing gRPC wrapper drops TaskTiming and hardcodes a MQTT-era VehicleSnapshot. Its
availability callback is synchronous and omits execution context. The native repository rejects
GOWM and embeds standalone SQL. These are explicit implementation seams, not cleared gates.
The native control driver currently permits only numeric loopback isolated simulators. G0 still
has 12 missing external facts. Extending catalog transport does not change that restriction.

The command acknowledgement must echo the complete identity and command sequence in the frozen
gRPC envelope. A physical pause alone is insufficient: the formal regression now checks the
Runtime command outbox reaches ACKNOWLEDGED for both pause and resume. Public input hashes are
checked before admission. Provider, console and SDAR pin the published output envelope, including
the Runtime business-failure alternative, rather than just the adapter's internal success schema.

The console checks the complete native catalog for native Providers. Missing/unknown tools,
output/profile/business/execution drift or a different resource fail before control. Native forms
expose exact JSON parameters with unit instructions. The isolated browser fixture covers one
bounded native navigation command and retained late simulated effect results; it remains distinct
from the formal MCP/PostgreSQL/native-ZMQ acceptance fixture.

## Validation

Use real PostgreSQL, native ZeroMQ simulators, formal Runtime/gRPC and authenticated MCP.
Cover exact catalog drift, input/timing/context preservation, idempotent admission, lifecycle,
immutable terminal Context and late versioned results, wrong identity rejection, owner routing,
unknown occupancy, disabled G0 release and package integrity. Re-run legacy transport regressions.
SDAR follows AGENTS.md full gate in its isolated verification runner. Store exact argv, cwd,
exit codes, source and evidence SHA-256. G0 preflight exit 2 is an expected rejected admission.

## Recovery / outcomes

No existing runtime/container is replaced before qualification and a concrete idle handoff.
Stopping the new candidate does not clear unresolved device occupancy. Withdraw new catalog
publication and retain history on rollback; old controls require their original dependencies.
Implementation and field acceptance are recorded separately in the final evidence report.

## Isolated increment closeout — 2026-10-25

Formal acceptance: 12 tests; relevant native/legacy regressions: 134 tests (including the same four
catalog tests); native PostgreSQL regressions: 29; console: 57 plus 6 browser cases; archive: 2.
Native module loading and 39 compiled-file hashes match the image. Its preflight validates all
17 frozen inputs and correctly rejects field admission with 12 G0 gaps (exit 2).

SDAR run `sdar-verify-d392206e-dc0d-4ad9-ad43-f58fb94f85c2` passed all 30 required stages with
unchanged runtime/baseline inputs and cleanup exit 0. It uses the explicit fixture-only default
bridge, an ensurepip-capable Python toolchain and inherited eight-core test-process affinity.
The original failing bridge, missing ensurepip and 19.064% unstable-baseline attempts are retained.
The final baseline drift is 4.872%, relative P95 regression -0.406%, append P95 2.423ms; thresholds
remain 15%, 10% and 20ms. No other service/process resource configuration was changed.

This closes the first formal isolated increment. Phase 5 remains open for the acceptance items
above. No 19100/19101 cutover, real control or SDAR governance publication is claimed.
