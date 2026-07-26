# Phase R5 Implementation Report

- Start SHA: `b128f1b`
- Upstream main at start/pre-commit fetch: `7e501d07786a7695d205b0bc92b8fdbd667e7f96`
- Phase/end SHA: `28d35d9fc13755b5eb52d4211e7f7650478672c8`

R5 implements the P2 timing contract with an injected Clock and persistent anchors: acceptedAt, notBefore, latestStartAt, and nullable deadlineAt. MCP timing metadata is validated for capability agreement, integer bounds, and zoned RFC 3339 scheduling.

Scheduled tools/call creates the admission, Task, revision-zero scheduling observation, outbox event, and optional idempotency outcome before returning. It makes no Adapter call. DurableScheduler performs explicit ticks backed by PostgreSQL `FOR UPDATE SKIP LOCKED` claims, starts no earlier than notBefore, allows expired claims to be recovered by another instance, and publishes start-window-missed without an external side effect.

Deadline claims persist STOPPING/cancel intent before RequestCancel. The Ack does not create a terminal state; `tasks/get` requires a later Adapter CANCELLED Snapshot before mapping a deadline-stopped Task to completed/deadline_reached. Runtime drives the same database scheduler with a bounded, non-overlapping polling interval; correctness remains in PostgreSQL state and explicit ticks.

Exit decision: PASS. GitHub Actions run `29495711506` passed real PostgreSQL timing/concurrency integration, all quality/security gates, both Adapter image builds, and Compose readiness. R6 may proceed.
