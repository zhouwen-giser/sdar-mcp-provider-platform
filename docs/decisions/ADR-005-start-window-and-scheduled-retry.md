# ADR-005: Start-window enforcement and scheduled retry

Status: accepted

Date: 2026-07-16

## Context

The rc.1 scheduler applied start tolerance only to scheduled rows before the first call. It
marked every accepted scheduled Snapshot as actually started, terminalized retryable rejection,
and retried an expired `STARTING` claim without first proving whether the previous Adapter call
had created a resource side effect. Immediate queued executions had no durable watchdog.

## Decision

Runtime persists `acceptedAt`, `notBefore`, `latestStartAt`, `actualStartedAt`,
`startStopRequestedAt`, `invocationAttempt` and `nextStartAttemptAt`. `actualStartedAt` is set
only when a Snapshot explicitly establishes running or a later state that proves execution has
occurred; queued, accepted, scheduled and waiting-for-input states do not imply actual start.

A scheduled worker atomically changes `SCHEDULED` to `STARTING` and increments
`invocationAttempt` before releasing its database connection and calling StartOperation. A
retryable negative response has no side effect and returns the Task to `SCHEDULED` with bounded
exponential backoff plus stable per-Task jitter. A nonretryable response is the frozen
`admission_rejected` business terminal. Once `latestStartAt` is reached, no new attempt is
claimed and the Task becomes `start_window_missed` without an Adapter call.

A transport error is not treated as a rejection. The Task stays `STARTING`; after claim expiry,
a worker must Reconcile the same task id and argument hash. Only authoritative `NOT_FOUND`
permits another Start attempt. `FOUND` binds the execution without another side effect. Claim
owner checks prevent a late response from overwriting a newer reconciler.

Immediate nonterminal Tasks with no confirmed actual start are scanned durably at the start
window. If an external execution exists, Runtime first commits a high-priority
`START_WINDOW_MISSED` stop command. A late Start response follows the same compensation path in
the publication transaction. Only a later `CANCELLED` Snapshot publishes the completed
`start_window_missed` result; an Ack alone remains insufficient proof.

### rc.3 amendment

Migration 014 replaces the immediate-only stop scan with one `BoundExecutionWatchdog` for every
bound execution, regardless of immediate or scheduled origin. Once the confirmation deadline
passes, the worker claims `WAITING_START_CONFIRMATION`, renews the claim around Reconcile, and
uses the Adapter snapshot as authority. A snapshot at RUNNING or later records
`actualStartedAt`; a definitive not-started snapshot or `NOT_FOUND` enqueues the durable stop.
Transient reconciliation releases the claim with bounded backoff. Claim-owner checks and an
attempt counter make repeated or multi-replica watchdog ticks idempotent.

When optional SDAR timing metadata is absent, Runtime uses an immediate 30-second compatibility
window and no elapsed deadline. Explicit timing, including a zero tolerance, is preserved
exactly. This fallback prevents ordinary MCP clients that do not send the SDAR extension from
being classified as late merely because the Adapter RPC took nonzero time.

## Consequences

- Multiple Runtime instances can contend safely through `SKIP LOCKED` claims.
- Response loss cannot cause a second resource side effect without a definitive Reconcile
  `NOT_FOUND`.
- Adapter retries receive the same identity and a strictly increasing persisted attempt.
- Runtime-owned start/retry events are persisted now; H3 separates their revision sequence from
  Adapter revision and unifies every remaining transition through one transaction API.
