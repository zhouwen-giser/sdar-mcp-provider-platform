# Recon inference supplement: implementation and qualification

The supplied `SMPP_Business_Feedback_Goal_v1.2_Supplement_Recon_Inference.zip`
was extracted and all three documents read. SHA-256:
`5d842f3c140f14a8c875defa13cd1aa71f991b8ba6a3dd4d46870d308faebdfa`.
Its original files and source manifest are retained under
`.codex/goals/business-feedback-final-convergence-v1.2/supplements/recon-inference/`.
The baseline is `b8d7c9bb851fd4140d7de9a0c62450b6b9371296` plus the current worktree.

Only BFF-008/009/010/012/022 requirements change. Existing Context, Store, events,
RequiredInput, navigation and intervention work remains in place. No upstream
repository, deployed schema, deployment package or fire setting was changed.
The two global completion flags remain false.

## Implementation

- `resolveReconExecutionCorrelation` checks the exact MQTT packet. An explicit
  mission/session identity must match the latest saved downstream mission.
  Malformed, conflicting and mismatching identities fail closed, including the
  status normalizer's `id` alias. Anonymous data requires exactly one active
  Recon execution for the same Provider/resource, a saved mission, freshness,
  non-retained delivery, and a cursor after creation/dispatch baselines.
- Status, targets, coverage and lock projection reuse this resolver and record
  `STRICT_CORRELATED` or `INFERRED_CURRENT_EXECUTION` in Context/Action properties.
  Standalone coverage also requires current scanning status. Existing map and
  area-revision qualification stays in force. No session service/table was added.
- AutoLock keeps deterministic candidate selection, latest-source checks,
  priority-control fences, and journal idempotency. Only a post-dispatch stage 3
  observation for the requested target confirms an active Provider policy lock.
- RequiredInput keeps the trusted responder, bound mission/Action/target,
  continue/decline/cancel/expiry, release-and-resume and recovery implementation.
  Its public probe now supplies simulation headers without requiring the optional
  simulation ID to be duplicated in public identity payloads.
- A live attempt exposed scan status 8 during EO locking. A matching Provider
  dispatch journal and a later stage 2/3 observation now prevent this sensor
  pause from incorrectly cancelling the Task's policy action. Real priority
  controls still win. An idle SSE reader now terminates at the probe deadline.
- The documented `coverable=unknown` response may contain null region distances.
  SMPP now accepts those explicit unknowns, preserving the accepted mission
  receipt. It still rejects invalid numeric ranges and does not treat unknown
  coverage as successful preflight or successful reconnaissance.

## Real attempts, not acceptance passes

| Attempt | Observed result                                                                                                                                                                                                                         | Qualification                                            |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1       | Approach completed; Recon Task `bcb4c8e8-d5c2-4de0-8a15-048a20bfe8da`, mission 47572, anonymous target 9, one journaled lock request, later same-target stage 3. Sensor pause was incorrectly mapped to Task pause; input did not open. | FAILED; sensor-pause fix added afterward                 |
| 2       | Task `eacb0d01-de70-4ec8-b3d5-23bc3db5dfe6`; device reported unavailable camera and unknown/null preflight distances. Configure became uncertain; no mission was persisted and safe stop could not be confirmed.                        | FAILED; history retained, no inferred mission fabricated |
| 3       | Reusing fixture A was refused because attempt 2 left an unresolved Provider execution.                                                                                                                                                  | PRECONDITION_REJECTED; no device call                    |
| 4       | Existing isolated fixture B had no active execution. Device still returned load_status=4, status=9 and lock stage=1. New readiness check stopped before launching workers or issuing mutations.                                         | NOT_RUN; load not ready                                  |

Original payloads and logs are `evidence/recon-public-attempt-{1,2,4}.{json,txt}`.
Attempt 1's recon-specific cancel was independently observed as status 9 / lock
stage 1. Attempt 2's failed safe-stop result remains explicit. Fixture A was not
edited to erase the unresolved record; fixture B is the existing second device
binding in the same disposable complete GOWM test installation.

At 2026-09-30 01:10:25–28 UTC, two MCP reads and 62 fresh, non-retained status
packets agreed on `online=true`, `camera_fault=false`, `load_status=4`.
This is an active producer result, not an old retained MQTT message. The local
simulator source's `_load_status` returns 4 when both camera and gimbal references
are absent, even without `_cam_fault`. Its reset clears task state, and idle
detection returns before refreshing actor references. This identifies the source
condition and a possible stale-binding cause; deployed process internals/build
were not verified because SSH authentication failed. See
`evidence/recon-load-diagnosis.json`. No simulator source was modified. A final read at 01:21:48 UTC still returned
load_status=4, status=9 and lock stage=1; see `evidence/recon-last-load-check.json`.

