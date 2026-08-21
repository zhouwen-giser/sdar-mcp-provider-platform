# UGV Provider external-simulation ExecPlan

## Purpose / Outcome

Qualify the existing SMPP UGV Provider on the external simulator and expose one governed northbound `vehicle_navigate(point)` MCP Task path to SDAR. The UGV Adapter alone owns MQTT/Device MCP southbound access, resource admission, execution ledger, task terminal state and objective final-position evidence. This plan supports the sibling SDAR `ugv-agent-profile` Goal and never grants production or physical-vehicle qualification.

## Requirements Covered

- Package tasks `UAP-P0-B01`, `UAP-P0-B02`, `UAP-P1-B01`, `UAP-P1-B02`, `UAP-P3-B01` through `UAP-P4-B01`.
- Goal success criteria `SC-02`, `SC-04`, `SC-05`, `SC-06`, and `SC-07` on the Provider side.
- Safety: one point-navigation Task for `vehicle:ugv1`, `stopOnObstacle=true`, no autonomous emergency stop, and zero recon/track/gimbal/fire authorization from the SDAR Profile.

## Context and Orientation

- User-selected baseline: latest relevant remote branch `codex/goal-ugv-runtime-telemetry-joint-integration@ce57d3d7ac2f99c0c95fa61bd9746abe862ed507`; the initial worktree was clean.
- The package reference `f8c37e6a2ecdc859e56910803197ec938b9a807a` and current branch diverge at `c3a26b45`; their exact drift is recorded under `reports/ugv-agent-profile-simulation/`.
- Reuse `apps/ugv-provider-adapter`, `packages/vehicle-provider-core`, `packages/vehicle-mqtt-ingress`, `packages/vehicle-device-mcp-client`, Runtime MCP Tasks, Provider persistence/ledger, and existing `deploy/ugv-simulation` operational tooling.
- External endpoints are `mqtt://192.168.2.63:1883` and `http://192.168.2.63:19000/mcp`. No mock simulator may be used for external acceptance.

## Architecture and Interfaces

PMS/Registry owns Provider/Catalog publication; Runtime owns northbound MCP Tasks and protocol projection; UGV Provider owns admission, resource state and execution lifecycle; UGV Adapter owns the external Device MCP/MQTT connection. External contracts are validated at adapter boundaries and normalized to Provider-domain types. PostgreSQL is durable authority; Redis/queues are reconstructable. SDAR never receives Device MCP credentials or raw MQTT authority and never writes Provider terminal state.

The existing Provider operation remains `vehicle_navigate`. Point input is deterministic WGS84 (`longitude=x`, `latitude=y`) with `stopOnObstacle=true`. A Provider `completed` observation is necessary but insufficient for Goal success; correlated, fresh, post-dispatch final position must be returned as objective evidence for SDAR's evaluator.

## Progress

- [x] 2026-08-21 01:20Z verified the local and remote latest relevant branch at `ce57d3d7`; retained the task-package commit only as drift reference per user instruction.
- [x] 2026-08-21 01:22Z ran the existing strict read-only external preflight: Device MCP initialize/tools-list and exact-topic passive MQTT subscription passed with zero mutation.
- [x] 2026-08-21 01:23Z captured the negotiated southbound Device MCP protocol `2025-11-25`, Device contract hash, explicit `ros_bridge_json`, missing canonical status topic, and speed QoS drift. The Device version is not compared to the separate northbound frozen Runtime protocol.
- [x] 2026-08-21 01:36Z finished `UAP-P0-B01`: bound preflight to the shared locked MQTT subscriptions, emitted explicit simulation/non-production/zero-call evidence, passed focused 6/6 tests, 222 inherited UGV/MCP regression tests, SMPP typecheck, package validation, runtime-version checks and both repository format/diff gates.
- [x] 2026-08-21 01:54Z finished the SMPP half of `UAP-P0-B02`: added a repeatable offline contract freezer, froze only `get_status`, `ugv_path_follow_mission` and `ugv_mission_control` schemas plus the 18 exact MQTT subscriptions, and passed the focused 3/3 tests, typecheck, lint, formatting, artifact replay and diff gates.
- [x] 2026-08-21 02:19Z finished `UAP-P1-B01`: added the isolated four-service external-simulation Profile and fixed-project lifecycle, immutable preflight run-ID reservation, profile closure validator, 8/8 focused contract tests, and all mandatory install/Compose/typecheck/lint/build/format/diff gates without starting containers or contacting the simulator.
- [x] 2026-08-21 03:30Z completed the `UAP-P1-B02` static gate: added deterministic public Provider catalog lineage, strict additive lifecycle metadata, ACK-only frozen pause/resume control contracts, an immutable read-only qualifier with exact synchronous-task audit correlation, and offline regression coverage. External execution remained gated until the source was fixed by the shared checkpoint.
- [x] 2026-08-21 03:42Z completed the uniquely identified external qualification `uap-p1b02-20260821t032832z` from checkpoint `051eae0d`: preflight, Profile startup, health and northbound read-only qualification passed. One `vehicle_get_state` correlated exactly to one Adapter-audited `get_status`; navigation, mutation, forbidden operations, direct qualification-client Device Tool calls and MQTT publishes were all zero.
- [ ] Support the SDAR Task Binding/continuation E2E, one authorized navigation, terminal/final-position evidence, negative/recovery scenarios, and full verification.

