# Goal 11 NPC Tank known limitations

Final qualification status: `NPC_TANK_SIMULATION_PARTIAL`.

## External simulator contract

- The real MQTT stream mixes ROS-bridge envelope and direct-domain JSON shapes. The truthful decoder setting is `ros_bridge_json`, which is a compatibility mode and does not satisfy the frozen Goal 11 strict-mode requirement of `ros_message_json` or `direct_domain_json`.
- The `/npc_tank1/speed` publisher was observed at QoS 0 while the required subscription/publisher contract expects QoS 1.
- Three requested topics were not observed in the primary passive window: `/npc_tank1/target_detected`, `/npc_tank1/target/gnss`, and `/npc_tank1/area_recon/exception`. Absence in a bounded idle window is not treated as proof that the topics never publish.
- All 15 Device MCP tools expose input schemas but no output schema or annotations. The Provider therefore applies conservative local result validation and safety classification.
- The real 15-tool inventory has no laser-ranging primitive. `vehicle_laser_range` is exposed as unavailable; no old Mock tool is used as a fallback.

## Real lifecycle coverage

- Four direct Device MCP read operations and four Registry-backed Runtime read operations passed.
- Real control was not executed because `NPC_TANK_ENABLE_REAL_CONTROL` was false and bounded distance, point, waypoint, and prior-route fixtures were absent.
- Real reconnaissance was not executed because `NPC_TANK_ENABLE_RECON_TESTS` and the safe region fixture were absent. Circular reconnaissance is supported by the real contract but is not lifecycle-qualified.
- The real mutating Runtime Task lifecycle, including observation-confirmed navigation/recon completion, was not executed.
- Active real Task interruption during MQTT or Device MCP loss was not executed. Reconnect, stale/duplicate rejection, Adapter/Runtime reconciliation, uncertain-mutation no-retry, and identity-conflict behavior passed deterministic tests only.
- Camera-fault and out-of-range injection were not attempted against the real simulator because no explicit safe fixture or authorization was supplied.
- Effector/fire remained disabled. No attack confirmation was sent; this is optional for core qualification.

## PMS, Web, and deployment boundaries

- Formal PMS onboarding, Worker reconciliation, catalog publication, Registry revision/checksum/ETag, Registry-derived Runtime reads, and live PMS Web same-origin API visibility passed.
- PMS Web evidence is HTTP route/API-mode evidence. No browser screenshot, pixel comparison, or manual visual inspection is claimed.
- Provider Package `realResourceStatus` remains `pending` because the overall result is partial.
- Two clean real deployment restart cycles passed and the final stack was shut down with persistent volumes preserved. Active real Task recovery was not part of those cycles.

## Repository regression boundary

- Goal11 NPC/UGV/HA/shared/PMS tests, lint, typecheck, build, and frozen protocol checks passed.
- Whole-repository `pnpm format:check` still reports three unchanged Goal10 evidence files: `reports/ugv-simulation/MCP_CONTRACT_CAPTURE.json`, `reports/ugv-simulation/REAL_EXTERNAL_PREFLIGHT.compose-cycle2.json`, and `reports/ugv-simulation/REAL_EXTERNAL_PREFLIGHT.json`. They were not introduced or modified by Goal11; Goal11 changed files pass their dedicated formatting gate.
- The database-backed `test:provider-platform-npc` suite was not run separately because no disposable host-visible `TEST_DATABASE_URL` was provided. Exact-head Adapter, Runtime, and PMS deployments exercised their real migrations, and targeted migration/configuration tests passed.

## Closure conditions for full qualification

Full `NPC_TANK_SIMULATION_QUALIFIED` requires at least:

1. one uniform frozen MQTT wire shape, or an approved change to the frozen acceptance policy for the observed compatibility mode;
2. `/npc_tank1/speed` publisher QoS aligned to 1, or an authoritative contract amendment;
3. explicit safe control fixtures and observation-confirmed distance, point, route, pause/resume/cancel, return-home, and emergency-stop runs;
4. explicit recon authorization and fixtures for area/circular lifecycle, targets, lock/unlock, concurrent movement, stop/reset, and safe fault semantics;
5. Registry-backed real mutating Runtime Task lifecycle and active-task interruption recovery without duplicate side effects.

No endpoint value, credential, coordinate, raw MQTT payload, image, or video is stored in this report.
