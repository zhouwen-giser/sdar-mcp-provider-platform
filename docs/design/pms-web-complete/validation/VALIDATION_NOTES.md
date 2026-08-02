# Validation Notes

## Passed locally

- frozen contract status and OpenAPI SHA-256 inspection;
- checked-in generated DTO SHA-256 inspection;
- TypeScript syntax transpilation for application, tests, and Playwright specifications;
- source lint;
- relative import resolution;
- architecture boundary validation;
- 123-route page completion validation;
- forbidden compatibility reference scan;
- secret and excluded-artifact scan;
- final ZIP integrity and SHA-256 verification.

## Blocked by execution environment

The container returned `EAI_AGAIN registry.npmjs.org` while Corepack attempted to obtain pnpm. Since `node_modules` was intentionally absent, formal semantic typecheck, OpenAPI regeneration, Vitest, Vite build, and Playwright could not proceed. Their exit codes are recorded in `TEST_EVIDENCE.json`; they are not reported as passed.
