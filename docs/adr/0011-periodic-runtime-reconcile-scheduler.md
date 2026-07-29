# ADR 0011: Database-backed periodic Runtime reconcile scheduler

## Status

Accepted.

## Context

API commands enqueue `runtime_deployment.reconcile`, but a completed job alone cannot provide
continuous convergence. A Worker crash, a Runtime crash after an ACTIVE observation, or a DEGRADED
deployment could otherwise remain without effective reconcile work. Adding an external queue or a
second scheduler service would duplicate the existing PostgreSQL Job Lease authority.

## Decision

The PMS Worker owns one bounded in-process `PeriodicReconcileScheduler`. It only asks a PostgreSQL
repository to enqueue the existing `runtime_deployment.reconcile` Job Type; it never calls Runtime,
PM2, or lifecycle services.

Each repository tick:

- uses `clock_timestamp()` for deployment age and job availability;
- acquires a transaction-scoped PostgreSQL advisory lock shared by all Worker processes;
- selects a bounded batch of non-terminal RuntimeDeployments;
- excludes deployments with matching pending or leased reconcile work before applying the batch
  limit; and
- inserts pending reconcile jobs atomically in the same transaction.

Succeeded and failed history is append-only and does not block a later periodic enqueue. Pending
work and leased work, including a lease awaiting expiry/fencing recovery, remain authoritative.
Normal Job Lease claim, expiry, and monotonically increasing fencing-token behavior is unchanged.

The in-process scheduler coalesces overlapping ticks. `start()` is idempotent, every tick is followed
by the configured delay even after failure, and `stop()` interrupts the delay and waits for the
current database tick. It does not stop the Worker handler or any running Runtime.

## Consequences

There is no new table, migration, service, queue, Job Type, or direct lifecycle path. PostgreSQL is
the time, serialization, and durability authority. Advisory-lock or insert failure rolls back the
whole tick and releases the transaction lock; a later tick or restarted Worker can recover.
