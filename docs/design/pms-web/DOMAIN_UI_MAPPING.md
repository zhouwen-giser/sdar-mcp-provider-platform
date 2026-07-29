# Domain to UI mapping

This mapping borrows current PMS vocabulary for operator familiarity but does not bind the
prototype to API response shapes.

| Domain term | UI projection | Important fields |
| --- | --- | --- |
| Provider | Provider list/detail | providerId, type, hosting mode, status, environment |
| ProviderPackage | Package inventory | packageId, version, supported hosting modes |
| Resource | Resource list/detail | resourceId, providerId, kind, health, observed time |
| RuntimeDeployment | Deployment list/detail | deploymentId, desiredState, observedState, revision |
| RuntimeProcess | Process drawer | processId, status, pid-like mock ID, heartbeat, drift |
| ConfigurationDraft/Profile | Configuration workspace | profileId, revision, validation, apply mode |
| EffectiveConfiguration | Impact and diff | source layers, resolved keys, SecretRef metadata |
| Catalog operation | Catalog detail | operation name, input/output schema, compatibility |
| RegistrySnapshot | Registry history/diff | environment, revision, checksum, publication state |
| Job | Worker job drawer | jobId, kind, attempts, lease state, linked aggregate |
| Incident | Incident detail | severity, status, linked entities, recovery timeline |
| AuditEvent | Audit drawer | eventId, actor label, correlationId, subject, change summary |
| PrototypeOperation | Global operation panel | operationId, simulated label, steps, result |

## Status language

UI labels use Chinese descriptions with stable English codes beside them. Desired/Observed,
ACTIVE, DEGRADED, STALE, ACK and breaking-change classifications remain visible where they carry
technical meaning.

## Future data source boundary

`PmsWebDataSource` exposes UI-oriented read models and operation commands. A later implementation
may adapt real contracts behind that interface, but pages and components remain unaware of
transport, endpoints and credentials.
