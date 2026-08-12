# Goal 10 UGV simulation known limitations

Qualification status: `UGV_SIMULATION_PARTIAL`

Qualification product SHA: `e1473ea6c7ea61ef0495e85cf19b6f7256143791`

Source status: `TRACKED_SOURCE_CLEAN`

Generated at: `2026-08-10T07:31:21Z`

Provider Package `realResourceStatus`: `pending`

## External protocol drift

- The supplied protocol designates `status/ugv` as the canonical composite status topic, but neither final bounded passive capture observed it. The live simulator emitted the compatibility alias `/ugv/status`, which the Adapter accepts. Canonical-topic conformance therefore remains incomplete.
- The live `/ugv/speed` publisher delivered QoS 0 while the supplied protocol requires QoS 1. The Adapter requests QoS 1, but a subscriber cannot raise the publisher's effective QoS. This upstream mismatch prevents full MQTT conformance.
- The final host preflight subscribed successfully to all 18 bounded topics and sampled 11. The event- or activity-dependent topics `/ugv/area_recon/coverage`, `/ugv/area_recon/exception`, `/ugv/area_recon/targets`, `/ugv/detected_objects`, `/ugv/target_detected`, `/ugv/target/gnss`, and canonical `status/ugv` were not observed in that window. Their deterministic decoders are covered, but their final live payloads are not all qualified.
- Live `tools/list` exposed 15 expected tools and stable input schemas, but exposed no `outputSchema` or tool annotations. Result semantics are guarded by the Adapter and deterministic contract tests; machine-readable live output-schema conformance cannot be claimed.

## Safety-gated work not executed

- `UGV_ENABLE_REAL_CONTROL` remained false. No distance move, point/route navigation, pause/resume/cancel, return-home, bounded gimbal control, or emergency-stop command was sent to the simulator.
- No safe point or safe waypoint fixture was provided. The corresponding checks are `NOT_EXECUTED_SAFE_FIXTURE_MISSING`.
- Reconnaissance remained disabled and no safe reconnaissance region was provided. No real recon lifecycle or target-lock lifecycle was executed.
- Both read-only cycles returned zero current targets. Real target tracking was not attempted.
- Effector testing remained disabled. No fire/attack-confirm call was made. Deterministic decline coverage proves that a declined fire task makes zero Device MCP fire calls, but it is not real effector evidence.
- No live PMS environment was provided. Formal Provider/Resource/Deployment onboarding and Registry-backed endpoint authority were not executed; no direct database onboarding was substituted.

Because these are Core Qualification gaps in addition to reconnaissance and PMS, this result must not be labeled `CORE_QUALIFIED_RECON_PENDING` or `CORE_QUALIFIED_PMS_PENDING`.

## Qualification scope

- Real evidence proves the read-only path through Runtime, UGV Provider, real Device MCP, real MQTT, and back to Runtime. It does not prove a real mutating Runtime Task lifecycle.
- Deterministic suites prove integer mission-ID chaining, result validation, uncertain-call no-retry, per-tool circuit recovery, MQTT same-process reconnect/resubscribe, stale-observation rejection, task identity handling, restart reconciliation, gimbal lifecycle, and emergency-stop logic. These results are deliberately kept separate from real control evidence.
- The dedicated Compose stack is a single-Adapter qualification deployment using an isolated internal test security profile. Multi-replica Provider high availability and a production security deployment were not qualified.
- The local ignored Compose `.env` is configured with mode `0600` and explicit `ros_bridge_json`; deployment validation returns the qualification SHA without overrides. It is not tracked or included in delivery, and no value from it is copied into evidence.
- The live recon status does not carry a strict mission identifier. Dispatch-time observation cursors prevent stale terminal observations from completing a new local recon execution, but strict upstream mission correlation remains unavailable; real recon is disabled in this qualification.
- Raw video is outside this Goal's data path. No image, coordinate, raw MQTT payload, credential, or unredacted external endpoint is retained in the reports.

## Evidence anchors

- Host preflight: `reports/ugv-simulation/REAL_EXTERNAL_PREFLIGHT.json`, SHA-256 `c169836e65b09862695597f9c58293a7a06da0c1d5f7e466b61ed22d9885ffcd`, `2026-08-10T07:27:07.158Z` through `2026-08-10T07:27:08.464Z`.
- Cycle 1 read-only smoke: `reports/ugv-simulation/READ_ONLY_SMOKE.cycle1.json`, SHA-256 `7ba6c377fb9f16a5c1dab0a29e645a6d0527bd9444c9719229fb310ef556ca3b`, `2026-08-10T07:28:46.562Z` through `2026-08-10T07:28:46.747Z`.
- Cycle 2 preflight: `reports/ugv-simulation/REAL_EXTERNAL_PREFLIGHT.compose-cycle2.json`, SHA-256 `89c8a689584bf53a39a36318d748141999b607f99e6ca43dd3780352aab096e1`, `2026-08-10T07:29:37.624Z` through `2026-08-10T07:29:38.839Z`.
- Cycle 2 read-only smoke: `reports/ugv-simulation/READ_ONLY_SMOKE.json`, SHA-256 `59336e2ac2e7490a8dba753443961e3ca4f4645c46df00b2c84526ac15914de7`, `2026-08-10T07:29:39.181Z` through `2026-08-10T07:29:39.362Z`.
- Persistent live MCP capture: `reports/ugv-simulation/MCP_CONTRACT_CAPTURE.json`, SHA-256 `9f4cca36aaacbe649ede430d4c1d1d5d079b27c9ec784317a0250eb952679519`.

All endpoint identifiers remain redacted, all real evidence has mock fallback disabled, and no remote push is part of this qualification.
