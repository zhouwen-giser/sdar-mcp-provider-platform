# Phase P5 — PMS API and Configuration Center

Status: PASSED

## Delivered scope

- Fastify PMS API with liveness/readiness, versioned discovery, deterministic OpenAPI 3.1, safe
  request/correlation context, uniform error envelopes, and bounded JSON bodies.
- Stable controlled Provider Package projections plus Provider Type, Provider, Resource, and true
  Provider–Resource many-to-many management APIs with optimistic lifecycle updates and Audit.
- Shared-contract Configuration Draft create/update, inheritance, JSON Schema validation,
  immutable-field rejection, SecretRef-only storage, apply-mode calculation, and redacted preview.
- Transactional canonical-checksum Publish, same-content no-op, monotonic Rollback, optimistic
  concurrency, database-enforced immutable revision history, and append-only Audit.
- Independently authenticated Runtime Config Latest with instance-to-deployment fallback,
  checksum ETag/304, authoritative identity projection, and fail-closed SecretRef projection.
- SSE revision/checksum-only Watch hints, disconnect-to-Latest recovery, and structured,
  instance-scoped, idempotent Runtime Config Ack.

## Security boundary

Management authentication is a separate injected port from Runtime Config client authentication.
Reads require reader/administrator; writes require administrator and an actor header equal to the
authenticated subject. Production defaults deny both management and Runtime access until an
authorizer is configured.

Provider Adapter input is restricted to bounded `host:port` values; URL/user-info/path forms are
not accepted. The API does not fetch submitted endpoints. Request bodies are capped at 1 MiB.
Errors, SSE, Audit metadata, Ack details, and Runtime projections do not expose plaintext secrets.

## Acceptance evidence

| Area | Evidence |
| --- | --- |
| API foundation | Health/readiness, context headers, safe 4xx/5xx envelopes, OpenAPI |
| Management | Provider Type/Provider/Resource/N:N routes, lifecycle, Audit, optimistic tokens |
| Draft/validate | Business key, inheritance sources, schema, immutable rejection, SecretRef |
| Publish/rollback | Canonical checksum, concurrent writers, no-op, monotonic history, DB guard |
| Latest | Runtime auth, deployment fallback, ETag/304, identity and SecretRef projection |
| Watch/Ack | Hint-only SSE, Latest recovery, Ack statuses/idempotency/scope/invalid revision |
| API security | Reader/admin/runtime separation, actor binding, body limit, invalid JSON, endpoint shape |
| Full loop | HTTP update → validate → publish → latest/watch → Ack → rollback → latest |

Mandatory commands passed:

- `pnpm test:pms-config-e2e`: 1 file, 8 tests.
- `pnpm --filter @sdar/pms-api test`: 5 files, 31 tests.
- `pnpm build`.

The phase also passed TypeScript, ESLint, Prettier, frozen-lockfile, migration/persistence
regressions, and `git diff --check`.
