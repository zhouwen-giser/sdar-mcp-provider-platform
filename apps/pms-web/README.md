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

`api` mode uses the production same-origin gateway and never silently falls back to Mock.

The production server always proxies the same-origin `/api/console/v1` surface. Raw PMS routes
remain blocked by default. An isolated deployment can explicitly set
`PMS_WEB_RAW_API_PROXY_ENABLED=true` to proxy `/api/v1` and `/api/v1/**` to
`PMS_WEB_API_UPSTREAM`; all other `/api/**` paths remain blocked. This proxy does not inject
credentials. It streams upstream responses so Registry watch/SSE connections remain live and are
cancelled when the downstream client disconnects.
