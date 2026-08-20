# UGV Runtime × Provider × Telemetry joint integration report

Final qualification: `UGV_SMPP_TELEMETRY_JOINT_PARTIAL`.

Four read-only Runtime operations are working: Runtime and UGV Provider report ready, MQTT and Device MCP are connected, Provider Telemetry enters Runtime with bounded and observable delivery semantics, and an earlier historical snapshot proves that real UGV resource ProviderOps can be queried after Collector, Processor/WAL, and ClickHouse. This does not satisfy the complete G3 live-read gate. The run is partial because required read-state facts are unproven, the upstream contract drifts, live-control authorization was absent, the historical Runtime ProviderOps backlog did not drain, and no task-level recovery or complete live fault-recovery matrix was executed or qualified.

## Baseline and deployed revisions

| Repository                   | Base                                       | Branch                                               | Deployed evidence revision                 |
| ---------------------------- | ------------------------------------------ | ---------------------------------------------------- | ------------------------------------------ |
| `sdar-mcp-provider-platform` | `c3a26b45fd03f93583ed07ecd15f191f9c0b52e4` | `codex/goal-ugv-runtime-telemetry-joint-integration` | `eaa36df380e7542f25f359d55c829e12d843738b` |
| `smpp-telemetry-platform`    | `d713f71b4c93f981d5bce05b65ed71f5ed5814b6` | `codex/goal-02-live-ugv-smpp-integration`            | `4de0e7e7cf1434bc2da051542f7b21a7e88b15d7` |

The final report commits are assigned after evidence is committed; they are intentionally not self-referenced in these files. Runtime and Adapter image tags bind to the deployed SMPP evidence revision, and Telemetry image IDs are recorded in `IMAGE_REVISIONS.json`.

## Live findings

- Device MCP `initialize` and `tools/list` succeeded against `ugv-mcp-server/1.26.0`. The observed protocol was `2025-11-25`, not the required `2026-07-28`; 15 tools were present, with no output schemas or annotations.
- Passive MQTT capture observed 1,077 messages across 12 topics in 15 seconds with no decode, oversize, retain, or publish event. Canonical `status/ugv` was absent and `/ugv/speed` used QoS 0; both are external drift.
- Runtime liveness and readiness returned 200. Provider dependencies reported MQTT connected, Device MCP connected, an initial observation, and completed recovery. Only one Runtime/Adapter command authority remained active.
- Final Runtime and Adapter image tags and revision labels both match `eaa36df380e7542f25f359d55c829e12d843738b`. Adapter ran in live mode with Provider Telemetry enabled to `ugv-runtime:7002`; Runtime exported OTLP to the local Collector at `host.docker.internal:4318` with deployment `ugv-test-deployment` and instance `ugv-runtime-test-1`.
- The final `eaa36df380e7542f25f359d55c829e12d843738b` read-only smoke exited 0. Runtime calls for state, capabilities, payload status, and targets all completed. The retained state evidence proves connectivity and mission state `4`, not the required mission state `0`. It does not retain sufficient facts to prove zero speed, parseable position, complete required-domain freshness, live execution mode, or disabled mock fallback. Point availability returned `available` with reason `UGV_AVAILABLE`, but availability is neither complete G3 evidence nor control authorization.
- The final pre-restart aggregate contained 180/180 unique ProviderOps: 122 resource-state records with 122 complete payloads, 56 resource-metric records with 56 complete payloads, and 2 other events. Duplicate event keys and Provider Event ID conflicts were zero.
- The first final-revision Adapter/Runtime order switch exposed, rather than hid, startup transport failure, retry, and 4 retry-exhausted drops. Runtime ingestion subsequently resumed.
- With Runtime healthy, an isolated Adapter force-recreate started at `2026-08-20T15:09:11.887Z`. During the following 20 seconds, Adapter logs contained zero rejected, transport-failed, or dropped outcomes, while Runtime stored 61/61 unique ProviderOps: 44 complete state and 17 complete metric payloads, with zero duplicate keys or ID conflicts. This proves Provider restart telemetry recovery only, not task/dispatch recovery.
- At the earlier `9f1e4a50b2ab80813f1affd6f820990bf129b64e` snapshot, Collector accepted 38,379 logs, refused zero, failed zero, and sent 38,371 to Processor. Query API returned real UGV records for the stable Runtime/deployment identity; this historical sample is not attributed to the final `eaa` epoch.
- Runtime backlog did not drain. An early non-atomic sample showed 821,689 records with oldest age about 872,771 seconds. The latest non-atomic snapshot showed backlog 726,934 (`CLAIMED=44`, `PENDING=127413`, `RETRY_WAIT=599514`; `DELIVERED=136156`, `EXHAUSTED=166347`) and oldest age 874,895 seconds; independently sampled gauge and state counts are not asserted to sum exactly.
- Telemetry's latest cross-repository watermark is landing-only: 134,864/134,864 unique records, maximum `occurredAt=2026-08-20T10:45:55.689Z`, and maximum `ingestedAt=2026-08-20T15:07:40.656Z`. Final Runtime epoch rows remained zero. These facts do not prove normalized, core, serving, query, or current-final-Adapter epoch convergence.

## Safety outcome

