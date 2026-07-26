# SDAR Business Events Profile 1.0

Status: implementation contract. The normative requirements are frozen by
`SDAR_v1.2.2_Business_Events_Provider_Runtime_Requirements_V0.5.2.md` and its
SHA-256 lock. This profile does not modify the Frozen MCP Tasks Profile V1.0.

## Protocol identity

- Extension: `io.sdar/businessEvents`, profile version `1.0`
- Listen method: `io.sdar/businessEvents/listen`
- Event notification: `notifications/io.sdar/businessEvents`
- Ack notification: `notifications/io.sdar/businessEvents/acknowledged`
- Continuity notification: `notifications/io.sdar/businessEvents/continuity`
- Relation method: `io.sdar/businessEvents/relatedTasks/list`
- Transport: bounded POST SSE using MCP protocol `2026-07-28`
- Scopes: `task` and `resource`; `system` is not supported

## Reliability model

Adapter source facts are first committed to a PostgreSQL inbox. Mapping and
association then prepare facts for a per-source publication barrier. A
finalizer allocates a decimal runtime sequence in the current stream generation
and atomically publishes an immutable event. PostgreSQL is the only authority
for source cursors, leases, fencing, stream generations, events, relations and
projection tokens.

Each generation freezes its source roster and is `all_durable`, `mixed`, or
`best_effort_only`. Confirmed durable continuity loss and roster changes rotate
the runtime stream atomically. A closed generation remains
`replayable_closed` through `lastReplayableSequence`; clients drain it, receive
one committed continuity control, and reconnect to the new stream.

## Subscription contract

Every request declares the current profile capability in
`params._meta["io.modelcontextprotocol/clientCapabilities"].extensions`.
Listen accepts exactly one of a cursor or `latest`/`earliest_available`. The
first SSE message is always an acknowledgement. Replay tracks both the last
scanned and last delivered sequence so authorization-filtered events cannot
stall or repeat scans. Closing the SSE connection is the only cancellation
mechanism.

## Authorization and relations

Subscriptions snapshot authorization scope hash, execution mode and simulation
identity. Task events are visible only when the mapped task matches that
snapshot. Resource events are sent only when at least one candidate relation is
visible. The wire preview contains at most 256 sorted task IDs.

Overflow pagination uses a random opaque token whose hash and immutable
projection are stored in PostgreSQL. Page position is supplied by
`afterTaskId`; the server never mutates a page cursor, so identical token,
`afterTaskId`, and limit inputs return identical pages on every replica.

## Canonical identities

Runtime event IDs are unpadded base64url SHA-256 over the NUL-separated UTF-8
tuple `(providerId, sourceId, sourceStreamId, sourceEventId)`. Source and stored
event hashes use RFC 8785 JSON canonicalization and the `sha256:<hex>` wire
form. Source and runtime sequences are PostgreSQL bigint values and decimal
strings on the MCP wire; JavaScript Number conversion is forbidden.

## Frozen schemas

- `protocol/sdar-business-events-v1.schema.json`
- `protocol/sdar-business-events-continuity-v1.schema.json`
- `protocol/sdar-business-events-relation-v1.schema.json`

The requirements document remains authoritative where this concise profile is
silent.
