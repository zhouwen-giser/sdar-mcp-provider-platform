# ZMQ 1.5：新协议兼容与按需取帧

## Baseline and scope

- User-approved plan: chassis 2.1, EO 2.3, simulation effect 1.0; existing 14 tools plus `vehicle_zmq_get_frame`.
- SMPP baseline `0473aff434c8372979f9a2e66f46ad5ceb47e81e`; upstream reference `a0be6a51e17fb9e85bc4ba0b62f7157a1b77c82e` in `/home/sz/code/isr-simulation`.
- Work in the attached isolated checkout. Only SMPP changes; preserve primary checkout packaging and SDAR bindings.
- Preserve frozen MCP protocol, old native contracts/results and task identities. No uncertain motion replay or automatic protocol fallback.
- FramePull uses its own socket at configured endpoint (site default 5559), exact camera/frame identity, JPEG <=16 MiB, <=256 KiB chunks, authorization-scoped temporary cache (5 min / 256 MiB). No continuous image archival.
- HTTP console and existing anonymous authorization domain remain. Native controls require normal eligibility/ownership checks.

## Progress

- [x] Read current and upstream contracts/source; verified live chassis new framing, EO 2.3 and successful FramePull during analysis.
- [x] Versioned native contracts, fixtures and deployment profiles.
- [x] Protocol-aware commands/observation; frame headers and same-frame validation.
- [x] Archive recovery and actionable health; reproduce/fix Runtime AJV retention and archive lease listener retention.
- [x] Bounded FramePull client/cache and MCP 1.5 catalogs (control/read-only).
- [x] Console original-image preview, exact-frame overlay, download and audit.
- [x] Unit, PostgreSQL/native MCP integration, frozen protocol, type/lint/build and browser gates, including final retention repair, at fixed application revision `ca33761`.
- [ ] Candidate 19110/19111; real read-only acceptance; >=24 h stability with no OOM.
- [ ] Verified new-protocol read-only rollback image, idle/lease handoff and formal 19100/19101 cutover.
- [x] Source commit/push, fixed images, candidate deployment package, operator documentation and evidence SHA256. Formal acceptance remains open above.

## Acceptance and evidence

Log actual commands and exit codes with source hashes in the delivery report. Separate software validation, live physical actions and report completeness. The 24-hour candidate gate cannot be shortened or declared passed before elapsed evidence exists. No control action is implied by read-only acceptance.

## Known boundaries

Optical zoom and next_follow remain unsupported. Upstream FramePull is enabled only in use_v2 deployments. Exposure UTC may be null; reception time is not exposure time. Frame headers are not heartbeat, target, empty-report or coverage evidence. Images do not prove complete coverage/trajectory/target streams. Keep current finite task deadlines; do not expose upstream infinite scanning or target_entity_id extensions.

## Findings and decisions

2026-11-12 authorized correction: complete interoperability entirely in SMPP; do not modify or redeploy isr-simulation or SDAR. Supersedes the earlier requirement for an upstream chassis deployment fix. Add an explicitly selected, evidence-locked chassis publication framing variant (uint32 prefix, business-only header length/CRC); keep strict 2.1 and command framing unchanged, with no parser fallback. Add a Dashboard V2 planner with fresh authoritative context, request/ACK correlation, scene-qualified WGS84/ECEF/ENU conversion, and unchanged preview-only semantics. Publish a separate 1.5.1 15-tool catalog/result version so frozen 1.5.0 remains readable. Candidate replacement restarts the 24-hour gate; no physical control without operator confirmation.

### SMPP-only interoperability follow-up

- [x] Explicit receive framing/deployment contract and captured-frame regressions; strict 2.1 remains strict.
- [x] Dashboard V2 context/ACK/request-ID adapter and ENU transform; context changes and errors fail explicitly.
- [x] Versioned 1.5.1 catalogs, Runtime/Provider/console exact validation and diagnostics.
- [x] Isolated protocol/planner/PostgreSQL/MCP/browser regression and engineering gates.
- [x] Real read-only chassis/planner verification, new fixed candidate images and fresh 24-hour run started.
- [x] Replacement 1.5.1 package, exact-member verification, image round trip and source push.
- [ ] Actual uninterrupted 24-hour pass, idle/lease handoff and formal cutover.

2026-11-11: formal Provider archive remains failed since 2026-11-04. Runtime logs confirm recurring V8 heap exhaustion. Both are release gates independent of the native protocol incompatibilities. Rollback must understand new native protocols; old images cannot read the current field source.

2026-11-12: Independent vectors and frozen v1 checks passed. Native 2.1/2.3 control regression passed 10 PostgreSQL/MCP cases. Frame and archive integration, browser login/image/bbox/download, and 76 console tests passed before final gates. Final post-change gates and candidate deployment remain pending.

Runtime reproduction: 60 unchanged manifest validations retained 1,688 AJV schemas / 121.6 MB heap before fix. Per-manifest compiler lifetime reduced the peak to 36 schemas / 42.8 MB. Both reports are in `reports/ugv-zmq-v15`. A 24-hour candidate observation is still required.

