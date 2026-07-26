# ADR-011: Frozen task creation projection and Availability reservation mapping

Status: accepted

Date: 2026-07-22

## Context

The frozen MCP Tasks profile distinguishes the operational `Task` returned by task creation from
the status-specific `DetailedTask` returned by `tasks/get` and task notifications. The Runtime
used one mapper for all three projections and consequently exposed `inputRequests`, `result`, or
`error` in `CreateTaskResult`. Strict SDAR consumers reject those additional fields.

The frozen Availability result also requires an explicit `reservationMode` (`none`,
`best_effort`, or `guaranteed`). The Adapter protocol had no field for that value, so the Runtime
could not preserve an Adapter's reservation semantics and emitted a result that strict consumers
reject.

## Decision

`CreateTaskResult` contains only the operational Task fields plus `resultType: "task"`.
Status-specific payloads remain available through `tasks/get` and task notifications.

The Adapter protobuf gains additive fields 12 and 13 on `AvailabilityResult`: the
`ReservationMode` enum and optional `reservation_ref`. Every Adapter must set a non-unspecified
reservation mode. Runtime rejects an unspecified mode as an Adapter contract error; it does not
guess a reservation guarantee. Transport-failure fallback explicitly uses `none`.

The generated MCP Tasks and Availability schemas encode the same distinction: creation excludes
DetailedTask payloads, and every Availability result requires `reservationMode`. Existing field
numbers, released migrations, and task persistence remain unchanged.

The standard MCP `tools/list` result remains `{ tools, nextCursor? }`. The Frozen discriminator is
not added to that standard result; `resultType` is reserved for the frozen discovery, Tool execution,
Task, Availability, acknowledgement, and extension result unions that explicitly define it.

## Consequences

- Strict clients can parse every creation response without losing task status or identity.
- Strict official MCP clients can parse the Tool catalog without an extension-only result field.
- Reservation guarantees can cross the Adapter boundary without an implicit default.
- Existing custom Adapters must regenerate protobuf bindings and explicitly return a reservation
  mode; `NONE` is the correct value when no reservation is made.
- Regression tests and the full frozen protocol gate are required before publication.