No mutating vehicle call was made. Point navigation, primary Device mission submission, follow-up mission start, pause, resume, cancel, emergency stop, area reconnaissance, and fire counts are all zero. No Task, Provider Execution, Mutation Journal, mission ID, or physical terminal evidence was created. The forbidden historical idempotency key was not reused, and no new key was generated.

## Acceptance gates

| Gate                           | Result                               | Evidence                                                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0 baseline/branches/revisions | PASS                                 | `BASELINE.json`, `WORKSPACE.json`, `IMAGE_REVISIONS.json`                                                                                                                                                                                 |
| G1 Cursor JSONB safety         | PASS                                 | real PostgreSQL 3 files / 25 tests; zero production NUL-cursor patterns                                                                                                                                                                   |
| G2 simulator contract          | PARTIAL                              | tools present, but protocol version, canonical topic, and QoS drift remain external blockers                                                                                                                                              |
| G3 read-only Runtime/Provider  | PARTIAL / EXTERNAL_INTERFACE_BLOCKED | four read operations and connectivity pass; mission state is 4 rather than 0, while speed, position, required freshness, execution mode, and mock-fallback state are not proven by retained current-run evidence                          |
| G4 Provider Telemetry ingress  | PARTIAL                              | per-event semantics and final live rows pass; the isolated Provider restart telemetry window is clean, but 4 initial handover drops and no task-level identity chain remain                                                               |
| G5 Runtime OTLP                | PARTIAL                              | real export passes; durable backlog and oldest age do not converge to zero                                                                                                                                                                |
| G6 Telemetry storage/query     | PARTIAL                              | earlier historical resource records are queryable, but the final Runtime epoch has zero rows; current-run time correlation and task layers are absent                                                                                     |
| G7 point navigation            | NOT EXECUTED                         | control gates disabled; mutation count zero                                                                                                                                                                                               |
| G8 correlation                 | PARTIAL                              | resource identity complete; task/execution/operation identity absent                                                                                                                                                                      |
| G9 rate/backpressure           | PARTIAL                              | queue/retry/drop accounting is bounded and visible; 4 startup-handover drops are disclosed, the 20-second restart window is clean, and navigation/terminal rate phases were not run                                                       |
| G10 recovery                   | PARTIAL                              | isolated Provider restart telemetry recovery passes; no active Execution existed, and the remaining controlled live outage/task-recovery matrix was not run                                                                               |
| G11 regression                 | PASS                                 | final build, typecheck, Prettier, lint, 40 files / 188 unit tests, 5 files / 26 contract tests, 16 files / 214 impacted UGV/NPC tests, client 14/14, and gRPC→Runtime→PostgreSQL 17/17 pass; PostgreSQL Cursor/Telemetry 3/25 also passes |
| G12 scope/security             | PASS                                 | fire zero, no direct Telemetry access to device interfaces, no secret payloads, development-only override paths                                                                                                                           |

## Layered readiness

| Layer                              | Status                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `SIMULATOR_CONTRACT_READY`         | PARTIAL — machine contract captured, upstream drift unresolved                                             |
| `SMPP_RUNTIME_READY`               | READY                                                                                                      |
| `UGV_PROVIDER_READY`               | READY                                                                                                      |
| `LIVE_READ_READY`                  | PARTIAL / EXTERNAL_INTERFACE_BLOCKED — four reads pass, but the strict G3 state facts are not fully proven |
| `LIVE_POINT_NAVIGATION_READY`      | NOT READY — authorization and prerequisite backlog gates fail                                              |
| `TASK_CONTROL_READY`               | NOT READY — no authorized live task                                                                        |
| `PROVIDER_TELEMETRY_INGRESS_READY` | PARTIAL — clean isolated Provider restart window, but initial handover drops and no task-level chain       |
| `RUNTIME_PROVIDEROPS_EXPORT_READY` | PARTIAL — real export, backlog not drained                                                                 |
| `TELEMETRY_STORAGE_READY`          | PARTIAL — historical live resource rows stored; final-epoch convergence absent                             |
| `TELEMETRY_QUERY_READY`            | PARTIAL — historical stable-identity query works; final-epoch and task correlation absent                  |
| `RESILIENCE_READY`                 | PARTIAL — Provider telemetry restart recovery only; task/dispatch and remaining fault matrix not qualified |

## Regression and scope

After the final Struct compatibility adjustment, SMPP build, typecheck, Prettier, lint, the full unit suite (40 files / 188 tests), the sandbox-external contract suite (5 files / 26 tests), and the impacted UGV/NPC suite (16 files / 214 tests) pass. Provider Telemetry client tests pass 14/14, the real gRPC→Runtime→PostgreSQL suite passes 17/17, and the PostgreSQL Cursor/Telemetry gate passes 3 files / 25 tests. No final SMPP regression rerun remains pending. Telemetry recorded 56 passing tests, build and Compose config validation, plus WAL concurrency, conflict, checkpoint, poison, and drain coverage.

Changes remain in the task's UGV, Provider Telemetry, MQTT ingress, development deployment, test, and report paths. Shared NPC behavior was regression-tested where shared code was touched. The Telemetry x86 override lives under the allowed development deployment path. No frozen MCP/Tasks redesign, PMS redesign, mTLS, production certificate, high-availability, fire-control, media, or external simulator source change was introduced.

See `KNOWN_LIMITATIONS.md` for every non-qualified item. Delivery patches and the combined evidence archive are generated separately under `delivery/` after both report sets are complete.
