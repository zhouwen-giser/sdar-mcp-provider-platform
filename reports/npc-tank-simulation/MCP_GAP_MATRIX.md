# Goal 11 NPC Tank Device MCP gap matrix

## Evidence and authority

This matrix is derived from:

- `reports/npc-tank-simulation/MCP_CONTRACT_CAPTURE.json`;
- the Goal 11 protocol, inheritance, safety, parity, and test documents;
- the pre-Goal-11 NPC implementation and its captured 23-tool Mock contract;
- the final Goal 10 UGV shared vehicle implementation.

The real runtime `tools/list` capture is authoritative for tool names and machine input schemas. The bundled human-readable contract is used only where the machine contract is silent. The old Mock contract is comparison evidence, not a design authority.

The authoritative source capture itself used `tools/list` only. Final qualification subsequently executed the four explicitly read-only tools (`get_status`, `npc_tank_get_capabilities`, `npc_tank_area_recon_get_status`, and `npc_tank_area_recon_get_targets`) and retained only result hashes. No real control, reconnaissance mutation, effector action, or MQTT publish occurred.

| Capture fact     | Evidence                                                                              |
| ---------------- | ------------------------------------------------------------------------------------- |
| Status           | `PASS`                                                                                |
| Server           | `npc-tank-mcp-server` `1.26.0`                                                        |
| MCP protocol     | `2025-11-25`                                                                          |
| Contract SHA-256 | `b06aa50a6e2fbe5bd0fa60cbc5578aeee887e5cfb3ec026edde1054f3c8d6be6`                    |
| Tools            | 15 captured / 15 expected                                                             |
| Input schemas    | 15                                                                                    |
| Output schemas   | 0                                                                                     |
| Tool annotations | 0                                                                                     |
| Mock fallback    | Disabled                                                                              |
| Contract drift   | Predicted `get_capabilities` is absent; actual `npc_tank_get_capabilities` is present |

The endpoint is intentionally omitted. The capture contains no authorization or credential value.

## Decision vocabulary

- `READ_ONLY`: no physical mutation; eligible for read-only smoke after implementation guards pass.
- `CONTROL`: chassis mutation; requires `NPC_TANK_ENABLE_REAL_CONTROL=true` and the applicable explicit safe fixture.
- `RECON`: payload/EO mutation; requires `NPC_TANK_ENABLE_RECON_TESTS=true`, plus an explicit region fixture when an area is required.
- `EFFECTOR`: weapon-side mutation; requires `NPC_TANK_ENABLE_EFFECTOR_TESTS=true` and separate authorization. It is not a core qualification gate.
- `MIGRATE`: replace the old mapping with the captured real contract.
- `RETAIN_SHARED`: reuse the final Goal 10 transport, validation, mission-chain, task-lifecycle, and recovery behavior with only an NPC profile.
- `INTERNAL_ONLY`: use as an implementation primitive; do not create a new public Provider operation.
- `UNAVAILABLE`: retain shared Provider vocabulary only as disabled capability/availability; never fabricate a downstream call.

## Contract-wide findings

1. The real inventory is the human-described 15-tool family with two important name facts: `get_status` is deliberately unprefixed, while capabilities are actually exposed as `npc_tank_get_capabilities`.
2. Every captured `mission_id` is an integer with default `0`. Submit/configure calls must capture the positive returned integer, persist its canonical decimal representation before a dependent mutation, and pass the same integer to lifecycle calls. The old NPC code accepts only string result IDs and does not perform the dependent start call.
3. The captured Pydantic-style schemas omit enum/range constraints for many fields, omit `additionalProperties`, and leave `task_points`, `region_points`, and `target_types` item shapes weakly typed. The descriptions and bundled protocol provide the missing intended constraints, but runtime result/input probes remain required before qualification.
4. No tool exposes `outputSchema` or annotations. A successful MCP envelope therefore cannot prove business success. The Provider must apply the shared structured-result validator (`error_code`, common state, integer mission correlation, recon `res`/`cmd_res`) and fail closed on missing, contradictory, or unexpected result shapes.
5. Read results may contain fields outside the Provider truth boundary. In particular, capability descriptions mention `camp`, `max_hp`, weapon `damage`, and `hit_rate`; target descriptions mention `damage` and `camp`; attack confirmation may contain hit/destruction adjudication. These fields must not enter Provider results, snapshots, events, telemetry, or evidence.
6. The real inventory has no laser-ranging tool. `vehicle_laser_range` must not be backed by the old `npc_tank_laser_range` Mock fixture. Report it as `PRD_REQUIRED_EXTERNAL_INTERFACE_UNAVAILABLE`, advertise it as unsupported, and return disabled availability without a downstream call.

