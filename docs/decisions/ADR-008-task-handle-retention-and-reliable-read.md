# ADR-008: Task handle retention and reliable reads

Status: accepted

Date: 2026-07-17

## Context

rc.1 persisted the requested `ttl_ms` but did not execute a retention lifecycle. It could neither
distinguish a handle expiry from an execution deadline nor preserve terminal results and later
remove their dependent records safely. `tasks/get` also treated a temporary Adapter transport
failure as a failed read even though PostgreSQL retained a valid last-confirmed Task.

## Decision

TTL is exclusively a Task-handle retention period. A finite active Task has a renewable
`handle_expires_at`, but no active state can become logically expired or physically purged.
Every accepted lifecycle transition extends the active handle, and the cleaner protects an idle
active Task whose window has elapsed. On the first terminal transition, Runtime fixes
`terminal_at` and a new expiry at `terminal_at + ttl`. The Manifest default applies when the
client omits TTL, and a terminal Task whose stored TTL is still null uses a 24-hour fallback.

Expiry and purge are separate. PostgreSQL time evaluates the authoritative terminal due time, so
the handle is invalid even if a cleaner tick is delayed and Runtime host clock skew cannot extend
or shorten retention. The cleaner persists `expired_at`, emits an idempotent
`task.expired` Outbox audit event, and sets `purge_after`. Only a later purge stage deletes data.
The production grace defaults to 24 hours so the expiry event can be delivered and operators can
inspect the marker.

Each cleaner stage selects a bounded ordered batch with `FOR UPDATE SKIP LOCKED` and completes in
one short PostgreSQL transaction. This permits multiple Runtime replicas without a process-local
leader. Purge first deletes the idempotency reference and Task-owned Outbox/admission rows, then
deletes `provider_task`; Observation, Input and Command rows use existing `ON DELETE CASCADE`.
Operation Snapshots are immutable shared history and are not purged with a Task.

An authorized request for an expired handle raises typed `TaskExpiredError`, mapped at the locked
MCP SDK boundary to Invalid Params with `reasonCode=TASK_EXPIRED`. Authorization is checked first,
so another tenant cannot distinguish expired from unknown.

`tasks/get` reads PostgreSQL before attempting an Adapter refresh. Only gRPC transport/resource
transient statuses fall back to the persisted Task, marked with stale freshness, last confirmed
time and a stable degraded reason. A background Reconcile is scheduled; its Adapter RPC is
read-only with respect to the resource, while any confirmed Runtime Snapshot transition still
uses the normal identity-validated recovery path. Its outcome is metered/traced. Identity,
revision and other contract errors remain hard failures and cannot be hidden by stale fallback.

## Consequences

- TTL can no longer stop an execution or delete active work.
- Terminal results remain available for the promised retention window.
- Physical cleanup is bounded, replica-safe and explicit about every dependent table.
- Adapter outages preserve read availability without misrepresenting freshness.
- H8 must still prove migration 011 from a real rc.1 migration-006 data fixture.
