# Phase H2 Implementation Report

## 1. Goal

Enforce the complete immediate and scheduled start window. Persist actual-start and retry
anchors, compensate an execution that is queued or accepted late, and prevent duplicate
resource side effects when a Start response is lost or multiple Runtime instances contend.

## 2. Baseline and upstream sync

- Starting SHA: `fcec0df291cfd3d1303b4f32ed5c6813b9477c10`
- Initial `origin/main`: `7e501d07786a7695d205b0bc92b8fdbd667e7f96`
- Initial target remote: same as starting SHA
- End fetch target: `e768f52d981248b63dcefdbeff42651e3e362867`, three commits ahead
- End fetch `origin/main`: `1233fe4ab11995bbce374cfca4fef618668e95ce`, four commits ahead
- H2 implementation: `20d4598`; upstream merge: `a14d4b3`; format fix: `7f034f9`
- Conflicts: none

The remote advance came from repository-governance PR #2 and an external merge of PR #1, then
`main` back into the target branch. H2 was committed independently before the normal merge; no
history was rewritten and rc.1 remained unchanged.

## 3. Implemented changes

- Added durable start-stop request time, invocation attempt and next-attempt time plus watchdog,
  retry and reconcile indexes.
- Added an immediate watchdog for nonterminal executions without confirmed actual start.
- Made late Start responses publish directly into `STOPPING` with a persisted
  `START_WINDOW_MISSED` command, not a normal running state.
- Added scheduled retryable rejection backoff/jitter and a frozen nonretryable business result.
- Split due start claims from expired uncertain attempts; an uncertain attempt must Reconcile,
  and only authoritative `NOT_FOUND` permits another Start.
- Added claim-owner CAS to every late response/rejection finalizer.
- Persisted and exposed actual-start, compensation and attempt anchors in SDAR Task metadata.
- Extended the mock Adapter with queued, retryable, permanent and response-loss scenarios.
- Serialized database test workers explicitly after the expanded suite exposed schema-reset
  races between Vitest forks; concurrency assertions still run inside real multi-worker tests.

## 4. State/transaction/protocol invariants

- `invocationAttempt` increments exactly when `SCHEDULED -> STARTING` claims a real call.
- A Task at or beyond `latestStartAt` cannot receive a new Start claim.
- Transport error remains `STARTING`; it is never treated as a no-side-effect rejection.
- Reconcile `FOUND` binds the existing execution; `NOT_FOUND` alone releases a retry.
- `actualStartedAt` is not inferred from accepted, scheduled, queued or waiting-input states.
- A start-window stop is a persisted high-priority command with stable task/hash/sequence.
- Neither a stop request nor Ack publishes `start_window_missed`; a `CANCELLED` Snapshot does.
- Claim owner predicates reject stale RPC responses after lease takeover.

## 5. Database migrations

`008_start_window_and_schedule_retry.sql` is append-only. It adds
`start_stop_requested_at`, `invocation_attempt`, `next_start_attempt_at` and partial indexes for
watchdog, retry and uncertain-start reconciliation. Existing migrations remain byte-identical.
H8 still owns the full migration-006 fixture forward-upgrade claim.

## 6. Tests executed

See `test-results.md`. T-007 through T-013 ran against PostgreSQL and gRPC without skip.

## 7. Defects found during implementation

- The rc.1 scheduled claim incremented an attempt even after the window. Expired unstarted rows
  now terminalize before the due-claim query.
- Node and PostgreSQL container clocks can differ by milliseconds. Command due claims now use
  the later of injected Runtime time and database time, retaining fake-clock determinism.
- Shared-schema Vitest files could overlap despite `fileParallelism: false`; `maxWorkers: 1`
  makes isolation explicit while T-013 performs its own real concurrent workers.
- Newly synchronized governance files violated the Prettier gate; a narrow follow-up commit
  formatted only those upstream-added files.

## 8. Known limitations

- Scheduler and recovery still resolve the current Manifest rather than the immutable Operation
  Snapshot; H4 remains red and owns that correction.
- Runtime observation revision is still coupled to Adapter revision in other transitions. H3
  owns the schema split and unified transition API.
- Full Snapshot and Ack identity validation remains H4.
- PR #1 was externally merged during H2 and cannot carry later commits. Draft PR #3 is the
  truthful continuation for H2-H9 and final checks.

## 9. Changed files

See `changed-files.md`.

## 10. Commit and push evidence

- Implementation: `20d4598`; upstream merge: `a14d4b3`; format fix: `7f034f9`
- Push: `e768f52..7f034f9`, no force
- PR: #3, draft, targeting `main`
- CI: push runtime `29511568781`, PR runtime `29511591880`, PR governance quality
  `29511590472`, and PR governance Compose `29511590473`; all succeeded.

## 11. Exit criteria

- [x] Immediate tolerance and late-response compensation implemented.
- [x] Scheduled retry and no-late-start behavior implemented.
- [x] Actual-start semantics and persisted attempts implemented.
- [x] Dual-Runtime response-loss test proves one side effect.
- [x] Required local regressions pass without skip.
- [x] Push and PR-context checks succeed.
- [x] Report closure is committed for push; its exact SHA is the document-containing H2
      closure commit in Git history.
