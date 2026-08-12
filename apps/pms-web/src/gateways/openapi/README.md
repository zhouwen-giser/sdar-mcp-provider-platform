# Console V1 HTTP Gateway

`http-gateways.ts` implements the complete frozen Console V1 Gateway Bundle over the same-origin
`/api/console/v1` boundary. The adapter uses the generated DTOs, preserves opaque pagination
cursors, maps `application/problem+json` into `GatewayProblem`, and never adds authentication
semantics that are absent from the frozen contract.

Mock mode remains a separate explicit development path. Production mode fails closed when its data
mode or same-origin Console base is missing or invalid; it never falls back to Mock data.
