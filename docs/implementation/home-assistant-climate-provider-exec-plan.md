# Home Assistant Climate Provider ExecPlan

Status: frozen protocol migration complete; publication pending

Base: `origin/main` merged at `798656827ea747fb824df2975f8e66135e80fcc2`

Target: `feature/home-assistant-climate-provider`

## Scope and invariants

Implement a standalone Node.js Provider at `apps/home-assistant-climate-provider` for explicitly
configured Home Assistant `climate.*` entities. It exposes synchronous state reads and durable
power, HVAC-mode, and target-temperature controls through the Runtime Adapter protocol.

Execution identity is persisted before Home Assistant side effects. `taskId` is idempotent,
reconcile is side-effect free, HTTP success is not terminal proof, completion requires observed
WebSocket or REST state, snapshot revisions are monotonic, terminal executions never regress,
and only configured resources may be controlled. Tokens come only from a secret file and are
forbidden from logs, errors, snapshots, results, and telemetry.

## First-version operations

- `climate_get_state` (`SYNCHRONOUS`)
- `climate_set_power` (`TASK_REQUIRED`)
- `climate_set_hvac_mode` (`TASK_REQUIRED`)
- `climate_set_temperature` (`TASK_REQUIRED`)

Fan mode, swing mode, humidity, presets, schedules owned by Home Assistant, discovery, direct
vendor protocols, pause/resume, and cancellation after dispatch are out of scope.

## Delivery phases

| Phase   | Deliverable                                         | Evidence                   | Status   |
| ------- | --------------------------------------------------- | -------------------------- | -------- |
| C0      | application, config, resource registry and manifest | unit tests                 | complete |
| C1      | REST/WebSocket client and climate normalization     | client/state tests         | complete |
| C2      | durable execution, confirmation and recovery        | integration/recovery tests | complete |
| C3      | durable Provider telemetry and security             | telemetry/security tests   | complete |
| C4      | Fake HA, Runtime E2E, image, Compose and docs       | E2E/deployment checks      | complete |
| C5      | frozen Wire, type-only Evidence, notification E2E   | Provider V1 report 8/8     | complete |
| Release | full repository verification and phased commits     | `pnpm verify:v1.1`         | complete |

## Verification ledger

| Date       | Command                                      | Result |
| ---------- | -------------------------------------------- | ------ |
| 2026-07-18 | repository and protocol baseline inspection  | PASS   |
| 2026-07-18 | TypeScript and ESLint                        | PASS   |
| 2026-07-18 | focused suite (4 files, 7 tests)             | PASS   |
| 2026-07-18 | Runtime/PostgreSQL climate E2E               | PASS   |
| 2026-07-18 | `pnpm verify:v1.1` (343.1 seconds)           | PASS   |
| 2026-07-19 | merge protected Runtime main                 | PASS   |
| 2026-07-19 | `pnpm test:ha-climate:protocol-v1` (8 tests) | PASS   |
| 2026-07-19 | `pnpm protocol:ha-climate:check` (8/8)       | PASS   |
| 2026-07-19 | exact `225b09c` `pnpm verify:v2` (474.1s)    | PASS   |
