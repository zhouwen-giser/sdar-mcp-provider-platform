# PMS API Configuration and File-based Credentials

## Bootstrap environment variables

Set the following environment variables in deployment startup:

- `PMS_API_HOST` (optional, default `127.0.0.1`)
- `PMS_API_PORT` (optional, default `8090`)
- `PMS_API_RUNTIME_HEARTBEAT_TTL_MS` (optional, default `30000`, min `1000`, max `300000`)
- `PMS_API_MANAGEMENT_AUTH_MODE` (optional, default `file_credentials`): either
  `file_credentials` or `anonymous_intranet`
- `PMS_DATABASE_URL_FILE` (required): path to file containing database URL
- `PMS_MANAGEMENT_CREDENTIAL_FILE` (required in `file_credentials` mode): path to management
  credential descriptor
- `PMS_RUNTIME_CREDENTIAL_FILE` (required): path to runtime credential descriptor

`anonymous_intranet` is a deployment-only opt-in for an isolated trusted network. It is accepted
only when `ALLOW_INSECURE_INTERNAL_TRANSPORT=true` is also set exactly; it does not read or require
`PMS_MANAGEMENT_CREDENTIAL_FILE`. Runtime Config and Runtime Registration credentials remain
mandatory and their authorization checks are unchanged. Any missing or invalid management-auth
mode fails closed; omitting the mode always retains file-backed management authentication.

The bootstrap process refuses inline secrets in environment variables:

- `PMS_DATABASE_URL`
- `DATABASE_URL`
- `PMS_ADMIN_TOKEN`
- `PMS_MANAGEMENT_TOKEN`
- `PMS_RUNTIME_TOKEN`
- `PMS_RUNTIME_CONFIG_TOKEN`
- `PMS_RUNTIME_REGISTRATION_TOKEN`

When these are present, startup fails with `PMS_API_INLINE_SECRET_REJECTED`.

## Credential file requirements

All credential files and referenced token files must meet strict file constraints:

- absolute paths only (relative paths are rejected)
- regular file (directories or symlinks are rejected)
- non-empty content
- token file permissions must be no more permissive than `0600`
- parent directory permissions must not grant group/other write (`022` bit cleared)

All checks are platform aware; Unix-only permission checks are skipped when running on non-Unix.

## Descriptor format

`PMS_MANAGEMENT_CREDENTIAL_FILE` expects:

```json
{
  "management": {
    "reader": [{ "subjectId": "reader-1", "tokenFile": "/abs/path/to/reader.token" }],
    "administrator": [{ "subjectId": "admin-1", "tokenFile": "/abs/path/to/admin.token" }]
  }
}
```

`PMS_RUNTIME_CREDENTIAL_FILE` expects:

```json
{
  "runtimeConfig": [
    {
      "subjectId": "identity-1",
      "providerId": "provider-a",
      "deploymentId": "deployment-1",
      "instanceId": "instance-1",
      "environment": "production",
      "runtimeVersion": "2.0.0",
      "protocolVersion": "2026-07-28",
      "scopes": ["runtime:config:read", "runtime:config:watch", "runtime:config:ack"],
      "tokenFile": "/abs/path/to/runtime-config.token"
    }
  ],
  "runtimeRegistration": [
    {
      "subjectId": "identity-1",
      "providerId": "provider-a",
      "deploymentId": "deployment-1",
      "instanceId": "instance-1",
      "runtimeVersion": "2.0.0",
      "protocolVersion": "2026-07-28",
      "scopes": ["runtime:register", "runtime:heartbeat"],
      "tokenFile": "/abs/path/to/runtime-registration.token"
    }
  ]
}
```

## Security notes

- Descriptor files must not contain inline `token` fields.
- Tokens and sensitive file contents are not logged in error messages.
- Runtime auth binding includes `providerId`, `deploymentId`, `instanceId`, `runtimeVersion`, `protocolVersion`, and scope checks.
- Management routes under:
  - `/api/v1/runtime-config/*`
  - `/api/v1/runtime-registration/*`
    are excluded from management-authorizer protection and are protected by runtime-specific authorizers.
- `anonymous_intranet` removes authentication from all management API reads and writes. Mutating
  routes still require `X-Actor-ID` for audit attribution. Do not enable this mode on a routable or
  untrusted network. The generated OpenAPI document marks management operations with `security: []`
  and `x-sdar-access-mode: anonymous_intranet`; Runtime Config and Runtime Registration operations
  retain their scoped bearer requirements.

## Production composition

`apps/pms-api/src/main.ts` loads this bootstrap configuration and delegates all
production assembly to `createPmsApiComposition`. The composition owns the
PostgreSQL Pool, applies the PMS migration set, and wires the Provider,
Configuration, RuntimeDeployment, RuntimeProcess, RuntimeRegistration,
Registry, Audit, readiness, and file-backed authorization services.

On `SIGINT` or `SIGTERM`, the API stops accepting HTTP connections, closes
Runtime Config watch subscriptions, closes Fastify, then closes the PostgreSQL
Pool. Do not construct repositories or substitute deny authorizers in the
production entry point.
