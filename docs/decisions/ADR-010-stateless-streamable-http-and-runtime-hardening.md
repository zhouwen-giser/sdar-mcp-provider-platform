# ADR-010: Stateless Streamable HTTP and Runtime operational hardening

Status: accepted

Date: 2026-07-17

## Context

rc.1 created a low-level MCP Server and Streamable HTTP transport per POST but did not state
whether that was an intentional stateless design. It also recorded Adapter readiness only at
startup, kept an unbounded source-IP rate-limit Map, and held a session advisory lock and
PoolClient while an idempotent invocation performed a potentially slow Adapter RPC. The runtime
image installed with a non-frozen lockfile and copied development dependencies into production.

## Decision

The Runtime uses the locked SDK 1.29.0 stateless Streamable HTTP mode. In that SDK,
`sessionIdGenerator` omission is the documented stateless configuration; its exact-optional
TypeScript declaration rejects spelling the property as `undefined`, so the code uses a named,
immutable empty options value and records this version-specific fact. Every POST receives an
independent Server and transport. Runtime does not issue or accept an MCP session id, does not
provide GET/DELETE session lifecycle, has no event store/resumption, and does not declare Task
status notifications. Durable PostgreSQL Tasks and polling provide cross-request continuity.

Readiness reports database, Adapter, recovery, scheduler, command dispatcher and TTL cleaner
separately. A periodic, overlap-guarded DescribeProvider probe marks only the Adapter failed after
the configured consecutive-failure threshold and automatically restores it after identity-valid
success. `/health/ready` probes PostgreSQL independently. Worker failures mark their own
component; they do not guess that the database failed. `/health/live` remains a process/event-loop
check and is unaffected by a temporary external outage.

The local source-IP rate limiter has an explicit maximum key count. Every consume removes expired
windows, and new-key pressure evicts the oldest remaining window before insertion. This bound is
per replica and is defense in depth; production-wide limits belong at a shared gateway unless a
shared limiter backend is introduced later.

Idempotency uses migration 012 claim leases instead of session advisory locks. A short
transaction creates or takes an expired claim with a stable task id and owner token, then releases
the PoolClient. The Adapter invocation occurs outside the claim transaction. A short owner-CAS
stores the final Task/result and clears the lease. Other callers poll COMPLETE/PENDING without
holding a connection; an abandoned owner makes its lease immediately reclaimable, while a
process crash is recovered after PostgreSQL lease expiry and Reconcile uses the same task id.

The production image installs from the frozen lockfile, builds in a development stage, prunes to
production dependencies and copies only runtime `dist`, Proto and migrations. It remains
non-root. CI builds it twice and compares filesystem layers plus runtime config, checks a 150 MB
compressed-size ceiling, and verifies that tests, docs, references, TypeScript and Vitest are
absent.

## Consequences

- Repeated POSTs and multiple clients work without sticky routing or a session store.
- Streaming notifications and resumability are not available in rc.2 and must not be advertised.
- Adapter, database and worker incidents have independently actionable readiness signals.
- Idempotent slow calls no longer reserve scarce database clients across an external RPC.
- Rate limiting is memory-bounded but not cluster-global; operators must configure an ingress
  limit for a global policy.
- Any future stateful-session design requires a new ADR, lifecycle store and concurrency tests.
