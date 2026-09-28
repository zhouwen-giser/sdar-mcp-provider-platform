# UGV live device source check — 2026-09-28

This check used the authorized UGV simulator MCP and MQTT services. It exercised the **device layer** directly. It did not create a Provider Task, use the selected `gowm_shared` business Store, read Runtime business events, or run an SDAR consumer. None of the four required business workflows is marked passed by this check.

## Supplied geometry and device reach

The requested navigation destination was `(longitude 106.81312856, latitude 29.72041222)`. The requested reconnaissance polygon, in order, was:

1. `(106.81271124, 29.71821513)`
2. `(106.81268055, 29.71864445)`
3. `(106.81323289, 29.71869495)`
4. `(106.81345382, 29.71816462)`

The polygon is non-self-intersecting and about 3,320 m². Its nearest boundary is about 190 m from the requested navigation destination, while `get_capabilities` reported an EO detection range of 140 m. A configuration at the initial vehicle position returned `coverability: none`, minimum distance 226.6 m. The user allowed one additional road waypoint for this UGV test. The selected waypoint was `(106.81315, 29.7193)`; the vehicle reached approximately `(106.81305335, 29.71930612)`. From there, the device returned `coverability: full`, minimum 69.1 m and maximum 133.8 m.

## Observed device calls and MQTT facts

| Run                                       | Device call and observation                                                                  | Result                                                                                                                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Navigation to supplied point              | `ugv_path_follow_mission`, then `ugv_mission_control(start)`                                 | Mission `1775532649` reached chassis state 4, progress 100. Planning receipt reported six points and 148.5 m.                                                                                                      |
| Navigation to additional road point       | Same tools                                                                                   | Mission `1315920037` reached chassis state 4, progress 100. Planning receipt reported nine points and 157.5 m.                                                                                                     |
| Finite area scan                          | `ugv_area_recon_configure` with the four supplied vertices, then `ugv_area_recon_control(1)` | Mission `1782600200` reached status 11, progress 100. Device coverage reported 424/424 and 100%. Target `9` appeared with WGS84 position, capture time and pixel coordinates; the list was empty after completion. |
| Continuous scan and lock-duration release | Configure/start, then `ugv_area_recon_lock(true, 9, mission_id)`                             | No automatic stage 2/3 was seen in eight seconds with target `9` visible. The explicit lock reached stage 3; a five-second limit led to stage 1 and resumed scanning status 5. The scan was then stopped.          |
| Continuous scan and explicit release      | Configure/start, lock target `9`, then `ugv_area_recon_lock(false, 0, mission_id)`           | Release ACK had `error_code: 0`; status showed stage 1 and resumed scanning status 5. The scan was then stopped.                                                                                                   |

The final independent status read showed chassis speed 0, a terminal EO task, reconnaissance status 9, lock stage 1 and `attack_ready: false`. No weapon tool was called. No server system configuration was modified, no data was deleted, and no unrelated service was operated.

## Source contracts still needed

- The live `ugv_path_follow_mission` description advertises `/ugv/planned_path`, but exact MQTT subscriptions captured no payload during planning or either navigation. A point count, distance, mission ACK and observed GNSS trajectory do not establish route geometry, route revision or plan adoption.
- Live `/ugv/area_recon/status` messages omitted `mission_id`/`id` through scanning, stage 3 lock, release and stop. The target list also omitted a mission/session ID. The coverage feed used `run_id: 1` for the finite scan, different from the MCP mission ID, without an authoritative mapping. The current Runtime requires strict mission binding before Task projection.
- A 2026-09-28 local follow-up fixed snapshot carryover: when a newer reconnaissance status omits the mission ID or reports a different one, the previous ID and mission-scoped coverage/lock fields are removed before merging. Unit tests cover both cases. This guard prevents an old ID from qualifying later unbound status or targets; it does not provide the missing source identity.
- The coverage feed gave 424 coordinate pairs and `cell_size: 3`, but no declared frame, origin, axis convention or cell-center/index semantics. Reported 100% coverage is a device statistic; it cannot become a located `recon.covered_area` Artifact from this source alone.
- Dynamic FOV and gimbal values were visible, but no calibrated camera mount or current footprint geometry was provided. An explicit lock and its two release paths do not prove device-native **automatic** lock ownership, target-loss handling or a source lock-session identifier.

These gaps keep the selected writable Profile gate closed. A named isolated scene and device/scene version are also absent, so this check cannot be reused as formal `SIMULATION_BUSINESS` evidence. Local raw MCP/MQTT reports and their hashes are retained in the goal package under `.codex/SMPP_Business_Feedback_Convergence_Codex_Goal_v1.1/reports/`.
