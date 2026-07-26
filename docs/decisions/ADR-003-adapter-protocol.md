# ADR-003: Versioned gRPC/Protobuf Adapter protocol

Status: accepted  
Date: 2026-07-16

## Context

Resource teams in different languages need one stable control contract without
implementing MCP Tasks. Runtime retries and crashes must not duplicate real
resource side effects.

## Decision

Define `io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter` in Protobuf and use
gRPC as the production Adapter transport. Mandatory RPCs are DescribeProvider,
CheckAvailability, StartOperation, GetExecution, RequestCancel and
ReconcileExecution; Update/Pause/Resume are conditional, and event streaming and
resource listing are optional. Complete Snapshots and Get/Reconcile remain the
correctness path even when events are enabled.

Every side-effect command carries stable task id, external execution id, operation name,
argument hash, execution context including authorization hash and mode, and an attempt or
command sequence. StartOperation is idempotent by task id and conflicts on any identity
mismatch. Request cancellation is acknowledgement-only.

Every ExecutionSnapshot echoes task id, external execution id, operation name,
argument hash and execution context. Every CommandAck echoes the complete
SideEffectIdentity as well as its top-level command sequence. Runtime rejects a
response if any echoed field differs from the persisted Task/Snapshot identity;
the request having contained the expected value is not considered response
proof. Reconcile also carries the known external execution id and cannot rebind
an existing Task.

All execution kinds call StartOperation. For synchronous operations the accepted
initial Snapshot must be terminal and the Runtime returns an ordinary Tool
result. A task-capable operation publishes a Task only for a nonterminal accepted
Snapshot. A task-required operation always publishes a persisted Task after
acceptance, even for a terminal initial Snapshot. Scheduled acceptance always
publishes a Task and Runtime does not call StartOperation before `scheduledAt`.

Runtime-to-Adapter mTLS is configurable and required outside explicitly marked
local development. Reference TypeScript and Python Adapters persist their
task/execution identity before simulating a resource side effect.

## Consequences

- Generated clients/servers are portable and protocol drift is detectable.
- Reference Adapters need their own small durable execution store; an in-memory
  map alone cannot demonstrate restart conformance.
- Proto comments and contract tests carry publication semantics that were only
  implicit in the Adapter design document.
