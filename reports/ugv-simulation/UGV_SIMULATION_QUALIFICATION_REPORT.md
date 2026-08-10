# Goal 10 UGV simulation qualification report

Overall qualification: `UGV_SIMULATION_PARTIAL`

Qualification product SHA: `e1473ea6c7ea61ef0495e85cf19b6f7256143791`

Source status: `TRACKED_SOURCE_CLEAN`

Generated at: `2026-08-10T07:39:21Z`

## Qualification summary

| Field                                 | Evidence-backed value                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Branch                                | `codex/goal-10-ugv-simulation-real-interface`                                                                                                                |
| Base SHA                              | `981792b9cb22f8b3117fe3ab26f639de71487d1f`                                                                                                                   |
| Reviewed main SHA                     | `981792b9cb22f8b3117fe3ab26f639de71487d1f`                                                                                                                   |
| Qualification product SHA             | `e1473ea6c7ea61ef0495e85cf19b6f7256143791`                                                                                                                   |
| Reviewed baseline drift               | `NO_DRIFT`                                                                                                                                                   |
| Protected paths                       | `PASS_NO_DIFF_FROM_BASE`                                                                                                                                     |
| Frozen protocol                       | `PASS_UNCHANGED`                                                                                                                                             |
| Real Device MCP endpoint              | `http`, `lan-or-dns`, host hash `6a321119728a4553`, port `19000`, path `/mcp`                                                                                |
| Real MQTT endpoint                    | `mqtt`, `lan-or-dns`, host hash `6a321119728a4553`, port `1883`, path redacted                                                                               |
| Live MCP server                       | `ugv-mcp-server` version `1.26.0`, protocol `2025-11-25`                                                                                                     |
| Captured live tool count              | `15`                                                                                                                                                         |
| Live MCP contract hash                | `3725dba7b92e587ecb3fd670bc54e00633828370e9063f96809b8f7c1400935a`                                                                                           |
| MCP conformance                       | Expected tool names and input schemas captured; live output schemas and annotations absent, so full machine output-schema conformance is not claimed         |
| MQTT conformance                      | `PARTIAL`: explicit `ros_bridge_json`; real connection and 18 subscriptions pass; canonical `status/ugv` absent and `/ugv/speed` publisher QoS drift remains |
| Provider capability surface           | 11 Runtime operations; `vehicle_get_capabilities` and bounded `vehicle_control_gimbal` present                                                               |
| Read-only smoke                       | `PASS` in two clean Compose cycles                                                                                                                           |
| Real control smoke                    | `NOT_EXECUTED_REAL_CONTROL_DISABLED`                                                                                                                         |
| Recon smoke                           | `NOT_EXECUTED_SAFE_FIXTURE_MISSING`                                                                                                                          |
| Effector smoke                        | `NOT_EXECUTED_EFFECTOR_DISABLED`                                                                                                                             |
| Runtime E2E                           | Real read-only path `PASS`; real mutating Task path `NOT_EXECUTED`                                                                                           |
| Recovery                              | Deterministic recovery gates pass; two-cycle real clean restart passes; active real Task recovery not executed                                               |
| Regression                            | `PASS`                                                                                                                                                       |
| NPC non-impact                        | `PASS`: public catalog unchanged and 36 NPC tests pass                                                                                                       |
| Mock fallback                         | `PASS_DISABLED_FOR_REAL_EVIDENCE`                                                                                                                            |
| Compose path                          | `deploy/ugv-simulation/compose.yaml`                                                                                                                         |
| One-click lifecycle                   | `up.sh`, `smoke.sh`, `down.sh`                                                                                                                               |
| Compose clean restart                 | `PASS_WITH_UPSTREAM_DRIFT`; final stack down and named volumes preserved                                                                                     |
| Provider Package `realResourceStatus` | `pending`                                                                                                                                                    |
| Remote push performed                 | `false`                                                                                                                                                      |

The qualification SHA is the exact clean product commit used to build the images and collect evidence. A later report-only commit and delivery envelope are intentionally not represented as the tested product SHA.

