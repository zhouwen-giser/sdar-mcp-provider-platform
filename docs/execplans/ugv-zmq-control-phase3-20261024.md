# UGV ZMQ control lifecycle — phase 3, 2026-10-24

## Scope and baseline

The operator requested continuation after phase 2. Implement navigation, camera and optical-task lifecycle orchestration, bounded scheduling and stopping, durable dispatch intent, restart reconciliation and isolated verification. Baseline: `6ade28aeabf65720207d47a29cb3a6aa267e25ea`; branch `codex/ugv-zmq-phase3-20261024` in the existing attached worktree. Preserve the primary checkout's united-package changes and deployed 19100/19101 services.

Control G0 is still pending. This phase can execute only against explicitly configured loopback simulators. It does not qualify 192.168.2.63 for control, publish the new catalog, or claim that local ordering supplies missing producer epochs or chassis feedback identities. Publication and deployment remain phase 5. An omitted controller ID stays unspecified; binary command tests supply an explicit simulated sender rather than inventing a production identity.

## Work

- [x] Audit frozen protocols, existing Provider execution/journal storage and mutation scheduling.
- [x] Add typed control requests, immutable execution scope and task timing, wire command construction and bounded native transports.
- [x] Persist execution stages and command intent before dispatch in existing Provider JSONB/journal storage; enforce a single local writer and scope-qualified queries.
- [x] Implement independent observation progression, startup/mode/planning gates, pause/resume/cancel, deadlines and component-scoped stop confirmation. Invalidate pending start/resume when stopped.
- [x] Restore queries and unresolved occupancy after restart without replaying possibly sent commands; distinguish ACK, device completion and physical stopping.
- [x] Verify with native loopback SUB/PUB and REQ/REP, real temporary PostgreSQL, crash boundaries, idempotency, loss, stale/foreign observations, concurrent components and bounded stop dispatch.
- [x] Run source contracts, frozen northbound compatibility, types/build/lint/format; record commands, exit codes, source/evidence hashes and remaining field gates.
- [x] Prepare the verified phase branch for delivery; pin the final Git identity in the post-push delivery record. Keep all running services unchanged.

## Acceptance boundaries

Only documented retries are allowed: identical chassis mode settings, 3000 ms per attempt, maximum three sends. Task creation, START, camera and optical commands are never automatically retried after entering dispatch. REQ timeouts rebuild sockets and preserve uncertainty. Platform deadlines include preparation and pause time; no device hard-deadline guarantee is inferred.

Chassis feedback has no mission/request identity and system-state has no producer sequence/epoch. The isolated simulator may demonstrate the documented sequence under a declared single-writer test condition; resulting evidence remains explicitly limited. An unqualified real deployment must still reject it. Chassis terminal state alone cannot prove physical stopping. Optical ACK alone cannot complete a task or stop. Source gaps, restart or persistence failures block new movement and retain unresolved occupancy.

## Progress and evidence

Local implementation and validation complete: 118 tests (48 frozen southbound, 21 observer, 20 control, 8 observer PostgreSQL/native and 21 control PostgreSQL/native). Six real child-process SIGKILL checkpoints preserve downstream execution counts. Typecheck, build, targeted lint/format and frozen northbound/source locks pass; G0 intentionally remains unqualified with 12 missing prerequisites.

The archive export contains 27 receiver sessions, 2,114 chain entries and 1,880 raw receptions. The compiled verifier resolves all 81 final source references and verifies framing, hashes, chain continuity and declared session tails. Measurements from engine cancel receipt to simulator command receipt: 23ms during another component's mode wait and scheduled 100Hz localization; 441ms with delayed REP; 506ms with execution-table writes locked. These are isolated software measurements, not physical device stopping or browser-to-device latency.

Findings resolved during verification: cancel could race a final send fence; initial ACK loss could be followed by earlier correlated PUB status; terminal results must remain immutable on late stop confirmation; endpoint locks must cover partial overlaps and unresolved earlier scopes; source interruption or conflicting native task type cannot establish old completion. ZeroMQ.js 6.8.0's native monitor uses object-pointer-derived inproc addresses; separate receiver contexts avoid collisions during rapid receiver teardown/recreation. Tests reserve simulator endpoints through suite teardown and install existing Provider tables in a unique schema to avoid accidentally reusing an unresolved predecessor endpoint.

Evidence and exact commands: `reports/ugv-zmq-phase3/REPORT.md`, `verification.json`, `source-manifest.json` and `raw/`. No command was sent to 192.168.2.63; 19100/19101 image IDs/ports and the primary worktree's dirty united-packaging status remain unchanged. Temporary PostgreSQL and private credential files are removed after verified export. G0, formal MCP/TaskBusiness/GOWM assembly, fourth-stage outcomes/UI and field/deployment gates remain explicitly pending.
