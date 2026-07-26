# Phase H8 Implementation Report

## Goal and outcome

H8 proves that published rc.1 data upgrades forward and expands dual-language Adapter
conformance without overstating the tested scope. T-047 through T-049 and all prior regression
suites pass without skip. The implementation commit is `e1041a9`.

## Published migration upgrade

- T-047 applies only the published 001-006 migrations in an isolated PostgreSQL schema and
  verifies their LF-normalized published checksums.
- The fixture contains pending and uncertain admissions; running, queued, input-required,
  stopping, scheduled and terminal Tasks; a pending command; an Observation and Outbox row; an
  idempotency claim; and an actual Adapter execution/snapshot.
- Applying 007-012 proves every required backfill and constraint. A second application is
  idempotent and retains all twelve migration records.
- Recovery, command dispatch and scheduling then continue against the upgraded data. Historical
  Tasks remain readable and immutable operation/Adapter identity remains bound to the saved
  snapshot.
- Migration checksum comparison is LF-normalized for cross-platform stability while accepting
  the legacy raw-checkout checksum already recorded by earlier Windows installations.

## Expanded Adapter protocol conformance

- TypeScript and Python run the same 17 cases covering availability states, identity mismatch,
  stable start identity, response loss/retryable rejection, restricted windows, pause/resume,
  command sequence mismatch, safe-stop rejection/transient transport, output mismatch,
  multi-round input and restart binding.
- The JSON report schema is executable and enforced before reports are written. It requires at
  least 17 cases and three independent claim scopes.
- Both reference Adapters report Adapter protocol `passed`, Runtime Profile `partial`, and
  resource-specific safety `not_claimed`. The reports therefore do not imply qualification of
  real external resources or standalone full P0-P4 Runtime compliance.

## Exit status

- [x] Published rc.1 data upgrades through migration 012 and remains operational.
- [x] Recovery ordering and the prior multi-instance regression matrix pass.
- [x] TypeScript and Python expanded conformance pass 17/17 each.
- [x] All T-001..T-046 regression suites pass without skip.
- [x] Implementation Head passes push and PR workflows.
- [ ] Report-containing closure Head checks are pending this report commit.
