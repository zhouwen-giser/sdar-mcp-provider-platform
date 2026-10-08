# UGV route source through existing planning and mission execution

The real planner and Provider adoption/re-execution chain passed on the software
simulator with selected GOWM storage. Public Runtime qualification is recorded
separately in V_REPLAN_SOURCE.md. Only SMPP is changed. No simulator producer or
bridge changes are required for the chosen route intake.

`AirportRoadPlanner` calls the existing dashboard `plan_route` event and consumes
only `route_candidates`. The 2026-09-29 probe returned six real planner points,
148.5 m, for the supplied navigation destination. The probe did not create or
start a mission. It does not use dashboard display caches, pruned waypoints,
entity state, target truth or requested-point interpolation.

The existing source broadcasts without a request ID. SMPP makes no claim of
request correlation: it selects an actual candidate only if its start/end and
ordered vias match the request within the declared 20 m airport road-snap
boundary. Unrelated or malformed broadcasts are ignored until the bounded
timeout. The consumer uses the inspected airport transform:
`lon = 106.81485 + x / 111320`, `lat = 29.71950 + y / 110540`.
It cannot be used for a different scene without qualifying its coordinate policy.
The stable plan/source IDs are hashes of selected planner content; source time
is SMPP receive time. They are not asserted to be device-issued identities.

The Runtime persists the selected plan in the existing Execution before Device
MCP creation. It submits exactly those points to `ugv_path_follow_mission` with
`need_plan=false`, persists the allocated mission, publishes a candidate Artifact,
and starts that mission through the existing mutation journal. Original Task
arguments and argumentHash remain unchanged. Replanning at the device would
break the exact candidate binding, so it is deliberately disabled for this
already planned submission.

Only a distinct, fresh, non-retained `/ugv/mission_state` state 1 can confirm
adoption. It must identify the same active mission, occur after journaled start,
and match an accepted primary submission with the exact planned-argument hash.
The Artifact retains the selected route's original source identity and geometry.
Candidate/receipt do not advance `activeRefs.route` or `effectivePlanRevision`.
Duplicates, old missions, stale samples, pending controls, preemption and
cancellation cannot cause late adoption. Recovery reuses the persisted plan and
accepted journal steps without repeating planning or physical dispatch.

Production wiring is explicit: set `UGV_NAVIGATION_PLANNER_MODE=isr_airport`,
`UGV_NAVIGATION_PLANNER_URL`, and the enabled airport navigation business profile.
Only simulation mode/entity `ugv1` is accepted. Default mode remains disabled;
the planner is not enabled from a generic endpoint setting alone. Install the
packaged GOWM Runtime 027 and Provider 030 overlays before enabling adjustments.
See `examples/gowm-shared-storage/task-business-airport-navigation.example.json`.

Every source observation is still projected. High-rate pose/IMU packets request
at most 20 recovery polls per second; mission-state packets request an immediate
poll. A newer matching, non-retained RUNNING heartbeat can confirm the same
adoption at commit; newer cancellation or retained data revokes that proof.
Production trajectory projection follows the declared 1 s interval using the
persisted last sample across restarts; raw observation and physical-completion
checks keep their original frequency. The local producer source inspection is not
a deployed-build attestation.

Source references (read-only):
`referee/referee/dashboard/combined_dashboard.py` plan_route handler;
`autonomous_sim/autonomous_sim/route_planner.py` plan_route_candidates;
`autonomous_sim/autonomous_sim/planner/gnss_transform.py`;
`ros2_mcp_server/ros2_mcp_server/mcp_server/ugv_mcp_server.py` path-follow creation;
`actor_control/actor_control/ugv_control/mission_manager/vehicle_action_client.py`
path ingestion, action feedback and mission-state publication.
