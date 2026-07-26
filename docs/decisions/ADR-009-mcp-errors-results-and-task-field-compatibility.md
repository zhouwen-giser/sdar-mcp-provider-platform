# ADR-009: MCP errors, result validation and Task field compatibility

Status: accepted

Date: 2026-07-17

## Context

rc.1 advertised each Adapter `outputSchema` but discarded its validator. Invalid synchronous,
inline and asynchronous success payloads could therefore cross the MCP boundary. Technical
failures were also able to appear as ordinary `CallToolResult` objects, and ad hoc `Error`
strings made JSON-RPC codes dependent on the path that threw them.

The locked `@modelcontextprotocol/sdk` 1.29.0 Task schema uses top-level `ttl` and
`pollInterval`. The SDAR Profile documents millisecond-suffixed names. Adding those aliases at
the top level is not compatible with the official strict Task schema. The SDK also prefixes a
local `McpError.message` for display and maps a nested TTL Zod failure to Internal Error unless
the Runtime accepts the value long enough to perform its own protocol mapping.

## Decision

The domain owns a typed Runtime error hierarchy. The MCP boundary is the only layer that maps
those errors to the locked SDK's typed `McpError` and JSON-RPC codes. Unknown tools, hidden or
expired Tasks, invalid timing/input/TTL and unsupported capabilities use Invalid Params with a
stable, non-sensitive `data.reasonCode`. A synchronous technical failure, or a task-capable
failure before Task publication, uses Internal Error. The boundary restores the intended wire
message after constructing `McpError`, preventing the SDK's local display prefix from being
serialized back to the client. Internal errors are logged through a correlation-aware callback.

An already published technical failure is a Task with `status=failed` and a stored error object
containing code, safe message, reason code and retryability. Business failure and partial
completion remain `status=completed` and their final Tool result has `isError=true`. A request or
Adapter acknowledgement is not terminal proof and this error mapping does not change the stop
state machine.

Operation Registry retains compiled Draft 2020-12 input and output validators and binds an
`outputSchemaVersion` to the immutable Manifest hash. Runtime validates the raw Adapter result
before publishing synchronous success, task-capable inline success, asynchronous success or a
partial completion. Result JSON is limited to 1 MiB, depth 32 and 10,000 nodes. An invalid
success/partial payload becomes `ADAPTER_OUTPUT_SCHEMA_MISMATCH`; it cannot be published as a
successful Tool result. The advertised Tool schema accepts either the raw success schema or the
standardized business-result envelope.

Official Task responses use only `ttl` and `pollInterval` at top level. Detailed SDAR responses
also expose `_meta["io.sdar/taskExecution"].ttlMs` and `pollIntervalMs`. No suffixed field is
added at top level. Official clients may parse the base Task schema; SDAR clients extend that
schema to retain Profile result/error and namespaced metadata. The Runtime validates TTL as a
safe integer from 1 through 31,536,000,000 milliseconds. A narrow extension of the official
CallTool request schema accepts malformed TTL values only so the centralized mapper can return
Invalid Params instead of the SDK's generic validation error.

## Consequences

- Adapter output contract defects become observable technical failures rather than false
  business success.
- Every H6 protocol class has a stable black-box code and reason, while server logs retain the
  correlation id and original error.
- Standard MCP clients receive schema-valid Tasks; SDAR clients keep compatibility aliases in
  namespaced metadata.
- `pollInterval` is a Runtime recommendation (currently the persisted 2,000 ms default), not a
  client-controlled scheduling or execution deadline.
- SDK upgrades must rerun T-031 through T-040 because `McpError` and experimental Task schemas
  remain upstream-owned APIs.
