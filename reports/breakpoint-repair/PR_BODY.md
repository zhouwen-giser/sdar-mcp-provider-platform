## Goal

Close the SMPP-owned Climate stable-confirmation and provider recovery breakpoints exposed by the
SDAR x SMPP x Home Assistant integration, while preserving at-most-once physical side effects.

## Main baseline

- Base SHA: `cc5dca8fab499826c8d1011e6f790e5fb0a8e3ef`
- Final merged-main SHA: `cc5dca8fab499826c8d1011e6f790e5fb0a8e3ef`
- Verified candidate SHA: `23eb2ed1c14830a8a6b328d3a67df1badcd492ab`
- Report-only evidence commit SHA: `84e5af71979e05e95f45664cadf2ab357a6c3df2`

The verified candidate is the exact runtime-code candidate that passed the gates below. The later
report-only evidence commit contains evidence documents and no runtime implementation change.

## Fixed breakpoints

- BP-SMPP-001: `FIXED` - stable observed state is required before Climate success.
- BP-SMPP-002: `FIXED` - covered crash/restart windows reconcile without duplicate HA calls.
- BP-SMPP-003: `ALREADY_FIXED_ON_MAIN` - capability advertisement and implementation are aligned;
  this branch adds contract regression coverage.
- BP-SMPP-004: `PARTIALLY_FIXED` - deterministic recovery foundation is expanded and verified;
  exhaustive real process/network fault qualification remains out of scope.
- BP-SMPP-005: `DEFERRED` - the consumer access-profile metadata gap is audited without changing the
  frozen Registry projection.

## Climate stable-confirmation semantics

Climate completion now requires both a minimum stable duration and a minimum number of matching
observations under one validated policy. Candidate start/count/last match/last observation, the
policy snapshot, and the confirmation deadline are durable. A mismatch or unreachable state resets
the candidate. Deadline expiration fails technically instead of allowing a late success.

The permanent regression covers `off -> cool -> off` with the regression occurring three seconds
after the first match: the Task is not `SUCCEEDED`. A later uninterrupted `cool` window can succeed.

## Crash/recovery semantics

- `NOT_STARTED`: deadline is checked before any dispatch.
- `INTENT_PERSISTED`: recovery treats dispatch as uncertain and observes/reconciles; it does not
  blindly replay `callService()`.
- Home Assistant returned before `CALL_RETURNED` persistence: restart retains one physical call and
  reconciles actual state.
- `CALL_RETURNED` / `CONFIRMING`: restart resumes the persisted candidate window without redispatch.
- Corrupt persisted state fails closed.

## Side-effect safety

Deterministic Fake Home Assistant clients record `callServiceCount`. Duplicate tasks and the covered
crash/restart paths prove no duplicate side effect for the same task. Cancel remains unsupported and
never means physical rollback; no inverse device operation is introduced.

## Task-control capability alignment

Climate and Light manifests advertise `cancel=false` and `pauseResume=false`. The real in-memory
gRPC Adapter services return stable negative acknowledgements for cancel, pause, and resume, and
make zero Home Assistant calls. Catalog projection and provider documentation do not claim those
controls.

## Registry / consumer compatibility impact

Native Registry state, `sdar-registry-v1` DTO/checksum, projection lineage, and
latest/304/bootstrap/watch semantics are unchanged. The existing `anonymous_intranet`, private HTTP,
and `direct_container` deployment behavior remains intact. A single versioned consumer
access-profile metadata object is still a documented follow-up rather than a frozen-projection
change in this repair.

## Test evidence

- `pnpm verify:v2`: PASS (1111.1 seconds)
- `pnpm verify:platform`: PASS (274.7 seconds)
- `pnpm container:check`: PASS (50.4 seconds)
- Production Bundle from clean exact-candidate Linux archive: PASS (33/33)
- Climate focused selection: PASS (7 files / 40 tests)
- `pnpm test:ha-climate`: PASS (5 files / 33 tests)
- `pnpm test:fault-injection`: PASS (5 files / 39 tests)
- Climate Runtime E2E: PASS (1/1)
- `pnpm test:recovery`: PASS (9/9)
- Home Assistant provider-platform E2E: PASS (4 tests)
- `git diff --check`: PASS

No real-device write test was run: `physicalDeviceWrites = 0`.

## External blockers

None for the required code-owned gates. The bounded BP-SMPP-004 process/network qualification and
BP-SMPP-005 metadata follow-up are documented, not presented as complete. Local `gh` CLI
authentication is not a code blocker because PR publication uses the authenticated GitHub
connector.

## Security impact

The change is fail-safe: stable physical observation is required before success, uncertain dispatch
is not replayed, and persisted corruption fails closed. Real-device write gates remain closed.
Anonymous intranet access is not broadened and remains dependent on private network isolation and
explicit insecure-internal-transport acknowledgement.

## Backward compatibility

No Adapter protocol, frozen Registry DTO/checksum, or existing Home Assistant operation is changed.
Legacy timeout-only Climate construction derives a bounded stable-confirmation policy. Existing
in-flight executions preserve their persisted policy snapshot across restart.

Verification support changes are intentionally narrow: PMS registration expiry uses a deterministic
past boundary, Unix mode-bit rejection remains enforced on POSIX while Windows tests avoid claiming
POSIX semantics, nested workspace `node_modules` are excluded from Docker contexts, and Markdown and
shell delivery bytes are pinned to LF. These changes do not alter Runtime authentication or Provider
control contracts.

## Rollback

Revert the branch commits as a unit to restore the previous Climate completion behavior. No database
migration or Registry projection rollback is required. Rolling back would reintroduce first-match
completion and is therefore not recommended without disabling Climate writes.

## Non-goals

- Production-readiness certification or real-device fault qualification.
- Automatic PR merge, release, tag, or deployment.
- New Home Assistant domains, providers, fan/swing/humidity/preset features, or Runtime redesign.
- SDAR or organization-control-plane changes.
- A new Registry projection or consumer access-profile protocol.
