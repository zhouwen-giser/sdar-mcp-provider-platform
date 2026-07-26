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
