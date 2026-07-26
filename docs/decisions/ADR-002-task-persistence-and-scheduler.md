# ADR-002: PostgreSQL task authority and durable scheduling

Status: accepted  
Date: 2026-07-16

## Context

Task visibility, idempotency, scheduled starts, deadlines, cancellation and
recovery must survive process loss and work correctly with multiple Runtime
instances. A transaction cannot span PostgreSQL and an arbitrary Adapter.

## Decision

Use PostgreSQL as the only Runtime lifecycle authority, through explicit SQL
repositories and append-only forward migrations. Persist provider tasks,
admission intents, observations, input requests, idempotency records, immutable
operation snapshots, outbox events, and scheduler/worker leases. Enforce state
and identity invariants with foreign keys, checks, unique indexes and versioned
compare-and-swap updates.

Immediate admission uses a durable, invisible intent and stable task id before
`StartOperation`; accepted publication creates the visible task, initial
observation and outbox event transactionally. Uncertain cross-system outcomes
are resolved through idempotent StartOperation and Reconcile, never by assuming
that an RPC timeout means no side effect.

Scheduling uses database scans and `FOR UPDATE SKIP LOCKED`/expiring claims.
Workers operate from an injected Clock. In-memory timers may reduce latency but
are never authoritative. Deadline publication waits for an Adapter Snapshot that
proves stable termination.

## Consequences

- A Runtime restart can reconstruct all timers and nonterminal work.
- Multiple instances safely compete for due tasks.
- Database and Adapter failure tests are mandatory because correctness depends
  on their interaction.
- Migrations become a public compatibility surface and are never edited after a
  release.
