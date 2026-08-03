# SMPP Home Assistant real-device preparation final delivery

- Base SHA: `abd9db778848303d2966ac9b9e80f75207713109`
- Candidate branch: `codex/ha-real-device-preparation`
- Candidate SHA: `PENDING_FINAL_COMMIT_SHA`
- Environment: `home-lab`
- Overall status: **BLOCKED**
- Ready for SDAR integration: **NO**

## Real evidence

- Home Assistant read-only preflight passed for the configured climate and two lights; reports are redacted.
- PMS API onboarding created/confirmed both Provider Packages, Provider Types, Providers, three Resources, bindings, published configuration, Runtime Deployments, Catalog revisions, and Registry revision 3.
- Both PMS-managed Runtime Deployments reached `ACTIVE`/ready in the controlled local environment. The separately launched Worker did not complete its existing reconcile leases, so the Worker sub-gate remains unverified.
- Registry-backed MCP reads returned all three resources. The Registry `latest` and `bootstrap` checksums and ETags matched; the redacted Registry contained neither secrets nor Home Assistant Entity ID keys.
- Both real lights completed bounded power toggles, terminal `tasks/get` confirmation, same-argument idempotency reuse, conflicting-argument rejection, and restoration. Final active and uncertain task counts were zero.
- A real Light Adapter outage was observed. Readiness failed closed, and exact Light Runtime restart restored readiness without replaying device side effects.
- The real climate was read successfully. Climate writes were not attempted because the saved power was off and the five-minute inverse-power safety rule blocked a safe bounded restoration.
- The latest read-only Home Assistant preflight was rerun after the bounded run and failed closed with `ENTITY_UNAVAILABLE` for the auxiliary light. No write was attempted after that observation; the earlier light qualification remains time-scoped evidence, not a current availability claim.

## Contract and static evidence

- Home Assistant Light Provider configuration, package validation, tests, deployment metadata, Registry projection, and documentation are included in the candidate.
- Frozen protocol verification passed: 38 locked files, 11 schemas, and 74 conformance cases.
- Lint, typecheck, build, unit, contract, security, focused Home Assistant, focused PMS Home Assistant platform, and protocol-conformance suites passed.
- Full regression remains partial because two pre-existing files fail repository-wide Prettier check, Windows symlink and fixed `D:/tmp` test paths return EPERM, and the aggregate `verify:v2`/`verify:platform` wrappers were not completed after the pnpm dependency-status failure.

## Hard blockers

- `CLIMATE_REAL_WRITE_QUALIFICATION_BLOCKED_MANUAL_SAFETY`: current PMS Registry-backed `climate_set_power`, `climate_set_hvac_mode`, and `climate_set_temperature` writes were not executed; no climate write pass is claimed.
- `HA_AUX_ENTITY_UNAVAILABLE_CURRENT_PREFLIGHT`: the latest read-only preflight found the auxiliary light unavailable, so no further real-device writes are permitted until Home Assistant state is restored and P1 passes again.
- `FROZEN_MCP_INITIALIZE_NOT_SUPPORTED_BY_CURRENT_RUNTIME`: the frozen Runtime returns 404 for `initialize`; this is recorded, not worked around by changing the frozen protocol.
- `PMS_WORKER_RECONCILE_JOB_COMPLETION_UNVERIFIED`: direct PMS application reconciliation converged the local deployments, but the formal Worker lease completion was not observed.
- `RUNTIME_ADAPTER_RECONNECT_WITHOUT_RUNTIME_RESTART_UNVERIFIED` and `REAL_IN_FLIGHT_RESTART_RECOVERY_UNVERIFIED`.
- `REAL_FAULT_INJECTION_UNVERIFIED`: real HA unavailable, REST-200-without-state-change, Entity unavailable, state-file corruption, PMS outage, and in-flight restart scenarios remain unverified.
- `RUNTIME_RELEASE_ASSET_PACKAGING_UNVERIFIED`: local release assets required controlled preparation before PMS Runtime startup; a clean packaged-release cold start is not claimed.
- `WINDOWS_PROVIDER_PACKAGE_SYMLINK_EPERM`, `NPC_TANK_FIXED_TEMP_PATH_EPERM`, `FORMAT_CHECK_PRE_EXISTING_FILES`, `VERIFY_V2_AGGREGATOR_UNVERIFIED`, and `VERIFY_PLATFORM_AGGREGATOR_UNVERIFIED` keep the Repository completion gate open.

The qualification scope is limited to the three explicitly configured lab resources. It does not change Provider Package `realResourceStatus` and does not certify all Home Assistant entities. Both lights were restored; the climate was left unchanged. No merge, tag, release, public deployment, or SDAR Agent Runtime integration was performed.
