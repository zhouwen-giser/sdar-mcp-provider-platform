# Phase R9 Test Results

| Command                             | Result     | Evidence                                                     |
| ----------------------------------- | ---------- | ------------------------------------------------------------ |
| `pnpm format:check`                 | PASS local | all repository files formatted                               |
| `pnpm lint`                         | PASS local | TypeScript and release scripts                               |
| `pnpm typecheck`                    | PASS local | strict project check including E2E/migrator                  |
| `pnpm build` / `pnpm proto:check`   | PASS local | release build and generated bindings                         |
| `pnpm audit:dependencies`           | PASS local | no known vulnerabilities after reviewed overrides/upgrades   |
| `pnpm sbom:check`                   | PASS local | 184 production components, lock hash current                 |
| `pnpm deployment:check`             | PASS local | 8 production Kubernetes manifests                            |
| `pnpm test:unit`                    | PASS local | 24 tests                                                     |
| `pnpm test:contract`                | PASS local | 4 tests; initial parallel generation race rerun sequentially |
| `pnpm test:security`                | PASS local | 6 tests                                                      |
| `pnpm verify`                       | PASS CI    | Actions `29501239305`; every root release gate executed      |
| PostgreSQL integration/recovery/E2E | PASS CI    | real PostgreSQL 17; no omitted suite                         |
| TypeScript/Python conformance       | PASS CI    | identical P0-P4 reports regenerated                          |
| Capacity baseline                   | PASS CI    | 100 sync + 25 durable lifecycles; committed JSON artifact    |
| Compose smoke                       | PASS CI    | non-root Runtime, both Adapter images and readiness          |
| Buf lint/compatibility              | PASS CI    | IDL lint and `origin/main` compatibility gate                |

The local account cannot access Docker and the host Python has no pip; the
release gate intentionally fails rather than skips when those prerequisites or
`TEST_DATABASE_URL` are absent. GitHub Actions run `29501239305` supplied the
authoritative complete environment and passed both jobs.