## Discoveries and Surprises

- The latest branch already contains canonical-first MQTT authority, external read-only Runtime evidence, Provider telemetry hardening, and a safe external preflight. Its historical live navigation was intentionally not authorized and created zero Tasks/mutations.
- Current Device MCP is reachable as `ugv-mcp-server/1.26.0`, negotiated protocol `2025-11-25`, with 15 tools and no declared output schemas/annotations. Runtime result validation remains mandatory; the southbound version is not a northbound SMPP protocol drift.
- The three Goal tools have explicit `null` output schemas in the freeze because the external server omitted them. Their combined input/output schema hashes are `d40d4867...` (`get_status`), `51fd0ac8...` (`ugv_path_follow_mission`) and `55b1404e...` (`ugv_mission_control`); a later omission or drift is a stable blocker rather than an automatic refreeze.
- Point navigation primitives are available and operation qualification passes, but the simulator does not publish canonical `status/ugv`; compatibility alias `/ugv/status` is active. `/ugv/speed` is observed at QoS 0 instead of the locked QoS 1.
- The inherited preflight reported `real_external_read_only` and omitted `productionEligible`. The additive P0 change now emits `external_simulation`, non-production/physical-qualification false, explicit zero-call counters and separate network/protocol/contract/freshness layers; the prior output remains under `attempts/`.
- Frozen `server/discover` previously exposed no safe Provider identity authority. The additive `io.sdar/providerCatalog` extension now publishes only the validated `providerId`, `providerType`, `providerVersion` and `manifestHash`; Catalog Manager strictly retains those four fields when present and remains compatible with older Runtimes that omit the extension.
- The SEP-2663 handler previously advertised Adapter pause/resume capability without frozen northbound pause/resume methods. The additive `io.sdar/taskExecution/tasks/pause` and `/resume` methods now use exact `mcp-name=taskId` routing and return only `{resultType:"complete"}` after Task Engine control acceptance.
- Registry Snapshot and Node Control do not yet project the new Provider identity lineage. `UAP-P1-B02` therefore qualifies the direct Runtime northbound discovery/Catalog authority only and records both downstream IDs as `null` with `DEFERRED_TO_UAP_P2_B02`; it does not claim current SDAR consumption.
- The real read-only run returned fresh external-simulation state for `vehicle:ugv1`: MQTT and Device MCP connectivity were true, the vehicle was idle and stationary, and the Runtime evidence correlation UUID matched the sole newly appended Adapter `get_status` audit row. The audit window had zero new executions, mutation-journal rows or command acknowledgements.
- The external qualification did not erase upstream drift: canonical `status/ugv` remained unobserved while `/ugv/status` supplied the explicit compatibility path, and `/ugv/speed` was still published at QoS 0 against locked QoS 1.

## Decision Log

