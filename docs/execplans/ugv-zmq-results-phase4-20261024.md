# ZMQ inspection, simulation results and console — phase 4

## Scope and baseline

Baseline: `9b870691e6a26eb6ee0193a1b10a5ab40b95bc6e`, branch `codex/ugv-zmq-phase4-20261024`. The operator authorized continued phased implementation. Work stays in the managed worktree; the primary checkout's packaging work and running 19100/19101 services are preserved. G0 remains pending. Every control endpoint remains numeric loopback and `isolated_simulator` only.

## Implementation sequence

- [x] Recheck phase 3, frozen EO/effect contracts, Provider storage and console boundaries.
- [x] Add identity-scoped immutable result revisions using existing Provider JSONB snapshot storage; bounded history/full received report reads.
- [x] Add `inspection.area` with four convex WGS84 vertices and explicit ellipsoid height, shared EO lifecycle, per-frame findings and independent coverage/source/time completeness.
- [x] Add one-shot `simulation.applyEffect`, correlated execution/effect reporting, unsupported cancellation/pause, retained occupancy after timeout and independently versioned late results.
- [x] Add console contract-gated forms and result/history/export views, preserving server-controlled execution domain and old catalogs.
- [x] Verify isolated native ZMQ + real PostgreSQL, fault/recovery and browser flows; record commands, exit codes, source and evidence hashes.
- [x] Prepare the isolated phase 4 delivery; the final commit and upstream are identified by the delivery receipt and Git history.

## Decisions

Formal MCP/TaskBusiness/catalog/SDAR publication and deployment remain phase 5. Phase 4 provides engine APIs, candidate console contracts and isolated executable integration tests. No arbitrary HTTP-to-ZMQ endpoint is added. Console actions require an actually matching upstream tool/profile; absent or mismatched candidates stay disabled.

Inspection retains all accepted source reports as independently readable JSONB records, plus a bounded 256-item inline summary. Counts describe observations, not unique physical entities. Empty frames do not prove a task-wide absence. Source truncation, unknown acquisition time, missing coverage footprints and unrecoverable PUB history remain explicit. A ratio of one never overrides false/null coverage completion.

Simulation request acceptance, execution outcome, `execution_finished` and referee effect are independent. Late revisions never mutate the original terminal result or finalized Context. Platform timeout does not cancel the native action or release unresolved occupancy. Reconnection/restart cannot prove native producer identity; unknown actions are not replayed.

## Verification record

`reports/ugv-zmq-phase4/` records 207 distinct passing tests (146 ZMQ, 56 console including six legacy Runtime cases, four legacy browser cases and one native ZMQ browser case), source hashes, exact commands/exit codes and immutable evidence. Focused follow-ups verify narrowed canonicalization, current versus historical missing evidence, graceful browser evidence export, content hashes and source-reference chains. G0 intentionally exits 2 with 12 missing prerequisites. No real endpoint control or deployment cutover occurred.

The native browser proves source selection, one effect request, deadline termination, a geometrically calculated late miss, independent occupancy release, disabled unsupported controls and authenticated report download. Late facts do not edit the original terminal result. The test bridge is not a formal Runtime/TaskBusiness release; phase 5 must perform governed catalog/SDAR assembly, owner-approved storage routing, source qualification and handoff/deployment gates.
