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
