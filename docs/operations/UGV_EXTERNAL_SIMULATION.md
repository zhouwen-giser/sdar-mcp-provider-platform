# UGV external-simulation contract freeze

This runbook is limited to the `UGV Agent Profile × SDAR × SMPP` external simulation Goal. It freezes contract evidence; it does not authorize a Tool call, MQTT publish, navigation, control action, production use, or physical-vehicle use.

## Frozen scope

The only southbound schemas frozen for this Goal are:

- `vehicle_get_state` read: Device MCP `get_status`;
- `vehicle_navigate` point start: Device MCP `ugv_path_follow_mission` followed by `ugv_mission_control(action=start)`.

The Profile mapping is `embodied.move_to@1` → `embodied.move` → `vehicle:ugv1` → `vehicle_navigate` → `mission.type=point`, in `simulation` execution mode. Skill `x` maps to WGS84 longitude and `y` maps to latitude; axis swapping and undeclared CRS conversion are forbidden. A Provider completed Task is necessary but is not sufficient: final-position evidence must be fresh, post-dispatch, revision/cursor backed, resource-correlated, and within the Goal tolerance.

No other discovered Device Tool schema is frozen or authorized. In particular, reconnaissance, tracking, gimbal, fire, emergency-stop automation, route, distance, and return-home operations are outside this contract.

## Reproduce offline

The input is the redacted, read-only preflight at `reports/ugv-agent-profile-simulation/external-preflight.redacted.json`. The freezer imports the current public UGV Topic inventory, Device operation qualification, allowlist, MQTT authority, and resolved configuration. It opens no socket and invokes no external Tool.

Create the artifacts once:

```bash
node --import tsx scripts/ugv-agent-profile-simulation/freeze-contracts.mjs --write
```

Verify them on every later run:

```bash
node --import tsx scripts/ugv-agent-profile-simulation/freeze-contracts.mjs --check
pnpm exec vitest run tests/ugv-simulation/external-contract-freeze.test.ts
```

`--write` is intentionally non-overwriting. If an artifact already exists and any canonical content differs, it fails exactly as `UGV_EXTERNAL_DEVICE_CONTRACT_ARTIFACT_DRIFT` or `UGV_EXTERNAL_MQTT_CONTRACT_ARTIFACT_DRIFT`. `--check` also fails when either artifact is absent. Review a legitimate upstream contract change as a new qualification event; do not delete or replace the frozen evidence as an automatic compatibility response.

## Device contract

`device-mcp-contract.redacted.json` records the negotiated Device MCP protocol separately from the northbound SMPP Runtime protocol. Each of the three Goal tools retains its complete input schema and an explicit `null` output schema when the simulator does not declare one. The artifact records input, output, combined-schema, and tool canonical hashes. Existing runtime result validation remains mandatory for undeclared output schemas.

The current external decision is `UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT=false`. This Goal is simulation-only, but its external acceptance still requires the real `tools/list`; there is no automatic mock fallback. The artifact grants no authorization and records zero `tools/call`, publish, and control counts.

## MQTT contract

`mqtt-contract.redacted.json` freezes the 18 public exact subscriptions with their QoS, no wildcard, and the externally observed explicit `ros_bridge_json` wire mode. It also records source-versus-ingest timestamp precedence, canonical/alias status authority, the final-position field, and resolved defaults:

- freshness: chassis 3000 ms, mission 3000 ms, health 5000 ms, target 3000 ms, payload 3000 ms;
- maximum future skew: 1000 ms;
- stationary confirmation: speed ≤ 0.1 km/h for 500 ms with at least 2 samples.

Observed upstream drift remains disclosed, not relabeled as conformance: the read-only capture did not see canonical `status/ugv`, used the explicit `/ugv/status` compatibility authority, and observed `/ugv/speed` at publisher QoS 0 while the subscription contract requests QoS 1.

## Stable blockers

The freezer fails closed for an invalid evidence envelope, any recorded side effect, missing/duplicate/out-of-allowlist Goal tools, discovery or schema hash drift, operation qualification drift, Topic/QoS/wire/authority drift, changed timestamp semantics, changed resolved thresholds, mock fallback, and missing/drifting frozen artifacts. A failure is a blocker requiring a fresh read-only qualification and review; it is never permission to guess a schema or wire mode.
