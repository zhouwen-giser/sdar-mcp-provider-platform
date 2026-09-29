# UGV reconnaissance source identity — qualification pending

Status: **BLOCKED_SOURCE_IDENTITY**. `mission_id` on a command reply is not the
identity of an unrelated telemetry packet.

The 2026-09-29 07:23 UTC read-only recheck is in
`reports/business-feedback-final-convergence-v1.2/evidence/recon-readonly-recheck.json`.
Two read-only MCP calls succeeded; 121 status frames and one coverage frame were
received without device mutations. Status/lock and the empty target response
still have no mission/session identity; coverage has `run_id=0`. No target frame
was observed during this idle window, so this capture does not establish active
target behavior or a new producer version.

Read-only inspection of `area_recon_scan.py` confirms `_run_id` starts at zero
in the constructor and increments on start; only coverage includes it. Status
publishes `last_cmd_ack`, while target items have capture time but no mission or
run ID. The MCP command sequence is a receipt identifier, not a shared generation
on status/targets/coverage, and also restarts with its process. Neither mechanism
establishes a reset-safe lifecycle mapping. Upstream files were not changed.

Current read-only capture is recorded in
`reports/business-feedback-final-convergence-v1.2/evidence/device-read-only-20260929.json`.
MQTT `/ugv/area_recon/status` wraps JSON in `data`; it contains status, lock stage
and target ID, but no mission/session ID or source observation time. The MCP
status and empty-target replies likewise lack mission identity. Coverage exposes
`run_id`, but no observed mapping to the MCP mission. An idle window supplies no
fresh target packet; the historical active capture also lacked authoritative
target-list mission identity.

Required producer contract: status, targets, lock and coverage carry the same
real mission/session ID, a reset-safe generation, and source time/sequence.
Alternatively supply a verified lifecycle mapping that cannot attribute a
buffered old packet to the next mission. Record configure/start/stop/reset,
disconnect/reconnect and restart behavior. Reusing a previous status mission or
stamping the currently active Execution onto anonymous target packets is invalid.

The existing Runtime/state-store mission fence must stay fail-closed. Provider
auto-lock may act only on a visible target belonging to the current recon
Execution; its requested Action and journal must bind mission/session/target.
Only a later stage-3 observing fact for that binding establishes active locking.
Pause/cancel wins over policy dispatch. A different mission, target loss or old
lock session must not answer or reissue a RequiredInput for the new session.

The implemented [Provider policy](UGV_TASK_BUSINESS_PROVIDER_AUTO_LOCK.md) enforces
these consumer fences and is covered by Runtime component tests. Its presence
does not supply the missing producer identity or open the production gate.

The selected profile is core. Current footprint remains disabled; coverage
cells are not map geometry without declared frame, origin, axis, transform and
area revision. Requested recon area, cumulative coverage and instantaneous
footprint remain distinct artifacts.

## Active source recheck

The follow-up `evidence/recon-active-source-recheck.json` under the same report
directory records configure/start for mission 47567 in the user-provided region.
MCP observed status 5 (running). MQTT produced 121 active status packets, 30
empty-target packets and two coverage packets. Status and target envelopes still
lack mission/session identity; coverage reports run_id=1 only. This is not a
nonempty target observation or a proof of a reset-safe session mapping.

The audit used `ugv_area_recon_control(cmd_type=4, mission_id=47567)` for cleanup;
a subsequent status reported 9 (terminated) and lock stage 1. No chassis movement,
visual lock or fire call occurred. The current deployed tool description differs
from the local simulator source, so the local code audit is supporting evidence
only and is not presented as a verified deployed build.