## Tool inventory summary

|   # | Captured real tool                   | Input schema SHA-256                                               | Safety      | Final Provider mapping                           | Migration                                    |
| --: | ------------------------------------ | ------------------------------------------------------------------ | ----------- | ------------------------------------------------ | -------------------------------------------- |
|   1 | `npc_tank_path_follow_mission`       | `c771ffd75a061b97f8ceb6230243ca32a0c91d9b72ec0000bb72099306167b85` | `CONTROL`   | `vehicle_navigate` point/route submit            | `MIGRATE`, then shared mission-chain start   |
|   2 | `npc_tank_return_home`               | `305aa6da628eb77289c1e1bea68027c0ed0637c11bc5c38746f6356010056820` | `CONTROL`   | `vehicle_navigate` return-home submit            | `MIGRATE`, then shared mission-chain start   |
|   3 | `npc_tank_move_distance`             | `16dba6b57a3cf17044591d46feab23af13c3c3d1c39780aa09c75e0bbf373acb` | `CONTROL`   | `vehicle_navigate` distance submit               | `MIGRATE`, then shared mission-chain start   |
|   4 | `npc_tank_mission_control`           | `980520249a90659b6ba75b9e5865baa3caa69b0825961c10ec0cf00ef1421f2a` | `CONTROL`   | Navigation task start/pause/resume/cancel        | `RETAIN_SHARED` with exact mission ID        |
|   5 | `npc_tank_motion_stop`               | `0b1f61ca106f52b2c6361e253d9d68681c019a0cdd35aa912b65e6246be609e6` | `CONTROL`   | `vehicle_emergency_stop` chassis primitive       | Replace old stop/cancel tools                |
|   6 | `get_status`                         | `fbac902bfaec6cda6de77d6963f23beb60d4c8442f43edf844e1eacb5b20cb27` | `READ_ONLY` | `vehicle_get_state`; lifecycle observation       | Add actual unprefixed tool                   |
|   7 | `npc_tank_get_capabilities`          | `da6108c4b0fa50aa2c720b09bac4af9d4d4b6bf8a040a7006df71a72988ad587` | `READ_ONLY` | `vehicle_get_capabilities`                       | Use captured name; whitelist safe facts      |
|   8 | `npc_tank_area_recon_configure`      | `2a0a0003faa79dfaf7dd67f388e2e4a0032b1b2bfbd70b436f2fe74aca1ac715` | `RECON`     | `vehicle_area_recon` configure                   | `MIGRATE`, then shared mission-chain start   |
|   9 | `npc_tank_area_recon_control`        | `9aeebe5d591d96113dab467d1ffa130e842cb5e8011aae4daec47f72d5e99fd9` | `RECON`     | Recon start/pause/resume/cancel                  | `RETAIN_SHARED` with exact mission ID        |
|  10 | `npc_tank_area_recon_lock`           | `46bcdc4993aed9a60fa7c999f4b1f00aafc34f1916f80ca21fe2e3fc379f123f` | `RECON`     | `vehicle_track_target`; unlock on cancel/stop    | Merge old lock/unlock mappings               |
|  11 | `npc_tank_area_recon_get_status`     | `9d98b99bc4d64f8831048484df6bbe0b062f759d1a79c04413d99c14dd9f7b7b` | `READ_ONLY` | `vehicle_get_payload_status`; recon lifecycle    | Use independent `MotionStatus` mapping       |
|  12 | `npc_tank_area_recon_get_targets`    | `d75f0d07e5852d1610d1bf8c1f7f5092495594c728d58d527f1e3a586e20f476` | `READ_ONLY` | `vehicle_get_targets`                            | Normalize and sanitize rich local targets    |
|  13 | `npc_tank_area_recon_reset`          | `3d9785b52dc4352f23497f0387401b36ae30d4f3ff6626975f90f8172765a97f` | `RECON`     | Recon recovery/reset primitive                   | `INTERNAL_ONLY`                              |
|  14 | `npc_tank_area_recon_attack_confirm` | `8b7d8360327fffc25c8602575e285c0422b9d49293236a7a597a757759a23d52` | `EFFECTOR`  | `vehicle_fire_weapon` post-confirmation dispatch | Replace old attack pair; disabled by default |
|  15 | `npc_tank_gimbal_move`               | `42fb52fc148f358f653139c5e1dbf73dfb37f239342f1f1b82e68dba9d7332c8` | `RECON`     | `vehicle_control_gimbal`                         | Add shared operation; NPC capability profile |

