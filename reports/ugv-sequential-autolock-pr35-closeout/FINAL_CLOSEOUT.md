# Sequential AutoLock / PR #35 engineering closeout

Date: 2026-10-08. Issues ② and ⑥ are complete at the engineering boundary.
Implementation commit: `ac03646127a84e9b99ba87754eb45acd512431c9`.
[Its exact CI run](https://github.com/zhouwen-giser/sdar-mcp-provider-platform/actions/runs/37722644205)
passed `static`, `development-tests` and `task-business-ugv`.
The delivery commit also includes these reports; its exact SHA and required
check run are recorded in the Goal `state/PROGRESS.json` and the
[PR #35 closeout](https://github.com/zhouwen-giser/sdar-mcp-provider-platform/pull/35).

## Outcome

The existing sequential policy was retained. Regression tests now exercise
7 → 8 → 9 within one Mission, using fresh scan/target facts between rounds,
without repeating an attempted ID or changing an active Input's target binding.
Continue retains the current lock. Decline/cancel/expiry wait for observed
release; ACK alone cannot authorize the next target. Rejection, timeout,
UNCERTAIN/DISPATCHING, restart, Mission replacement and source ambiguity retain
their conservative dispatch fences.

A queued emergency stop previously lost the final dispatch race against the
second target. The new regression failed on the old code and passed after a
23-line Runtime change exposed validated pending stops to the existing guard.
Persisted preemption and the existing mutation journal still own admission and
recovery. No Session service, DB table, Device MCP protocol or weapon path changed.

## Task completion

| Task     | Status | Evidence / counts                                                                                                           |
| -------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| SEQ-001  | DONE   | [Baseline](BASELINE_AUDIT.md); clean checkout preserved by a four-commit fast-forward; PR/ref/old-CI audit                  |
| SEQ-002  | DONE   | REUSED_VERIFIED coordinator, NativeLock and PostgreSQL Context/Action CAS/history audit; [validation](VALIDATION.md)        |
| SEQ-003  | DONE   | All A-01–A-14 mapped; 425/425 local cases including 72 AutoLock, 17 RequiredInput and 26 correlation                        |
| SEQ-004  | DONE   | Exact Runtime/device calls, three targets, final-boundary controls and enabled-owner terminal regression; 72/72 AutoLock    |
| ARCH-001 | DONE   | [Byte audit](ARCHIVE_AUDIT.json): 20/20 SHA/size matches; 81,789,766 bytes; fixed remote archive ref                        |
| ARCH-002 | DONE   | 757 tracked Markdown files scanned, zero dangling archived-capture links; navigation/Recon restored replay PASS; diff below |
| QA-001   | DONE   | Eight required local commands PASS; Native 32/32, GOWM components 9/9 + 7/7; exact-head required CI                         |
| QA-002   | DONE   | Baseline, validation, archive audit and this closeout; Goal progress and PR delivery verification                           |

The 72/17/26 counts are subsets of the 425-case gate. Native and GOWM component
counts are separate. Selected-installation GOWM qualification is
NOT_APPLICABLE in this isolated environment; its configured owner fixture was
absent. Component gates used a temporary PostgreSQL database and were cleaned up.

## Archive and PR review

The archive branch `archive/ugv-pr35-raw-evidence-20261008` still points to
`9f6714d1fc06a65fb7438d66df435da51226455a`. Every manifest path matches actual
Git blob bytes, SHA-1 and size; SHA-256 is also recorded. All 20 archived raw
captures are absent from the candidate tree. All 50 retained historical v1.2
JSON files remain byte-identical. Existing V-OBS/V-INPUT and Map-full outcomes
were preserved; replay documentation now restores the immutable source first.

The pre-archive PR had **382 files, +2,180,249 / -685 lines**. The delivered tree
has **369 files, +34,617 / -686 lines** against main
`5a2482aa5df25f2eebed604ed15f9d4c3a02a454`; added lines fell by
**98.41%**. The remaining diff includes the original integration work,
the sequential fix, small evidence summaries and these closeout reports.

Reproduce the full read-only audit:

```sh
git fetch origin archive/ugv-pr35-raw-evidence-20261008
python3 scripts/audit_evidence_archive.py --repo .
```

Restore one original capture without reintroducing it into the active tree:

```sh
git show 9f6714d1fc06a65fb7438d66df435da51226455a:reports/business-feedback-final-convergence-v1.2/evidence/map-full-recon.json > /tmp/pr35-map-full-recon.json
git hash-object /tmp/pr35-map-full-recon.json
# Expected: 9aca65a2f0a4d0cb68e33778bd2f7fc3a49ec811; 22,489,800 bytes
```

**Recommend squash merge** after reviewing the final PR checks. This preserves
the small final tree on main while the separate archive ref keeps raw evidence
available. The PR remains open and was not merged by this closeout.

## Final status and limits

```text
UGV_SEQUENTIAL_AUTOLOCK_CODE_COMPLETE=true
PR35_RAW_EVIDENCE_ARCHIVE_VERIFIED=true
PR35_MERGE_READY=true
UGV_SEQUENTIAL_AUTOLOCK_REAL_SOURCE_QUALIFIED=false
PR35_MERGED=false
```

Real-source sequential-policy qualification is **UNVERIFIED**. The local port
19100 health endpoint is ready; its Runtime/Adapter still run `0a4a7c3`, so this
candidate has not been deployed there. No field navigation, Recon, lock or weapon
command was issued. Fire remains disabled. Uncertain effects require qualified
observations before progress; that conservative behavior is retained. Historical
Map-full mobility limitations, authentication/SDK work and multi-device or
Session architecture remain outside this closeout.
