# P10 nearby Mission correlation qualification

Qualified at `2026-09-02T06:18:35Z` without creating a Task, dispatching navigation,
calling a Referee mutation, or invoking any other Device mutation.

## Implementation

- Implementation commit: `ae8a7cb8fb46eedb6f544ebbcfd591e59921e18f`
- The exact failed primary mutation hash
  `ebcdd4d8c40cc2b870d51d089aac3b80f942b9e4effb8a2732c5208f1586bd90`
  reproduces as `ugv_path_follow_mission` with `need_plan=null` for the nearby
  point target. The Provider now preserves an omitted point/route planning mode
  as exact direct navigation (`need_plan=false`); explicit `auto`,
  `road_network`, and `direct` remain distinct.
- Device Mission `12394` was already consistent across the durable PRIMARY and
  FOLLOWUP journal rows. A post-dispatch idle sentinel with no usable Mission ID
  is now `UGV_MISSION_CORRELATION_UNCONFIRMED`; only a different valid observed
  Mission ID is `UGV_DOWNSTREAM_MISSION_ID_MISMATCH`.
- Future immutable start-confirmation lifecycle facts use the validated Adapter
  transition reason. A terminal Adapter snapshot with
  `UGV_START_OBSERVATION_TIMEOUT` therefore produces the same reason in the
  authoritative Task row, task observation, and ProviderOps record.
- Historical record `1c1dd66a-bf8f-5354-8027-6c5de507a0f3` remains immutable
  with its pre-fix `START_CONFIRMED` reason and was not rewritten.

## Verification

- `pnpm verify`: PASS.
- Unit: 43 files / 206 tests PASS.
- Contract: 6 files / 36 tests PASS.
- Integration: 33 files / 336 tests PASS.
- Recovery: 1 file / 9 tests PASS.
- Security: 9 files / 53 tests PASS.
- E2E: 3 files / 9 tests PASS.
- Expanded Adapter conformance and capacity baseline: PASS.
- Focused UGV mapping/correlation: 85 tests PASS.
- Focused PostgreSQL terminal reason alignment: 4 tests PASS.

## Exact running instance

- MCP endpoint: `http://127.0.0.1:19100/mcp`
- Runtime image:
  `sdar-ugv-simulation-real/runtime:ae8a7cb8fb46eedb6f544ebbcfd591e59921e18f`
- Runtime digest:
  `sha256:bf67821ba937c4d394d8690fc29988582c0977e9fde411b606efe2cd73aaba2b`
- Runtime startedAt: `2026-09-02T06:17:35.846360095Z`; restartCount: `0`
- Adapter image:
  `sdar-ugv-simulation-real/ugv-adapter:ae8a7cb8fb46eedb6f544ebbcfd591e59921e18f`
- Adapter digest:
  `sha256:322dd3e73cc31bd0fea8b142a55ce1d9c42991ecd6d83caea7cd99bbb5dd6b10`
- Adapter startedAt: `2026-09-02T06:17:10.075585179Z`; restartCount: `0`
- Both OCI revisions equal the implementation commit.
- Readiness: `ready`; all listed dependencies are `ready`, including Adapter
  Manifest, Provider Telemetry ingress, and business-event persistence/replay.

The current directory exposes ten tools and includes `vehicle_navigate`. The
Adapter remains in `live` execution mode with Device MCP
`http://192.168.2.63:19000/mcp` and MQTT `mqtt://192.168.2.63:1883`.

## Zero-active and read-only evidence

- Adapter nonterminal executions: `0`.
- Runtime nonterminal Tasks: `0`.
- Active diagnostic leases: `0`.
- Runtime lease rows: `0`.
- Read-only `vehicle_get_state`: complete and not an error.
- Provider observedAt: `2026-09-02T06:18:35.523Z`.
- Position observedAt: `2026-09-02T06:18:35.547Z`.
- Mission observedAt: `2026-09-02T06:18:35.544Z`.
- MQTT connected: `true`; Device MCP connected: `true`; GNSS: `normal`.
- Speed: `0 km/h`; Mission state: `0` with no active Mission identity.

For failed remote Task `0ba82895-6a55-46f8-ac4d-0bcb3547e50f`, Runtime durable
ProviderOps contains 102 delivered records: 27 execution progress, 15 recovery,
16 resource metric, 26 resource state, 1 scheduler decision, and 17 task
lifecycle records. This confirms the ProviderOps path for the exact Task; no
historical facts were changed during qualification.

The diagnostics API contract hash remains
`5f3e158dd994958e1fcd99e294d7b4da783fd07dbbf82254d91c09696af21ec2`.
The credential path remains `/run/secrets/smpp_diagnostic_operator_token`,
configured by `UGV_DIAGNOSTICS_CONTROL_TOKEN_FILE`; no credential value is
recorded here.
