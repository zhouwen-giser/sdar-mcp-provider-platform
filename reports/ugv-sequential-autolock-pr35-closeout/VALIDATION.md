# Sequential AutoLock / PR #35 validation

Date: 2026-10-08. Implementation candidate:
`ac03646127a84e9b99ba87754eb45acd512431c9`.
Scope: serial distinct-target AutoLock within one Recon Mission and immutable
raw-evidence archival. Tests use the actual Provider Runtime, synthetic MQTT
ingress and a mock Device MCP client. They establish engineering behavior and
do not qualify a physical multi-target run.

## Local commands

Final checks used Node `v22.23.2`, pnpm `11.13.1`, and controlled fixture clocks.
The bundled fallback pnpm initially selected Node 24; checks were rerun with the
project's Node 22 / Corepack toolchain. The first queued-emergency regression
failed before the fix because target 8 was dispatched ahead of the stop. It
passed after the queued request became visible to the final dispatch guard.
Lint/type errors in new test scaffolding were corrected before delivery.

| Command                                   | Exit | Result                                                              |
| ----------------------------------------- | ---- | ------------------------------------------------------------------- |
| `pnpm format:check`                       | 0    | PASS                                                                |
| `pnpm lint`                               | 0    | PASS                                                                |
| `pnpm typecheck`                          | 0    | PASS                                                                |
| `pnpm build`                              | 0    | PASS                                                                |
| `pnpm protocol:check`                     | 0    | PASS; 11 schemas, 74 frozen cases, 63 locked files                  |
| `pnpm sbom:check`                         | 0    | PASS                                                                |
| `pnpm task-business:check`                | 0    | PASS; generated contracts/fixtures and additive proto compatibility |
| `pnpm test:task-business:ugv-local`       | 0    | **425/425**, 23 files                                               |
| `pnpm test:task-business:ugv-native`      | 0    | **32/32**, 3 files                                                  |
| `pnpm test:task-business:gowm-template`   | 0    | **9/9**, 2 files                                                    |
| `pnpm test:task-business:gowm-deployment` | 0    | **7/7**, 1 file                                                     |

The local gate includes 72 AutoLock, 17 RequiredInput-producer and 26 Recon
correlation cases. The final AutoLock file was rerun after the last test typing
correction: **72/72**. These counts overlap with the 425-case gate.

Database gates ran sequentially on a newly created PostgreSQL
`17.10-alpine3.23` container, `codex-pr35-sequential-audit-postgres`, bound only
to `127.0.0.1:32849`, database `sdar_pr35_test`. It was removed after verification.
No existing GOWM database was used. The selected-installation
`test:task-business:ugv-gowm` gate is **NOT_APPLICABLE** here: its isolated
`SMPP_GOWM_SHARED_OPEN_TEST_CONFIG_FILE` fixture was not configured. The passing
owner-template/deployment component gates do not confer installation qualification.

Local logs and Vitest JSON were captured under `/tmp/ugv-sequential-*`.
The hosted run below supplies durable logs for the committed candidate.

## Acceptance mapping

All A-01–A-14 pass in the 425-case local gate. Test titles below are in
[AutoLock](../../tests/integration/ugv-provider-auto-lock.test.ts), supplemented
by [RequiredInput](../../tests/integration/ugv-required-input-producer.test.ts),
[correlation](../../tests/contract/ugv-recon-execution-correlation.test.ts) and
[Runtime controls](../../tests/integration/ugv-provider-adapter.test.ts).

