# ADR 0002: Use governed PM2 Fork Mode on one node for V0.1

- Status: Accepted
- Date: 2026-07-26
- Goal: goal-02
- Task: G2-P0-B03

## Context

V0.1 needs local Runtime lifecycle governance and crash recovery. Kubernetes or cross-node
scheduling would add placement, networking, storage, and credential distribution concerns that are
outside the release scope.

## Decision

Use PM2 Fork Mode on a single node behind a typed `RuntimeInfrastructureAdapter`.

- One Runtime replica maps to one PM2 application named in the `sdar-runtime-*` namespace.
- Only repository-approved Runtime releases, entrypoints, working-directory roots, environment
  keys, and `*_FILE` secret paths are accepted.
- The adapter exposes typed lifecycle operations, never arbitrary commands or scripts.
- PM2 `online` is only process evidence. `ACTIVE` also requires live, ready, identity, and official
  Catalog checks.
- Tests use an isolated `PM2_HOME` and cannot manage non-platform processes.

## Consequences

PM2 supplies local supervision while PMS reconciliation remains authoritative for desired state.
The adapter must preserve stable error codes, idempotency, timeout evidence, and Audit records.

## Alternatives rejected

- Kubernetes: deferred beyond V0.1.
- Shell/HTTP command executor: rejected because it defeats the allowlist boundary.
- PM2 Cluster Mode: rejected because Runtime identity and Task Authority semantics require explicit
  replicas.
