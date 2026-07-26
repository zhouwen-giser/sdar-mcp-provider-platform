# UGV + NPC Tank Provider V1 Work Completion Report

## Outcome

The detached UGV Work workspace now contains an independent NPC Tank Adapter and Runtime for `vehicle:npc_tank1`, while retaining the complete UGV Provider. NPC differences are implemented through profiles, exact allowlists, mappings and capability rules over shared vehicle foundations.

The supported claim is **NPC Tank Provider Component Complete against the supplied protocol and Mock Level 1 contract**. Real ISR interface conformance is not claimed because no real NPC Device MCP endpoint, ISR MQTT broker/sample stream, credentials, Docker, or test PostgreSQL URL was available.

## Verification

- Format, ESLint, TypeScript, build, generated-file self-check, and all 10 protected-file hashes passed.
- NPC suites: 11 unit, 5 contract, 7 integration, 4 security, and 1 gRPC E2E test passed (28 total).
- The unchanged UGV gate passed: 9 unit, 4 contract, 6 integration, 3 security, and 1 gRPC E2E test (23 total).
- Frozen protocol: 71 tests passed. Business Events protocol and contract catalogs: 81 each; adapter contract: 5; telemetry unit: 15. Stream, replay, continuity, and telemetry security suites passed.
- A real Streamable HTTP exchange with the Mock NPC Device MCP listed 23 allowlisted tools, called `npc_tank_laser_range`, selected `npc_tank_path_follow_mission`, and advertised circular EO scan only with all three required contracts.
- `verify:business-events`, `verify:business-events:telemetry`, and `verify:v2` were executed and stopped only at their PostgreSQL-dependent gates because `TEST_DATABASE_URL` is absent.
- Docker Compose execution is environment-blocked because Docker is unavailable; the `npc-tank-provider` profile and its independent services are covered by contract/static checks and in-process gRPC E2E.
- The delivery packager passed single-root, required-path, exclusion, file-count, project-tree-hash, extraction, and ZIP SHA-256 verification before the final deterministic package was generated.

## Contract and safety boundaries

The adapter subscribes only to the twelve exact `/npc_tank1/` topics and calls only the 23 explicit `npc_tank_*` tools on port 19003. MissionState and public task tracks are terminal authority; `run_state` and `mode` are never completion authority, and conflicting public state fails closed with `NPC_TASK_STATE_CONFLICT`.

Navigation prefers `npc_tank_path_follow_mission` and uses `npc_tank_send_waypoints` only as a startup fallback. Circular EO scan is conditional on valid start, stop, and set-angle contracts. Fire requires explicit confirmation, and hit/miss/destruction/damage/remaining-health/referee/verdict fields are recursively stripped before persistence, results, evidence, events, logs, and telemetry.

NPC executions, command acknowledgements, tool calls, snapshots, and event source data use independent `npc_tank_*` PostgreSQL tables and cannot resolve UGV executions.

## Provenance and limitations

The work continued from the supplied verified UGV delivery ZIP in a detached directory without `.git`. No Git command or remote write was performed. The two NPC task documents match their mandated SHA-256 values. The inherited UGV task-document metadata drift is preserved and documented; no protected or frozen protocol file changed.

See `reports/npc-tank-provider-v1/` and checkpoints `N0.json` through `N9.json` for machine-readable evidence.