## Per-tool gap decisions

### 1. `npc_tank_path_follow_mission`

- Machine input: `task_points` (default `null`, item shape unspecified), `json_url:string=""`, `need_plan:boolean=false`, `density:string="adaptive"`, `mission_id:integer=0`; no field is machine-required.
- Goal 11 prediction: `task_points`, `json_url`, `need_plan`, `density`, and integer `mission_id`, with NPC `need_plan` defaulting to `false`. This is confirmed.
- Old Mock/current code: sent `waypoints`, `speed_limit_kmh`, and `stop_on_obstacle`; selected obsolete `npc_tank_send_waypoints` as a fallback.
- Final mapping: standard `vehicle_navigate` point/route becomes `task_points`; `json_url` remains `""` because the public Provider must not become an arbitrary URL fetch surface. `planningMode=road_network` maps to `true`; `direct` and omitted/`auto` map to the NPC default `false`; `density` passes the bounded shared enum.
- Lifecycle decision: call submit with `mission_id:0`, validate/persist the returned positive integer, then call `npc_tank_mission_control` with `{action:"start", mission_id:<same>}`. MCP acceptance is not terminal success.
- Unresolved: `task_points` has no machine type/items constraint and `density` has no machine enum. Use strict local WGS84 point validation and the documented density enum until a machine schema upgrade is captured.

### 2. `npc_tank_return_home`

- Machine input: optional `mission_id:integer=0`.
- Goal 11 prediction: return home with integer mission handling. Confirmed.
- Old Mock/current code: sent `{}` and did not start the returned mission.
- Final mapping: `vehicle_navigate` with `mission.type="return_home"`; submit with `mission_id:0`, persist the returned ID, and start it through `npc_tank_mission_control`.
- Safety/precondition: `CONTROL`; no call without real-control enablement. A missing previous route is a structured business rejection, not a transport failure and not retryable as a mutation.
- Unresolved: no output schema proves the exact rejection code for “no prior route.” Capture it only through an explicitly enabled safe fixture or deterministic simulator contract test.

### 3. `npc_tank_move_distance`

- Machine input: required `direction:string`, required `distance:number`, optional `mission_id:integer=0`.
- Goal 11 prediction: `distanceM -> distance`, `backward -> back`, integer mission chaining. Confirmed by the description; the machine schema itself does not enumerate direction or require a positive distance.
- Old Mock/current code: sent `distance_m` and accepted `backward` directly, with no mission ID.
- Final mapping: `vehicle_navigate` distance mission sends `{direction:"forward"|"back"|"left"|"right", distance:<positive metres>, mission_id:0}`, persists the returned ID, then sends lifecycle `start` with that ID.
- Safety: `CONTROL`; qualification additionally requires the explicit bounded `NPC_TANK_TEST_DISTANCE_M` fixture. The Provider must never invent a distance.
- Unresolved: machine constraints omit the documented bilingual direction values and `distance>0`; the Provider should emit only the four canonical English values and validate positivity locally.

### 4. `npc_tank_mission_control`

- Machine input: required `action:string`, optional `mission_id:integer=0`.
- Goal 11/human mapping: `pause -> pause`, `resume -> start`, `cancel -> terminate`.
- Old Mock/current code: allowed `start/pause/resume/terminate/cancel/stop`, sent `resume` downstream, and omitted the mission ID.
- Final mapping: use only documented `start`, `pause`, and `terminate`; every dependent call carries the persisted mission ID. The initial submit follow-up and Runtime resume both use `start`.
- Lifecycle decision: a command response is only an acknowledgement. Task state changes require a newer, mission-correlated `MissionState`/`chassis_task` observation; cancellation must not become terminal merely because the call returned.
- Unresolved: the machine schema does not enumerate actions or require a nonzero ID. Enforce both in the adapter profile.

