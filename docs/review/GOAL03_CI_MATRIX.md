# Goal 03 CI matrix

Goal 03 keeps the existing Runtime and Compose qualifications and adds an
independent PMS API production-composition check. The checks intentionally have
separate names so branch protection can distinguish their failure domains.

| Check                | Environment                                      | Qualification                                                                                  |
| -------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `runtime-ci`         | Node 22, pnpm 11.13.1, PostgreSQL 17, Buf 1.57.2 | Frozen install, complete `verify:v2`, Protobuf lint, and compatibility against `v1.0.0-rc.1`   |
| `runtime-compose`    | Ubuntu 24.04, Docker Compose                     | Runtime and TypeScript/Python Adapter builds, base readiness, and Business Events readiness    |
| `pms-api-production` | Node 22, pnpm 11.13.1, PostgreSQL 17             | Frozen install, PMS API production composition, PMS domain/persistence, config E2E, migrations |

Superseded pull-request commits cancel older runs through workflow-level
concurrency. Push runs are not cancelled.

## Evidence boundaries

The PMS job does not upload logs or artifacts. Its database URL contains only
ephemeral CI service credentials and is not echoed by a custom step. No token
fixtures are exported.

This matrix does **not** qualify PMS Worker production composition, PM2
Production Bridge behavior, full Worker composition, release readiness, or
deployment rollout. Those checks remain explicitly deferred beyond Goal 03.
