# PMS Console API V1 Resource Model

The Console contract is a transport projection of existing SMPP objects and application capabilities. It does not introduce a Console domain.

## Scope

- Provider Package: read-only public projection.
- Provider Type: read-only in V1.
- Provider: list, get, create, and existing status transition.
- Resource: list, get, create, existing status transition, and Provider binding.
- Configuration: existing Draft, validation, effective preview, publication and rollback models.
- RuntimeDeployment: existing create, query, start, stop, restart, scale and reconcile commands.
- RuntimeProcess: read-only projection; direct control is forbidden.
- Registry: latest, history and diff; manual publication/editing is forbidden.
- Audit: read-only list projection.

## Audit context without authentication

Authentication and login are not part of V1. `X-Actor-ID` is required on mutating requests because current application commands require an audit actor. The value is audit metadata, not an authenticated identity. `X-Correlation-ID` is optional and may be server-generated when omitted.

## Configuration model

Configuration responses preserve the existing object shapes: `ConfigurationDraft`, `EffectiveConfigurationPreview`, `ConfigurationPublicationResult`, and `ConfigRevision`. Rollback creates a new revision and uses the existing `configuration.rolled_back` audit action.

## Runtime process log reference

`RuntimeProcess.logReference` is an opaque projection field. The Console contract does not expose a standalone log endpoint and does not promise that `tailEndpoint` is reachable.