### 5. `npc_tank_motion_stop`

- Machine input: empty object.
- Goal 11 prediction: likely replacement for old `npc_tank_stop`. Confirmed exactly.
- Old Mock/current code: invoked both `npc_tank_stop` and `npc_tank_cancel_mission`, neither of which exists in the real capture.
- Final mapping: one independent chassis primitive in `vehicle_emergency_stop`, combined with mission `terminate`, recon stop, and unlock primitives using known mission IDs. Attempt all independent emergency primitives before surfacing the first failure, matching final UGV behavior.
- Safety: `CONTROL`, despite being a safety action; default read-only qualification must not call it.
- Persistence gap: the existing NPC audit-table constraint permits only `npc_tank_%`, so this name is compatible. The separate unprefixed `get_status` issue remains below.

### 6. `get_status`

- Machine input: empty object.
- Goal 11 prediction: the known unprefixed exception. Confirmed.
- Old Mock/current code: no such tool; `vehicle_get_state` returned the MQTT snapshot only.
- Final mapping: primary read primitive for `vehicle_get_state`, normalized through the same modern composite-state path as MQTT. It also supplies `chassis_task`, `eo_task`, and `weapon_task` observations, but only a newer mission-correlated observation may advance a Task.
- Availability: `{available:false}` means the device is unavailable; it must not be treated merely as “MQTT connected.” Heading remains compass heading and must not overwrite raw IMU/world yaw.
- Migration blocker: `npc_tank_device_tool_call.tool_name` currently has `CHECK (tool_name LIKE 'npc_tank_%')`. Add a forward NPC migration allowing the exact literal `get_status`; do not edit the already-applied baseline migration and do not silently drop its audit record.
- Unresolved: no output schema exists, so the complete state shape and `available=false` exclusivity require read-only response tests.

### 7. `npc_tank_get_capabilities`

- Machine input: empty object.
- Drift: Goal 11 expected `get_capabilities`; the real machine contract proves the prefixed name. The old Mock happened to include the correct actual name, but the Provider did not expose `vehicle_get_capabilities`.
- Final mapping: standard `vehicle_get_capabilities`, using captured tool presence and schemas for facts such as navigation, circular reconnaissance, gimbal modes, and NPC defaults.
- Safety: `READ_ONLY`.
- Truth boundary: do not pass the raw result through. Whitelist operational facts; strip or omit referee/global-truth and adjudication fields including `camp`, `max_hp`, weapon `damage`, and `hit_rate`. Report `navigation.needPlanDefault=false`, `recon.circularScan=true`, `gimbal.manualYawSweep=true`, and `gimbal.continuousPitchSweep=false` only where supported by captured contract evidence.
- Unresolved: the machine contract has no output schema, and the description says the data originates from `entities.yaml`. A safe read must prove the returned shape before full capability qualification.

### 8. `npc_tank_area_recon_configure`

- Machine input: `region_points:array|null`, `region_type:integer=5`, `target_types:array|null`, `scan_num:integer=0`, `lock_duration_limit:integer=0`, `recon_type:integer=1`, `scan_speed:number=30`, `scan_mode:integer=1`, `scan_pitch:number=0`, and `mission_id:integer=0`; no machine-required fields and array item shapes are unspecified.
- Goal 11 prediction: the same field family, with `scan_mode=2` as circular reconnaissance. Confirmed.
- Old Mock/current code: sent `{area, scan_mode:"area"|"sector", scan_count, zoom, stop_on_target, target_types:string[]}` and used three obsolete `npc_tank_eo_scan_*` tools for circular scan.
- Final mapping: `vehicle_area_recon` maps `area -> region_points`, shared `regionType`, integer target types, `scanNum`, lock duration, recon type, scan speed, and scan pitch. `scanMode="area" -> 1`; `"circular" -> 2`. Circular mode sends `region_points:null` and does not invent an area.
- Lifecycle decision: configure with `mission_id:0`, validate `res/error_code`, persist the returned ID, then start via `npc_tank_area_recon_control {cmd_type:1, mission_id:<same>}`.
- Safety: `RECON`. Area mode additionally requires `NPC_TANK_TEST_RECON_REGION_JSON`; circular mode still requires explicit recon enablement. Chassis motion and recon remain concurrent.
- Unresolved: region/target array item schemas, enum ranges, and the optional `coverability` response are not machine-described. Enforce the bundled protocol constraints and validate observed responses before qualification.

