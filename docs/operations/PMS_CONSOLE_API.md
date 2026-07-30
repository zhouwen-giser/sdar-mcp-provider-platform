# PMS Console API V1

## Scope

`/api/console/v1` is a transport adapter over the existing PMS Application and Query services.
The frozen contract at `contracts/pms-console-api/v1` is the sole interface authority. The
implementation registers exactly its 36 operations and no additional Console routes.

The Console API does not replace or redirect `/api/v1`, Runtime Config, Runtime Registration, or
health routes. It does not implement authentication, RBAC, login, direct PM2 control, Runtime
process log access, Registry publication, or any other deferred surface.

## Registration

Production composition supplies all required dependencies and `createPmsApi` then registers the
Console plugin. For isolated tests, supply these existing ports:

- `ProviderPackageQueryService`
- `ProviderManagementService`
- `ConfigurationCenter`
- `ConfigurationPublicationService`
- `RuntimeDeploymentManagementPort`
- `RuntimeProcessQueryService`
- `RegistrySnapshotRepository`
- `AuditRepository.list`

If the dependency set is incomplete, the Console plugin is not registered. Existing partial
`createPmsApi` test compositions therefore retain their prior behavior.

## Request context

Every request accepts `X-Correlation-ID` exactly as frozen. When it is omitted, the existing PMS
request-context hook generates a correlation identifier and returns it in the response header.

Every mutating request requires `X-Actor-ID`. This value is passed only as existing audit metadata;
it is not an authenticated identity or authorization credential.

## Validation

The request and response schemas are loaded from
`packages/pms-console-api-contract/schema/openapi.bundle.json`. Component references receive stable
runtime schema IDs before Fastify registration. Each operation uses the frozen:

- path, query, header, and JSON body constraints;
- required fields, enums, ranges, formats, and `additionalProperties` policy;
- success response status and response schema;
- default `ProblemDetails` response.

`scripts/pms-console-conformance/check-route-inventory.mjs` compares the frozen OpenAPI operations
with the checked-in runtime registration inventory. It fails on missing, extra, duplicate, Method,
Path, operationId, or handler mappings.

## Error behavior

Console errors use `application/problem+json` and the 32 frozen problem codes. The mapper covers
Fastify request failures and existing domain, repository, configuration, RuntimeDeployment, and
RuntimeProcess errors. Unexpected failures are redacted as `INTERNAL_ERROR`.

Legacy routes continue using the existing `{ "error": ... }` envelope.

## Response projection

Response mappers expose only frozen transport fields. They convert `Date` values to RFC 3339
strings, copy readonly arrays to JSON arrays, omit absent optional fields, preserve `SecretRef`,
and reject non-JSON values such as `BigInt`, `Map`, `Set`, or `Error`.

RuntimeDeployment commands return `202 Accepted`. Stop projections preserve
`desiredState = "stopped"`. Registry latest supports `If-None-Match`, `ETag`, and `304`.

## Verification

Without package dependencies:

```bash
node scripts/pms-console-conformance/validate-all.mjs
git diff --check
```

With local dependencies and the frozen Bundle restored:

```bash
pnpm pms-console-contract:check
pnpm pms-console-conformance:check
pnpm --filter @sdar/pms-api test
pnpm --filter @sdar/pms-api typecheck
pnpm --filter @sdar/pms-api lint
pnpm --filter @sdar/pms-api build
```

