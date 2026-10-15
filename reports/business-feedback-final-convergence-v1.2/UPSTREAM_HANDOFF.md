> Navigation update, 2026-09-29: the airport production profile, two real public
> adjustments, arrival and full Runtime/Provider restart now pass on the isolated
> GOWM SMPP installation. See V_ROUTE_SOURCE.md, V_REPLAN_SOURCE.md and
> evidence/navigation-summary.json. Runtime 027 and Provider 030 are included in
> SMPP deployment SQL. Earlier pending statements below are historical. Recon
> Recon now passes under current-execution inference; external SDAR remains pending. No remote deployment occurred.

# Confirmed scope and existing-source implementation

The user confirmed SMPP-only changes, adding the required SQL to deployment packages, and no isr-simulation changes. The follow-up explicitly chooses existing planning plus mission re-execution for route adoption. There is no pending scope question.

The existing dashboard public `plan_route` event was called on 2026-09-29. It returned six road-planner points and length 148.5 m for the supplied navigation destination. Evidence: `evidence/existing-road-planner-response.json`. No mission was created or started by this probe.

SMPP now contains `AirportRoadPlanner`, consuming only `route_candidates`, validating endpoints and ordered vias under the inspected airport transform, and retaining the exact selected planner points. The legacy event is a broadcast without request IDs: SMPP does not claim request correlation or use dashboard entity/target truth. It selects a matching actual candidate and binds its exact bytes to a new Device MCP mission with `need_plan=false`. Planner IDs are derived fingerprints with declared source provenance, not invented device IDs.

The Runtime persists the plan before creation, publishes candidate separately, and requires fresh non-retained `/ugv/mission_state` state 1 after the journaled start, matching mission and submitted-argument hash, before adoption. Component tests cover unrelated/retained/stale packets, duplicate adoption, restart without replanning/resending and cancellation. Production profile/config wiring and real same-candidate adoption are still pending; an internal injected planner is not a qualified deployment.

The running-Task handler now implements the existing re-execution path: observed old-mission stop before planning/creating/starting the replacement, independently observed adoption, atomic effective intent/mission/result publication and restart recovery. Source inspection found that native cancellation does not reliably clear queued goals; SMPP therefore avoids relying on an overlapping native queue. Seven new Runtime component cases cover successive adjustments and failure/cancellation/restart boundaries. Two consecutive real adjustments and full Runtime/Provider restart subsequently passed; see V-EDIT.json and V-PUBLIC-PAYLOADS.md.

SMPP now packages an executable GOWM migration in `deploy/gowm-task-business`, with its pinned contract and explicit owner deployment step. Five PostgreSQL component tests and source-archive contents/checksum validation pass. No remote schema has been changed. The prior sz-gowm observation still showed the four tables absent; it is not a current installation pass. The old GOWM full structure audit does not include this additional migration and must not be reported as qualified.

Recon source packets remain anonymous. The user supplement permits Provider-side unique-current-execution inference with freshness, non-retained and cursor checks; no upstream identity change is required. GOWM and isr-simulation repositories remain read-only. Historical navigation/edit and selected-store/process restart evidence are retained. Current-candidate Recon/Input now pass locally; external SDAR remains unqualified; see RECON_SUPPLEMENT.md.
