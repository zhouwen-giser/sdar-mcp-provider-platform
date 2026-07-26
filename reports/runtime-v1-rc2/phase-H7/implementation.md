# Phase H7 Implementation Report

## Goal and outcome

H7 hardens runtime readiness, bounded in-memory admission state, idempotency concurrency,
production images and MCP Streamable HTTP mode. T-041 through T-046 pass without skip. The
implementation commits are `5c03ce6` and the Linux image-baseline repair `3d885be`.

## Runtime health and bounded state

- Readiness reports database, Adapter, Recovery, Scheduler, command dispatcher and TTL cleaner
  independently. A failed worker no longer incorrectly marks the database failed.
- An overlap-guarded `DescribeProvider` probe continuously verifies Adapter availability and
  provider identity. Adapter failure makes readiness 503 while liveness and database readiness
  remain truthful; recovery restores readiness automatically.
- The rate limiter expires old buckets and enforces a configured maximum key count, evicting the
  oldest entry when necessary. A unique-principal flood proves the bound.

## Idempotency and database boundaries

- Migration 012 adds durable claim owner/expiry/attempt fields and backfills every old PENDING
  rc.1 row with an immediately recoverable lease.
- The repository uses a short claim transaction, invokes the Adapter after releasing the
  `PoolClient`, then uses a short owner-CAS completion transaction. It no longer holds a session
  advisory lock or checked-out connection over a slow external RPC.
- A lost invocation expires its lease; the next claimant reuses the stable task identity and is
  explicitly told it is recovering. Pool-max-1 integration proves ordinary SQL remains usable
  while the external boundary is blocked.
- The forward-upgrade test applies only 001-011, inserts old PENDING and COMPLETE rows, applies
  012, verifies data/lease backfill, and proves the new constraint is active.

## MCP HTTP mode

Runtime explicitly adopts SDK 1.29.0 stateless Streamable HTTP by omitting a session-id
generator. Each request gets a fresh Server/transport; no session id, resumability, GET/DELETE
session endpoint or server notification support is claimed. Repeated requests and two official
clients pass with no session identity.

## Production image and evidence

- Docker uses frozen lockfile installation, a production prune stage, non-root `node`, and copies
  only production node_modules, emitted JavaScript, proto and migrations.
- The audit builds twice, compares filesystem/config shape, smoke-checks startup payload, rejects
  tests/docs/references/TypeScript/Vitest, and enforces the Linux baseline.
- GitHub Linux Docker Engine measured 327,026,557 bytes against a 350,000,000-byte ceiling.
  Docker Desktop reports a smaller containerd/compressed figure, so it is not release authority.
- SBOM generation is line-ending stable and invokes the active pnpm entry without a shell.

## Exit status

- [x] T-041..T-046 pass locally without skip.
- [x] Actual rc.1 data forward-upgrade test passes.
- [x] The then-current 10-case grouped TypeScript/Python baseline passed; H8 owns its expansion
      and claim correction.
- [x] Implementation and repair Heads pass push and PR checks.
- [x] Production image is frozen, production-only, non-root, reproducible and size-guarded.
- [ ] Report-containing closure Head checks are pending this report commit.
