# Adapter Protocol v1

The normative IDL is `proto/io/sdar/mcp/tasks/adapter/v1/adapter.proto`. JavaScript and TypeScript bindings are regenerated with `pnpm proto:generate`; `pnpm proto:check` fails when committed bindings drift.

## RPC surface

Mandatory RPCs are DescribeProvider, CheckAvailability, StartOperation, GetExecution, RequestCancel, and ReconcileExecution. UpdateExecution, PauseExecution, and ResumeExecution are conditional on operation capabilities. StreamExecutionEvents and ListResources are optional; neither events nor inventory replaces GetExecution/Reconcile as the recovery authority.

Every request carries protocol/provider/correlation metadata. Side-effect calls carry a stable task id, operation name, argument hash, authorization context hash, execution mode, and attempt or command sequence. StartOperation is idempotent by task id; an identity mismatch is a conflict. RequestCancel is acknowledgement-only.

rc.2 validates response identity on Start, Get, Reconcile and every control Ack. A cancel Ack only
closes the durable command attempt; it cannot publish `cancelled`, `deadline_reached` or
`start_window_missed` until a later Snapshot proves the authoritative resource state. Retryable,
permanent and transport rejection remain distinct dispatcher outcomes.

R4 exercises batched CheckAvailability and ReconcileExecution. Availability is predictive only and never authorizes or starts execution. Reconcile is a side-effect-free lookup by stable taskId, operation, canonical argument hash, and trusted execution context; `FOUND`, `NOT_FOUND`, transient unavailable, and conflict remain distinct outcomes.

## Execution publication

All operation kinds use StartOperation:

- `SYNCHRONOUS` requires an accepted terminal initial Snapshot; Runtime returns an ordinary Tool result and never creates an MCP Task.
- `TASK_CAPABLE` returns an ordinary result for a terminal initial Snapshot and creates a Task for a nonterminal Snapshot.
- `TASK_REQUIRED` always creates a persisted Task after acceptance, even if the initial Snapshot is terminal.
- A scheduled accepted call always creates a Task. Runtime invokes StartOperation no earlier than `scheduledAt`.

## Generation

The repository pins `grpc-tools` and the TypeScript protoc plugin. pnpm's dependency-build allowlist contains only the reviewed packages that require installation scripts. Global `protoc` is not required.

Python bindings are generated inside the Python Adapter image from the same IDL. `pnpm adapter:python:smoke` can perform a local cross-language DescribeProvider smoke when the host Python has pip; the container path remains the reproducible default.

`pnpm test:conformance` executes the same 17 protocol cases for TypeScript and Python, including
response loss, retry/reject, identity/sequence mismatch, multi-round input, safe-stop failure and
restart binding. This is Adapter protocol evidence, not real-resource safety certification.

## Development transport

The Compose example explicitly sets Adapter TLS to `disabled` for local-only
networking. Production sets `required` with CA/client certificate/private-key
files; startup validation never silently falls back to plaintext.