### 9. `npc_tank_area_recon_control`

- Machine input: required `cmd_type:integer`, optional `mission_id:integer=0`.
- Goal 11 prediction: `1=start`, `2=pause`, `3=resume`, `4=stop`. Confirmed by the description.
- Old Mock/current code: sent `{command:<1..4>}` and omitted mission ID.
- Final mapping: Runtime area-recon start/pause/resume/cancel sends `{cmd_type:1|2|3|4, mission_id:<persisted>}`. Circular and area recon use this same tool.
- Lifecycle decision: map terminal state from independent recon `MotionStatus`, not chassis `MissionState`; use post-dispatch observation cursors and mission correlation.
- Safety: `RECON`.
- Unresolved: the machine schema does not constrain `cmd_type` to 1–4 or require a nonzero mission ID. The adapter must.

### 10. `npc_tank_area_recon_lock`

- Machine input: required `lock:boolean`, `target_id:integer=0`, `mission_id:integer=0`.
- Goal 11 prediction: combined lock/unlock with integer target and mission IDs. Confirmed.
- Old Mock/current code: used `npc_tank_area_recon_lock {target_id:string}` and a separate `npc_tank_area_recon_unlock {}`; it also sent a gimbal-centering call before lock.
- Final mapping: `vehicle_track_target` sends `{lock:true, target_id:<canonical safe integer>, mission_id:<recon ID>}`. Cancel/emergency unlock sends `{lock:false, target_id:0, mission_id:<same>}`. Do not pre-position the gimbal unless a captured contract explicitly requires it.
- Safety: `RECON`; requires a target ID observed from the local recon target feed. Never invent or coerce a noncanonical ID.
- Unresolved: the machine schema cannot express “target required only when lock=true.” Enforce that conditional locally and validate `cmd_res/error_code`.

### 11. `npc_tank_area_recon_get_status`

- Machine input: empty object.
- Goal 11 prediction: independent `MotionStatus`, `scan_mode`, `scan_pitch`, `out_of_range`, `camera_fault`, progress/coverage, lock, attack readiness, gimbal, and command acknowledgement. The tool description confirms the core fields.
- Old Mock/current code: treated returned status as a chassis-style `state` track, combined it with nonexistent `get_exceptions`, and used legacy `eo_task` as reconnaissance.
- Final mapping: `vehicle_get_payload_status` plus authoritative recon lifecycle observations. Map MotionStatus 1–13/99 independently; `out_of_range=true` is a process state, not an immediate failure; `camera_fault=true` freezes progress/coverage authority and raises payload degradation.
- Safety: `READ_ONLY`.
- Unresolved: no output schema machine-enforces the described fields, and the description does not enumerate every optional coverage/ack field from the human protocol. Validate with a read-only call and MQTT cross-observation before relying on it for Task completion.

### 12. `npc_tank_area_recon_get_targets`

- Machine input: empty object.
- Goal 11 prediction: rich local target metadata and empty-list clearing. Confirmed by the description at a field-family level.
- Old Mock/current code: merged raw Device MCP objects with legacy MQTT targets and could retain stale/duplicate entries; the old tool description allowed a different target vocabulary.
- Final mapping: `vehicle_get_targets`; normalize canonical integer target ID, capture time, type, WGS84 position, ENU velocity, distance, confidence, threat, IFF, lock duration, pixel position, and role name. Deduplicate against MQTT by source time and authority; an authoritative empty list clears stale targets.
- Safety: `READ_ONLY`.
- Truth boundary: omit `damage`, `camp`, referee verdict, and global-truth fields even if returned. Never store raw target payloads in evidence.
- Unresolved: output shape is description-only. A read-only call while recon is not running should first prove the safe empty-list shape; nonempty target evidence requires explicitly enabled recon.

