# Continuation blockers

## Current blockers

- `CLIMATE_POWER_CONTROL_SAFETY_DEFERRED`
- `PMS_WORKER_RECONCILE_JOB_COMPLETION_UNVERIFIED`
- `RUNTIME_ADAPTER_RECONNECT_WITHOUT_RUNTIME_RESTART_UNVERIFIED`
- `REAL_IN_FLIGHT_RESTART_RECOVERY_UNVERIFIED`
- `REAL_FAULT_INJECTION_UNVERIFIED`
- `CURRENT_PMS_REGISTRY_CLIMATE_WRITE_QUALIFICATION_UNVERIFIED`
- `FROZEN_MCP_INITIALIZE_EXPECTATION_UNSUPPORTED_BY_CURRENT_RUNTIME`
- `WINDOWS_PROVIDER_PACKAGE_FULL_SUITE_UNVERIFIED`
- `FORMAT_CHECK_PRE_EXISTING_FILES`
- `NPC_TANK_FIXED_TEMP_PATH_EPERM`
- `VERIFY_V2_AGGREGATOR_UNVERIFIED`
- `VERIFY_PLATFORM_AGGREGATOR_UNVERIFIED`
- `HA_AUX_ENTITY_UNAVAILABLE_CURRENT_PREFLIGHT`

Each blocker must be independently reclassified with fresh evidence; a contract or fake test cannot close a real-device or live-PMS blocker.

## Reclassified

- `PMS_LIVE_FORMAL_ONBOARDING_UNVERIFIED` is partially closed by live PMS API, Catalog, Registry, Deployment and readiness evidence; the Worker completion sub-gate remains open.
- `REAL_ADAPTER_RESTART_RECOVERY_UNVERIFIED` is partially closed for Adapter outage plus exact Runtime restart recovery; automatic reconnect and in-flight recovery remain open.
- `WINDOWS_NODE_MODULES_STATUS_EPERM` is an execution-environment limitation: pnpm's ordinary workspace status check attempted a node_modules recreation and failed, while the explicit offline frozen-lockfile rebuild passed.
- `WINDOWS_PROVIDER_PACKAGE_FULL_SUITE_UNVERIFIED` remains open after an elevated symlink-test rerun reproduced EPERM; the dedicated Linux symlink gate is passed.
- `HA_AUX_ENTITY_UNAVAILABLE_CURRENT_PREFLIGHT` is open after two consecutive read-only preflight runs found the auxiliary light unavailable; no further writes are authorized until P1 passes.

## Closed in C1

- `REAL_RUNNER_EXPECTS_REMOVED_TASKS_RESULT` — closed by the focused source regression and protocol-method inventory. The frozen profile remains unchanged; historical reports retain their original evidence classification.
- `WINDOWS_PROTOCOL_LOCK_LINE_ENDING_UNVERIFIED` — closed by 38/38 Windows and Linux lock verification with zero content drift.
- `WINDOWS_SYMLINK_SECURITY_TEST_UNVERIFIED` — the Linux implementation-level symlink gate passed; the full Windows Vitest suite remains environment-limited by EPERM and is tracked as `WINDOWS_PROVIDER_PACKAGE_FULL_SUITE_UNVERIFIED`.
