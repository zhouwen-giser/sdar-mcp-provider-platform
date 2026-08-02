# PMS Web Complete Product Baseline

## Inputs

- Frontend baseline: `pms-web-productionization-foundation.zip`
- Frozen contract: `PMS Console API Contract V1.0.0`
- Contract status: `frozen`
- OpenAPI SHA-256: `dddf9a6c9a5d8264b71aa11495106e197857e186b02fd8e54fc0f0a53e33f042`
- Frozen operations: 36
- Frozen schemas: 28

## Engineering baseline

- Application remains `apps/pms-web`; no parallel console project was created.
- React Router and TanStack Query foundation retained.
- Legacy `PmsWebDataSource`, `useDataQuery`, `StructuredPlaceholder`, `PlatformPage`, and generic public route dispatch were removed.
- Public route inventory: 121
- Internal development routes: 2
- Product source modules: 42
- Unit/component test files: 8
- Playwright specifications: 3

## Environment

- Node: `v22.16.0`
- Chromium: `144.0.7559.96`
- Package manager requested: `pnpm@10.14.0`
- Execution limitation: npm registry DNS resolution failed, so dependencies could not be installed in this container.
