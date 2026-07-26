# Decisions

## 2026-07-26 — G1-P3-B09 root command wiring

The task requires `pnpm config:schema:generate` and `pnpm config:schema:check`, but neither
root command exists. Add only these two script entries to the root `package.json`, pointing at the
generator under the card's allowed `scripts/**` range. This is the minimum out-of-range change
needed to make the mandatory verification reproducible; it adds no dependency or future capability.

## 2026-07-26 — G1-P3-B10 compatibility command wiring

The mandatory `pnpm test:config-compat` command does not exist. Add one root script that runs the
new `tests/config-compat/**` matrix and then the existing shared-contract package suite. This is the
minimum out-of-range wiring needed to cover all four configuration classes and all Provider config
tests without adding an empty or always-successful command.

## 2026-07-26 — G1-P4-B01 empty workspace lock importer

Adding `packages/pms-domain` makes pnpm treat the lockfile as stale unless the new dependency-free
workspace has an empty importer. Add only `packages/pms-domain: {}` to `pnpm-lock.yaml`. This
minimal out-of-range lock metadata prevents mandatory filtered tests from invoking dependency
resolution; it adds no package or infrastructure dependency.

## 2026-07-26 — G1-P4-B02 PostgreSQL migration verification wiring

The mandatory `pnpm test:pms-migrations` command does not exist, and no existing test command
validates a PMS schema because the Migration set was previously empty. Add one root script and one
focused PostgreSQL test outside the card's production-file allowlist. The test applies the real SQL
twice in an isolated schema, checks the exact table boundary, and exercises representative UUID,
checksum, JSONB, and Job Lease constraints; it is not an empty success shim.

## 2026-07-26 — G1-P4-B03 ports public export and contract test

Repository ports under the allowed `src/ports/**` path would not be consumable through the package's
existing root export, and the mandatory package test would not exercise type-only contracts.
Export the ports from `src/index.ts` and add one compile-time/runtime contract test under the
existing package test directory. These are the smallest out-of-range wiring changes; they add no
implementation or infrastructure dependency.

## 2026-07-26 — G1-P4-B04 Provider Package composite identity

The committed PMS schema correctly keys Provider Packages by `(package_id, package_version)`, while
the initial Provider domain value carried only `packageId`. Persistence cannot safely choose a
version implicitly when more than one version exists. Add the paired optional `packageVersion`
field and validation to the Provider entity, with a regression test. This minimal domain correction
keeps package selection explicit and avoids a lossy PostgreSQL mapping.

## 2026-07-26 — G1-P4-B05 lossless package projection compatibility migration

The three delivered production descriptors use Provider Type segments with underscores, while the
initial domain/SQL regex accepted only hyphens. The initial package table also cannot retain the
complete authoritative descriptor. Do not edit committed migration `001`; append PMS migration
`002_provider_package_source_projection.sql` to align the identifier constraint and add a checked
JSONB `source_document`. Extend the pure package value with optional projection/timestamp fields so
sync can overwrite drift using an explicit optimistic token. These are required compatibility
changes outside the card allowlist, not future platform capability.

The mandatory root `pnpm test:pms` command was also absent. Add one real database-gated script that
runs the PMS application and persistence integration suites; update the existing PMS migration-set
expectation for the append-only `002` file. This is verification wiring, not an empty success shim.

## 2026-07-26 — G1-P4-B06 database-enforced append-only Audit

An append-only repository interface alone cannot prevent a privileged application path from issuing
an Audit update or delete. Do not modify prior migrations; append PMS migration
`003_audit_append_only.sql` with a database trigger that rejects both operations. Extend the
existing real `test:pms` wiring and migration-set expectation for the new concurrency/security
suite. These minimal migration and verification changes are necessary to prove the card's explicit
append-only acceptance criterion.

## 2026-07-26 — G1-P5-B03 expose optimistic tokens on managed aggregates

ProviderType, Provider, and Resource tables already carry `updated_at`, and their repository update
ports require it, but read models did not return the token. A management client therefore could not
perform a valid optimistic status update. Add optional validated `updatedAt` values to these pure
entities and map the existing columns in PostgreSQL. This minimal domain/persistence correction is
outside the API card allowlist but introduces no schema or future capability.

## 2026-07-26 — G1-P5-B04 configuration verification wiring

The mandatory `pnpm test:pms-config` command does not exist. Add one root script that runs the
Configuration Center contract suite and the PMS Config Draft API suite using explicit TypeScript
test paths. This is the minimum out-of-range verification wiring and avoids root Vitest discovering
stale compiled test copies; it adds no empty success shim or publication capability.

## 2026-07-26 — G1-P5-B05 database-enforced revision history

The card allows PostgreSQL persistence changes, but the append-only PMS migration set lives at the
repository-level `migrations/pms/**` path. Do not modify delivered migrations `001` through `003`;
append migration `004_config_revision_history_guard.sql` to reject revision deletion, payload
mutation, and invalid lifecycle transitions in the database. Extend the real `test:pms-config`
command with a PostgreSQL integration suite because in-memory tests cannot establish concurrent
publish safety or database-enforced immutable history.

## 2026-07-26 — G1-P5-B06 Runtime Config E2E verification wiring

The mandatory `pnpm test:pms-config-e2e` command does not exist. Add one root script that requires
the local PostgreSQL test URL and runs the explicit Runtime Config latest API E2E test. This is the
minimum out-of-range wiring needed to prove authenticated deployment fallback, ETag/304, SecretRef
projection, and authoritative identity projection against a real Published revision; it is not an
empty or mocked-success command.

## 2026-07-26 — G1-P6-B01 Runtime Config Client workspace lock importer