## Real evidence

The final host preflight connected to the real Device MCP and MQTT services with mock fallback disabled. It captured all 15 expected Device MCP tools and subscribed passively to all 18 bounded MQTT topics. It did not publish MQTT messages and did not call a mutating Device MCP tool.

The two Runtime smoke cycles each proved:

- Runtime readiness and all required dependencies ready;
- an 11-operation UGV Runtime catalog;
- `vehicle_get_state` with MQTT connected, Device MCP connected, device availability true, and fresh chassis telemetry;
- real `vehicle_get_capabilities` completion;
- real payload-status completion with the payload online and no current camera fault;
- real target-read completion with zero current targets;
- zero mutating tool calls.

Evidence anchors:

- Host preflight: `REAL_EXTERNAL_PREFLIGHT.json`, SHA-256 `c169836e65b09862695597f9c58293a7a06da0c1d5f7e466b61ed22d9885ffcd`, `2026-08-10T07:27:07.158Z`–`2026-08-10T07:27:08.464Z`, exit 0.
- Cycle 1 smoke: `READ_ONLY_SMOKE.cycle1.json`, SHA-256 `7ba6c377fb9f16a5c1dab0a29e645a6d0527bd9444c9719229fb310ef556ca3b`, `2026-08-10T07:28:46.562Z`–`2026-08-10T07:28:46.747Z`, exit 0.
- Cycle 2 Compose preflight: `REAL_EXTERNAL_PREFLIGHT.compose-cycle2.json`, SHA-256 `89c8a689584bf53a39a36318d748141999b607f99e6ca43dd3780352aab096e1`, `2026-08-10T07:29:37.624Z`–`2026-08-10T07:29:38.839Z`, exit 0.
- Cycle 2 smoke: `READ_ONLY_SMOKE.json`, SHA-256 `59336e2ac2e7490a8dba753443961e3ca4f4645c46df00b2c84526ac15914de7`, `2026-08-10T07:29:39.181Z`–`2026-08-10T07:29:39.362Z`, exit 0.
- Persistent MCP capture: `MCP_CONTRACT_CAPTURE.json`, SHA-256 `9f4cca36aaacbe649ede430d4c1d1d5d079b27c9ec784317a0250eb952679519`.

No report contains a real URL, credential, coordinate, or raw MQTT payload.

## Acceptance gates

