# Phase H3 Implementation Report

## 1. Goal

Separate Runtime observation ordering from Adapter Snapshot ordering and make every externally
visible Task transition atomically update current state, append a complete observation and
insert an idempotent outbox event.

## 2. Baseline and upstream sync

- Starting SHA: `1b01891e998d73b5209c5becfdaf013116c3db52`
- Phase-start and pre-commit `origin/main`: `1233fe4ab11995bbce374cfca4fef618668e95ce`
- Phase-start and pre-commit target remote: `f0fe46fef63db589606bb5e89d6f6bd4fba92472`
- Local was already 5 commits ahead of main and 2 commits ahead of the target after the H3-start
  upstream merge; no new remote commit or conflict was present.
- Peeled `v1.0.0-rc.1`: `51d68926ba1bc9e935438e750582693aea3ecf4d`

## 3. Implemented changes

- Added independent `observation_revision` on the Task and full observation fields for
  message, substate, progress, source and optional Adapter revision.
- Added one row-locking, version-aware transition primitive. It enforces terminal
  irreversibility, rejects stale Adapter revisions, increments Runtime observation/version,
  and writes Task, observation and outbox in one transaction.
- Converted scheduling, retry, window, deadline, cancellation, command, recovery, input and
  Snapshot transitions to that primitive. The remaining direct Task updates allocate private
  command sequences only and do not change externally visible lifecycle state.
- Added stable terminal event names and stable event keys derived from Task plus Adapter
  revision, command sequence, start attempt or terminal reason.
- Expanded outbox payloads with a stable Task reference and the complete current state summary.
- Exposed the Runtime observation revision and full observation records in DetailedTask.
- Added migration 009 and ADR-006, preserving append-only migration history.

## 4. Atomicity and revision invariants

- Runtime transitions increment only `observation_revision`; Adapter revision changes only for
  a newer accepted Adapter Snapshot.
- Task state, observation and outbox event commit or roll back together.
- A duplicate event key is a no-op and cannot allocate another observation revision.
- Latest observation revision always equals the Task's persisted observation revision.
- Adapter and Runtime terminal transitions publish `task.completed`, `task.failed` or
  `task.cancelled`, with reason and result/error retained separately.
- A request/Ack remains only a control observation; safe-stop completion still requires an
  authoritative resource Snapshot.

## 5. Tests

T-014/T-015 exercise Adapter revision 1, a Runtime cancellation transition, then Adapter
revision 2 and assert observation revisions 1/2/3, complete observation fields and three unique
outbox events. T-016 installs a real PostgreSQL trigger that rejects the terminal outbox insert,
proves Task/observation/outbox rollback, removes the fault and proves the same transition then
commits. See `test-results.md` for the complete local regression evidence.

## 6. Known limitations

- Immutable Operation Snapshot recovery and Adapter Snapshot/Ack identity validation remain
  the two expected-red H4 guards.
- Migration 009 has an explicit rc.1-compatible backfill, but H8 still owns the real
  migration-006 fixture forward-upgrade release claim.
- Outbox delivery is a durable integration boundary; this phase does not claim MCP
  notifications/tasks delivery.
- PR #1 was externally merged during H2. Draft PR #3 is the truthful continuation for H2-H9.

## 7. Commit and CI

- Implementation commit: `f3ad0383fbf34c4dd78fe9ae88e335ec151c26eb`
- Push: `f0fe46f..f3ad038`, no force
- Push runtime CI: `29514013921`, SUCCESS (`pnpm verify`, Buf and Compose)
- PR #3 runtime CI: `29514017780`, SUCCESS (`pnpm verify`, Buf and Compose)
- PR #3 quality: `29514019017`, SUCCESS
- PR #3 Compose: `29514017491`, SUCCESS

## 8. Exit status

- [x] Runtime and Adapter revisions are separated.
- [x] Lifecycle transitions use the atomic state/observation/outbox primitive.
- [x] Latest revision and stable terminal observation remain consistent.
- [x] T-014..T-016 and old lifecycle/control regressions pass without skip.
- [x] Branch and PR checks pass at the implementation SHA.

## 9. Closure-Head CI defect

The later report-containing Head `857f095` passed PR runtime, quality and Compose, but push run
`29514255881` exposed a nondeterministic security failure: changing the final base64url
character of a JWT signature can leave the decoded bytes unchanged when only unused padding
bits differ. Runtime accepted that non-canonical spelling. The fix rejects any segment whose
decoded bytes do not round-trip to the exact canonical base64url text. The security suite
passed 20 consecutive local runs; H3 remains open until the fix Head passes push and PR gates.

Fix commit `b599480` subsequently passed push runtime `29514585761`, PR runtime
`29514590381`, PR quality `29514592620` and PR Compose `29514590244`. H3 is closed with the
failure retained above as evidence rather than erased.
