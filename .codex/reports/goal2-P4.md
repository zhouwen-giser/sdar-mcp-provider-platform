# Goal 2 P4 — Runtime Registration, Catalog, and Registry Report

Date: 2026-07-26

Branch: `codex/goal-02-runtime-governance`

Scope: `G2-P4-B01` through `G2-P4-B08`

## Outcome

P4 closes the control-plane path from an expected Runtime instance through authenticated
registration, provider identity verification, frozen-protocol Catalog discovery, immutable Catalog
and Registry publication, Registry consumer APIs, and the guarded transition to `ACTIVE`.

The authoritative Operation Catalog is obtained only from Runtime `server/discover` plus the
complete `tools/list`. Provider package metadata is not treated as an authoritative Catalog.

## Delivered controls

- Runtime registration and ordered heartbeat accept only pre-existing expected instances and
  dedicated `runtime:register` / `runtime:heartbeat` scopes.
- PMS Provider ID, Runtime bootstrap Provider ID, and Adapter `DescribeProvider` manifest ID must
  match. Mismatch errors use stable redacted codes and prevent `ACTIVE`.
- Catalog discovery validates the frozen `2026-07-28` profile, complete bounded Tool lists, JSON
  Schema, Task Execution Profile, and optional resource binding. It rejects pagination and partial
  results.
- Catalog snapshots are immutable, canonical, checksum-addressed revisions with an active pointer,
  no-op publication, audit, history, and diff.
- Registry snapshots use an explicit public-field projection, stable Provider/Tool ordering, one
  effective MCP endpoint, immutable history, active/LKG pointer, no-op publication, audit, and diff.
- Registry latest/history/diff/watch/bootstrap APIs support ETag/304 and SSE revision hints.
  Registry output excludes credentials, Secret files, PM2 internals, Runtime Task data, and
  qualification claims.
- The worker publication phase commits Catalog before Registry and transitions to `ACTIVE` only
  after both commits. Discovery failure publishes neither. Registry failure preserves the prior
  Registry LKG and prevents `ACTIVE`.

## Task commits

| Task | Commit | Result |
| --- | --- | --- |
| G2-P4-B01 | `bc8947d` | Registration/heartbeat model |
| G2-P4-B02 | `6d811f9` | Registration service, API, and Runtime client |
| G2-P4-B03 | `235a40e` | Provider identity consistency |
| G2-P4-B04 | `96727e7` | Frozen Catalog discovery client |
| G2-P4-B05 | `7e45662` | Immutable Catalog snapshots |
| G2-P4-B06 | `322fc00` | Registry projection and persistence |
| G2-P4-B07 | `f0f0424` | Registry API, Watch, Bootstrap, and SDAR import guide |
| G2-P4-B08 | this task commit | Ready→Catalog→Registry publication closure |

## Verification evidence

- `pnpm --filter @sdar/runtime-registration test`: 3 files, 10 tests.
- Provider identity/reconcile targeted suite: 2 files, 9 tests.
- `pnpm --filter @sdar/runtime test`: 4 files, 16 tests.
- `pnpm --filter @sdar/catalog-manager test`: 1 file, 10 tests.
- Catalog snapshot plus PMS migration suite: 2 files, 11 tests.
- `pnpm test:registry`: 2 files, 12 tests.
- `pnpm test:registry-e2e`: 1 file, 4 tests.
- `pnpm --filter @sdar/pms-api test`: 9 files, 51 tests.
- `pnpm test:catalog-registry-e2e`: 1 file, 4 tests, using a real loopback HTTP
  discovery endpoint and local PostgreSQL.
- `pnpm --filter @sdar/pms-worker test`: 3 files, 9 tests.
- `pnpm build`: passed (`proto:generate` plus `tsc -p tsconfig.build.json`).
- Targeted TypeScript, ESLint, formatting, and `git diff --check` gates passed throughout P4.

Database-bearing commands used the local test PostgreSQL URL supplied only through the command
environment. No credential was written to source, evidence, report, Git metadata, or process
configuration.

## Evidence classification

The P4 tests establish local component and integration behavior, including real local PostgreSQL and
loopback HTTP protocol exchange. They do not constitute real external resource authentication,
Provider qualification, or system-level interoperability certification. Those claims remain gated
by later Provider/System E2E and release tasks.