| Acceptance gate                 | Status                                                | Evidence or reason                                                                                             |
| ------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Baseline/branch integrity       | `PASS`                                                | Required branch and exact merge base; tracked product source clean                                             |
| No frozen protocol change       | `PASS`                                                | Frozen protocol check exit 0 and protected diff empty                                                          |
| No NPC behavior/catalog change  | `PASS`                                                | NPC catalog unchanged; full NPC suite 36/36                                                                    |
| Real MCP connection             | `PASS`                                                | Final host and Compose preflights                                                                              |
| Real `tools/list` captured      | `PASS`                                                | 15 tools, persistent capture hash recorded                                                                     |
| Mock contract fallback disabled | `PASS`                                                | Both preflights report false; no mock services in Compose                                                      |
| Used MCP tool/schema mapping    | `PASS_DETERMINISTIC_AND_LIVE_INPUT_SCHEMA`            | Exact bindings tested against captured live input schemas                                                      |
| MCP result/error semantics      | `PASS_DETERMINISTIC`                                  | Structured rejection, contradictory result, `error_code`, `res`, and `cmd_res` tests; no real mutation claimed |
| Integer mission-ID lifecycle    | `PASS_DETERMINISTIC`                                  | Dynamic chaining and correlation tests; no real control lifecycle executed                                     |
| Device MCP reconnect            | `PASS_DETERMINISTIC`                                  | Dropped read reconnect and bounded retry test                                                                  |
| Real MQTT connection            | `PASS`                                                | Both preflights and both Runtime smokes                                                                        |
| Real topic mapping              | `PARTIAL_UPSTREAM_DRIFT`                              | Compatibility alias observed; canonical topic absent                                                           |
| Correct QoS                     | `FAIL_UPSTREAM_DRIFT`                                 | `/ugv/speed` observed QoS 0, expected 1                                                                        |
| Explicit MQTT wire mode         | `PASS`                                                | `ros_bridge_json`                                                                                              |
| `status/ugv` mapping            | `PARTIAL_UPSTREAM_DRIFT`                              | Decoder exists; only `/ugv/status` observed live                                                               |
| `available=false` fail closed   | `PASS_DETERMINISTIC`                                  | Exhaustive boundary tests; final live device availability was true                                             |
| MissionState mapping            | `PASS_DETERMINISTIC`                                  | Exhaustive 0 through 5 mapping and invalid-state rejection                                                     |
| Recon MotionStatus mapping      | `PASS_DETERMINISTIC`                                  | Independent exhaustive mapping for 1 through 13 and 99                                                         |
| EO/recon observations           | `PARTIAL`                                             | EO pose and passive recon status observed; no real recon task executed                                         |
| Rich target normalization       | `PARTIAL`                                             | Deterministic rich-target authority tests pass; final real target count zero and target topics unobserved      |
| `vehicle_get_capabilities`      | `PASS_REAL_READ_ONLY`                                 | Completed through Runtime in both cycles                                                                       |
| `vehicle_get_state`             | `PASS_REAL_READ_ONLY`                                 | Completed with both connections and availability true                                                          |
| `vehicle_navigate(distance)`    | `NOT_EXECUTED_REAL_CONTROL_DISABLED`                  | Safety gate closed                                                                                             |
| `vehicle_navigate(point)`       | `NOT_EXECUTED_SAFE_FIXTURE_MISSING`                   | No safe point supplied                                                                                         |
| Pause/resume/cancel             | `NOT_EXECUTED_REAL_CONTROL_DISABLED`                  | No real navigation task started                                                                                |
| `vehicle_control_gimbal`        | `NOT_EXECUTED_REAL_CONTROL_DISABLED`                  | Deterministic post-dispatch lifecycle passes; no real gimbal command                                           |
| `vehicle_emergency_stop`        | `NOT_EXECUTED_REAL_CONTROL_DISABLED`                  | Deterministic preemption passes; no real control sequence                                                      |
| Runtime Task lifecycle          | `PARTIAL`                                             | Read-only Runtime path passes; real mutating Task path not executed                                            |
| No duplicate uncertain command  | `PASS_DETERMINISTIC`                                  | Lost mutating response is uncertain and never retried                                                          |
| MQTT reconnect                  | `PASS_DETERMINISTIC_AND_CLEAN_RESTART`                | Same-process resubscribe test plus two clean real starts                                                       |
| Adapter restart recovery        | `PASS_DETERMINISTIC`                                  | Restores active execution without duplicate mutation                                                           |
| Runtime restart/reconcile       | `PASS_DETERMINISTIC`; `NOT_EXECUTED_ACTIVE_REAL_TASK` | Clean Runtime readiness repeated; no active real mutating task                                                 |
| Evidence redaction              | `PASS`                                                | Hashed structural evidence only; no raw payload or endpoint                                                    |
| Real-only Compose build/config  | `PASS`                                                | Required service allowlist, security checks, and clean product revision                                        |
| Real-only Compose up/smoke      | `PASS_WITH_UPSTREAM_DRIFT`                            | Both cycles healthy and read-only smoke passed                                                                 |
| Clean Compose restart           | `PASS_WITH_UPSTREAM_DRIFT`                            | Full down/up/smoke/down/up/smoke/down sequence exit 0                                                          |

## Safety-gated non-execution

The following are deliberately not PASS claims:

- real distance, point, route, pause/resume/cancel, return-home, gimbal, and emergency-stop controls: `NOT_EXECUTED`;
- real area/circular reconnaissance and target tracking: `NOT_EXECUTED`;
- live PMS onboarding and Registry authority: `NOT_EXECUTED`;
- real effector/fire execution: `NOT_EXECUTED`.