### 13. `npc_tank_area_recon_reset`

- Machine input: optional `mission_id:integer=0`.
- Goal 11 prediction: reset after terminal recon state. Confirmed.
- Old Mock/current code: allowed an empty call but did not integrate a mission-correlated reset flow.
- Final mapping: `INTERNAL_ONLY` recovery/qualification primitive after observed recon state 9, 10, or 11; send the persisted recon mission ID, validate `cmd_res/error_code`, and require a later IDLE observation.
- Safety: `RECON`; never auto-reset a running task and never expose a new NPC-only public operation.
- Unresolved: the machine schema does not encode the terminal-state precondition or response shape.

### 14. `npc_tank_area_recon_attack_confirm`

- Machine input: required `confirm:integer`, optional `mission_id:integer=0`.
- Goal 11 prediction: `confirm=1|2` with mission ID. Confirmed by the description.
- Old Mock/current code: first called nonexistent `npc_tank_attack_target`, then sent `{target_id:string, confirmed:true}` to this tool.
- Final mapping: the only downstream primitive for `vehicle_fire_weapon`, after the shared elicitation, local durable dispatch fence, observed target lock, attack readiness, and explicit effector enablement. `confirm=1` dispatches; a locally declined/cancelled elicitation remains locally terminal and should not be converted into a physical call merely to exercise `confirm=2`.
- Safety: `EFFECTOR`, disabled by default and optional for core qualification. A timeout/lost response is uncertain execution and must never be retried automatically.
- Truth boundary: sanitize every returned hit, miss, destruction, damage, health, camp, and referee field. The Provider may report only local command acceptance/rejection and lifecycle state.
- Unresolved: the machine schema does not constrain `confirm` to 1 or 2 and provides no output schema. Real execution requires separate authorization beyond this report.

### 15. `npc_tank_gimbal_move`

- Machine input: required `mode:string`; `yaw:number=0`, `pitch:number=0`, `yaw_speed:number=30`, `pitch_speed:number=0`, `delta_zoom:number=0`, `mission_id:integer=0`.
- Goal 11 prediction: absolute, relative, velocity, and reset semantics; velocity is manual yaw sweep, with no continuous pitch sweep. Confirmed by the description.
- Old Mock/current code: sent `angle_unit` and optional `zoom`; it did not expose standard `vehicle_control_gimbal`, and circular recon incorrectly used separate EO scan tools.
- Final mapping: standard `vehicle_control_gimbal` for absolute/relative/reset, with integer mission handling and `eo_task` observation correlation. Do not create `npc_gimbal`. Manual velocity sweep must use the same shared operation only after the shared public schema provides a finite bounded-duration mode; force `pitch_speed=0` for NPC velocity and always send the matching zero-velocity stop.
- Safety: `RECON`; manual EO and active recon are mutually exclusive, while circular target-producing search remains `vehicle_area_recon(scanMode="circular")` rather than this tool.
- Unresolved: the final UGV public manifest currently exposes only finite absolute/relative/reset modes even though its lower-level mapper supports bounded velocity. Goal 11 must either generalize that shared schema with UGV regression or keep velocity internal to an explicitly bounded qualification probe; an NPC-only public mode is forbidden.

## Removed Mock-only tools and replacements

The following old allowlisted tools are absent from the authoritative real capture and must not remain qualification fallbacks:

| Old Mock-only tool                   | Decision                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `npc_tank_send_waypoints`            | Remove fallback; use captured `npc_tank_path_follow_mission` only.                           |
| `npc_tank_stop`                      | Replace with `npc_tank_motion_stop`.                                                         |
| `npc_tank_cancel_mission`            | Replace with mission-control `terminate` using the exact mission ID.                         |
| `npc_tank_attack_target`             | Remove; attack confirmation owns the already locked target.                                  |
| `npc_tank_area_recon_unlock`         | Replace with `npc_tank_area_recon_lock {lock:false}`.                                        |
| `npc_tank_area_recon_get_exceptions` | Remove MCP dependency; consume recon exception/status through captured status/MQTT channels. |
| `npc_tank_laser_range`               | Remove real mapping; mark shared laser capability unavailable.                               |
| `npc_tank_eo_scan_start`             | Remove; circular recon is `configure(scan_mode=2)` plus recon control.                       |
| `npc_tank_eo_scan_stop`              | Remove; circular recon stops through recon control `cmd_type=4`.                             |
| `npc_tank_eo_set_angle`              | Remove; circular pitch is `scan_pitch`; manual pointing is `npc_tank_gimbal_move`.           |

