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
- [x] Unit, PostgreSQL/native MCP integration, frozen protocol, type/lint/build and browser gates for application revision `a22b74f`; final console retention fix is being revalidated separately.
- [ ] Candidate 19110/19111; real read-only acceptance; >=24 h stability with no OOM.
- [ ] Verified new-protocol read-only rollback image, idle/lease handoff and formal 19100/19101 cutover.
- [ ] Source commit/push, fixed images, deployment package, operator documentation and evidence SHA256.

## Acceptance and evidence

Log actual commands and exit codes with source hashes in the delivery report. Separate software validation, live physical actions and report completeness. The 24-hour candidate gate cannot be shortened or declared passed before elapsed evidence exists. No control action is implied by read-only acceptance.

## Known boundaries

Optical zoom and next_follow remain unsupported. Upstream FramePull is enabled only in use_v2 deployments. Exposure UTC may be null; reception time is not exposure time. Frame headers are not heartbeat, target, empty-report or coverage evidence. Images do not prove complete coverage/trajectory/target streams. Keep current finite task deadlines; do not expose upstream infinite scanning or target_entity_id extensions.

## Findings and decisions

2026-11-11: formal Provider archive remains failed since 2026-11-04. Runtime logs confirm recurring V8 heap exhaustion. Both are release gates independent of the native protocol incompatibilities. Rollback must understand new native protocols; old images cannot read the current field source.

2026-11-12: Independent vectors and frozen v1 checks passed. Native 2.1/2.3 control regression passed 10 PostgreSQL/MCP cases. Frame and archive integration, browser login/image/bbox/download, and 76 console tests passed before final gates. Final post-change gates and candidate deployment remain pending.

Runtime reproduction: 60 unchanged manifest validations retained 1,688 AJV schemas / 121.6 MB heap before fix. Per-manifest compiler lifetime reduced the peak to 36 schemas / 42.8 MB. Both reports are in `reports/ugv-zmq-v15`. A 24-hour candidate observation is still required.

State DTO v3 is exclusive to catalog 1.5; older state DTO v2 and catalog schemas remain frozen. Archive recovery records verified durable tails and gaps, never reconstructs a lost batch. A separate explicit predecessor supports the protocol transition while retaining old archive bytes.

2026-11-12 candidate: exact read-only 15-tool catalog, anonymous authorization, invalid-JWT rejection, EO 2.3/effect 1.0 subscriptions, archive recovery gap and 640×480 JPEG verification passed at 19110/19111. No physical control was dispatched. The old failed archive stream remains unchanged.

Field chassis discrepancy: 11001 currently publishes a 4-byte string prefix but declares `len=N` and CRC over the business bytes only, whereas the frozen 2.1 contract requires `len=4+N` and prefix-inclusive CRC. Four captured message types were independently checked with Python `binascii.crc_hqx`; raw frames and archive ordinals are retained in the evidence. Both 2.0 and 2.1 decoders reject these frames; no automatic fallback is added. Fresh localization and formal cutover remain blocked pending a conforming upstream deployment. The user has been asked to verify that deployment.

Live console acceptance found two upstream-expired tasks. Add a display/export-only retained snapshot path for `TASK_EXPIRED`, with original timestamps, explicit local provenance and unavailable business evidence. Authorization errors and unknown tasks must not fall back. Lifecycle commands retain the strict live query and cannot use retained snapshots. A PostgreSQL API regression covering these boundaries passed before the final gate run.

The first 24-hour observation started at 2026-11-12 11:00:46 Asia/Shanghai with revision `a22b74f`. At 14:16 it had 197 hash-linked samples, no restart/OOM and healthy archival; chassis acceptance was still false. This is ongoing evidence, not a passed 24-hour gate. Replacing any candidate image for the retention fix requires a new continuous run; preserve the superseded run and its exact boundary.
