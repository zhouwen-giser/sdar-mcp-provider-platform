# PMS Web Complete Product Experience

React + TypeScript product reconstruction aligned to the frozen PMS Console API Contract V1.0.

## Local verification

```bash
pnpm install --frozen-lockfile
pnpm --filter @sdar/pms-web contract:generate
pnpm --filter @sdar/pms-web contract:check
pnpm --filter @sdar/pms-web typecheck
pnpm --filter @sdar/pms-web lint
pnpm --filter @sdar/pms-web test
pnpm --filter @sdar/pms-web build
pnpm --filter @sdar/pms-web test:e2e
node apps/pms-web/scripts/validate-architecture.mjs
node apps/pms-web/scripts/validate-page-completion.mjs
```

## Modes

```bash
VITE_PMS_DATA_MODE=mock
VITE_PMS_ENABLE_PROTOTYPE_TOOLS=false
```

`api` mode is deliberately fail-closed until a real OpenAPI Gateway is implemented. It never silently falls back to Mock.
