# Goal 04 CI qualification matrix

All jobs use Node 22 and pnpm 11.13.1. PostgreSQL-backed jobs use independent PostgreSQL 17 service
containers and database names. Required jobs do not use `continue-on-error` or weak success shims.

| Merge criterion                                        | Required check          | Principal commands                                                                                                      |
| ------------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Formatting, lint, types, build, protocol and SBOM      | `static`                | `format:check`, `lint`, `typecheck`, `build`, `protocol:check`, `sbom:check`                                            |
| Runtime V2 regression and historical gates             | `runtime-ci`            | `verify:v2`, Buf lint and RC compatibility                                                                              |
| PMS API/config/migration production path               | `pms-api-production`    | `test:pms-api-production`, `test:pms`, `test:pms-config-e2e`, `test:pms-migrations`                                     |
| Worker-to-Runtime production lifecycle                 | `worker-pm2-production` | `build`, `test:worker-pm2-production`, always-run production-Bridge cleanup                                             |
| Controlled Provider regressions                        | `provider-regression`   | `test:provider-platform-ugv`, `test:provider-platform-npc`, `test:provider-platform-ha`                                 |
| Platform security, recovery, Catalog/Registry and SDAR | `platform-e2e`          | `test:platform-security`, `test:fault-injection`, `test:catalog-registry-e2e`, `test:sdar-interop`, `test:platform-e2e` |
| Runtime and adapter container assembly                 | `runtime-compose`       | Compose config/build/start/readiness for TypeScript, Python and business-events profiles                                |

The `worker-pm2-production` artifact contains only the redacted lifecycle evidence and cleanup
resource counts. It never uploads credential files, database URLs, PM2 dumps, logs, or temporary
directories.

## Branch protection administrator action

Configure the Goal 03 integration branch to require these exact GitHub Actions check names:

```text
static
runtime-ci
pms-api-production
worker-pm2-production
provider-regression
platform-e2e
runtime-compose
```

Branch-protection configuration is an external repository setting and is intentionally not mutated
by this task.
