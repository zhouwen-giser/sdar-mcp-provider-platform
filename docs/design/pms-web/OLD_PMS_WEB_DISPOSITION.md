# Old PMS Web disposition

The baseline implementation is not a compatibility target. Goal 05 replaces the old `src` and
tests in place.

## Delete

- `src/api-client.ts`: real HTTP client, endpoint paths and actor/header behavior violate the
  prototype boundary.
- `src/app.ts`: page orchestration is coupled to that client and old route model.
- `src/router.ts`: route inventory does not match the required information architecture.
- `src/views.ts`: string templates cannot support the required component and workflow depth.
- `src/main.ts`: boots the old client/application composition.
- `test/api-client.test.ts` and `test/views.test.ts`: assert obsolete transport and HTML output.

## Replace

- `src/model.ts`: replace API projection types with prototype read models.
- `src/styles.css`: replace the old presentation with the Goal 05 design tokens and dense shell.
- `src/dom.d.ts`: reassess after choosing the build/runtime structure.
- `index.html`, `build-static.mjs`, `tsconfig.json`, `package.json`: retain paths but revise contents
  as required by the rebuilt application.

## Reusable ideas, not code contracts

- HTML escaping and date/status formatting pure functions
- History-based route preservation
- Independent workspace build/test scripts

No old Token field, actor storage, endpoint input or API client will be retained.
