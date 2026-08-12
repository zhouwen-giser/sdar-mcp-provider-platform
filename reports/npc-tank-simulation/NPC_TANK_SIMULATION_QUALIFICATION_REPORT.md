# Goal 11 NPC Tank real simulation qualification report

## Result

`NPC_TANK_SIMULATION_PARTIAL`

The real NPC simulator is integrated through the final Goal 10 shared vehicle architecture. Exact-head deployment, real Device MCP/MQTT capture, four direct Device MCP reads, four Registry-derived Runtime reads, formal PMS onboarding, Registry publication, PMS Web visibility, and two clean restart cycles passed without any simulator mutation.

Full qualification is not claimed. The real MQTT stream mixes ROS-bridge envelope and direct-domain shapes, so the truthful compatibility mode is `ros_bridge_json`, outside the two frozen strict modes (`ros_message_json` or `direct_domain_json`). The `/npc_tank1/speed` publisher also delivered QoS 0 rather than the expected QoS 1. Real control, reconnaissance, mutating Runtime Task lifecycle, and active-task interruption recovery were not executed because the explicit enable flags and safe fixtures were absent.

## Source boundary

| Item                                  | Value                                              |
| ------------------------------------- | -------------------------------------------------- |
| Goal 10 base ref                      | `codex/goal-10-ugv-simulation-real-interface`      |
| Goal 10 base SHA                      | `ac3369ba9fa4e0ff6b6589525594b50291da02b7`         |
| Goal 11 branch                        | `codex/goal-11-npc-tank-simulation-real-interface` |
| Qualification product SHA             | `67eb73729588b9f6fc46f8ea448ec2f3046243f0`         |
| Source state used by images           | tracked source clean                               |
| Provider Package `realResourceStatus` | `pending`                                          |

The qualification product SHA is the source/image boundary. The later evidence-cut and delivery-artifact commits are intentionally distinct and do not change the tested binaries.

## Real interfaces

| Interface               | Result                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Device MCP endpoint     | HTTP, redacted host hash `6a321119728a4553`, port `19003`, path `/mcp`                                              |
| Server                  | `npc-tank-mcp-server` `1.26.0`                                                                                      |
| Protocol                | `2025-11-25`                                                                                                        |
| Tools                   | 15 captured / 15 authoritative; contract SHA-256 `b06aa50a6e2fbe5bd0fa60cbc5578aeee887e5cfb3ec026edde1054f3c8d6be6` |
| Navigation              | `npc_tank_path_follow_mission`                                                                                      |
| Circular reconnaissance | supported by `scan_mode=2`; real lifecycle not executed                                                             |
| MQTT endpoint           | MQTT, redacted host hash `6a321119728a4553`, port `1883`                                                            |
| MQTT topics             | 18 requested; 15 observed in the primary capture; authoritative and compatibility status topics observed            |
| Wire mode               | `ros_bridge_json` compatibility mode                                                                                |
| Upstream defects        | mixed wire shapes; speed publisher QoS 0 instead of 1                                                               |

No endpoint host value, credential, coordinate, raw MQTT payload, image, or video is stored in this report set.

## Acceptance gates

