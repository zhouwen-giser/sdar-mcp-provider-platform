# Goal 10 baseline drift review

Status: `NO_REPOSITORY_BASELINE_DRIFT`

Overall qualification: `UGV_SIMULATION_PARTIAL`

The task base, reviewed main, and `origin/main` used to create the Goal 10 branch were all `981792b9cb22f8b3117fe3ab26f639de71487d1f`. The qualified product commit is `e1473ea6c7ea61ef0495e85cf19b6f7256143791`, and all current qualification evidence records `sourceStatus=TRACKED_SOURCE_CLEAN`.

The protected paths have no diff relative to the base. NPC behavior and Catalog are unchanged. This satisfies the repository baseline and scope-protection review; it does not imply that the external simulator matches the supplied protocol.

## Live authority revalidation

The initial gap hypotheses were revalidated against the real read-only endpoints. The host preflight (`2026-08-10T07:27:07.158Z`–`07:27:08.464Z`) and Compose cycle 2 preflight (`2026-08-10T07:29:37.624Z`–`07:29:38.839Z`) both returned `PASS_WITH_UPSTREAM_DRIFT` with mock fallback disabled, no control call, no MQTT publish, and no raw payload retention.

Live Device MCP exposed 15 tools from `ugv-mcp-server` `1.26.0`, negotiated MCP `2025-11-25`, and produced contract hash `3725dba7b92e587ecb3fd670bc54e00633828370e9063f96809b8f7c1400935a`. The captured tools match the supplied 15-tool inventory, while all live tools omit `outputSchema` and annotations. The product therefore retains strict local result validation rather than treating an MCP transport success as business success.

Live MQTT established a passive `ros_bridge_json` subscription to all 18 configured topics. Eleven topics produced bounded samples. Six event/reconnaissance topics were not sampled; canonical `status/ugv` was also not observed, for seven unsampled subscriptions in total. The upstream simulator published the composite status on `/ugv/status`. `/ugv/speed` was published at QoS 0 although the supplied protocol requires QoS 1. These are external-interface drifts, not repository baseline drift.

Two clean Compose cycles passed Runtime readiness, 11-tool discovery, and the four real read-only operations: `vehicle_get_state`, `vehicle_get_capabilities`, `vehicle_get_payload_status`, and `vehicle_get_targets`. Both cycles observed MQTT and Device MCP connected, device availability true, and nonzero MQTT ingress.

## Qualification boundary

Real control, point/route navigation, reconnaissance, PMS onboarding, and effector execution were not run. Safe point/route fixtures and a recon region were not configured; the real-control, recon, and effector switches remained disabled. Together with the canonical status-topic and speed-QoS drift, this prevents `UGV_SIMULATION_QUALIFIED` and also prevents either `CORE_QUALIFIED_*_PENDING` label. The only supported overall classification is `UGV_SIMULATION_PARTIAL`; Provider Package `realResourceStatus` remains `pending`.

Evidence is in `REAL_EXTERNAL_PREFLIGHT.json`, `REAL_EXTERNAL_PREFLIGHT.compose-cycle2.json`, `MCP_CONTRACT_CAPTURE.json`, `READ_ONLY_SMOKE.cycle1.json`, and `READ_ONLY_SMOKE.json`. Their SHA-256 values are recorded in `BASELINE.json`; endpoints and credentials remain redacted.
