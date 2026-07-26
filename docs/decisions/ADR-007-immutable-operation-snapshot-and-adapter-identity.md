# ADR-007: Immutable Task operation and Adapter response identity

Status: accepted

Date: 2026-07-17

## Context

The current Manifest is mutable deployment state. rc.1 used it while scheduling and recovering
historical Tasks, so removing an operation or changing its schema/capabilities could strand or
reinterpret work that had already been accepted. Adapter responses also lacked enough echoed
identity to prove that a Snapshot or Ack belonged to the requested execution.

## Decision

Every admitted Task and admission intent retains `operation_snapshot_id`. The snapshot
repository loads that exact row, validates its stored definition, recompiles its input schema
and returns `ResolvedTaskOperation`. Scheduler and recovery resolve it before any Adapter RPC;
Task get/control/input paths use it for operation name and capability decisions. Current
Manifest state remains authoritative only for catalog listing, new calls and creation of new
snapshots.

Recovery of a pending admission explicitly reuses its original snapshot id. It never looks up
the operation name in the new Manifest and never substitutes the new operation snapshot. A
removed operation can therefore finish old work while remaining unavailable to new calls. If
the Adapter itself no longer supports the old operation, its explicit rejection/conflict enters
the normal recovery failure policy rather than permanent deferral.

Snapshot response identity comprises task id, provider-scoped external execution id, operation
name, argument hash, authorization-context hash, execution mode and simulation id. Start also
requires the outer accepted external id to equal the initial Snapshot id. Command Ack identity
adds the exact command sequence and must match both the Ack top-level sequence and the echoed
SideEffectIdentity. Reconcile for an already bound Task supplies the known external id and
requires the response and Snapshot ids to agree.

An identity mismatch never updates the Task row, Adapter revision, current execution binding or
command success. A published Task receives a durable, stable-key `task.identity_conflict` audit
Outbox event; it does not receive a lifecycle observation that could be mistaken for accepted
Adapter state. The operation remains retryable/recoverable according to its existing durable
state. Runtime also increments an identity-conflict metric when the Task Engine detects the
violation. Before initial Task publication, a bad Start response leaves the durable admission
intent `UNCERTAIN` for explicit reconciliation.

Migration 010 adds a provider/external-execution unique partial index as the final database
backstop against cross-Task rebinding.

## Consequences

- Manifest upgrades cannot reinterpret already accepted Tasks.
- Snapshot/Ack identity is verified from response content, not assumed from the request.
- Adapter protocol v1 gains backward-compatible fields, but rc.2 conformance requires both
  reference Adapters and production Adapters to populate them.
- H8 must prove migration and expanded dual-language conformance before the release claim.