| Gate                     | Status                                  | Evidence boundary                                                                                                              |
| ------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| G0 Goal 10 inheritance   | PASS                                    | Exact base, PMS addendum, branch, baseline, and UGV inheritance recorded.                                                      |
| G1 real MCP contract     | PASS                                    | Real Streamable HTTP connection and exact 15-tool `tools/list`; no Mock fallback.                                              |
| G2 real MQTT             | PARTIAL                                 | Real status and payload shapes observed, but strict wire-mode and speed QoS gates are not satisfied.                           |
| G3 shared reuse          | PASS                                    | Shared vehicle MCP/MQTT/task abstractions reused; UGV regression passed.                                                       |
| G4 Provider capabilities | PASS_WITH_DECLARED_UNAVAILABLE          | Eleven shared operations exposed; laser is truthfully unavailable; no fake primitive.                                          |
| G5 read-only             | PASS                                    | Four direct Device reads and four Registry-backed Runtime reads passed; mutation count zero.                                   |
| G6 low-risk control      | NOT_EXECUTED                            | Control flag false; bounded distance, point, waypoint, and prior-route fixtures absent.                                        |
| G7 reconnaissance        | NOT_EXECUTED                            | Recon flag and safe region absent; circular capability is contract-proven only.                                                |
| G8 Runtime               | PARTIAL                                 | Registry-backed read path and deterministic lifecycle/idempotency/recovery pass; real mutating Task lifecycle not executed.    |
| G9 PMS / Registry        | PASS                                    | Formal API/application onboarding, Worker ACTIVE, catalog, revision/checksum/ETag, and Registry-derived endpoint reads passed. |
| G10 PMS Web              | PASS_REAL_API_MODE                      | Package, Provider, Resource, Deployment, Registry, and Audit are visible through live same-origin HTTP API projections.        |
| G11 recovery             | PARTIAL                                 | Two clean real restarts passed; active real Task interruptions were not executed.                                              |
| G12 deployment           | PASS_WITH_UPSTREAM_DRIFT                | Independent overlay, exact-head non-root images, no simulator Mock services, health and clean restart passed.                  |
| G13 security             | PASS                                    | Secrets and raw/coordinate data excluded; Registry and Web sensitive-key scans returned zero.                                  |
| G14 regression           | PASS_WITH_PREEXISTING_FORMAT_EXCEPTIONS | NPC/UGV/HA/shared/PMS/protocol/build gates passed; only three unchanged Goal10 JSON files fail whole-repo Prettier.            |

## Read-only, PMS, and Registry evidence

- Direct real Device MCP reads passed for `get_status`, `npc_tank_get_capabilities`, `npc_tank_area_recon_get_status`, and `npc_tank_area_recon_get_targets`; only response hashes were retained.
- PMS onboarding used PMS API/application flows, the Postgres provisioner, Worker reconciliation, catalog discovery, and Registry publication. It did not directly write authority tables.
- Runtime `runtime-32b1d426cc87-0` was ACTIVE. Registry revision 1, canonical checksum, bootstrap checksum, ETag, and HTTP 304 all agreed.
- Registry catalog revision 1 exposed the 11 frozen shared vehicle operations. The final Runtime endpoint was taken from Registry authority, not substituted with an Adapter endpoint.
- Four Registry-backed Runtime reads passed: `vehicle_get_state`, `vehicle_get_capabilities`, `vehicle_get_payload_status`, and `vehicle_get_targets`.
- Provider Package remains `realResourceStatus: pending` because the overall real qualification is partial.

## Deployment and recovery

The one-click entry point is:

```bash
bash deploy/npc-tank-simulation/up.sh
```

The overlay reuses `deploy/pms-console/compose.yaml` and adds NPC-specific Postgres, preflight, Adapter, and Runtime services. The real profile contains no simulator Mock service. Five locally built application images run as `node` and carry OCI revision `67eb73729588b9f6fc46f8ea448ec2f3046243f0`.

After the exact-head initial deployment, two complete `down -> up -> independent smoke` cycles passed. Each cycle observed the authoritative status topic, resolved the same Registry revision/checksum/server/catalog, and completed the same four Runtime reads with zero mutations. The final stack was shut down cleanly while preserving named database, Worker-state, and contract-report volumes.

## Regression and evidence policy

Final runs passed lint, typecheck, build, the 74-case frozen protocol gate, 142 unit tests, 22 contract tests, 52 NPC/UGV integration-security-E2E tests, 66 NPC/config/PMS targeted tests, 49 UGV simulation tests, 20 HA climate tests, and 9 HA light tests. Tests requiring `python3` spawn or loopback listeners were rerun outside the restrictive sandbox after their sandbox-only `EPERM` diagnostics and passed unchanged.

Whole-repository `pnpm format:check` reports only three unchanged Goal10 evidence JSON files. They are byte-equivalent to the Goal11 base. Goal11 changed files and NPC reports pass their dedicated Prettier check.

Mock fixtures are used only for deterministic regression. They are not part of the real deployment and are not cited as real qualification evidence.

## Safety and deferred work

- Real simulator control calls: 0.
- Real simulator reconnaissance mutation calls: 0.
- Real simulator effector calls: 0.
- MQTT publishes by qualification tooling: 0.
- No safe coordinates or distances were invented.
- Effector/fire remains disabled and is optional for core qualification.

See `KNOWN_LIMITATIONS.md` for the exact closure conditions. The delivery archive and patch are generated from the evidence-cut commit after this report is committed; their checksum and final artifact commit are reported in the handoff response.
