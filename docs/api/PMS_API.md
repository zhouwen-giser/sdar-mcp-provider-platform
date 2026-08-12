# PMS API v1

The authoritative machine-readable contract is served at `GET /api/v1/openapi.json`.

## Authentication boundaries

- Health, API discovery, and the OpenAPI document are public.
- With the default `PMS_API_MANAGEMENT_AUTH_MODE=file_credentials`, Provider Package, Provider
  Type, Provider, Resource, binding, Config Draft, Runtime Deployment, Runtime Process, Registry,
  and Audit reads require a management principal with `reader` or `administrator`.
- In that default mode, management writes require `administrator`; `x-actor-id` must exactly match
  the authenticated subject so Audit attribution cannot be spoofed.
- `PMS_API_MANAGEMENT_AUTH_MODE=anonymous_intranet` removes management authentication only when
  `ALLOW_INSECURE_INTERNAL_TRANSPORT=true` is also set. It is a deployment-only profile for an
  isolated network. Runtime Config and Runtime Registration authorization are not relaxed, and
  mutating management requests still require `x-actor-id` for audit attribution.
- Runtime Config latest, watch, and Ack use the separate `RuntimeConfigClientAuthorizer` port.
  Management credentials are not Runtime credentials and Runtime credentials are not accepted by
  management routes.
- Production bootstrap defaults to file-backed management credentials. Anonymous access is never
  inferred from a missing credential file; it requires both explicit settings above.

The OpenAPI document reflects the active access profile. In the default mode it exposes distinct
`managementToken`, `runtimeConfigToken`, and `runtimeRegistrationToken` bearer schemes, and
management operations carry `x-sdar-required-role`. In `anonymous_intranet` mode, management
operations instead declare `security: []` and `x-sdar-access-mode: anonymous_intranet`; the Runtime
Config and Runtime Registration bearer contracts remain unchanged.

## Input and output safety

- JSON bodies are limited to 1 MiB. Oversized and malformed bodies return stable envelopes without
  parser internals.
- Provider Adapter endpoints are opaque `host:port` values with bounded ports. URL schemes, user
  info, paths, and invalid ports are rejected, and the API performs no endpoint fetch.
- Configuration secret fields accept only `{ "secretRef": "..." }`. Latest returns SecretRef
  projections; it never resolves secret material. A legacy plaintext secret revision fails closed.
- Runtime identity in Latest is taken from the authenticated identity. Hierarchical/default
  `PROVIDER_ID`, deployment, and instance values cannot override it.

## Runtime Config flow

1. An administrator creates and validates a Draft.
2. Publish creates an immutable canonical-checksum revision; identical content is a no-op.
3. Runtime Latest returns the authorized Published Effective Config with `ETag: "<checksum>"`.
4. Matching `If-None-Match` returns an empty `304`.
5. Watch uses SSE and sends revision/checksum hints only. Reconnect recovery always uses Latest.
6. Ack accepts `applied`, `rejected`, `restart_required`, `stale`, and `unavailable`. Repeating an
   identical Ack is idempotent; a different Ack for the same instance/revision conflicts.
7. Rollback creates a new monotonic revision from an explicit historical revision.
