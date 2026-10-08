# Provider automatic visual lock

Implementation status: the Provider-to-device lock and input path has real public Runtime
software-simulator V-OBS/V-INPUT evidence. This sequential multi-target policy is covered
by synthetic Runtime tests and still needs its own real-source qualification. The opt-in
public Profile uses the [recon correlation contract](UGV_RECON_CORRELATION_CONTRACT.md).
Synthetic tests do not by themselves establish new field qualification.

With `businessVisualLockOwner: "provider"`, the existing area-recon Execution
selects the first eligible target from the just-projected complete target list.
Policy `ugv.sequential-visible-target/1` processes distinct targets sequentially:
only one lock and Input may be active at a time, and each target ID is attempted
at most once per mission. After a lock ends, new fresh scanning/target evidence
can select the next unattempted target. No ranking or automatic same-target retry.
It neither starts a second public tracking Task nor invokes a weapon action.

Eligibility requires a running, non-preempted Execution; connected device and
MQTT ingress; fresh, non-retained status and target messages with either matching explicit identity or unique-current-execution inference; scanning status 5/stage 1; and a unique current visible
`target.object` from the same mission. Target and source times must be within
the existing freshness windows and cannot predate the Execution or be in the
future. The exact packet is checked; anonymous packets use the unique active Execution, never an inherited mission field from another topic.

Before dispatch, the existing business Store atomically saves a requested
`sensor.visual_lock` Action, its Context references, the mission selection marker
and the `ACTION_CHANGED` source event. The Action records
`triggerOrigin: provider_policy`, the policy, target, mission and deterministic
mutation step ID. The existing mutation journal then fences
`ugv_area_recon_lock(true, target, mission)`. Runtime checks pending controls and
the latest source qualification again at the last dispatch boundary. A queued
pause or cancel with the matching execution identity wins that boundary. A
queued emergency stop for the same resource also blocks dispatch before its
existing admission path persists preemption. Resource, mode and start identity
are validated before registering that pending stop, and each request's fence is
removed when its queue turn completes. Invalid controls do not claim priority.

Device acceptance leaves the Action requested. Stage 2 records locking without
activating this requested Action. Only a fresh later stage-3 observation for the
same mission and visible target, strictly after a matching journal dispatch,
activates it. That observation preserves the Provider actor and policy cause.
When manual decision is enabled, only this observed Provider-policy activation
may generate its RequiredInput. A foreign or unattributed lock cannot acquire
Provider-policy provenance or generate this policy's input.

Recovery uses the persisted Context and journal, without another Store. A crash
after the requested Action but before dispatch can resume the same Action after
fresh eligible source messages. `ACCEPTED`, `DISPATCHING` and `UNCERTAIN` entries
are never resent; a later matching observation can resolve an uncertain effect.
Rejection and confirmation timeout end the requested Action and retain the
selection history. Another target is eligible only after a fresh unlocked/scanning
status and a newly observed target list; uncertain dispatch remains fenced.
Missing or lost targets cannot establish active locking.
Newer valid status messages remain eligible during database awaits, while a
newer explicit mismatch, ambiguous source or retained message revokes eligibility
before dispatch.

When the Execution's current mission changes, a requested policy Action from
the prior mission is cancelled with `UGV_AUTO_LOCK_MISSION_REPLACED` and removed
from active references. Its immutable history remains readable. This retires a
superseded request; it does not assert that a possibly dispatched device effect
was physically released. Already observed active locks retain their evidence
until qualified observation/finalization resolves them. A stale coordinator
invocation cannot retire the new mission's request, and old-mission stage-3
packets cannot activate it. The new mission still needs its own eligible scan,
target and post-dispatch observation before any policy Action becomes active.

Validation: `tests/integration/ugv-provider-auto-lock.test.ts` exercises selection,
observation confirmation, identity/freshness fences, rejection, timeout, journal
recovery and control races through the actual Runtime with synthetic ingress and
a mock device. It is part of `pnpm test:task-business:ugv-local`. These tests do
not substitute for V-OBS/V-INPUT under the selected GOWM installation.

The same tests now exercise trusted continue/decline/cancel responses to the
policy-generated input, reject an agent response, and verify that retries do not
repeat device effects. Continue keeps observation active without another device
command. Decline/cancel send one release and wait for a later scanning fact;
expiry also survives a Runtime restart before that confirmation. No previous
target is automatically re-locked. A _different_ fresh visible target may be
selected after the previous Action is terminal, a later unlocked/scanning
observation is confirmed, and a new target observation is accepted. The history
is recovered from existing Context Action versions without new session storage.
Regression coverage includes three distinct targets in sequence, a new target
arriving during the second Input without changing its binding, post-timeout
recovery, DISPATCHING persistence loss across restart, and priority controls at
the second-target dispatch boundary.
