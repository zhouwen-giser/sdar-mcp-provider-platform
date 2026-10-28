# SDAR anonymous ZMQ integration and native single-area patrol — 2026-10-27

## Purpose and requirements

Implement the accepted anonymous SDAR integration: restore scoped service networking, pin both
13-tool catalogs, publish through actual governance, and compose one confirmed navigation followed
by one inspection. Preserve legacy contracts, reports, ownership bindings, volumes and secrets.
Software validation, physical action acceptance and report completeness are separate gates.

## Context and architecture

SMPP baseline 76a6dea; SDAR baseline 8558401. Both use existing isolated worktrees and new codex
branches. The primary SMPP checkout contains protected joint-packaging changes. Current formal
SMPP is readonly 1.1.0; candidate is site-control 1.2.0. Both currently require JWT. SDAR uses an
expired legacy binding and has partial Docker connectivity. No automatic physical dispatch.

Explicit site_anonymous uses default/development-anonymous without a verified responder; optional
JWT remains strictly validated. Anonymous SDAR uses unauthenticated://none. Operator input and
internal administration retain existing authentication. Exact catalog/version/identity checks remain.
Native patrol has exactly two confirmed children, bounded by the original deadline, with no replay.

## Progress

- [x] Inspect worktrees and baseline instructions; preserve existing changes/evidence.
- [x] Restore SDAR pinned dependencies offline without lockfile changes.
- [x] Implement and test site_anonymous authentication and history compatibility (2026-10-28).
- [x] Repair tagged, service-specific network paths and verify two source refresh periods.
- [x] Implement exact 1.1.0/1.2.0 profiles, live identity, governance and renewal.
- [x] Implement native single-area patrol, lifecycle and truthful evidence aggregation.
- [x] Run both repositories' required gates and isolated PostgreSQL/Redis/ZMQ task chains.
- [ ] Build fixed candidate images and deployment packages; verify anonymous readonly access.
- [ ] Operator confirms and executes field acceptance via formal A2A task chain.
- [ ] Handoff and promotion, commit/push, rollback and evidence delivery.

## Discoveries

Current anonymous mode uses internal-anonymous and changes the historical authorization hash;
development mode accepts identity headers. Neither is a valid substitute for the new explicit mode.
SDAR's existing isolated consumer pins 12 tools and simulation identity; it must remain unchanged.

## Decisions

Use additive contracts and a separately versioned report. Preserve raw Provider evidence. Do not
infer coverage or actual trajectory from requested geometry. Candidate direct bindings and formal
PMS registrations must retain their real lineage. Physical acceptance remains pending until an
operator-confirmed task and its result exist.

## Implementation and validation

Implement authentication first with spoofed-header, invalid-JWT, history-domain, operator and admin
boundary tests. Diagnose both netfilter backends before applying owned rules, resolving current
container identities at execution time. Extend profiles/governance and deterministic patrol using
existing CAS and LangGraph mechanisms. Test success, degradation, failure, cancel, timeout and
restart without duplicate dispatch using isolated storage/queues. Run complete repository gates;
record exact commands, source hashes, exit codes, artifact hashes and preserved failures.

## Idempotence and recovery

Use existing command IDs and CAS publication. Never replay an uncertain physical request. Keep
old writers retired. Network reconciliation manages only its own tagged rules. Candidate ports must
be free. Production queue consumers are exclusive; rollout preserves all storage and authorization
history. Rollback is verified anonymous readonly, with control publications withdrawn.

## Artifacts and evidence

Current increment evidence will be recorded under reports/ugv-zmq-anonymous-patrol-20261027;
private deployment inputs stay outside source control. No secrets in reports.

## Outcomes

In progress. SMPP authentication is implemented and its 19-command software gate passed on
2026-10-28 (exit 0). The first gate detected ENV_TEMPLATE_DRIFT; regenerated the schema-derived
server template and reran all 19 commands successfully. The original failed receipt is retained.

