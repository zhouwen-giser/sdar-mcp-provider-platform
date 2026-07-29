# Goal 04 Decisions

## G4-P1-B02 — Root PM2 resolution lockfile update

- `package.json` is explicitly task-scoped and now declares the same exact `pm2@7.0.3`
  runtime dependency as the adapter workspace.
- `pnpm-lock.yaml` received the corresponding three-line root importer entry. This is the minimum
  derived change required for `pnpm install --frozen-lockfile` and for the built
  `dist/packages/pm2-runtime-adapter` product path to resolve PM2 under Node's normal package
  resolution.
- Regression evidence: frozen install, build, 49 adapter tests, real PM2 lifecycle E2E,
  `PM2_PRODUCT_PATH_OK`, typecheck, lint, prior-state verification and `git diff --check`.

## G4-P2-B03 — Minimal prior-task test lint correction

- Full-repository lint after the production composition change exposed five type-aware ESLint
  findings in three `G4-P2-B02` Scheduler test files outside the B03 path list.
- `EXECUTION_CONTRACT.md` item 8 permits a minimum out-of-scope correction when the task card is
  insufficient. The changes retain every assertion: they keep direct mock references instead of
  extracting typed interface methods, and add the exact PostgreSQL row projection instead of
  accepting `any`.
- Files: `apps/pms-worker/test/reconcile-scheduler.test.ts`,
  `apps/pms-worker/test/runtime-composition-contract.test.ts`, and
  `packages/pms-persistence-postgres/test/runtime-reconcile-scheduler-repository.test.ts`.
- No production behavior, Job Type, migration, or assertion strength changed. Regression evidence:
  Worker tests, Scheduler PostgreSQL integration, typecheck, and full-repository lint.

## G4-P3-B01 — Production lifecycle E2E fixes and packaging boundary

- The E2E exposed PostgreSQL `42P18` in the production Runtime credential rotation query because
  parameters passed to `format()` had no inferable type. The minimal production fix casts both
  parameters to `text`; the generated `ALTER ROLE` statement and password remain server-quoted.
- Built Worker modules reached unresolved workspace aliases when executed from `dist`. The small
  value-import corrections in `apps/pms-worker/**` and
  `packages/pms-persistence-postgres/src/runtime-instance-allocator.ts` use repository-relative
  module paths, matching other executable product paths without broad Worker composition or
  packaging work.
- The controlled gate instantiates PMS API and Worker through their production composition
  factories from source under `tsx`, while the Runtime and Mock Provider Adapter use built output.
  This isolates Goal 04 lifecycle authority from pre-existing monorepo-wide dist alias packaging
  outside the task scope.
- The fixed Runtime release directory remains under the repository test boundary so Node resolves
  the frozen installed dependencies normally. Its isolated `PM2_HOME` uses a separate short
  temporary path because PM2's Unix-domain socket path is more restrictive than filesystem path
  validation.
- The fixture uses `claimLimit: 1`: claims, leases, retries and fences remain production-backed,
  while explicit Worker shutdown can drain its claimed batch inside the configured lease-duration
  bound.

## G4-P3-B02 — Derived SBOM freshness correction

- The required `verify:v2` and new `static` CI job both fail closed on `pnpm sbom:check`.
- The lockfile changed in G4-P1-B02 when the repository-pinned PM2 runtime dependency became
  available to the built product path, but the derived CycloneDX report was not regenerated.
- `reports/sbom/runtime-v1.cdx.json` is therefore included as the minimum out-of-path derived
  correction. It records the current lockfile digest and PM2 dependency closure; no dependency,
  vulnerability threshold, or product behavior changes in this task.

## G4-P4-B01 — SBOM root identity derivation

- The final required root rename exposed that `scripts/generate-sbom.mjs` hard-coded the retired
  Runtime-era root name while already deriving the version from `package.json`.
- The minimum out-of-path release-tool correction derives the SBOM application name from the same
  private root manifest. Component collection, lock digest, schema and freshness behavior are
  unchanged.