## Restored environment and public-wire fixes, 2026-09-30

The user's restart restored load_status=1 at 01:52:38 UTC. Attempts 5–14
reached actual anonymous targets and a journal-confirmed same-target visual lock.
Attempts 11–14 also reached public Runtime `input_required`. They are still
failed qualification attempts, not PASS evidence. Their full sanitized captures
and logs are retained as `evidence/recon-public-attempt-{5..15}.{json,txt}`.

The real chain exposed and now has fixes for:

- Repeated PostgreSQL object-version reads and reference checks: batch exact
  immutable versions inside the same scoped transactions; retain missing-version
  rejection, ordering and scope isolation.
- Repeated Ajv compilation when reading the same RequiredInput: bounded cache by
  full JSON schema content, with defensive copies; every response is still
  validated and changed schemas cannot reuse an older validator.
- Continuous Context updates invalidating a single page read: PostgreSQL pages
  now read within one repeatable-read transaction. Subsequent-page cursors still
  reject revision changes. The manual probes can request a protocol-bounded
  1 MiB page for growing Recon histories instead of repeatedly crossing pages.
- High-rate telemetry triggering full reconciliation more frequently than the
  configured cycle: timer and observation polling now share that cycle. Every
  observation is still persisted/projected; mission-state events remain immediate.
- Recon advertised a business input profile but `capabilities.inputRequired=false`:
  the operation now advertises input capability when its profile enables it.
- GOWM Runtime promoted-input validation reversed the table/alias parameters for
  inbox and request scope predicates. Native mode's TRUE predicate masked this;
  the real application-role SQL now uses the proper aliases. A GOWM regression
  executes the query under both device bindings.

Attempt 6 needed direct recon-specific cleanup after Runtime cancellation timed
out: `ugv_area_recon_control(cmd_type=4, mission_id=47576)` was followed by status 9
and lock stage 1. Later attempts were recovered via their original durable
Provider/Runtime processes; no task database status was manually edited. Attempts
12/14 preserved their failed UPDATE command history. Attempt 15 failed before
mutation while MCP briefly disconnected; a subsequent read showed an empty,
operational scene. No fire action ran.

## Qualified real workflows and remaining Goal boundary

Attempt 17 passed on 2026-09-30 at 02:41:53 UTC through the actual simulator,
production Provider/Runtime entrypoints, authenticated user input and the
complete isolated GOWM application-role installation:

| Decision             | Public Task                          | Device mission | Observed effect                                                     |
| -------------------- | ------------------------------------ | -------------- | ------------------------------------------------------------------- |
| continue_observation | a3c0a208-ef97-459f-afee-0dc346941d7c | 35668          | Input answered; Task working; same target 9 remains at lock stage 3 |
| decline              | 2b9a9455-92f8-4c80-8931-de92f318c82f | 35669          | Input declined; Task working; actual stage 1 and scanning status 5  |

Both runs recorded `INFERRED_CURRENT_EXECUTION`, exactly one journaled policy
lock before its later active Action, an actual same-target stage 3, and public
`input_required`. Both ended by public task cancellation; independent final
status was 9, lock stage 1, load status 2. No fire command ran.

The final real-chain defect was an answered Input leaving the Runtime Task
`input_required` with no open requests until the next Provider poll, causing
`TASK_INPUT_REQUESTS_MISSING`/HTTP 500. The acknowledgement transaction now moves
that Task to working only after all open inputs are answered, explicitly awaiting
Provider observation. Partial inputs remain pending and safe-stop wins. The
subsequent device observation, not this acknowledgement, qualifies the effect.

Full sanitized evidence is `evidence/recon-public-attempt-17.json`. Offline replay
passes 54 complete Contexts and 76 selected original parsed notifications, with
76 duplicate no-ops. Five deliberately damaged copies are rejected. The NDJSON
handoff retains those actual payloads, source hashes and workflow identities.
Attempts 1–16 remain failed/historical evidence and are never upgraded to PASS.

BFF-008/009/010/012 are complete for the selected local Recon supplement. BFF-022
and the entire Goal remain open: the previous navigation/edit positive evidence
predates these final code changes, final hosted CI and remote deployment are not
qualified, and external SDAR consumption is still pending. External SDAR affects
end-to-end readiness only. No package, deployment, commit, push or upstream edit
was performed in this continuation. Fire remains disabled.