| ID   | Executed regression / assertion                                                                                                                                  | Result |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| A-01 | `selects a target once and waits for stage 3`: one requested policy Action and one exact lock call                                                               | PASS   |
| A-02 | Same test: ACK/stage 2 remain requested and create no Input                                                                                                      | PASS   |
| A-03 | Same test plus post-dispatch timestamp boundary: bound stage 3 activates and creates target-specific Input                                                       | PASS   |
| A-04 | `keeps the continued target active when a different target appears`: A stays active; B has no lock until qualified scan                                          | PASS   |
| A-05 | `locks three distinct targets serially after decline/cancel`: release ACK and intervening target packet cannot dispatch B                                        | PASS   |
| A-06 | Same four strict/inferred × decline/cancel cases: exact calls A=7 → B=8 → C=9, separate Action/Input identities                                                  | PASS   |
| A-07 | Same cases and decision matrix: fresh A never retries; immutable requested/active versions survive restart                                                       | PASS   |
| A-08 | Same cases: C arrives during B Input; complete B request remains equal and no C call occurs                                                                      | PASS   |
| A-09 | `waits for a post-failure scan before selecting the next fresh target (rejected/timeout)` plus no-scan negative case                                             | PASS   |
| A-10 | `does not replay UNCERTAIN/DISPATCHING`: uncertain response or journal persistence loss; restart sends no duplicate; bound later stage 3 confirms                | PASS   |
| A-11 | `expires input and recovers one release across restart`, plus producer release-recovery failures: one release; later scan/fresh B required                       | PASS   |
| A-12 | Freshness/retained/foreign-Mission tests; `refuses AutoLock when two active executions can own the source`; 26 correlation cases                                 | PASS   |
| A-13 | First/second-round queued pause/cancel; queued emergency blocks B; invalid stops get no priority; terminal test with owner enabled; persisted preemption tests   | PASS   |
| A-14 | `retires a superseded mission request without suppressing the same target in a new mission`: old stage 3 cannot activate new Mission; target 7 is eligible there | PASS   |

## Implementation and wire audit

The existing coordinator is **REUSED_VERIFIED**: attempted IDs come from every
persisted `provider_policy` visual-lock Action version in the current Mission.
Context snapshots include all Action references, and PostgreSQL reads them in a
repeatable-read transaction. Request/terminal projections retain revisioned
objects and commit their references/events with Context CAS.

Selection requires the previous Action to be terminal, the native scan anchor
to reach its end time, and a new target observation strictly after that time.
Pending Input, active locks, uncertain journals, stale/retained/ambiguous packets
and preemption prevent new dispatch. Each lock uses the current Execution's
Mission ID and the selected target ID through the existing call builder and
mutation journal; ACK does not activate a lock or confirm physical release.

The production change adds a validated, per-request pending emergency-stop fence
at `start()` and checks it at the existing AutoLock dispatch boundary. Existing
persisted preemption takes over when admission runs. Each request removes only
its own fence in `finally`. No Session service, table, Device protocol, tracking
Task or weapon call was added.

## Archive and report integrity

`python3 scripts/audit_evidence_archive.py --repo .` returned 0:
**20/20** actual byte hashes and sizes match the immutable archive, totaling
**81,789,766 bytes**. All 20 paths are absent from the implementation tree.
The manifest set exactly matches the archived raw captures at the 100,000-byte
threshold. An invalid candidate ref exits 2; auditing the archive as the active
candidate exits 1 for all 20 present captures.

[ARCHIVE_AUDIT.json](ARCHIVE_AUDIT.json) records every expected/actual Git blob
SHA-1, actual size, independent SHA-256, fixed remote ref and restored replay.
757 tracked Markdown files had zero dangling links to the removed captures.
All 50 retained historical v1.2 JSON files are byte-identical to the archive.
The five historical Markdown differences explain archive locations/replay;
their original runtime outcomes remain unchanged.

Restored navigation replay passed with 19 complete Contexts and 38 selected
notifications; restored Recon replay passed with 54 Contexts and 76 notifications.
Duplicate replays were no-ops. The two replay command examples now fetch the
fixed archive and restore to `/tmp` before invoking the existing offline tools.

## Hosted verification

[Implementation CI run 37722644205](https://github.com/zhouwen-giser/sdar-mcp-provider-platform/actions/runs/37722644205)
targets exactly `ac03646127a84e9b99ba87754eb45acd512431c9`.

| Job                 | Result  |
| ------------------- | ------- |
| `static`            | SUCCESS |
| `development-tests` | SUCCESS |
| `task-business-ugv` | SUCCESS |

Delivery reports receive their own subsequent commit. The exact delivery HEAD
and its three required CI results are recorded in this Goal's
`state/PROGRESS.json` and the [PR #35 closeout](https://github.com/zhouwen-giser/sdar-mcp-provider-platform/pull/35).
Historical green runs do not substitute for checks on that final HEAD.

## Deployment boundary

The user's local Runtime at `http://127.0.0.1:19100/health/ready` returned HTTP 200
with dependencies ready. Its Runtime/Adapter image remains based on `0a4a7c3`;
this closeout did not update those containers or issue field device commands.
The configured execution mode is live/development and `UGV_FIRE_ENABLED=false`.
Sequential-policy real-source qualification remains unverified. Historical
single-target V-OBS/V-INPUT, Map-full mobility-blocked/failed outcomes and other
out-of-scope work retain their separate status.
