# ADR-006: Runtime observation revision and transactional outbox

Status: accepted

Date: 2026-07-16

## Context

The rc.1 Task row used the Adapter Snapshot revision as both the stale-Snapshot guard and the
public observation sequence. Runtime-owned transitions such as scheduling, start retry,
cancellation intent, deadline stop and recovery therefore either reused an Adapter number or
changed visible state without a matching observation. Several repository methods also updated
the Task and outbox separately, so a fault could expose a state that had no matching event.

## Decision

Each Task has two independent counters:

- `adapter_revision` is the greatest accepted Adapter Snapshot revision and changes only when
  Runtime accepts a newer authoritative Adapter Snapshot.
- `observation_revision` is Runtime-owned, starts at one when a Task is published and increases
  once for every externally visible lifecycle transition, regardless of its source.

All post-publication lifecycle changes use one repository transition primitive. The primitive
locks the Task row, rejects an irreversible terminal transition, applies optional expected-row
version and Adapter-revision guards, increments `observation_revision` and Task version, writes
the full observation, and writes a stable-key outbox event before committing. A duplicate
event key is a no-op that returns the already committed Task. Operational command-sequence
allocation may update its private counter separately because that counter is not a visible
Task lifecycle state; its accompanying visible request transition still uses the primitive.

Observations persist revision, type, occurrence time, reason, message, substate, progress,
source, optional Adapter revision and an extension payload. Adapter terminal Snapshots are
normalized to `task.completed`, `task.failed` or `task.cancelled`. Runtime business terminals
use the same stable terminal names with a reason code and result payload.

Every visible transition writes an outbox row. Its unique `event_key` is derived from stable
Task identity plus the transition identity (Adapter revision, command sequence, invocation
attempt or fixed terminal reason). The payload contains a stable Task reference and the current
state, MCP status, substate, status message, observation revision and Adapter revision, plus
transition-specific fields. Consumers can detect duplicates and fetch the authoritative
DetailedTask; outbox delivery failure never prevents `tasks/get` from reading committed state.
rc.2 persists and exposes the outbox boundary but does not claim MCP task-notification
delivery support.

## Migration

Migration 009 is append-only. For rc.1 rows it initializes `observation_revision` from the
highest stored observation, classifies known Runtime-created observations, and records the old
revision as `adapter_revision` for historical Adapter Snapshot observations. Existing outbox
rows receive their immutable event UUID as a collision-free compatibility event key.

### rc.3 publisher lifecycle

Runtime now owns a bounded `OutboxPublisher` worker. The internal no-op sink acknowledges events
for deployments that intentionally need no external delivery; the webhook sink acknowledges only
after a successful HTTP response. Failed batches increment delivery attempts and remain pending.
TTL purge excludes every Task with unpublished Outbox rows, so publication completes before
physical deletion.

## Consequences

- Runtime events no longer pollute stale-Snapshot comparison.
- Task state, observation and event either all commit or all roll back.
- A consumer sees stable terminal event names and enough state to resolve DetailedTask.
- Historical classification is necessarily based on rc.1 event types; H8 verifies the exact
  migration-006 fixture and forward upgrade before release qualification.
