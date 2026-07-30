# PMS Console API V1 — Local Validation Required

## Work environment

- Node.js: `v24.14.0` available; repository requires `>=22 <23`.
- pnpm: `11.7.0` available; repository declares `pnpm@11.13.1`.
- npm: `11.9.0` available.
- Repository `node_modules`: unavailable.
- Dependency installation attempted: no.
- Network dependency installation required by the implementation: no.

Because the Work task forbids installing dependencies, TypeScript, ESLint, Vitest, build, and the
dependency-backed OpenAPI validation pipeline were not executed here. They must not be interpreted
as passed or failed.

## Restore the frozen input

The Git baseline ignores generated `dist` directories. Before validation, extract the supplied
`pms-console-api-contract-v1-frozen.zip` over the repository so that this exact file exists:

```text
contracts/pms-console-api/v1/dist/openapi.bundle.json
```

Its SHA-256 must be:

```text
a0982fd32dd5647831b528571fbee3972eac29ee0e8f7295b960e0507bf4ab1a
```

Do not regenerate, edit, or refreeze the contract.

## Required local toolchain

- Node.js 22.x, matching `package.json`.
- pnpm 11.13.1.
- PostgreSQL only for the existing integration and production-composition suites that require
  `TEST_DATABASE_URL`.

## Full validation

Run from the repository root:

```bash
pnpm install --frozen-lockfile

pnpm pms-console-contract:check
pnpm pms-console-conformance:check

pnpm --filter @sdar/pms-api typecheck
pnpm --filter @sdar/pms-api lint
pnpm --filter @sdar/pms-api test
pnpm --filter @sdar/pms-api build

pnpm typecheck
pnpm lint
pnpm format:check
pnpm build

git diff --check
```

Command purposes:

- `pms-console-contract:check`: runs the frozen contract validation pipeline.
- `pms-console-conformance:check`: validates mandatory hashes, 36-route parity, and protected paths.
- PMS API `typecheck`, `lint`, `test`, `build`: verifies the Console adapter and Fastify inject
  tests.
- Root gates: detect cross-package TypeScript, lint, formatting, and build regressions.
- `git diff --check`: detects whitespace and patch corruption.

If a PostgreSQL-backed existing PMS API test is selected, set `TEST_DATABASE_URL` to a disposable
test database. Never use production credentials.

## Evidence checks

Contract hashes:

```bash
node scripts/pms-console-conformance/check-contract-lock.mjs
```

Route inventory:

```bash
node scripts/pms-console-conformance/check-route-inventory.mjs
```

Response Schema validation:

```bash
pnpm --filter @sdar/pms-api test -- test/console/response-conformance.test.ts
pnpm --filter @sdar/pms-api test -- test/console/all-operations.test.ts
```

Legacy regression:

```bash
pnpm --filter @sdar/pms-api test -- test/console/legacy-regression.test.ts
pnpm --filter @sdar/pms-api test
```

## Logs to return on failure

Return the complete stdout/stderr for the failing command, Node and pnpm versions, the output of
`node scripts/pms-console-conformance/validate-all.mjs`, `git status --short`, and
`git diff --check`. Redact database URLs, tokens, credentials, and local secret paths.

