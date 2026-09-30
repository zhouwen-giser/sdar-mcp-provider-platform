# Recon current-execution correlation

The 2026-09-29 v1.2 supplement replaces the former producer identity prerequisite.
Explicit mission/session identity is preferred. If absent, the Provider supports
`INFERRED_CURRENT_EXECUTION` for the same resource's unique active
`vehicle_area_recon` Execution. No upstream change or new session service/table is required.

`resolveReconExecutionCorrelation` checks the exact accepted MQTT packet rather
than borrowing a sticky mission ID from another topic. Present identities must
all match the latest saved downstream mission. Malformed, conflicting or foreign
identities return `UNRESOLVED`. Anonymous data requires exactly one nonterminal,
started Recon Execution in the same Provider/resource scope. No active execution,
multiple candidates, retained packets, stale/future observations, pre-creation
observations and the recorded start/baseline cursor are rejected. The same checks
apply to status, target, lock and coverage facts. A restarted Runtime waits for a
new accepted packet; a persisted Context is not fresh source evidence.

Accepted facts return `STRICT_CORRELATED` or `INFERRED_CURRENT_EXECUTION` and use
the Execution's saved latest downstream mission. Public Context summary properties
record `reconStatusCorrelation`, `reconTargetCorrelation`, `nativeLockCorrelation`
and `reconCoverageCorrelation`; an observed lock Action records `correlation`.
This is an explicit inference policy, not proof that the device supplied identity.
Without source time/identity, ingress time cannot distinguish every delayed
non-retained historical packet; the supplement accepts this boundary with the
existing freshness, Execution and cursor checks.

AutoLock reuses the existing deterministic selection, command journal and priority
control gates: RUNNING, fresh visible target, scanning/unlocked, saved mission and
no pending pause/cancel. Both accepted correlation types are eligible. ACK only
records the request. Only post-dispatch stage 3 for the requested target establishes
a Provider-policy active Action and its RequiredInput. Mission replacement,
target loss, restart and uncertain command handling retain their existing fences.
Trusted user continue/decline/cancel and expiry reuse the existing handler and
release-and-resume observation confirmation.

Provider policy and user-required input are opt-in configuration paths. Their
presence does not itself establish live workflow qualification. V-OBS and V-INPUT
must run through the public Runtime with independent simulator observations,
record correlation, and prove continue plus decline/cancel. Automated expiry is
sufficient. Fire remains disabled; no weapon behavior is added or enabled.

Coverage statistics do not establish map geometry. A separate coverage packet
also requires current scanning status for the same Execution; native lock stages
2/3 cannot be counted as scanning. Frame/origin/axis/transform/area revision rules
remain unchanged. `mapFull=false`; current footprint stays disabled.

## Preserved source audit facts

The read-only and active captures are retained in
`reports/business-feedback-final-convergence-v1.2/evidence/recon-readonly-recheck.json`
and `recon-active-source-recheck.json`. On mission 47567, the active audit received
121 status, 30 empty-target and two coverage packets. Status/target/lock had no
shared mission/session identity; coverage alone had `run_id=1`. The local producer
inspection found run_id resets at construction and increments on start, so it is
not a shared reset-safe identity. The command reply's mission ID is a receipt,
not an identity field on a telemetry packet. These facts remain valid; they no
longer prevent Provider-side current-execution inference.

Cleanup used `ugv_area_recon_control(cmd_type=4, mission_id=47567)` and observed
status 9 with lock stage 1. That audit made no chassis, visual-lock or fire call
and saw no nonempty target. It is source inspection, not V-OBS/V-INPUT acceptance.
The deployed tool description differed from local source; no deployed simulator
build identity is claimed. Neither upstream repository was modified.
