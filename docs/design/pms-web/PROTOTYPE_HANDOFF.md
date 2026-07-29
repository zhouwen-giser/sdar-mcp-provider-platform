# PMS Web prototype handoff

## Review target

- Branch: `codex/goal-05-pms-web-interaction-prototype`
- Fixed baseline: `8af9b76086eebc8b6e516cda4ca29068dc4d5ef7`
- Application: `apps/pms-web`
- Mode: React browser prototype backed exclusively by `PmsWebDataSource` and in-memory Mock data

Run `pnpm --filter @sdar/pms-web dev`, then open `/dashboard`. The development header exposes
the 14 scenario variants. `pnpm --filter @sdar/pms-web test:e2e` starts a local Vite server and
uses the installed system Chrome.

## Reviewable outcomes

The 29 registered routes, reusable application shell and five core flows are implemented. Provider
onboarding, deployment creation, configuration publishing, runtime recovery and Catalog breaking
change all create browser-only `PrototypeOperation` steps. The Operation Panel requires explicit
manual advancement and always labels results as simulated.

The browser suite covers every route, every scenario, Console errors, forbidden transport resource
types, drawers, wizards, tables and the Operation Panel. The required 1440×900 and 1280×720
screenshots are indexed in `SCREENSHOT_INDEX.md`.

## Hard boundary

This handoff contains no authentication, login, actor session, Token input, Authorization header,
OIDC, OAuth, route guard, backend client or live data transport. It does not modify PMS API,
Runtime, Worker, PM2, migrations or protocol packages. The `ROUTE_API_FUTURE_MAP.md` and
`MISSING_API_INVENTORY.md` are planning records only.
