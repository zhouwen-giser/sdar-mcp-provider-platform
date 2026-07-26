# Phase H4 Implementation Report

## 1. Goal

Make persisted Operation Snapshots the only operation definition used by historical Tasks and
reject every Adapter response that does not prove it belongs to the exact Task, execution,
operation, arguments, execution context and command.

## 2. Baseline and upstream sync

- Starting SHA: `93e52f1db4dffaba8c7a4a1b47ecc386179a36e5`
- Phase-start and pre-commit `origin/main`: `1233fe4ab11995bbce374cfca4fef618668e95ce`
- Phase-start and pre-commit target remote: `93e52f1db4dffaba8c7a4a1b47ecc386179a36e5`
- Local was 9 commits ahead / 0 behind main and identical to the target remote.
- Annotated `v1.0.0-rc.1` object: `9a4715e6316a23f399ee06eea2444b0245fa1adb`;
  peeled commit: `51d68926ba1bc9e935438e750582693aea3ecf4d`.

## 3. Immutable Operation Snapshot resolution

- Added `loadOperationSnapshot(snapshotId)` and stored-definition reconstruction/validation.
- Added `ResolvedTaskOperation`, which retains the persisted definition, capabilities, schemas,
  resource binding, execution kind, timing/result contract, Adapter operation and version.
- Task Engine, Scheduler, Recovery and command dispatch resolve the Task's
  `operation_snapshot_id`; none of those historical paths looks up the current Manifest.
- Current Manifest remains authoritative only for new calls, catalog/listing and new Snapshot
  creation.
- Response-loss admission recovery carries the persisted snapshot id through the recovery Start
  path, so a removed or changed current operation cannot redirect an old Task.

## 4. Adapter execution identity

- Extended `ExecutionSnapshot` with operation name, argument hash and execution context; command
  Acks echo the full side-effect identity in addition to the command sequence.
- Central validators require exact Task id, nonempty/stable external execution id, operation,
  argument hash, execution mode, simulation id, authorization context and command sequence.
- Start validates the accepted response before publishing a provider binding. Get and Reconcile
  cannot rebind an existing Task. Mismatches leave Task state, binding and Adapter revision
  unchanged.
- Every rejected mismatch increments `sdar_adapter_identity_conflicts_total` and appends a
  durable, idempotent `task.identity_conflict` audit Outbox event with a stable key. It does not
  update the Task row or create a misleading lifecycle observation.
- Migration 010 enforces provider-wide uniqueness for non-null external execution ids.
- TypeScript and Python reference Adapters now echo and validate the same identity fields.

## 5. Tests

- T-017 proves an admission recovery and scheduled Task created from Manifest v1 continue after
  Manifest v2 removes the operation.
- T-018 proves an old input Task retains v1 schema/capabilities while a new v2 call is validated
  against the changed v2 schema.
- T-019/T-020 reject Start task-id and Get external-id mismatches without publishing or mutating
  the wrong provider execution.
- T-021 rejects an incorrect Ack sequence and keeps the durable command retryable.
- T-022 rejects Reconcile argument-hash and execution-context mismatches without binding another
  execution, while retaining an auditable conflict event.

See `test-results.md` for the exact local and CI evidence. No test is skipped.

## 6. Known limitations

- The protocol fields are backward-compatible protobuf additions, but an old Adapter that does
  not echo them fails the hardened identity contract. H8 owns the expanded release-level
  dual-language conformance claim.
- Migration 010 is append-only and applies on the existing schema; H8 still owns the full
  migration-006 rc.1 data-fixture forward-upgrade proof.
- PR #1 is already merged and immutable as review history. Draft PR #3 carries the truthful
  H2-H9 continuation.

## 7. Commit and CI

- Implementation commit: `c58feb782edea857fd9857640a3618fa44df88b8`
- First push runtime `29517410128` and PR runtime `29517412904` failed in Python P3
  conformance because the Python Ack mapping omitted the newly required external execution id.
  All preceding verify steps and both Compose jobs had passed; Buf was skipped after verify failed.
- Repair commit: `5873a7960bae47f0dfc2aa0c7ef41a2b013f2dd0`
- Repair push runtime: `29517588173`, SUCCESS (`pnpm verify`, Buf, Compose)
- Repair PR runtime: `29517591379`, SUCCESS (`pnpm verify`, Buf, Compose)
- Repair PR quality: `29517591502`, SUCCESS
- Repair PR Compose: `29517591413`, SUCCESS

The failed conformance result remains part of the evidence: it demonstrated that a missing echoed
identity field is rejected rather than silently tolerated.

## 8. Exit status

- [x] Historical Tasks do not depend on the current Manifest.
- [x] Identity mismatches are rejected before authoritative Task mutation.
- [x] Reconcile cannot bind a different execution.
- [x] T-017..T-022 pass locally without skip.
- [x] Implementation/repair Head passes branch and PR checks.
- [ ] Report-containing closure Head passes branch and PR checks.
