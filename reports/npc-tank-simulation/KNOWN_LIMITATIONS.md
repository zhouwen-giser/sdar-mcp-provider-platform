# Goal 11 NPC Tank simulation known limitations

Document status: `INITIAL_DRAFT_PENDING_FINAL_REAL_RUNS`

Provisional qualification status: `NPC_TANK_SIMULATION_PARTIAL`

Provider Package `realResourceStatus`: `pending`

This draft reflects the evidence available at `2026-08-10T10:49:08Z`. It is not a final qualification report. Mock fixtures and local simulated transports are used only for deterministic regression and are not cited as real qualification evidence.

## Current real-evidence boundary

- Real Device MCP evidence currently proves a live Streamable HTTP connection and authoritative `tools/list` capture only: 15 tools, 15 input schemas, no output schemas, and no annotations. The capture deliberately made no tool call, so it does not yet prove real `get_status`, capability, payload-status, or target responses.
- Real MQTT evidence currently proves a bounded passive subscription and structure-only sample capture. It made no publish and caused no control, reconnaissance, or effector action.
- The targeted local test set passed 73 tests across seven unit, contract, integration, simulated E2E, and security files. Those tests prove implementation behavior under deterministic local fixtures; their names do not make them live simulator, PMS, Registry, or recovery evidence.
- No Mock fallback is accepted as real evidence. The old 23-tool NPC Mock inventory is comparison material only; the real 15-tool inventory is authoritative.

## External interface limitations

- The real 15-tool MCP inventory has no laser-ranging primitive. `vehicle_laser_range` is retained only as an explicitly unavailable shared operation with reason `PRD_REQUIRED_EXTERNAL_INTERFACE_UNAVAILABLE`; it has no old-Mock fallback and must not issue a downstream call.
- All 15 real MCP tools omit `outputSchema` and annotations. Local validators reject malformed, contradictory, nonzero-error, or mission-mismatched results, but real safe calls are still required to qualify actual response shapes and availability semantics.
- The human prediction named `get_capabilities`; live runtime authority instead exposes `npc_tank_get_capabilities`. The implementation binds the captured name, but a real capability read and sanitization check remain pending.
- The bounded MQTT capture observed a mixture of ROS-style envelopes and direct-domain objects. Neither Goal 11 final strict mode (`ros_message_json` or `direct_domain_json`) can truthfully decode the entire observed stream. The implementation therefore needs the explicit compatibility mode `ros_bridge_json`. This is recorded as `SIMULATOR_INTERFACE_DEFECT_MIXED_MQTT_WIRE_SHAPES` and prevents full G2 wire-mode conformance unless the upstream stream becomes uniform or the qualification policy is amended.
- The live `/npc_tank1/speed` publisher delivered QoS 0 while the expected QoS is 1. The subscriber continues to request QoS 1, but it cannot upgrade the publisher's effective delivery. This upstream mismatch remains visible and prevents full MQTT conformance.
- Fifteen of 18 bounded subscriptions produced samples. `/npc_tank1/target_detected`, `/npc_tank1/target/gnss`, and `/npc_tank1/area_recon/exception` were not observed. Their deterministic decoders are covered, but no live payload claim is made for them.
- Both `status/npc_tank1` and `/npc_tank1/status` were observed, but they have different roles: the canonical topic is a brief status object, while the compatibility topic carries the richer composite device state. Their authority and merge rules are locally tested but have not yet been qualified through the real Provider read path.
- The observed reconnaissance status structure carries no strict mission identifier. Post-dispatch observation cursors can reject stale pre-dispatch state, but they cannot create upstream mission correlation. A real reconnaissance lifecycle has not been run, so this mitigation is deterministic-only evidence.
- The real device supports gimbal velocity mode as a manual yaw sweep, while the shared public `vehicle_control_gimbal` schema currently exposes finite absolute, relative, and reset adjustments. The lower-level bounded velocity/stop behavior is locally tested, but manual sweep is not a separately qualified public capability and no NPC-only operation is introduced.

## Safety-gated work not executed

- `NPC_TANK_ENABLE_REAL_CONTROL` is not enabled and explicit safe movement fixtures are unavailable. No distance move, point or route navigation, pause, resume, cancel, return-home, emergency-stop, or observation-confirmed terminal control lifecycle has been sent to the simulator. No safe location was invented.
- `NPC_TANK_ENABLE_RECON_TESTS` is not enabled and no explicit safe reconnaissance region fixture is available. No area configure/start/pause/resume/stop/reset, circular scan, lock/unlock, moving-while-recon, camera-fault, or out-of-range lifecycle has been executed. Passive idle/status telemetry is not a substitute for a real reconnaissance task.
- A safe locally observed target is unavailable for real target tracking. Synthetic nonempty targets prove normalization and deduplication only.
- `NPC_TANK_ENABLE_EFFECTOR_TESTS` remains disabled. No attack-confirm or fire call was made. Local confirmation, rejection, cancellation, durable dispatch-fence, and result-sanitization tests are not real effector evidence. Effector execution remains optional for core qualification.

## Qualification work still pending

- The read-only real smoke is still pending. It must exercise safe Device MCP reads, MQTT readiness, Provider resource readiness, and standard read operations without movement.
- The real Runtime Task E2E is still pending. The local gRPC E2E passed deterministically, but no final Task lifecycle has used an endpoint obtained from Registry authority.
- Formal PMS onboarding is still pending. Provider Package, Provider Type, Provider, Resource, Binding, Configuration, RuntimeDeployment, Worker reconcile, and Catalog must be created or verified through PMS API/application flows; no direct authority-table write may substitute for this chain.
- Registry authority is still pending. No live Registry revision, checksum, ETag, canonical endpoint selection, or Registry-backed E2E has yet been recorded.
- PMS Web visibility is still pending for Package, Provider, Resource, Deployment, Registry, and Audit views.
- Real recovery and fault injection are still pending for MQTT disconnect/reconnect, Device MCP timeout and reconnect, Adapter restart, Runtime restart, active Task interruption, duplicate task identity, and conflicting arguments. Selected local recovery/idempotency tests pass, but they are not real fault evidence.
- One-click deployment, exact-head image verification, no-mock combined Compose inspection, health checks, smoke, and two clean restart cycles remain pending main-agent execution.
- Full NPC, UGV, shared vehicle, relevant Home Assistant, frozen-protocol, PMS Console, typecheck, lint, formatting, and build regression has not yet been completed as a final tracked-source gate.

## Evidence and redaction boundary

- Evidence paths are limited to redacted contract metadata, schema hashes, topic/QoS observations, payload key/type structure, bounded byte lengths, and hashes.
- This report contains no endpoint value, credential value, coordinate value, raw MQTT payload, image/video bytes, or referee/global-truth result.
- `PROVIDER_CAPABILITY_MATRIX.json` keeps live capture facts, deterministic local tests, and unexecuted gates in separate fields so an implementation pass cannot be mistaken for real external qualification.
