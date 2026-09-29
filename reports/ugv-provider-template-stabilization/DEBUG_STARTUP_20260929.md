# UGV debug startup and LAN access — 2026-09-29

## Source and correction

Validation started from `02db4afad8ff394aa0e2d4ea6d80565f396c95d4` with the local fixes delivered
alongside this report. Generated preflight/smoke reports retain their original `gitSha` and
`sourceStatus: UNVERIFIED`; they are not clean-commit release qualification.

The first production image failed to import `ajv-formats` from the UGV task-business interaction
module. The dependency is now a production dependency at its existing version `3.0.1`; the
lockfile and SBOM are synchronized. The image check now imports the actual Runtime and UGV
Provider module graphs with production dependencies only.

The same isolated module-load command failed on the original image with
`ERR_MODULE_NOT_FOUND: ajv-formats`, then passed after rebuilding the corrected image. Both
application containers and their separate local PostgreSQL containers became healthy.
Formatting, targeted ESLint, frozen-lockfile validation, and SBOM checks passed.

## Observed results

| Check                              | Actual result                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| External Device MCP/MQTT preflight | `PASS_WITH_UPSTREAM_DRIFT`; optional `ugv_laser_range` is absent                                     |
| Strict read-only smoke             | `BLOCKED_EXTERNAL_ENV`, `UGV_STATE_CHASSIS_STALE`                                                    |
| Follow-up timestamp diagnosis      | Device chassis timestamp was 1,387 ms ahead of host time; the smoke script rejects future timestamps |
| Runtime and Provider readiness     | Healthy                                                                                              |
| Four read-only Runtime tools       | HTTP 200, `resultType: complete` for state, capabilities, payload status, and targets                |
| Runtime and Provider Inspector     | HTTP 200; Node debugging targets available on loopback ports 9229 and 9230                           |
| Runtime over host LAN address      | Independent Docker bridge client received HTTP 200 and `ready` from `17.26.1.20:19120/health/ready`  |
| MCP over host LAN address          | HTTP 200 with 10 tools from `17.26.1.20:19120/mcp`                                                   |
| Provider published port            | TCP connection to `17.26.1.20:17010` succeeded from the same independent container                   |

Service ports were changed from loopback to `0.0.0.0`; Inspector ports remain loopback-only.
The reusable configuration is
[`compose.debug.yaml`](../../deploy/development/ugv-provider-template/compose.debug.yaml).
The LAN probe was a separate local container, not a different physical LAN host.

No clock or freshness threshold was changed. The strict smoke result remains failed; healthy
services and successful read-only calls do not qualify physical task execution, selected GOWM
storage, SDAR integration, or formal release acceptance. No mutating device tool was called in
these startup checks.

## Evidence

- `DEVELOPMENT_EXTERNAL_PREFLIGHT.json`
- `DEVELOPMENT_EXTERNAL_SMOKE.json`
- `DEVELOPMENT_DEBUG_READ_ONLY_DIAGNOSTICS.json`
- `DEVELOPMENT_DEBUG_LAN_ACCESS.json`