The real-control, recon, and effector switches remained false. Safe point, waypoint, and recon-region fixtures were absent. Both read-only target queries returned zero targets. No control, recon, effector, or MQTT-publish action was performed.

## Regression and recovery

The final product gate components all exited 0: changed-file Prettier check, lint, typecheck, build, detached protocol check, and the UGV/NPC Provider suites. UGV counts were unit 9, contract 6, integration 20, security 3, and gRPC E2E 1. NPC counts were unit 16, contract 7, integration 8, security 4, and E2E 1.

The Goal 10 suite passed 49 tests across five files. An independent exact commit-object run passed 131/131 across 16 targeted files: UGV Provider 39, NPC Provider 36, Goal 10 core 39, and config/migration 17. The NPC+UGV Provider-platform suites passed 5/5 against temporary PostgreSQL, including a fire-decline case that reached final cancellation with zero Device MCP fire calls. Provider Package tests passed 13/13 plus self-check with UGV still `pending`; config compatibility passed 45/45. The PostgreSQL CAS and unique-active-fire-index checks, config schema, protected paths, frozen protocol, Docker deployment security, and diff checks passed.

Deterministic recovery covers Device MCP reconnect, uncertain-mutation no-retry, per-tool circuit half-open behavior, MQTT same-process reconnect and resubscription, duplicate-task replay and identity conflict, stale recon/gimbal observation rejection, and Adapter restart reconciliation. The real Compose restart proves process-level reconnection for read operations, not recovery of an active real mutating task.

## Compose result

The official final sequence was:

1. `bash deploy/ugv-simulation/down.sh`
2. `bash deploy/ugv-simulation/up.sh`
3. `bash deploy/ugv-simulation/smoke.sh`
4. `bash deploy/ugv-simulation/down.sh`
5. `bash deploy/ugv-simulation/up.sh`
6. `bash deploy/ugv-simulation/smoke.sh`
7. `bash deploy/ugv-simulation/down.sh`

Every command exited 0. Both starts became healthy; both container preflights returned `PASS_WITH_UPSTREAM_DRIFT`; both read-only smokes passed. Final `docker compose ps --all` was empty. The Adapter database, Runtime database, and contract-report named volumes were preserved. Both application images carry OCI revision `e1473ea6c7ea61ef0495e85cf19b6f7256143791`.

A retained local database-volume configuration drift was identified and corrected before this official sequence. The full sequence was restarted after correction. No configuration value is retained in evidence.

The ignored local `.env` remains configured with mode `0600` and explicit `ros_bridge_json`. Validation without overrides returns the exact qualification SHA. The file is neither tracked nor included in delivery, and none of its values appear in these reports.

## Qualification decision

`UGV_SIMULATION_PARTIAL`

This result is partial because full qualification requires real control Task lifecycles and correct live MQTT canonical topic/QoS behavior. Reconnaissance, PMS onboarding, and effector execution are also pending. Consequently, neither `CORE_QUALIFIED_RECON_PENDING` nor `CORE_QUALIFIED_PMS_PENDING` is claimed.

The Provider Package remains:

```text
componentStatus=passed
realResourceStatus=pending
```

See `KNOWN_LIMITATIONS.md`, `CONTROL_SMOKE.json`, `RECON_SMOKE.json`, `RUNTIME_E2E.json`, `RECOVERY_EVIDENCE.json`, `REGRESSION_EVIDENCE.json`, `COMPOSE_EVIDENCE.json`, and `MOCK_FALLBACK_CHECK.json` for bounded evidence.

## Delivery handoff

The review envelope is generated after the report-only commit so the ZIP cannot hash itself. Required closeout paths are:

```text
reports/ugv-simulation/delivery/ugv-simulation-goal10-delivery.zip
reports/ugv-simulation/delivery/ugv-simulation-goal10-delivery.zip.sha256
reports/ugv-simulation/delivery/ugv-simulation-goal10.patch
```

The checksum sidecar and final user handoff are the authority for the resulting ZIP SHA-256 and report-only final local SHA. No automatic push or pull request is authorized or performed.