State DTO v3 is exclusive to catalog 1.5; older state DTO v2 and catalog schemas remain frozen. Archive recovery records verified durable tails and gaps, never reconstructs a lost batch. A separate explicit predecessor supports the protocol transition while retaining old archive bytes.

2026-11-12 candidate: exact read-only 15-tool catalog, anonymous authorization, invalid-JWT rejection, EO 2.3/effect 1.0 subscriptions, archive recovery gap and 640×480 JPEG verification passed at 19110/19111. No physical control was dispatched. The old failed archive stream remains unchanged.

Field chassis discrepancy: 11001 currently publishes a 4-byte string prefix but declares `len=N` and CRC over the business bytes only, whereas the frozen 2.1 contract requires `len=4+N` and prefix-inclusive CRC. Four captured message types were independently checked with Python `binascii.crc_hqx`; raw frames and archive ordinals are retained in the evidence. Both 2.0 and 2.1 decoders reject these frames; no automatic fallback is added. Fresh localization and formal cutover remain blocked pending a conforming upstream deployment. The user has been asked to verify that deployment.

Live console acceptance found two upstream-expired tasks. Add a display/export-only retained snapshot path for `TASK_EXPIRED`, with original timestamps, explicit local provenance and unavailable business evidence. Authorization errors and unknown tasks must not fall back. Lifecycle commands retain the strict live query and cannot use retained snapshots. A PostgreSQL API regression covering these boundaries passed before the final gate run.

The first 24-hour observation started at 2026-11-12 11:00:46 Asia/Shanghai with revision `a22b74f`. At 14:16 it had 197 hash-linked samples, no restart/OOM and healthy archival; chassis acceptance was still false. This is ongoing evidence, not a passed 24-hour gate. Replacing any candidate image for the retention fix requires a new continuous run; preserve the superseded run and its exact boundary.

2026-11-12 delivery update: `ca33761c1d5c9c0a6cce3acc9105faa1735832da` is pushed. All prescribed SMPP gates passed (160 unit, 107 PostgreSQL integration with one external SDAR fixture not enabled, 10 v15 control regressions, 77 console tests and one browser test). Three fixed images built and round-tripped without identity changes. New candidate at 19110/19111 passed exact catalog, anonymous/invalid-JWT checks and retained historical report/browser download tests. Production remains unchanged.

Field planner acceptance did not pass: a serialized read-only diagnostic obtained an explicit Socket.IO ACK `Dashboard controlled entity changed or is missing`. Upstream now checks V2 device/epoch/mission context. This disproves the assumption that the field 7879 endpoint still accepts the old request unchanged; do not invent those identities or silently claim a geometry match.

Around 14:33 all three native subscriptions disconnected; probes at 14:35 found 10001, 11001, 5555–5559 and 7879 refusing connections. Local candidate and archive remain healthy. No physical control was dispatched. Source restoration and a conforming chassis 2.1 stream remain external acceptance blockers.

The first soak is retained as superseded before 24 h. The replacement run started at 2026-11-12 14:37:37 Asia/Shanghai (`stability-24h-2`); earliest 24 h is 2026-11-13 14:37:37, subject to actual uninterrupted evidence. Native admission remains separate and false during source loss. Hourly follow-up is configured, quiet when unchanged. Delivery report: `reports/ugv-zmq-v15/evidence/REPORT.md`.

2026-11-12 candidate package completed: `artifacts/ugv-zmq-v15-ca33761-candidate-20261112.tar.gz`, 196782330 bytes, SHA256 `1d47f6f92e30b0ee856d6017372cbecbf346a2501cc60da35335560d10944e40`. Bundle source is `c12601ba7a90b41d1ad659ddbcd92f4768da3e6b`; fixed application/image source remains `ca33761`. All 4,051 members and image save/load identities verified. Receipt is `reports/ugv-zmq-v15/package-receipt.json`. This delivery is explicitly not control-qualified or formally switched.

2026-11-12 15:05 follow-up: upstream endpoints have recovered (first fresh EO/effect monitor sample at 14:55:37, all eight TCP endpoints verified at 15:06). The unchanged `ca33761` candidate now passed actual exact-frame MCP retrieval and browser original-image/download/history checks. Images are 640×480 with unknown exposure UTC; no field detection boxes were observed. Archive retained all three disconnect gaps. A fresh four-message chassis capture still fails the 2.1 length/CRC contract, and serialized 7879 probing still returns the explicit missing-controlled-entity ACK. No physical control was sent. The second soak remains uninterrupted and below 24 hours. Evidence: `reports/ugv-zmq-v15/followups/20261112-1505/SUMMARY.md`; application, fixed images, bindings and existing bundle are unchanged. Remaining gates: conforming chassis data, qualified planner context, 24 h evidence and final idle/lease handoff.

