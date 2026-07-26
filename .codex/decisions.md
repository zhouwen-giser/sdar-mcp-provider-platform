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
