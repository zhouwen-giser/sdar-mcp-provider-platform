# UGV ZMQ observation — phase 2

Date: 2026-10-24. Baseline: `0bbf5ee223e9a51a71725de7af3b718b9a4ed03a`; branch `codex/ugv-zmq-phase2-20261024`. The operator authorized phase 2 after a phase 1 audit and made controller ID optional.

## Phase 1 audit

- [x] Make controller ID optional without inventing a sending header value; keep explicit identity validation.
- [x] Re-freeze the executable contract and rerun the contract/wire suite: 48 tests passed; source lock verified.
- [x] Preserve historical reports at their original commit and record a separate current G0 report. Pending G0 prerequisites remain visible (12 missing fields/evidence classes); control publication is not qualified.

Phase 1's local completion criteria are satisfied. Its external control qualification is distinct from phase 2 diagnostic observation. Only confirmed publication endpoints and strict message contracts are used here. Missing simulation/provider identity puts data in an explicit diagnostic partition, with control admission disabled.

## Implementation

- [x] Add an actual SUB-only driver with per-component monitor state, bounded messages/queues and orderly shutdown. No REQ/PUSH/control socket exists in this application.
- [x] Normalize validated messages into versioned observations; preserve source time, nullable evidence, origin and native task references without guessing Runtime task associations or producer epochs.
- [x] Persist every received message or explicit local capture failure in a separate append-only PostgreSQL archive with multipart bytes, hashes, process/session provenance and bounded batch writes.
- [x] Provide read-only V2 state/capability diagnostics and scoped archive pagination/raw-frame retrieval. Preserve legacy DTOs, stores and running services.
- [x] Handle foreign/invalid/replayed/out-of-order data, clocks, disconnect/reconnect, restart, backlog, storage errors and budget exhaustion without declaring complete evidence or source freshness.
- [x] Test real isolated PostgreSQL and loopback ZMQ publishers, including 100Hz ingestion, queue/storage faults, restart and byte-for-byte archive reads. Run typecheck/build/lint/format and frozen protocol gates.
- [x] Perform a bounded real SUB-only observation against the confirmed hosts into an isolated database; record source, commands, exit codes, capacity scope and hashes; commit/push delivery.

## Decisions

- The diagnostic app is independently runnable and exposes only read endpoints on loopback by default. It does not replace the deployed 19100/19101 stack in this phase.
- Raw retention is explicit and append-only in this version. Enforce a configured canonical payload budget and finite queues; do not silently delete data or claim this budget measures PostgreSQL disk/WAL usage. Long-duration retention/archive qualification remains G5.
- Source continuity and restart identity are unverified by these protocols. A local receiver session is never labeled a producer epoch. Only local observable gaps are counted; upstream unknown loss remains unknown.
- Snapshots use committed observations. Receipt freshness uses a process monotonic clock; source freshness is separately unverified, skewed, repeated or regressed. A socket connection alone never establishes a current device state.
- Database installation is an explicit owner command for a new schema. Normal observer startup performs no DDL. Existing frozen migrations, history signatures, task records, PMS configuration and runtime volumes stay intact.
- No applicable project AGENTS.md; `/home/sz/.codex/AGENTS.md` is empty. No subagents used.

## Acceptance boundaries

Successful phase 2 means actual publications can be received, validated, durably read back and diagnosed without false online/freshness/completeness claims. It does not qualify navigation/camera lifecycle, inspection completeness, simulation effects, device stop or controlled deployment handoff. G0 gaps and G1–G6 release gates continue to apply to those phases.

## Closeout — 2026-10-24

The read-only observer is implemented. Verification passed: phase 1 wire/config suite 48 tests, observer unit/API suite 21 tests, isolated real PostgreSQL/native ZMQ suite 8 tests, typecheck/build/lint and frozen protocol/source locks. The native loopback test scheduled 500 publications at 100Hz, received/committed all 500 plus four initialization/reconnect messages, and read back every multipart frame with chain verification.

Two bounded six-second site observations (source entrypoint and built JavaScript entrypoint) each archived 48 valid publications across all three services, with zero invalid frames, zero local discards and zero business commands. HTTP state/capabilities/storage/pagination/raw reads succeeded. Both sessions closed normally. The site did not publish localization or target reports in either window; POSITION_NOT_OBSERVED / TARGET_REPORT_NOT_OBSERVED remain explicit. Actual position/trajectory/target-stream operation is not field-qualified by this result.

Evidence and exact commands are in `reports/ugv-zmq-phase2/REPORT.md`, `verification.json` and `raw/`. The temporary PostgreSQL and observer processes are cleaned up after exporting immutable archive entries; the deployed 19100/19101 services remain unchanged. Long-duration retention/G5 and all control qualification belong to later phases.
