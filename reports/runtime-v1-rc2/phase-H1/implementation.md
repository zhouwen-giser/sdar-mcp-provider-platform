# Phase H1 Implementation Report

## 1. Goal

Replace rc.1 synchronous cancellation with a durable, recoverable control-command state
machine. Preserve stable command identity across retry/restart, distinguish voluntary cancel
rejection from mandatory safe-stop failure, and ensure no database connection spans Adapter
RPC latency.

## 2. Baseline and upstream sync

- Starting SHA: `facc38ee07b6b7491ba37db7e49e847957058cb7`
- `origin/main` SHA: `7e501d07786a7695d205b0bc92b8fdbd667e7f96`
- Target branch remote SHA at phase start: `facc38ee07b6b7491ba37db7e49e847957058cb7`
- H1 implementation SHA: `3f2d4251e6edfb635cbe9b5c961ef0c51fb74eb0`
- Conflicts and resolution: none; target was 0 ahead/0 behind local and `origin/main` had
  no commits absent from the feature branch.

## 3. Implemented changes

- Added a persisted command state machine with due time, retry count, claim lease, diagnostics,
  priority, stop reason and prior Task state.
- Added a multi-instance `DurableCommandDispatcher` and Runtime lifecycle timer.
- Changed cancel and deadline paths to commit intent and return without waiting for the Adapter.
- Added transient retry/backoff, permanent user-cancel rejection reconciliation, deadline
  safe-stop failure, active-stop coalescing and terminal command closure.
- Removed recovery's long-lived database transaction/advisory-lock wrapper around Adapter RPC;
  recovery ownership now uses a short durable lease.
- Added TypeScript mock-Adapter rejection and transport-loss scenarios and made conformance
  cancellation explicitly dispatch the stored command.

## 4. State/transaction/protocol invariants

- `PENDING/RETRY_WAIT -> CLAIMED` commits before RPC; acknowledgement/retry/rejection commits
  after RPC in a separate database operation.
- Every retry reuses task id, operation name, argument hash and command sequence.
- An accepted command Ack is not a terminal Snapshot and is not safe-stop proof.
- Permanent user-cancel rejection restores only the authoritative Reconcile Snapshot, clears
  cancellation flags and permits a new sequence.
- Mandatory stop cannot return to normal running. Permanent rejection or exhausted proof ends
  in technical failure `SAFE_STOP_UNCONFIRMED` with a critical Outbox record.
- One active stop command is permitted per Task; a deadline promotes an existing stop reason.

## 5. Database migrations

`007_durable_command_dispatch.sql` is append-only and leaves migrations 001-006 unchanged. It
widens the command-state constraint, adds claim/retry/rollback fields and due indexes, replaces
the rc.1 global request-hash unique constraint, and enforces a single active stop with a partial
unique index. H8 owns the full migration-006 fixture forward-upgrade gate.

## 6. Tests executed

See `test-results.md`. Required T-001-T-006, T-029 and T-030 have real PostgreSQL/gRPC evidence.
The H1 suite contains an explicit single-connection-pool test with the RPC held open.

## 7. Defects found during implementation

- The rc.1 uniqueness constraint prevented a new cancel sequence after authoritative permanent
  rejection; migration 007 now replaces it with active-command partial uniqueness.
- Deadline claims initially used database wall clock instead of the injected test/worker clock;
  due time is now persisted from the same `now` value as the deadline decision.
- Shared retry rows initially leaked between scenarios; tests now isolate non-target due work
  and thereby exercise the real claim predicate deterministically.

## 8. Known limitations

- H2-H4 structural guards remain red by design: immediate start watchdog, scheduled retry,
  unified observation/outbox transition, immutable Snapshot resolution and full Adapter
  identity validation are not claimed by H1.
- Pause/resume/update still use the rc.1 synchronous control path; later hardening must move all
  external side effects onto the same durable dispatch boundary before rc.2 release.
- Windows cannot execute the installed native `grpc-tools` binary; Linux GitHub Actions remains
  the authoritative build/proto/conformance gate, while source/type/database gates run locally.

## 9. Changed files

See `changed-files.md`.

## 10. Commit and push evidence

- Implementation commit: `3f2d4251e6edfb635cbe9b5c961ef0c51fb74eb0`
- Push result: `facc38e..3f2d425` pushed without force to the target branch.
- CI runs: push `29509615239`, PR `29509616607`; both succeeded. Each passed the `quality`
  job (`pnpm verify`, Buf lint and compatibility) and `compose-smoke` job (Runtime plus
  TypeScript/Python Adapter image builds and ready probe).

## 11. Exit criteria

- [x] H1 implementation and migration are present.
- [x] Required regression tests pass locally without skip.
- [x] Slow Adapter RPC does not hold the only database-pool connection.
- [x] Existing natural-completion/cancel/recovery tests pass.
- [x] Traceability and phase evidence are updated.
- [x] Both implementation push and PR CI runs succeed.
- [x] Report closure is committed for push; its exact SHA is the document-containing H1
      closure commit in Git history, avoiding a circular self-SHA claim.
