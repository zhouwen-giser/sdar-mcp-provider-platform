# Goal 03 next-goal handoff

## Starting point

Start from Draft PR
[#3](https://github.com/zhouwen-giser/sdar-mcp-provider-platform/pull/3)
after its base and checks are revalidated. The integration target is
`codex/goal-02-runtime-governance`, not `main`.

Goal 03 provides the following stable foundation:

- all 41 Docker workspace manifests are staged before frozen installation;
- `verify:v2` remains fail-closed, with no high or critical dependency
  findings and a synchronized production SBOM;
- `runtime_deployment.reconcile` is the only Worker job owner for Runtime
  deployment reconciliation;
- unhealthy ACTIVE deployments degrade, and healthy DEGRADED deployments
  recover through DISCOVERING before Catalog and Registry publication;
- PMS API production composition is qualified independently in CI.

## Next-goal work packages

### PM2 Production Bridge

Qualify the real production bridge rather than only its isolated adapter
contract. Cover process identity, start/stop/restart idempotence, stale process
handling, crash and transport failure, timeout behavior, persisted deployment
state, and observable error mapping. Preserve the existing application ports
and do not move PM2 concerns into domain logic.

### Worker Production Composition

Compose the complete Worker process around the single
`runtime_deployment.reconcile` owner. Cover dependency construction, startup
and graceful shutdown, failure isolation, database preparation through the
Reconciler port, operational health, and production configuration validation.
Do not restore `runtime_deployment.prepare_database` as a second external job.

### Periodic Scheduler

Add bounded periodic triggering only after ownership semantics are explicit.
Require single-owner or lease behavior, overlap prevention, retry/backoff
bounds, shutdown cancellation, metrics/logging, and deterministic fake-clock
tests. The scheduler should trigger the existing job; it must not become a
second reconciliation implementation.

## Required invariants

- Preserve Goal 2 task-state SHA-256
  `5ffce4a73146dd9c8a7d7ffd299fb9298d2c461355946120019a36d6ce4378be`.
- Preserve one Worker Runtime reconcile owner.
- Preserve `DEGRADED -> DISCOVERING`; never restore direct recovery to ACTIVE.
- Preserve Catalog and Registry publication before ACTIVE.
- Preserve the complete `verify:v2` chain, frozen protocol, migrations, Docker
  checks, strict high-severity audit, SBOM check, and the three-job CI matrix.
- Keep release metadata, tags, rollout, and merging `main` outside the next
  Goal unless explicitly authorized.

## Entry evidence

Read these before planning the next Goal:

- `.codex/goal-03/test-evidence.json`;
- `.codex/goal-03/handoff.json`;
- `docs/review/GOAL03_FINAL_REPORT.md`;
- `docs/review/GOAL03_CI_MATRIX.md`;
- `docs/adr/0007-single-runtime-reconcile-job.md`;
- `docs/adr/0008-runtime-reconcile-state-convergence.md`.

Re-run the final Goal 03 mandatory gates on a clean PostgreSQL volume before
changing production composition.
