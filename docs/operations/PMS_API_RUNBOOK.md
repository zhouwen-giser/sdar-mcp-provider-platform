# PMS API Production Runbook

## Start-up

1. Place the database URL, credential descriptors, and each referenced token
   in separate regular files. Use absolute paths and restrictive permissions
   (`0600` for files; no group/other write permission on their parent
   directories).
2. Set `PMS_DATABASE_URL_FILE`, `PMS_MANAGEMENT_CREDENTIAL_FILE`, and
   `PMS_RUNTIME_CREDENTIAL_FILE`. Set `PMS_API_HOST`, `PMS_API_PORT`, and
   `PMS_API_RUNTIME_HEARTBEAT_TTL_MS` as required.
3. Start `apps/pms-api/src/main.ts`. It applies the PMS migration set before
   accepting traffic. Inline database URLs or tokens are intentionally refused.
4. Check `/health/live`, then `/health/ready`. Readiness verifies PostgreSQL.

## Credential scopes

- Management readers may use read-only management APIs; administrators are
  required for management writes.
- Runtime Config clients require exactly the route scope:
  `runtime:config:read`, `runtime:config:watch`, or `runtime:config:ack`.
- Runtime Registration clients require `runtime:register` or
  `runtime:heartbeat`, and are bound to their Provider, Deployment, Runtime
  Instance, Runtime Version, and protocol version.

Authentication failures are best-effort audited with request/correlation IDs,
target IDs, reason code, and optional source IP. Tokens, authorization headers,
credential paths, configuration bodies, and database URLs are never written to
Audit metadata.

## Shutdown and recovery

Send `SIGINT` or `SIGTERM` once. The production composition closes
idempotently: it stops HTTP acceptance, closes Runtime Config watches, closes
Fastify, and ends the PostgreSQL Pool. Runtime Registration and RuntimeProcess
projection state are durable; after a restart, a valid next heartbeat continues
from its persisted session, sequence, and revision.

When a registration appears stale, inspect `runtime_registration.expires_at`
through the RuntimeProcess query. Freshness is derived at query time; no
background task mutates registration state merely to mark it stale.

## Production acceptance gate

Run the gate against a local PostgreSQL service:

```sh
TEST_DATABASE_URL=<local-postgres> pnpm test:pms-api-production
```

The gate creates an isolated schema and temporary credential/token files,
exercises the real 001–009 migrations and production composition, and removes
its schema and credential files when complete.
