# ADR 0007: One external RuntimeDeployment reconcile job

## Status

Accepted.

## Context

The PMS Worker exposed two handlers with the same external Job Type,
`runtime_deployment.reconcile`. One invoked the complete
`RuntimeDeploymentReconciler`; the other invoked database preparation alone.
Registering both was structurally impossible because `PmsJobRegistry` rejects
duplicate Job Types, while registering either one made the same persisted job
mean two different lifecycle boundaries.

The application reconciler already models database preparation as
`RuntimeReconcileDatabasePort`. It calls that port for the `REQUESTED`,
`DATABASE_PROVISIONING`, `MIGRATING`, and recoverable `FAILED` states before
continuing configuration, process start, health, discovery, and steady-state
reconciliation.

## Decision

`runtime_deployment.reconcile` is the only external RuntimeDeployment lifecycle
Job Type.

The Worker handler for that Job Type invokes `RuntimeDeploymentReconciler`.
Database preparation remains an internal application service implementing the
reconciler's database port. It is not independently leased, registered, or
exported as an external Worker handler.

`PmsJobRegistry` continues to reject duplicate Job Types deterministically with
`PMS_JOB_HANDLER_DUPLICATE`. This invariant is covered for both constructor and
incremental registration paths.

## Consequences

- One persisted reconcile job has one stable meaning and one fencing context.
- Database provisioning and migration remain retryable steps within the single
  reconciler state machine.
- Package consumers cannot accidentally register a second database-preparation
  handler under the reconcile Job Type.
- Production Worker composition is unchanged. Wiring the complete reconciler
  into the production bootstrap remains explicitly outside this decision.
- No PM2 bridge, scheduler, migration, or Runtime protocol behavior is added.
