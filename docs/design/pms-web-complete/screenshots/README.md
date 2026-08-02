# Browser screenshot evidence

No screenshots are included in this package. The final browser capture command could not run because the execution environment could not resolve `registry.npmjs.org`, so Playwright dependencies were unavailable. Static design images were deliberately not substituted.

Run locally:

```bash
pnpm install --frozen-lockfile
pnpm --filter @sdar/pms-web build
pnpm --filter @sdar/pms-web test:e2e
```

`e2e/product-screenshots.spec.ts` writes the required final-build review images into this directory.