2026-11-12 interoperability implementation: a separate deployment /3 selects the publication framing without changing the frozen standard codec or outgoing command encoding. Current field scene was read as yuan_qu (22.506858333333, 114.048222222222, reference height 500), matching the local a0be6a5 scenario configuration; live map conversion outputs are retained as independent PROJ fixtures. V2 preview checks scene/epoch, real context, ACK, request ID and ENU geometry. Preliminary checks passed 22 unit, five PostgreSQL/MCP and ten 1.5.1 isolated control cases; a mission/identity diagnostic ambiguity found in console validation was corrected before the fixed-source engineering gates. Upstream and SDAR source remain unchanged; no physical action was sent. Full gates and replacement candidate/24 h evidence remain pending. Operations: deploy/ugv-zmq/v151/README.md.

2026-11-12 1.5.1 candidate acceptance supersedes the earlier external-blocker status: the explicit, evidence-locked receive variant now accepts real chassis localization while the frozen strict 2.1 decoder still rejects those nonconforming frames. Dashboard V2 preview passed through both real MCP and the Chinese HTTP console with fresh source context, request ID, epoch and ENU geometry; no navigation task or physical action was created. Exact original-image pull/download and retained historical report reads passed. The upstream repository remains clean at a0be6a5, and SDAR/formal services are unchanged.

Fixed application/image source is ada745829c635b9bb56d6017c2c2faf7f31e544e. Engineering gates passed: 171 unit tests, 124 PostgreSQL/MCP tests with one unconfigured external SDAR fixture skipped, ten strict and ten compatible control regressions, 80 console tests and one browser test. Initial simulator PUB concurrency and missing isolated broker configuration are preserved as failed attempts; final affected suites passed at 22a3555, whose only application-source difference is a test simulator file. A monitor-only whitelist correction permits the already authorized readonly planning probe and does not change the application images.

Candidate 19110/19111 was replaced at 18:12–18:13 Asia/Shanghai. Second ca33761 soak ended after 12,911 seconds, is explicitly superseded, and is not a 24-hour pass. Third soak began at 2026-11-12 18:20:30.763833 Asia/Shanghai in stability-24h-3; earliest 24 hours is 2026-11-13 18:20:30.763833, subject to actual hash-linked samples and unchanged container identities without OOM/restarts. Launch verification found all three sources fresh, healthy archive, compatible chassis localization, a qualified V2 preview and a verified original frame. Formal deployment remains gated on the complete continuous run and idle/lease handoff. New evidence authority: reports/ugv-zmq-v151/evidence/REPORT.md; previous reports remain historical.

2026-11-12 replacement delivery: source and evidence pushed through 69e2d88. `artifacts/ugv-zmq-v151-ada7458-candidate-20261112.tar.gz` contains 4,135 verified files, three identity-preserving image exports, 197106820 bytes; SHA256 `3fa99f6f099c02fcb7f5cd17c1a255e489210d28855672dbe9737f7054f4f8fa`. Package source is 69e2d88, image/application source remains ada7458. Receipt and actual export command/exit code are in reports/ugv-zmq-v151. The current candidate is unchanged; initial 69 samples and seven live planning probes passed, below the required 24 hours. Hourly monitoring continues quietly until meaningful changes. Isolated test containers and their own anonymous volumes were removed by exact ID and task label; production volumes are preserved.

2026-11-12 22:30 field follow-up: after 22 successful planning probes, the 22:00, 22:10 and 22:20 samples returned UGV_PLANNER_SCENE_UNAVAILABLE. Readonly GETs confirmed the source scenario manager still reports phase=failed, while watchdog runtime declares DEGRADED/dashboard following an internal localhost watchdog timeout. Current watchdog component health and map/coordinate endpoints respond successfully, which does not override the scenario-ready gate. Source inspection confirms DEGRADED is published as failed by the runtime owner and forwarded from fresh profile state by ScenarioController. SMPP correctly refuses planning; no code/config fallback or upstream mutation is applied. The same candidate continues the uninterrupted runtime soak with healthy archival, fresh native channels and verified frames; siteReadOnlyQualified is currently false. Formal cutover remains blocked until source scene readiness is restored and qualified planning reverified. Exact APIs, source hashes and the verified sample prefix are in reports/ugv-zmq-v151/followups/20261112-2230.

2026-11-13 09:22 requested status audit: anonymous live discovery confirms candidate 19110 has 15 tools/profile zmq_v1_5_1_readonly_15 with controls disabled, fresh three-way subscriptions and healthy archive. Soak prefix has 902 hash-verified samples over 54,102 seconds, no image/identity changes, restarts or OOM; 91 exact-frame checks passed. Planning has 22 historical successes and 69 scene-ready refusals. Current source runtime is still DEGRADED/dashboard and now declares accepting_commands=false with no ready control groups. Formal 19100 discovery still has the old 14 tools/profile zmq_v1_4_0_site_control_14, source 58d3d73, failed observation archive and stale data despite HTTP ready. No deployment or upstream mutation occurred. Development/candidate delivery is complete; formal upgrade remains open pending actual 24 hours, scene recovery/qualified preview and idle/lease handoff, followed by separately confirmed physical acceptance. Evidence: reports/ugv-zmq-v151/followups/20261113-0922.
