# UGV navigation replan through existing planning and mission execution

Status: **IMPLEMENTED; REAL PROVIDER REPLACEMENT PASS**. Only SMPP changes.
The selected mechanism calls the existing public `plan_route` / `route_candidates`
planner, `ugv_path_follow_mission`, `ugv_mission_control` and `ugv_motion_stop`.
No new simulator API, diagnostic lease or direct device/database edit is used.

## Replacement and adoption

1. In the same RUNNING Task, admit `navigation.adjust_plan` against the current
   available entry and plan guard. Persist the validated request with its semantic
   hash and Runtime sequence in the existing command ledger. Input is `waypoints`
   (one destination or ordered via points followed by destination) and `density`.
   Admission and device receipts do not establish applied.
2. Journal termination of the old mission. Require fresh non-retained raw mission
   state 3, new position/speed facts and stationary stability before proceeding.
   Keep the outer Task RUNNING. The existing controller can queue a new goal, but
   its cancellation callback does not reliably clear the queued goal; SMPP therefore
   confirms the old goal stopped before creating the replacement.
3. Obtain actual planner geometry from the current fresh GNSS position. Persist
   that candidate before creating the new Device MCP mission, passing the exact
   selected points with `need_plan=false`. Stop/source and priority-control guards
   are checked again immediately before device calls.
4. Persist the returned mission ID and candidate Artifact, then journal its start.
   Adoption requires fresh non-retained `/ugv/mission_state` state 1 for that ID,
   later than start dispatch, plus an accepted creation journal with an exact
   submitted-argument hash. A lost start receipt can be resolved by that independent
   observation; an uncertain creation with no allocated ID is never resent.
5. In one TaskBusinessStore transaction, publish adopted route, effective intent,
   mission, plan revision, applied command/resultRefs and the next available entry.
   `summary.properties.navigationEffective` is authoritative; the existing
   Execution caches it after commit and restores it before recovery/terminal checks.
   Original arguments and argumentHash remain immutable.
6. Ignore historical mission terminal packets. Success uses the adopted requested
   destination (20 m horizontal tolerance, matching the source endpoint policy),
   fresh post-dispatch GNSS and existing physical terminal/stationarity checks.
   Failure/withdrawal does not advance the plan. Failure cleanup is journaled and
   recoverable; it drops a known READY mission before independently stopping motion.

## Cancellation and recovery

Same commandId with changed content or sequence is rejected. A concurrent second
adjustment cannot reserve the active entry. Replaying an accepted/applied command
never repeats physical effects. Recovery uses the persisted request and journal,
including after Context adoption commits before the Execution cache write.

Cancellation prevents late adoption. For a replacement whose start was dispatched
but has not been adopted, a cancellation packet alone cannot prove that an in-flight
goal will not start later. A late observed RUNNING state triggers one journaled stop;
fresh correlated physical stop evidence is then required. If this cannot be proven,
existing timeout/failure handling applies. No successful cancellation is fabricated.
A rejected command also fences stale Execution recovery before any further replan.

## Qualification boundary

The real source run on 2026-09-29 completed two consecutive adjustments in one
Task through missions 47549 → 47550 → 47551, effective plan revisions 1 → 2 → 3,
then physically reached the final requested point. Production settings/Profile
wiring is implemented. Provider evidence is narrower than public Runtime/SSE and
full process-restart qualification; the current result for each layer is recorded
in `reports/business-feedback-final-convergence-v1.2/V_REPLAN_SOURCE.md`.
No upstream repository edit or remote deployment is implied by this evidence.