Adding the new `packages/runtime-config-client` workspace requires pnpm to record its link to the
existing shared Runtime Configuration Contract. Update only the generated workspace importer in
`pnpm-lock.yaml`. This minimal out-of-range metadata change is required for the mandatory filtered
test and frozen installation; it introduces no external dependency or later P6 behavior.

## 2026-07-26 — G2-P1-B01 RuntimeDeployment workspace lock importer

Adding the dependency-free `packages/runtime-deployment` workspace makes pnpm's dependency-state
check invoke installation unless the workspace has an importer in `pnpm-lock.yaml`. Add only the
empty `packages/runtime-deployment: {}` importer. This minimal out-of-range lock metadata is needed
for the card's mandatory filtered test and frozen installation; it adds no dependency or later
Runtime process, persistence, PM2, or provisioning capability.

## 2026-07-26 — G2-P1-B03 RuntimeDeployment migration constraint coverage

The card permits the new PMS SQL and schema documentation, while its completion criteria require
constraint coverage and the mandatory existing PMS migration suite hard-codes both the migration
list and table boundary. Update only `tests/pms-migrations/pms-migrations.test.ts` outside the
allowlist to recognize append-only migration `005`, the three new control-plane tables, and to
exercise Provider FK, desired replica consistency, PM2-name uniqueness, stable instance linkage,
action idempotency, and an upgrade from the exact migration-004 schema while preserving existing
Provider rows. This does not weaken or skip any existing assertion.

## 2026-07-26 — G2-P1-B04 RuntimeDeployment persistence workspace dependency

The persistence adapter now maps the pure `@sdar/runtime-deployment` aggregate and process
projection. Add that existing workspace package to
`packages/pms-persistence-postgres/package.json` and only its generated workspace link to
`pnpm-lock.yaml`. The package remains an infrastructure adapter depending inward on a pure domain
package; no PM2 or PostgreSQL type enters the RuntimeDeployment domain.

## 2026-07-26 — G2-P1-B05 application workspace and mandatory test wiring

RuntimeDeployment application use cases depend on the existing pure domain workspace, so add its
workspace link to `packages/pms-application` and the generated lock importer. The mandatory root
`pnpm test:pms` command previously listed explicit files and would omit the new use-case suite;
append that real suite to the command. These are minimal wiring changes, not PM2 integration or an
empty success script.

## 2026-07-26 — G2-P2-B02 DatabaseProfile environment scope and migration verification

The B02 acceptance criterion requires DatabaseProfile persistence to be scoped by both Provider and
Environment, while the B01 card listed Provider-specific naming but did not explicitly name an
environment field. Add `environment` to the already delivered pure DatabaseProfile value and its
focused test as the minimum dependency correction; do not introduce provisioning behavior there.

The mandatory root `test:pms-migrations` suite also hard-codes the append-only migration list and
control-plane table boundary outside this card's allowlist. Update only that existing test to
recognize migration `006`, validate its Provider/Environment uniqueness, SecretRef-only columns,
status/error constraints, and audit reference. These changes strengthen existing verification and
do not relax or skip prior migration assertions.

## 2026-07-26 — G2-P2-B03 provisioning Port export and executable contract

The card limits production code to `packages/runtime-deployment/src/ports/**`, but the Port would
not be consumable through the package root and the mandatory package command only discovers its
existing `test/**` directory. Add one root index export and one focused Port contract test outside
the allowlist. These are minimal public wiring and verification changes: they add no PostgreSQL
driver, Secret resolver, network behavior, or Provisioner implementation.

## 2026-07-26 — G2-P2-B04 Provisioner workspace lock importer

The new `packages/postgres-provisioner` workspace consumes the existing pure Provisioner Port and
the repository's existing `pg` version. Add only its generated workspace importer to
`pnpm-lock.yaml`. This is required for filtered tests and frozen installation; it adds no new
external package version or authority.

## 2026-07-26 — G2-P2-B05 Secret Store workspace lock importer

The dependency-free `packages/secret-store` workspace requires an empty importer in
`pnpm-lock.yaml` for frozen workspace validation. Add only that generated importer; the adapter uses
Node filesystem primitives and introduces no external dependency.

## 2026-07-26 — G2-P2-B06 existing Runtime migration engine evidence and timeout

The delivered Runtime engine owns advisory locking and checksum history, but returns no per-file
result and waits indefinitely for the lock. The B06 card explicitly requires using that engine,
complete version evidence, timeout evidence, and concurrent single execution. Extend
`runMigrations` compatibly with an optional positive statement timeout and a returned immutable
per-file `applied`/`already_applied` result; existing callers may continue ignoring the return.
Update its focused unit test and add only the new workspace lock importer. Do not alter any
Migration SQL, set mapping, version key, checksum rule, transaction boundary, or rollback behavior.

## 2026-07-26 — G2-P3-B01 infrastructure Port package export

The card limits implementation to `packages/runtime-deployment/src/ports/**`, but later composite
adapters must consume the infrastructure-neutral Port through the workspace package contract. Add
only the corresponding export line to `packages/runtime-deployment/src/index.ts`. This minimal
out-of-range wiring exposes types and validation only; it adds no PM2 dependency, command surface,
process implementation, network listener, or infrastructure authority.

## 2026-07-26 — G2-P3-B02 PM2 adapter workspace bootstrap

The card's source allowlist assumes `packages/pm2-runtime-adapter` exists, but the workspace has no
such package and the mandatory filtered test cannot resolve it. Add only the minimal package
manifest, root source export, focused Bootstrap renderer test, and generated lock importer outside
`src/bootstrap/**`. The package consumes the existing infrastructure-neutral type contract and
adds no PM2 library, process control, arbitrary environment, script, cwd, or command capability.
