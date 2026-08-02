# SMPP Home Assistant real-device preparation: repository map

## Baseline

- Base: `origin/main` at `abd9db778848303d2966ac9b9e80f75207713109`.
- Candidate branch: `codex/ha-real-device-preparation`.
- The starting worktree was clean.
- No `AGENTS.md` file exists in the checkout.

## Existing implementation entrypoints

| Area                  | Current location                                                          | Finding                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MCP Tasks Runtime     | `apps/runtime/src/main.ts`                                                | Starts the HTTP `/mcp` data plane, PostgreSQL-backed task engine, scheduler, command dispatcher, recovery and Adapter gateway.                                     |
| PMS API               | `apps/pms-api/src/main.ts`                                                | Starts PMS HTTP API; management, configuration, runtime deployment, catalog and registry routes are wired from `apps/pms-api/src/app.ts` and `src/composition.ts`. |
| PMS worker            | `apps/pms-worker/src/main.ts`                                             | Runs package sync, runtime deployment/reconcile and catalog/registry phases.                                                                                       |
| Climate Adapter       | `apps/home-assistant-climate-provider/src/main.ts`                        | Loads a file-backed allowlist and token file, connects to HA REST/WebSocket, starts confirmation/recovery and Adapter gRPC.                                        |
| Climate package       | `provider-packages/home-assistant-climate/provider-package.json`          | `builtin.home-assistant.climate`, `home_assistant.climate`, `vendor_managed`, `frozen_v1`.                                                                         |
| Climate configuration | `packages/runtime-configuration-contract/src/providers/home-assistant.ts` | Requires `HOME_ASSISTANT_TOKEN_FILE` and `CLIMATE_RESOURCES_FILE`; rejects `HOME_ASSISTANT_TOKEN`.                                                                 |
| Adapter protocol      | `packages/adapter-protocol/src` and `proto/io/sdar/mcp/tasks/adapter/v1`  | Frozen Adapter gRPC surface; no field or numbering changes are in scope.                                                                                           |
| Catalog               | `packages/catalog-manager/src`                                            | Validates and checksums Runtime `tools/list` discovery snapshots.                                                                                                  |
| Registry              | `packages/registry-snapshot/src`                                          | Builds and persists redacted provider registry snapshots with revision/checksum semantics.                                                                         |
| PMS E2E               | `tests/provider-platform-e2e/home-assistant/vendor-managed.test.ts`       | Existing Climate vendor-managed platform test uses a fake HA client and PostgreSQL-backed Catalog/Registry publication.                                            |
| Climate deployment    | `deploy/home-assistant-climate/compose.override.yaml`                     | Vendor-managed Adapter container plus PMS-managed Runtime composition override.                                                                                    |

## Missing at baseline

- No `apps/home-assistant-light-provider/`.
- No `provider-packages/home-assistant-light/`.
- No `deploy/home-assistant-light/`.
- No Home Assistant real-device preflight command or report generator.
- No real-device safety gate, run-id enforcement or three-device MCP driver.
- No Light Provider contract, protocol, integration, security or platform tests.
- No `test:ha-real:*` or `verify:ha-real-preparation` scripts.

## Runtime and local ports

- Default Runtime HTTP: `127.0.0.1:8080`.
- Default PMS API HTTP: `127.0.0.1:8090`.
- Existing Climate Adapter default: `0.0.0.0:7020`.
- Existing Provider telemetry ingress default: `127.0.0.1:7002`.
- PostgreSQL defaults are defined by the Runtime/PMS configuration contracts and Compose; all real runs must use an explicitly identified database rather than an arbitrary local instance.

## Build and startup

- Development Runtime: `pnpm dev:runtime`.
- Development PMS API: `pnpm dev:pms-api`.
- Development Climate Adapter: `pnpm dev:ha-climate`.
- Compose baseline: `docker compose up --build --wait`.
- Climate overlay: `docker compose -f compose.yaml -f deploy/home-assistant-climate/compose.override.yaml up --build --wait` after supplying the local token/resource files.

## Evidence rule

The existing fake HA fixture and simulated platform tests are contract/simulated evidence only. They cannot be promoted to `real` without HA REST/WebSocket observations and the complete Runtime → Adapter → HA path.