- 2026-08-21: Use `ce57d3d7` as the SMPP baseline because the user explicitly selected the latest branch and the remote ref matches the local clean checkout.
- 2026-08-21: Preserve upstream MQTT topic/QoS drift as evidence. Compatibility logic may be explicit and test-only but cannot silently relabel drift as conformance.
- 2026-08-21: Reuse the existing Provider task state machine, mutation journal and execution ledger. Do not add a Skill-specific Provider lifecycle or polling loop.
- 2026-08-21: All new reports use `evidenceClass=external_simulation`, `productionEligible=false`; direct qualification-script Device MCP calls and MQTT publishes remain zero. `UAP-P1-B02` permits exactly one northbound read whose Adapter audit must correlate to one read-only southbound `get_status`; mutations and navigation remain zero until the single authorized end-to-end run.
- 2026-08-21: Freeze `UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT=false` even though execution mode is `simulation`; external acceptance requires the observed real `tools/list`, and the freeze grants no Tool or control authorization.
- 2026-08-21: Contract generation is non-overwriting. The capture timestamp is reused as `generatedAt` for byte-repeatability; existing artifact drift fails closed and requires a newly reviewed qualification event.
- 2026-08-21: Invoke the source-backed freezer with `node --import tsx`; the preserved direct-Node failure proves an unconfigured ESM loader is not a valid reproduction command.
- 2026-08-21: The Goal Compose override retains the root file unchanged but starts only four explicit, uniquely named services under project `sdar-ugv-agent-profile-simulation`. The current Runtime/Adapter topology has no PMS/Registry or Redis startup dependency; adding unused instances would not be minimal.
- 2026-08-21: Freeze `RUNTIME_ENV=test`, explicit insecure-internal-transport acknowledgement and passwordless PostgreSQL trust only inside the unpublished Goal bridge. This prevents local qualification credentials from appearing in rendered Compose or logs and cannot qualify production.
- 2026-08-21: Reserve each read-only preflight identity with an immutable `*.used.json` evidence envelope before configuration/freeze/network gates. A failed attempt consumes its ID; repeating `up` against an already healthy stack only checks health, while a later restart requires a new ID.
- 2026-08-21: Treat the latest Runtime's Provider catalog extension as additive: latest servers always emit the exact public four-field object, Catalog Manager validates and retains it when present, and older frozen discovery documents may omit it.
- 2026-08-21: Qualify `vehicle_get_state` only through Runtime `tools/call`. Correlate its northbound evidence `subjectRef` UUID to the sole newly appended Adapter `get_status` audit row; open the database audit window before health/readiness and reject any existing-row modification, execution, mutation journal row, command acknowledgement, navigation or forbidden operation.
- 2026-08-21: Expose cancellation/pause-resume/observation support as optional strict northbound metadata. For UGV navigation all three must be true and backed by real frozen protocol handlers; the qualifier verifies the contract but never invokes a lifecycle control or navigation.
- 2026-08-21: Publish the first passing canonical qualification report with exclusive create and retain every run-specific attempt. Until the Adapter post-audit succeeds, observed mutation/navigation counts are `null`, never fabricated zero.

## Implementation Steps

1. Normalize the read-only preflight report and freeze exact Device tool/schema and MQTT topic/wire hashes.
2. Add or update the narrow external-simulation deployment profile using explicit endpoints, `simulation`, PostgreSQL store, `ros_bridge_json`, fire disabled and insecure-transport test labeling.
3. Start an isolated SMPP stack, run Provider/Runtime readiness and northbound read-only MCP qualification, and publish the exact catalog/binding inputs needed by SDAR.
4. Prove fail-closed availability for stale/busy/unavailable/schema-drift inputs, then expose one current point-navigation readiness window.
5. Under the shared confirmed run identity, admit exactly one navigation Task, persist the execution/mission correlation, observe terminal state and fresh final position, and support continuation without redispatch.
6. Run cancel/restart/idempotency/uncertain-state scenarios and final SMPP gates; freeze redacted evidence and handoff hashes.

## Validation

Run focused UGV configuration, MQTT, Device MCP, Provider core, adapter, Runtime MCP Task and persistence tests after each increment. Final minimum commands are `pnpm verify:ugv-provider:work`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`, plus isolated external-simulation E2E and recovery scenarios. Every report records command, exit code and evidence class; mocks remain unit/contract evidence only.

`UAP-P0-B02` SMPP evidence: `pnpm install --frozen-lockfile` passed with the lock already current; `pnpm exec vitest run tests/ugv-simulation/external-contract-freeze.test.ts` passed 3/3; `pnpm typecheck`, focused ESLint, focused Prettier, `node --import tsx scripts/ugv-agent-profile-simulation/freeze-contracts.mjs --check`, and `git diff --check` all exited 0.

`UAP-P1-B01` evidence: `pnpm install --frozen-lockfile`, the required two-file `docker compose ... config`, the active-profile render plus `validate-compose-profile.mjs`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm format:check`, and `git diff --check` all exited 0. `pnpm exec vitest run tests/ugv-simulation/ugv-agent-profile-deployment.test.ts` passed 8/8; the final joint replay with the inherited Provider-boundary suite passed 14/14. No lifecycle script, container, external socket, Device Tool, MQTT publish, or control action was run during this implementation gate.

