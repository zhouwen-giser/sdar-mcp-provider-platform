# P10 Southbound Session Recovery Qualification

Status: **PASS**

Qualification window: 2026-09-02T08:39:08Z–2026-09-02T08:47:08Z  
Branch: `codex/smpp-mcp-tasks-ugv-diagnostic-support-v0.1`  
Implementation commit: `c9ebc2a9b5c43525059ae2a68211d14e3c7e9f52`

## Scope and safety boundary

This qualification was read-only. It did not submit an SDAR Task, arm a diagnostic lease, navigate, publish MQTT, invoke a Device mutation, invoke a Referee mutation, or call a weapon operation. The only Device operation invoked was `get_status`; MQTT use was subscribe-only.

The deployed Provider remains in `live` execution mode against the remote simulation environment:

- Device MCP: `http://192.168.2.63:19000/mcp`
- MQTT: `mqtt://192.168.2.63:1883`
- Provider MCP: `http://127.0.0.1:19100/mcp`
- Provider ID: `isr.vehicle.ugv.ugv1`
- Resource ID: `vehicle:ugv1`

## Exact running instance

| Component | Image                                                                           | Image ID / digest                                                         | OCI revision                               | Started at                       | Restart count | State             |
| --------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------- | ------------: | ----------------- |
| Runtime   | `sdar-ugv-simulation-real/runtime:c9ebc2a9b5c43525059ae2a68211d14e3c7e9f52`     | `sha256:9fad02fb9858e014cc8858435da082c7ecf478fa427c1e4d7e8764b1acc7e0ca` | `c9ebc2a9b5c43525059ae2a68211d14e3c7e9f52` | `2026-09-02T08:41:25.322909149Z` |             0 | running / healthy |
| Adapter   | `sdar-ugv-simulation-real/ugv-adapter:c9ebc2a9b5c43525059ae2a68211d14e3c7e9f52` | `sha256:5a3d40519a9d2b08e6d4604da6aa85ace137e1749b1ae89fee4736adf61a082c` | `c9ebc2a9b5c43525059ae2a68211d14e3c7e9f52` | `2026-09-02T08:41:05.660680228Z` |             0 | running           |

Runtime `GET /health/ready` returned HTTP 200 with every declared dependency ready. Adapter authoritative initialization returned:

```json
{
  "state": "READY",
  "reasonCode": "UGV_PROVIDER_READY",
  "deviceMcpConnected": true,
  "mqttConnected": true,
  "initialObservationReceived": true,
  "recoveryComplete": true,
  "observedAt": "2026-09-02T08:41:08.885Z"
}
```

The Adapter Device timeout is 2000 ms, preserving room for the implementation's single read-only expired-session reconnect within the Runtime's 5-second request deadline. Mutation calls remain non-retriable.

## Remote Device MCP qualification

A fresh `initialize` returned HTTP 200, protocol `2025-11-25`, server `ugv-mcp-server` version `1.26.0`, and a new `mcp-session-id`. `tools/call get_status` in that session returned `isError=false` with:

- vehicle ID `3`, role/entity `ugv`
- position `x=-340.18`, `y=109.45`, `z=0.01`
- speed `0.0 km/h`
- GNSS `1`, location status `4`, fault `0`
- chassis task ID `-1`, state `0`

## MQTT authority qualification

A clean read-only subscriber received all three exact authority topics without publishing:

| Topic                   | Evidence                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `status/ugv1`           | device `ugv1`, status `idle`, speed `0`, position `lon=106.811794`, `lat=29.72049`                     |
| `/ugv/status`           | authoritative stamp present; GNSS `1`, location status `4`, speed `0`, chassis task ID `-1`, state `0` |
| `/ugv/component_status` | authoritative stamp present; GNSS/navigation/comms status `0`                                          |

## Provider read-only deadline qualification

Both calls used `vehicle_get_state(resourceId=vehicle:ugv1)` through the deployed Runtime and completed inside the 5-second deadline:

| Probe                   | HTTP / duration    | Provider result                        | Fresh evidence                                                                       |
| ----------------------- | ------------------ | -------------------------------------- | ------------------------------------------------------------------------------------ |
| Immediate               | `200 / 0.073024 s` | `resultType=complete`, `isError=false` | observedAt `2026-09-02T08:42:00.515Z`; positionObservedAt `2026-09-02T08:42:00.501Z` |
| After >75 s idle window | `200 / 0.031271 s` | `resultType=complete`, `isError=false` | observedAt `2026-09-02T08:44:25.133Z`; positionObservedAt `2026-09-02T08:44:25.134Z` |

The post-idle snapshot reported Device MCP, MQTT, and Device available; position `lat=29.72049/lon=106.811794`; speed `0`; mission state `0`; and `mqttIngressSequence=21093`. Mission, payload, chassis, health, and position observed timestamps all advanced to the second probe window.

Provider `tools/list` remained read-only and returned 10 tools, including `vehicle_navigate`; no mutation tool was called.

## Zero-active and zero-mutation proof

Before qualification:

- Adapter: executions total 4 / active 0; diagnostic leases active 0; mutation journal total 8; Device tool-call audit total 470; execution command acknowledgements total 2.
- Runtime: Provider tasks total 4 / active 0; unexpired runtime leases 0; task commands total 2 / active 0.

After qualification:

- Adapter: executions total 4 / active 0; diagnostic leases active 0; mutation journal total 8; Device tool-call audit total 474; execution command acknowledgements total 2.
- Runtime: Provider tasks total 4 / active 0; unexpired runtime leases 0; task commands total 2 / active 0.
- The four new Adapter audit rows are exclusively `get_status`, all `accepted`, with durations 13 ms, 11 ms, 10 ms, and 18 ms.

Therefore the qualification created no Task, Execution, lease, command, mutation-journal row, Mission, navigation, or other physical side effect.

## Verification baseline

The implementation commit passed the repository's complete `pnpm verify` gate before deployment: unit 206, contract 36, integration 336, recovery 9, security 53, end-to-end 9, plus conformance, capacity, static, container, and build checks. The focused Device MCP contract suite passed 19/19, including exact stale-session classification and a 404 `Session not found` recovery case with a hung old-session DELETE. The implementation never retries mutations.

## Diagnostic controls

Diagnostics remain explicitly enabled for the P10 runtime. The scoped operator credential is mounted through environment name `SMPP_DIAGNOSTICS_OPERATOR_TOKEN_FILE` at `/run/secrets/smpp_diagnostic_operator_token`; no credential value is recorded here. Active diagnostic lease count is zero.
