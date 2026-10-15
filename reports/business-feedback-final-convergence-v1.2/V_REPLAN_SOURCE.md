# Existing re-execution: real public two-adjustment and restart PASS

The final public run in `evidence/navigation-public-restart.json` completed both
`navigation.adjust_plan` commands in Task `8a3d2d0b-5cf7-4e07-96a8-193b3cad6267`.
Mission 47564 was stopped before 47565 was created/started; after adoption and a
full Runtime/Provider restart, 47565 was replaced by 47566. Effective revisions
1 → 2 → 3 and applied command/resultRefs were confirmed through public MCP.
Original arguments/hash stayed unchanged. The final requested goal was reached
at 1.454523 m distance with zero speed and a completed public Task.

Actual production settings select `isr_airport` only for simulation/entity ugv1.
The business profile publishes route/adoption/adjustment support only with the
real airport adapter. Fire remains disabled. Runtime 027 and Provider 030 SQL
are explicitly deployed by the SMPP owner installer; startup only verifies them.

Real testing found and fixed: missing Runtime INTERVENTION constraint migration;
result Schema omission of adopted plan/destination fields; high-frequency polling
starving mission proof; an equivalent newer heartbeat invalidating commit proof;
and an unbound in-memory admission object obscuring cleanup errors. Raw telemetry
still persists. Production trajectory projection now uses its declared 1 s durable
sampling interval, reducing Context churn without changing physical confirmation.

The public probe preserves HTTP scene authorization even when optional identity
metadata is absent, waits for Task `running` before edits, aborts old SSE reads on
refresh, and limits consecutive snapshot conflicts rather than accumulated
successful hydration cycles. The restarted event observer allows the existing
30 s source lease takeover and independently requires recovered-window events.
No event continuity state was manually cleared to manufacture a pass.

Failed attempts are retained in `evidence/navigation-public-attempts.json`.
Component cases cover cancellation, stale/retained observations, command replay,
uncertain create/start and adoption cache recovery; those fault cases are not all
claimed as live injected-device tests. External SDAR and V-OBS/V-INPUT remain
pending, so the complete Goal is still incomplete.