SDAR service-specific nft rules restored PostgreSQL, PMS, gateway and Control API connectivity.
The existing control worker was restarted after checking no active Runtime Tasks; source sync
operation da4e7c1f-439d-4e97-9ead-94a71b42e1ca succeeded. Old control Capability/Exposure
admission was suspended through CAS. Source freshness renewal resumed. Exact 13-tool profiles,
site result wrappers and native patrol are still under implementation in SDAR.

No physical action, candidate image activation, formal cutover or field acceptance is claimed.
Evidence: /mnt/data/ugv-zmq-anonymous-patrol-20261028/smpp-software-{1,2}/verification.json.
Private network receipts are under /home/sz/.smpp-debug/zmq-anonymous-sdar-20261027/network/.

## Candidate and readonly rollback update (2026-10-28)

All 19 software commands passed on compiled source b910f937. Candidate Runtime, Provider and console
use fixed images built from that commit. Idle check before replacement found runtimeActive=0,
providerActive=0 and pendingCommands=0; all bind mount identities/modes remain unchanged. Actual
anonymous discovery validates 13 tools at 19110 with the 1.2.0 profile. Browser HTTP login, real state
and existing task report reads pass on candidate 19111 and LAN formal readonly 19101.

Formal 19100 has received the anonymous Runtime authentication update while retaining readonly
1.1.0 mode; it is the rollback target. Formal control has not been promoted. SDAR's isolated joint
run c256fbc8 passes all six native controls, preview and patrol degradation/pause-resume/restart/
cancel/timeout with no Authorization headers. Its complete gate and field acceptance remain open.
The packaging CLI now explicitly selects the readonly/control catalog; controlQualified stays false
until operator field acceptance, and a bundle never triggers automatic deployment.

## Cross-project software closeout and owner boundary (2026-10-28)

SMPP b910f93 has 19 passing commands. SDAR ebfd2c22 passes all 30 frozen stages and cleanup;
run sdar-verify-b7f10881-aa19-453c-a81f-ab858acfe474, runtime input db5bbf16… unchanged.
Native isolated joint d6315423 passes 21 cases. Fixed SDAR image32e7fa… matches 2997 source
files and offline import. Real direct control14 and PMS readonly7 governance pass in isolated storage.
SMPP bundle c0f0e42… and final SDAR source/image have no matches for 25 actual deployment-secret
patterns across 83,769 inspected files, including compressed OCI layers.

Original restricted GOWM startup/governance works, but readonly Task a015bf15… fails
MCP_TASK_SERVER_BINDING_MISMATCH: frozen owner binding 80099d63… authorizes smpp-sz-gowm,
not the new local Server. Keep this exact check and original binding; a history-preserving owner
binding successor requires explicit user direction. Seven trial production Exposures/Capabilities/
Skills were suspended, original services restored and independent candidate kept separate.
Formal integration, control promotion and physical action acceptance remain OPEN/NOT_RUN.
No site device command was sent. Full receipts: /mnt/data/ugv-zmq-anonymous-patrol-20261028.

## Authorized binding successor and task-history reset (2026-10-29)

The user explicitly authorizes successor device bindings without retaining old bindings or task
history. Owner administration stopped both SDAR consumer sets and both SMPP Runtime/Provider
sets, rehearsed and committed an exact snapshot-guarded purge of 155,096 related rows (12 MCP
Tasks, one failed SDAR Task and their dependent execution/report records). Foreign keys stayed
enabled; two delete guards were restored inside the transaction. Non-target row hashes match.
New owner binding `0ab6028b-f367-4953-819f-ecca220a9a71` authorizes stable Server `smpp-zmq-site`.
Both SMPP configurations now pin it; old MQTT writers remain retired.

Physical deletion of old binding anchors additionally requires removing about 31 million raw
trajectory receptions (65 GB). This exceeds Task history; scope clarification is pending and raw
observations remain intact. Old bindings are closed and grant no new admission.

The actual restricted-role readonly Task now passes exact Server ownership and its MCP invocation
succeeds, exposing a missing readonly report attestation. Add the same content-bound native
report Evidence used by the control adapter to synchronous readonly responses. It attests returned
content, never physical coverage or action success. Real PostgreSQL/MCP regression passes 9 tests
and proves zero native commands; run the 19-command gate before building a fixed Provider image.
