# PMS Web prototype baseline

## Fixed source

- Repository: `zhouwen-giser/sdar-mcp-provider-platform`
- Base branch: `main`
- Baseline commit: `8af9b76086eebc8b6e516cda4ca29068dc4d5ef7`
- PMS Web existed at baseline: yes
- Workspace package: `@sdar/pms-web@0.1.0`

Goal 05 does not follow later movement of `main`. All prototype work is evaluated against the
commit above.

## Existing implementation

The baseline application is a framework-free TypeScript single page application. `tsc` emits
JavaScript and `build-static.mjs` assembles a static `dist` directory. Vitest exercises string
renderers and the HTTP client.

The application currently has nine coarse pages: Providers, Provider Packages, Resources,
Configuration, Runtime, Catalog, Registry and Audit. Navigation uses a custom history router.
Rendering is based on HTML strings and global event delegation.

## Repository constraints

- pnpm workspace package manager: `pnpm@11.13.1`
- Node.js and TypeScript are controlled by the root workspace.
- Root gates include Prettier, ESLint, `tsc --noEmit`, build and Vitest.
- `apps/pms-web` must keep independent `test` and `build` commands.
- Goal 05 may change the root package/lockfile only when a PMS Web development dependency requires
  it.

## Evidence

The baseline SHA equals both the installation record in `.codex/goal-05/baseline.json` and the
branch starting commit. No production source was changed by the baseline task.
