# Simulation view capability, exchange diagnostics and per-operation admission

## Purpose / Outcome

Implement the user's requested simulation view adjustment as an explicitly distinct capability;
fix native command exchange timeouts and diagnostics, and qualify each control operation.
Continue in the existing isolated worktree; preserve primary checkout packaging changes.

## Requirements / context

Frozen MCP 2026-07-28, existing exact ZMQ catalogs and historical results remain authoritative.
Current source 3adce25, SDAR 9b3a9e09; formal services are verified anonymous readonly.
Actual TeleControl.zoom rejects with UNSUPPORTED: simulator recreates camera without optical
lens stop feedback. Existing upstream V2.2 offers no simulation-FOV method. Previous accepted
scope excluded upstream modifications; a clarification requests a real FOV endpoint/source or
permission to expand that scope. No unsupported wire method or success will be invented.

## Architecture / interfaces / decisions

- Keep transportTimeoutMs as a legacy input; add independent bounded send/receive configuration.
  Site defaults follow confirmed protocol 1000/2000 ms; isolated legacy tests remain explicit.
- Record stable failure stage/code, elapsed times, send completion, bounded response size/hash
  and validation code in existing command JSONB, including fallback stop. Never log credentials,
  arbitrary exception text or unbounded replies. Preserve original native rejection details.
- Unknown command outcomes remain uncertain and never automatically replay. Permission/deadline
  revocation before a send remains distinguishable from an attempted send with unknown result.
- Site admission requires per-operation deployment support evidence. Missing support is unverified;
  unsupported optical zoom disables only that action. Component freshness/occupancy/parameters
  are checked separately at availability and immediately before dispatch.
- Publish simulation view under its own semantics, version and confirmation scope only with an
  implemented/verified downstream contract. Existing optical zoom and old catalogs stay exact.
- No new tables or frozen migration changes. Formal remains readonly until qualification.

## Progress

- [x] Inspect actual refusal, legacy timeout/diagnostic implementation and repository instructions.
- [x] Implement split timeout resolution and persistent staged diagnostics with regression tests.
- [x] Implement per-operation support and UI reasons, including direct-call/dispatch protection.
- [ ] Resolve actual simulation-view backend, implement versioned MCP/SDAR contract and real results.
- [x] Run focused checks, full SMPP gate and isolated PG/MCP/ZMQ/browser cases. SDAR source is
      unchanged; its gate becomes applicable when the genuine simulation-view contract is implemented.
- [ ] Build/review candidate deployment, publish only verified versions, retain honest site gaps.
- [ ] Update docs/evidence and commit/push authorized changes.

## Steps / validation

Test replies after 1000ms and before 2000ms, disconnected sender, receive timeout, malformed JSON,
wrong correlation, explicit native rejection, disposal/reconnect and no replay. Verify diagnostic
persistence across restart and fallback stop; validate redaction and bounded payloads. Exercise
supported/unsupported/unverified actions on one component, exact schema matching and revoked
admission between check and send. Simulation view needs genuine FOV/camera revision feedback;
software fixtures and site action evidence are recorded separately.

## Recovery / artifacts

Use current independent storage for tests. Preserve all database volumes, accounts, bindings,
unknown occupancy and signing keys. Runtime rollback target is existing verified readonly mode.
Evidence records source, commands, exit codes and hashes outside secret-bearing private inputs.

## Discoveries / outcomes

Local timeout, diagnostic and operation-admission fixes are software verified. The backend for
simulation view remains unresolved; this request is not complete and no FOV capability is published.
Formal runtime and governance remain on the verified anonymous readonly version. A private candidate
configuration explicitly selects 1000/2000 ms and separates actual action evidence from incomplete
reports. It has not been activated; predecessor chassis occupancy still requires the existing
reconciliation and cannot be bypassed by changing the control scope.

### Focused validation progress

Native/control/contract focused suite passes 63 tests, including real delayed REP, send/receive
failure separation, malformed/correlation failures, support revocation and persistent no-replay
facts. Real PostgreSQL/MCP v13 suite passes 4 tests, including direct refusal and unchanged
command diagnostics after restart. Full source lint passes. A frontend unknown-value ReactNode
type error was found and corrected; the first browser attempt used the previous build and its
new assertion failed, retained as preliminary evidence. Repeat against the corrected build in
the complete site gate. No assertions were removed or weakened.

Simulation view backend is still unresolved. The missing interface/scope question remains
pending; no synthetic FOV operation or unsupported native method has been published.

### First complete gate and final persistence case

software-1 passes all 21 steps with unchanged source, including four browser configurations.
A final real PostgreSQL case then proves that a lost REP retains receive-timeout facts even
when later correlated physical feedback resolves a camera action, including after restart and
with exactly one native request. The focused control/PostgreSQL set passes 64 cases. Fallback
stop wrapper failures now measure their actual monotonic elapsed interval rather than a zero
placeholder. Run software-2 on this final source before committing the local fixes.

### Final local-fix verification

software-2 completed 2026-10-29T15:47:53.184Z: all 21 commands exit 0, every sourceUnchanged=true.
Source fingerprint is 8c3b2e6639517508b10aeafacf88b4786f4679027b2046a5a43bede07a0cf29b.
Receipts include actual commands, times, exit codes, log hashes and the source manifest under
reports/ugv-zmq-view-diagnostics-20261029/software. Log hashes were independently checked and
five credential patterns found no matches in the retained receipts. No real device commands were
issued by these checks. The final native/PostgreSQL suites include the later correlated completion
case without replay; browser checks include unsupported zoom versus supported position selection.

The source commit/push receipt is recorded beside the external verification artifacts at
/mnt/data/ugv-zmq-view-diagnostics-20261029. Simulation view still needs the pending upstream
interface/source or explicit expansion of the prior no-upstream-change scope. Existing native
UNSUPPORTED, regional ACK uncertainty and missing stationary evidence are not reclassified as
successful field actions by these software fixes.

### Clarified project-local implementation

The user subsequently requested extension inside this project. The successor plan
docs/execplans/ugv-simulation-view-20261030.md implements a distinct project-owned CARLA
camera, exact 1.4.0/fourteen-tool MCP catalog and real FOV/new-frame evidence. Its source
commit is 58d3d73; all 24 expanded checks pass. This clarified scope leaves SDAR unchanged.
Formal activation still requires the matching site SDK and verified vehicle/world mapping;
the old optical zoom refusal and previous field unknowns remain valid. The local fixes d2a03f7
are pushed and verified; the new delivery's final push receipt is maintained externally.
