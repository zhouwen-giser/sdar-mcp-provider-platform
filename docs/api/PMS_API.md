# PMS API v1

The authoritative machine-readable contract is served at `GET /api/v1/openapi.json`.

## Authentication boundaries

- Health, API discovery, and the OpenAPI document are public.
- Provider Package, Provider Type, Provider, Resource, binding, and Config Draft reads require a
  management principal with `reader` or `administrator`.
- Management writes require `administrator`; `x-actor-id` must exactly match the authenticated
  subject so Audit attribution cannot be spoofed.
- Runtime Config latest, watch, and Ack use the separate `RuntimeConfigClientAuthorizer` port.
  Management credentials are not Runtime credentials and Runtime credentials are not accepted by
  management routes.
- Production bootstrap installs deny-all authorizers until deployment wiring supplies the
  corresponding credential verifiers. There is no anonymous fallback.

The OpenAPI document exposes distinct `managementToken` and `runtimeConfigToken` bearer schemes.
Management operations also carry `x-sdar-required-role`.

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
