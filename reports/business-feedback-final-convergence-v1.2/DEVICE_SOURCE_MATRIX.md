# BFF-003 current southbound evidence

The successful real public navigation run and a later active reconnaissance
source audit replace the earlier idle-only navigation assessment. Both used the
software simulator at 192.168.2.63. The active recon audit discovered 15 current
MCP tools; its selected schemas and exact replies are captured. Local simulator
source is supporting evidence only: its tool description differs from the live
server, so no deployed build identity is claimed.

| Required fact     | Real source and binding                                                                                                                                         | Current qualification                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Route candidate   | Existing airport Socket.IO plan_route/route_candidates; selected geometry submitted through Device MCP with need_plan=false; source ID is a content fingerprint | Real public V-NAV passed; no device-issued request ID claimed                            |
| Route adoption    | Fresh non-retained raw mission-state 1 after journaled start; mission matches the persisted candidate; effective plan revisions 1→2→3                           | Real public V-NAV/V-EDIT passed                                                          |
| Replan            | Stop prior mission, confirm stationarity, plan/create/start replacement; same Task, missions 47564→47565→47566                                                  | Two real public adjustments and full process restart passed                              |
| Recon status/lock | Active MCP status=5 and 121 MQTT status packets; no mission/session identity; command receipt uses mission 47567                                                | Actual inferred V-OBS PASS: target 9, one policy lock, later stage 3; attempt 17         |
| Targets           | 30 active MQTT frames and MCP result contain empty targets; envelopes lack mission/session identity                                                             | Historical empty-target audit; attempt 17 has actual target 9, continue and decline PASS |
| Coverage          | Two active frames carry run_id=1 and no authoritative relation to the status/target streams                                                                     | Fresh current-Execution inference allowed; mapFull=false                                 |
| Current footprint | No qualified direct or calibrated source selected                                                                                                               | Disabled under core profile; not required map-full qualification                         |
| Trajectory        | Actual GNSS/position authority, persisted separately from planned routes; declared ingest-time authority where source timestamps are absent                     | Real navigation and terminal arrival passed                                              |

Navigation evidence: `V-NAV.json`, `V-EDIT.json`,
`evidence/navigation-public-restart.json`, and the hashed records under
`evidence/navigation-public-handoff/`.

Recon evidence: `evidence/recon-readonly-recheck.json` (121 idle status frames,
one coverage frame, two read-only MCP calls) and
`evidence/recon-active-source-recheck.json` (configured the user's original area,
started mission 47567, observed active messages, then stopped through
`ugv_area_recon_control` with cmd_type=4). Cleanup was independently observed as
status 9 and lock stage 1. No chassis, lock or fire call was made. This audit is
not a public Runtime recon workflow and does not qualify V-OBS/V-INPUT.

Generated acceptance scene labels are authorized by the user and recorded in
SCENE.json. They do not establish the simulator build or a reset-safe source
session. The earlier idle capture `evidence/device-read-only-20260929.json` and
2026-09-28 active notes remain historical observations, not current workflow passes.

The Recon inference supplement supersedes source identity as a prerequisite. See
RECON_SUPPLEMENT.md for the later public attempts, including the sensor-pause
fix and current live EO load failure. The historical captures above are retained
verbatim; they are not the current V-OBS/V-INPUT verdict.

Final Recon evidence: `evidence/recon-public-attempt-17.json`, `V-OBS.json`,
`V-INPUT.json` and `evidence/recon-public-handoff/manifest.json`. These qualify
the local selected profile, not remote deployment or external SDAR.
