# ADR 0013: Worker lease renewal and cancellation

## Status

Accepted for Platform V0.1 release qualification.

## Context

The Worker can claim more than one job, while Runtime reconciliation can exceed a single lease
period because it performs database, PM2, health, identity, Catalog, and Registry operations. A
serial claimed batch leaves later jobs idle without renewal. A long handler can also outlive its
lease and continue side effects after a higher fencing token has taken ownership.

## Decision

Every claimed job starts as an independent in-process execution immediately. Its immutable lease
identity contains job ID, owner, opaque token, and fencing token; its stable operation identity is
derived only from job ID and fence. The token is never logged.

Each execution renews at `floor(leaseDuration / 3)`, with a 100 ms tested lower bound. Production
configuration already requires a lease of at least 1000 ms. A successful renewal replaces the
execution's authoritative expiry observation. A renewal error means lease ownership is lost:
the execution Signal is aborted and the Worker performs neither completion nor failure writes.
The later owner with the higher fence is authoritative.

Ordinary handler failure calls `fail` only while the execution Signal remains live and renewal has
not failed. Successful work similarly calls `complete` only under the live lease. A
`LEASE_NOT_OWNED` returned by either terminal write is propagated rather than converted to success.

Worker shutdown stops claiming and polling, aborts every active execution, and waits for handlers
to observe their Signal. The existing lease-duration shutdown bound remains the outer safety bound.
Shutdown does not stop Runtime processes.

Runtime reconciliation checks its Signal before and after database, PM2, health, identity,
inventory, and state-store operations. This is especially important for calls that cannot be
interrupted internally: after they return, cancellation is checked before any later state write.
The same Signal is passed through the Runtime infrastructure context and the Catalog discovery
path.

## Consequences

- A claimed batch uses bounded local concurrency equal to the configured claim limit.
- Every active handler owns an independent renewal loop.
- Lease loss deliberately leaves the database lease for expiry and higher-fence takeover.
- External calls must remain idempotent under the stable job/fence identity.
- This does not add distributed scheduling, multi-host coordination, or a new job schema.
