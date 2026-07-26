# ADR-004: Durable control-command dispatch and stop rejection policy

Status: accepted  
Date: 2026-07-16

## Context

The rc.1 Runtime persisted a control intent but called the Adapter synchronously from the
request or deadline path. A transport failure could leave a Task permanently in `STOPPING`,
and a negative Adapter acknowledgement did not distinguish a user cancellation from a
mandatory deadline stop. Recovery also risked waiting on Adapter RPC while a database
connection and transaction-scoped lock remained held.

## Decision

Control requests commit a stable `task_command` identity before any Adapter call. A database
claim changes a due command from `PENDING` or `RETRY_WAIT` to `CLAIMED` in a short transaction.
The worker then releases the database connection, invokes the Adapter, and commits the result
in a second short transaction. Claim expiry makes a crashed worker's command eligible again;
the same task id, argument hash and command sequence are reused on every attempt.

Cancel endpoints return the persisted Task immediately. An Adapter acknowledgement means only
that the command was accepted, never that the resource has safely stopped. A terminal Snapshot
is the safe-stop proof.

Transient transport failures and explicitly retryable negative acknowledgements enter
`RETRY_WAIT` with bounded exponential backoff. A permanent user-cancel rejection must be
followed by Reconcile. When the authoritative identity and Snapshot are valid, Runtime restores
that Snapshot, clears the stop flags, emits `task.cancel_rejected`, and permits a new command
sequence. If authoritative reconciliation cannot be obtained, Runtime retries instead of
guessing the resource state.

A deadline stop is mandatory and may not return to normal running after rejection. Permanent
rejection, or exhaustion without safe-stop proof, terminates the Task as a technical failure
with stable reason `SAFE_STOP_UNCONFIRMED` and a critical Outbox event. It must not be reported
as `deadline_reached` or another successful compensation outcome.

Only one active stop command exists for a Task. A deadline may promote an existing user cancel
to the stronger stop reason without allocating another sequence. Natural terminal completion
wins and closes any unfinished command without another Adapter call.

## Consequences

- Request latency is independent of Adapter cancellation latency.
- Multiple Runtime instances coordinate through row claims and can recover abandoned work.
- Adapter idempotency over the stable command identity is part of the correctness boundary.
- Runtime health and release evidence must expose retry and `SAFE_STOP_UNCONFIRMED` outcomes.
- Pause, resume and input-update dispatch will adopt the same claim/RPC/finalize pattern in a
  later hardening phase; H1 moves cancellation and mandatory stop first.