## Public Provider surface decision

NPC must expose the final shared vehicle vocabulary, not device names:

| Provider operation           | Downstream authority                                                    |
| ---------------------------- | ----------------------------------------------------------------------- |
| `vehicle_get_state`          | `get_status` plus normalized MQTT state                                 |
| `vehicle_get_capabilities`   | `npc_tank_get_capabilities` plus captured contract facts                |
| `vehicle_get_payload_status` | `npc_tank_area_recon_get_status`                                        |
| `vehicle_get_targets`        | `npc_tank_area_recon_get_targets` plus normalized MQTT target authority |
| `vehicle_laser_range`        | `UNAVAILABLE`; no real captured tool, no Mock fallback                  |
| `vehicle_navigate`           | Path/return/distance submit plus mission control                        |
| `vehicle_area_recon`         | Recon configure plus recon control                                      |
| `vehicle_track_target`       | Combined recon lock/unlock                                              |
| `vehicle_control_gimbal`     | `npc_tank_gimbal_move`                                                  |
| `vehicle_fire_weapon`        | Attack confirmation, effector-disabled by default                       |
| `vehicle_emergency_stop`     | Motion stop plus independent lifecycle stop/unlock primitives           |

`npc_tank_area_recon_reset` remains internal. No `npc_move`, `npc_scan`, `npc_gimbal`, or other NPC-only public operation is permitted.

## Implementation and test closure

1. The legacy profile was replaced by the shared resilient Streamable HTTP behavior with exact contract hashing, bounded read retry/reconnect, per-tool circuit health, no uncertain-mutation retry, and no Mock fallback.
2. The final UGV mapping/result-validation/start-flow abstractions were generalized through an NPC profile; UGV regression passed.
3. Common results, nonzero `error_code`, integer mission IDs, dependent starts, mission correlation, and post-dispatch observation cursors are validated and covered by deterministic tests.
4. Forward migration `026_npc_tank_get_status_tool_audit` admits only the exact unprefixed `get_status` exception without weakening the remaining audit constraint.
5. Legacy 23-tool/fallback assumptions were removed from the real mapping and qualification path. All 15 captured tools have exact mapping/schema regression coverage.
6. Four real read-only Device MCP calls passed. Control, recon, and effector calls remained separately gated and were not executed without explicit authorization and fixtures.

## Open contract differences

| Difference                                              | Current disposition                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Actual capabilities name is prefixed                    | Bind `npc_tank_get_capabilities`; record the prediction drift as resolved by runtime authority. |
| All 15 `outputSchema` values are absent                 | Locally mitigated by conservative result validation; four safe read shapes were hash-verified.  |
| All annotations are absent                              | Open; safety classes in this report are conservative policy, not server-declared annotations.   |
| Several enums/ranges are description-only               | Open; enforce documented values locally and reject unknown values.                              |
| Array item schemas are weak/empty                       | Open; enforce shared WGS84 and integer target-type schemas locally.                             |
| Laser ranging is absent                                 | `PRD_REQUIRED_EXTERNAL_INTERFACE_UNAVAILABLE`; no fabricated tool.                              |
| Manual gimbal velocity is below the final public schema | Open shared-schema decision; never add an NPC-only operation or unbounded sweep.                |
| Read descriptions mention referee/adjudication fields   | Resolved at Provider boundary by strict allowlisting/sanitization; safe-read regression passed. |

## Matrix status

`PASS_REAL_15_TOOL_GAP_CLASSIFIED_IMPLEMENTED_READ_ONLY_VERIFIED`

This status proves contract capture, mapping implementation, deterministic regression, and four real read-only calls. It does not claim real control, reconnaissance mutation, effector execution, or a real mutating Runtime Task lifecycle; those remain separately reported as not executed.