`UAP-P1-B02` static evidence: the first sandboxed `pnpm verify:ugv-provider:work` passed every non-network gate but exited 1 when two gRPC E2E tests were denied loopback bind with `listen EPERM`; the approved host rerun exited 0, including both E2E tests. `pnpm protocol:generate`, `pnpm protocol:lock`, and `pnpm protocol:check` exited 0 and validate 11 schemas, 74 frozen cases, and the 44-file lock. The focused protocol/Catalog/Registry suite passed 49/49, the read-only qualifier suite passed 11/11, the deployment suite passed 9/9, and `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm format:check`, and `git diff --check` exited 0. At the static checkpoint, external `preflight/up/health/qualify` was deliberately `NOT_RUN`; the later, separately recorded run below supplies the Provider qualification claim.

`UAP-P1-B02` external evidence: with immutable run ID `uap-p1b02-20260821t032832z`, `preflight.sh`, `up.sh`, `health.sh`, and `qualify-provider-readonly.sh` all exited 0. The preflight remained `PASS_WITH_UPSTREAM_DRIFT`; its direct Device MCP `tools/call`, MQTT publish, control and navigation counts were zero. Runtime northbound discovery/list/availability passed and exactly one `tools/call vehicle_get_state` produced fresh external-simulation state. The Adapter durable audit verified exactly one new `get_status` row with the same correlation hash and zero new execution, mutation-journal or command-ack rows. `vehicle_navigate` remained `TASK_REQUIRED`, point availability was current with `stopOnObstacle=true`, and navigation/mutation/forbidden counts were zero. Canonical evidence is `reports/ugv-agent-profile-simulation/smpp-provider-qualification.redacted.json`; the compact verification index is `reports/ugv-agent-profile-simulation/p1-b02-verification.json`. Registry Snapshot and Node Control IDs are truthfully `null` and deferred to `UAP-P2-B02`.

## Idempotence and Recovery

Preflight only subscribes exact topics and invokes no Tool. External mutation requires the shared unused run/idempotency identity and complete readiness. A timeout or disconnect after potential admission is uncertain: reconcile the durable Provider Task/ledger before any further action and never create a second navigation. Restart rebuilds queue state from PostgreSQL without replaying the Device MCP mutation.

## Artifacts and Evidence

Goal evidence lives in `reports/ugv-agent-profile-simulation/`; historical `reports/ugv-runtime-telemetry-joint-integration/` remains immutable prior evidence. Evidence records omit credentials/raw payloads and preserve correlation IDs, hashes, timestamps, redacted endpoint identity and zero-forbidden-call counts.

The P0 contract artifacts are `device-mcp-contract.redacted.json` (`472e482c64d7f71f167cfb60461570068c7948108a46aa7614ea9bfccaea4c72`) and `mqtt-contract.redacted.json` (`a374f360ae1b2008c7ca80c1aed78548c38140c311250da819d253f83e20fffa`). Their common source is `external-preflight.redacted.json`; the MQTT subscription profile hash remains `5ebe7992d93d813a749f96aa83faea34fe3dff09d2797d21d6f44859151c40cd`.

The P1-B02 canonical qualification is `smpp-provider-qualification.redacted.json` (`589a277558c8f34ef785414364ef07f5fb6b99cb32fa82244ee4e08d78004f6c`), byte-identical to its immutable run-specific attempt. Its external preflight is `attempts/deployment-preflight-uap-p1b02-20260821t032832z.redacted.json` (`83f8045db3b748034afed47f0814b8582099d6bbb990c11242bdd9268be8fdff`). `p1-b02-verification.json` is the machine-readable index over those source artifacts and their explicitly limited qualification layer.

## Outcomes and Retrospective

In progress. P0 external connectivity/contract discovery and P1 external Provider read-only qualification are real. `UAP-P1-B01` and `UAP-P1-B02` are complete: the fixed Profile was healthy, catalog/readiness was consumable, and the single qualified read had exact northbound-to-southbound audit correlation. Upstream protocol/topic/QoS drift remains disclosed, Registry Snapshot/Node Control consumption remains assigned to `UAP-P2-B02`, and no navigation has been authorized or dispatched.
