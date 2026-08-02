# Deferred Surfaces

The following surfaces are deliberately outside PMS Console API Contract V1.0. They are not implied by the reviewed SMPP business objects.

## Authentication and identity (explicitly deferred)

- Login and logout
- OIDC/OAuth
- Bearer token processing
- Session and refresh token management
- RBAC and permission APIs
- User, role and service-account management

V1 uses `X-Actor-ID` only as required audit metadata for mutating requests. It is not an authentication credential. Requiring authentication later is a separate contract decision.

## Runtime process logs

The standalone Console operation for Runtime process log references is deferred. Existing Runtime process projections may contain an opaque `logReference`, but V1 does not guarantee that its `tailEndpoint` is dereferenceable.

## Contract deferred

- Dashboard aggregate API
- Attention Center
- Notification
- Global Search
- Generic Operation
- Incident
- Incident Rule
- Change Request
- Approval
- Change Calendar
- Conformance Run management
- MCP Explorer history
- User management
- Role management
- Service Account management
- Access Review
- System Setting management
- Secret management/value access
- Runtime Release management
- Database Profile management writes
- Catalog history/edit/rediscover command
- Worker Job management and requeue
- Audit detail by id
- Runtime configuration ACK management query

## Forbidden

- Provider onboarding one-shot transaction
- Provider preflight business command
- Arbitrary Provider PATCH
- RuntimeProcess direct control
- PM2 direct control
- Catalog manual edit or block/unblock
- Registry manual edit or manual publish
- Environment entity/lifecycle management
- Generic Operation table/state machine/worker
- Incident or Change Request domain invented for Console
- Secret plaintext or credential-bearing database URL
- Worker Job mark-success/fence/lease/payload mutation
