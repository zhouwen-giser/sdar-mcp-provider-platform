# ADR 0008: RuntimeDeployment health and publication convergence

## Status

Accepted.

## Context

RuntimeDeployment reconciliation previously recorded steady-state health without
changing deployment status. An unhealthy `ACTIVE` deployment therefore
remained `ACTIVE`, while a recovered `DEGRADED` deployment remained
`DEGRADED`. The domain also allowed `DEGRADED -> ACTIVE`, which could bypass
Provider identity verification and Catalog/Registry publication.

Provider identity was optional on the main reconciler constructor, so a caller
could silently create a production-oriented reconciler that skipped the
identity gate.

## Decision

The main `RuntimeDeploymentReconciler` requires a Provider identity port. No
production-oriented constructor silently disables identity verification.

For a desired running deployment, reconciliation follows this matrix:

| Current status    | Health    | Identity      | Result                                 |
| ----------------- | --------- | ------------- | -------------------------------------- |
| `HEALTH_CHECKING` | healthy   | valid         | `DISCOVERING`                          |
| `HEALTH_CHECKING` | any       | mismatch      | existing `FAILED` path                 |
| `HEALTH_CHECKING` | unhealthy | valid         | `DEGRADED`                             |
| `ACTIVE`          | unhealthy | not evaluated | `DEGRADED`                             |
| `ACTIVE`          | healthy   | valid         | idempotent `ACTIVE`                    |
| `ACTIVE`          | healthy   | mismatch      | existing `FAILED` path                 |
| `DEGRADED`        | unhealthy | not evaluated | idempotent `DEGRADED`                  |
| `DEGRADED`        | healthy   | valid         | `DISCOVERING`                          |
| `DEGRADED`        | healthy   | mismatch      | existing `FAILED` path                 |
| `DISCOVERING`     | n/a       | valid         | remain `DISCOVERING` until publication |
| `DISCOVERING`     | n/a       | mismatch      | existing `FAILED` path                 |

`DEGRADED -> ACTIVE` is not a legal domain transition.
`DEGRADED -> DISCOVERING` is legal and retains observed-revision fencing.
Concurrent retries of the same transition are idempotent; a divergent stale
transition fails deterministically.

`CatalogRegistryReconcileDecorator` is the only closer from `DISCOVERING` to
`ACTIVE`. It activates only after Catalog publication and Registry publication
both commit. Any discovery, projection, or publication failure uses the
existing failure path and never returns `ACTIVE`.

## Consequences

- Runtime status reflects health loss and recovery rather than remaining
  stale.
- Recovery re-runs identity and publication gates before returning to
  `ACTIVE`.
- Revision fencing and same-transition retry idempotency remain intact.
- No periodic scheduler, PM2 implementation, production Worker composition,
  migration, Runtime API, or PMS API behavior is added.
