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
