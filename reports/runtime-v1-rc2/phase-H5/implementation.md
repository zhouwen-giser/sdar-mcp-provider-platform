# Phase H5 Implementation Report

## 1. Goal

Turn Task TTL from stored metadata into an enforceable handle-retention lifecycle, and keep
`tasks/get` useful during a transient Adapter outage without hiding identity or contract defects.

## 2. Baseline and upstream sync

- Starting SHA: `d38351a3cc28735225a57ea9b28e003022d04619`
- Phase-start and pre-commit `origin/main`: `1233fe4ab11995bbce374cfca4fef618668e95ce`
- Phase-start and pre-commit target remote: `d38351a3cc28735225a57ea9b28e003022d04619`
- Local was 12 commits ahead / 0 behind main and identical to the target remote.
- Annotated `v1.0.0-rc.1` object: `9a4715e6316a23f399ee06eea2444b0245fa1adb`;
  peeled commit: `51d68926ba1bc9e935438e750582693aea3ecf4d`.

## 3. Retention lifecycle

- Migration 011 adds `handle_expires_at`, `terminal_at`, `expired_at`, `purge_after` and
  `last_confirmed_at`, backfills rc.1 rows and adds due-work indexes and ordering constraints.
- Active Tasks with finite TTL are renewed on every accepted transition and by the cleaner when
  due. They are never logically expired or purged merely because their prior lease elapsed.
- The first terminal transition fixes `terminal_at` and retains the handle for its effective TTL;
  the Manifest default applies when the client omits TTL, with a 24-hour fallback for a stored
  null value.
- Logical expiry is distinct from physical purge. Authorization is checked before expiry is
  disclosed, so an unauthorized caller still receives `TASK_NOT_FOUND`.
- `TaskExpiredError` is mapped to MCP `InvalidParams` with stable `TASK_EXPIRED` data for get,
  result, cancel, update, pause and resume operations.

## 4. Multi-runtime cleaner

- `TtlCleaner` claims bounded batches with PostgreSQL `FOR UPDATE SKIP LOCKED` in a short
  transaction; it never waits for an Adapter RPC while holding the database connection.
- It renews active finite handles, marks terminal handles logically expired, publishes one
  idempotent `task.expired` Outbox record, and purges only after the configured grace period.
- Purge explicitly clears idempotency, Outbox and admission rows; Task-owned observation, input
  and command rows use existing cascading foreign keys.
- Runtime startup and periodic ticks are overlap-guarded and expose ready/failed dependency
  state plus `sdar_ttl_cleaner_total{outcome=renewed|expired|purged|error}`.

## 5. Reliable reads

- `tasks/get` authorizes and loads the persisted Task and immutable Operation Snapshot first.
- A successful Adapter refresh validates the full H4 identity contract before applying a
  Snapshot. Equal Adapter revisions only refresh `last_confirmed_at`; they do not mint a Runtime
  observation revision.
- Only explicit transient gRPC statuses use the persisted fallback. The response carries
  `snapshotFreshness: stale`, `lastConfirmedAt` and
  `degradedReasonCode: ADAPTER_TRANSIENT_UNAVAILABLE` in namespaced metadata.
- A background Reconcile is triggered and observed through recovery metrics/tracing. The read
  path itself does not issue a Start or control command and does not mark the Task failed.
- Identity mismatches and contract violations are rethrown and retain the H4 durable audit path;
  they are never converted into a stale success.

## 6. Tests

- T-023 proves a due active finite-TTL Task is renewed and not expired.
- T-024 proves a terminal Task remains result-queryable before retention ends.
- T-025 uses the official MCP client over Streamable HTTP and proves the expired error on get,
  result, cancel and update, plus non-disclosure to another authorization context.
- T-026 runs two cleaners concurrently, proves a single logical expiry and purge, and checks all
  Task-owned persistence residue is gone.
- T-027 proves a transient Get returns byte-for-byte unchanged persisted state with stale
  metadata and a deferred background Reconcile.
- T-028 proves an Adapter identity mismatch is not masked and leaves the Task row unchanged.

See `test-results.md` for exact evidence. No test is skipped.

## 7. Known limitations

- H8 owns the full migration-006 rc.1 fixture forward-upgrade test and expanded dual-language
  conformance matrix; this phase does not broaden the existing P0-P4 claim.
- Background reconciliation is process-triggered here and is also covered by the periodic,
  multi-runtime Recovery scan. It is intentionally not a second external side-effect queue.
- The local Windows `grpc-tools` binary is a debug-linked upstream artifact and the SBOM helper
  resolves `pnpm` without the `.cmd` suffix. Linux container and remote CI evidence are therefore
  authoritative for build/proto/SBOM gates; no passing result is claimed for the failed Windows
  invocations.

## 8. Commit and CI

- Implementation commit: `6360af89f7ceb482fc7fc511f32b2fc3f06f1d0e`.
- Push runtime `29520205271`: SUCCESS (`pnpm verify`, Buf lint/breaking, Compose).
- PR runtime `29520212409`: SUCCESS (`pnpm verify`, Buf lint/breaking, Compose).
- PR quality `29520211902`: SUCCESS.
- PR Compose `29520211382`: SUCCESS.
- Report-containing closure Head checks: pending.

## 9. Exit status

- [x] TTL is executable, forward-only, indexed and cleanable.
- [x] Active Tasks are renewed/protected rather than deleted.
- [x] Expired MCP wire errors are explicit and tenant-safe.
- [x] Transient Adapter reads return persisted state with degradation metadata.
- [x] Identity conflicts are not hidden by fallback.
- [x] T-023..T-028 pass locally without skip.
- [x] Implementation Head passes branch and PR checks.
- [ ] Report-containing closure Head passes branch and PR checks.
