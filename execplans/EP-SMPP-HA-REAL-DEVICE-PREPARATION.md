# EP-SMPP-HA-REAL-DEVICE-PREPARATION

## Objective and scope

Prepare and qualify the SMPP Home Assistant Climate and Light Provider path for one configured Home Assistant climate resource and two configured Home Assistant light resources. The path ends at Home Assistant and does not include SDAR Agent Runtime integration.

The candidate branch is `codex/ha-real-device-preparation`, based on the execution-time `origin/main` SHA recorded in `reports/real-device-preparation/baseline.json`.

## Source entrypoints discovered at P0

- Runtime: `apps/runtime/src/main.ts` and `apps/runtime/src/runtime.ts`; HTTP `/mcp` is the Runtime data plane and the Runtime owns task persistence and recovery.
- PMS API: `apps/pms-api/src/main.ts`, `src/app.ts`, `src/composition.ts`; PMS owns management, configuration, deployment, Catalog and Registry control-plane operations.
- PMS worker: `apps/pms-worker/src/main.ts`; worker jobs reconcile package, configuration, deployment, Catalog and Registry state.
- Climate Adapter: `apps/home-assistant-climate-provider/src/main.ts`; `src/home-assistant.ts` is the only HA REST/WebSocket client and `src/execution.ts` confirms real state before success.
- Light Adapter: to be added as an independent logical Provider at `apps/home-assistant-light-provider/`.
- Adapter boundary: `packages/adapter-protocol/src` and the frozen Adapter proto. The proto and MCP Tasks Unified Protocol are protected.
- Package and configuration boundaries: `provider-packages/*` and `packages/runtime-configuration-contract/src/providers/*`.

## Ports and startup

- Runtime HTTP: `8080` by default; MCP endpoint is `/mcp`.
- PMS API HTTP: `8090` by default.
- Climate Adapter: `7020` by default.
- Light Adapter: `7021` by default in the candidate design.
- Runtime telemetry ingress: `7002` by default.
- PostgreSQL: use the explicit `TEST_DATABASE_URL`/Compose database selected for the run; never infer an arbitrary local database.
- Local development uses the `pnpm dev:*` scripts. Vendor-managed Provider Adapters may run as controlled local processes or Compose services while PMS manages each Runtime deployment.

## State-machine gates

1. `P0 BASELINE_AND_DESIGN`: lock branch, SHA, source map, authority map, command inventory, safety design and evidence classes.
2. `P1 HA_READ_ONLY_PREFLIGHT`: read HA API and WebSocket state for the three configured entities; no service call.
3. `P2 CLIMATE_REAL_QUALIFICATION`: run existing Climate contract/platform gates, then Runtime → Adapter → HA read/write/confirm scenarios subject to the safety gate.
4. `P3 LIGHT_PROVIDER_IMPLEMENTATION`: add an independent Light Provider with allowlist, file token, REST/WebSocket, durable execution and confirmation semantics.
5. `P4 LIGHT_REAL_QUALIFICATION`: qualify both lights independently, including failure isolation, idempotency, timeout, unavailable and restart behavior.
6. `P5 PMS_PLATFORM_ONBOARDING`: use PMS application/API flows for package sync, provider/resource/binding/config/deployment, Catalog and Registry publication.
7. `P6 MCP_REAL_DEVICE_E2E`: run the three-device sequence through the two public Runtime `/mcp` endpoints; retain a unified correlation record.
8. `P7 IDEMPOTENCY_AND_RECOVERY`: exercise duplicate calls, restart/reconcile and controlled fault cases; stop on uncertain or safety-blocked writes.
9. `P8 FULL_REGRESSION`: run all available root and Provider-specific gates on the final candidate.
10. `P9 FINAL_QUALIFICATION`: verify no active/uncertain tasks, state restoration, redacted artifacts, clean worktree and conservative handoff status.

## Safety design

- `.local/ha-real-device/token.txt` is the only token source and contains the token alone. No token environment variable, log, report or screenshot is permitted.
- `.local/ha-real-device/resources.local.json` is the only local source of the three internal HA entity identifiers. Public reports use resource IDs and redacted/hashed entity references.
- Read-only preflight does not require the write gate. Every service call requires both `ALLOW_REAL_DEVICE_SIDE_EFFECTS=YES` and a non-empty unique `REAL_DEVICE_TEST_RUN_ID`.
- The Adapter accepts only configured public resource IDs and fixed operation/service mappings; user input cannot select arbitrary HA domains, services or entities.
- Every write re-reads state immediately before the service call and waits for WebSocket or REST-confirmed target state afterward. HTTP 200 is not completion.
- Each run saves original state before writes and maintains a global write budget. Light state changes default to two per resource; climate power changes default to one on and one off. No automatic write continues after `uncertain`.
- Climate power reversal is blocked when it would violate the five-minute opposite-power interval; the report must say `MANUAL_RESTORE_REQUIRED` with original and current state.
- A repeated real scenario gets at most three attempts. After that the scenario is `BLOCKED_MANUAL` and no further device writes occur.

## Implementation scope

- Add Light Provider app, package manifest, configuration contract, deployment overlay, docs, unit/contract/integration/security/platform tests and root scripts.
- Add shared preflight and real-run safety/test-driver code without bypassing Runtime for control scenarios.
- Add PMS fixture/onboarding evidence using existing PMS APIs/application services and preserve `vendor_managed` where required by package capability.
- Add redacted reports and handoff docs. Do not alter frozen MCP Tasks or Adapter proto fields/numbers.
- Only fix existing Climate code when a reproducible test demonstrates a violation of its current contract; add the regression test first.

## Verification commands

P0 records all commands found in `package.json`. The final candidate must run, where dependencies and an isolated database are available:

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm protocol:check
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:e2e
pnpm test:ha-climate
pnpm test:ha-climate:e2e
pnpm test:ha-climate:protocol-v1
pnpm test:provider-platform-ha
pnpm verify:v2
pnpm verify:platform
pnpm test:ha-light
pnpm test:ha-light:e2e
pnpm test:ha-light:protocol-v1
pnpm test:ha-real:preflight
pnpm test:ha-climate:real
pnpm test:ha-light:real
pnpm test:ha-real:e2e
pnpm verify:ha-real-preparation
```

Real commands default to read-only. The two safety variables are required for any write scenario.

## Recovery methods

- Device: stop writes, preserve current HA state, record `MANUAL_RESTORE_REQUIRED` and let an operator restore after the climate safety interval.
- Adapter: stop the process, preserve its durable state, restart with the same state path and run reconcile; never delete state to clear a task.
- Runtime: restart against the same isolated PostgreSQL database and use `tasks/get`, `tasks/result` and reconciliation; do not create a new database to hide an uncertain task.
- PMS: restore Registry from `latest`/`bootstrap` and reconcile deployment/config revisions; do not re-run a side effect because PMS was unavailable.
- Code: use a narrow reproducer, evidence capture, regression test, minimal fix, narrow test, component test, then all previously passing real scenarios.

## Evidence classification

- `real`: observed on the named HA entities through the formal Runtime → Adapter → HA path.
- `simulated`: fake HA or in-memory test behavior.
- `contract`: protocol/schema/contract tests.
- `static`: source, package, path, checksum and redaction checks.
- `unverified`: required but not executed because an environment, dependency, database, or manual safety prerequisite was absent.

Reports must never elevate simulated, static or unverified evidence to real qualification.
