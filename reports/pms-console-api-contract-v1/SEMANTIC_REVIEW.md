# Semantic Review

All non-negotiable semantic assertions pass against local source.

- 36 operations are present; no unsupported operation was added.
- `ConfigurationDraft`, validation response, effective preview map, publication result and concurrency inputs match local symbols.
- Publish and rollback return `{ outcome, revision }`; rollback audit action is `configuration.rolled_back`.
- RuntimeDeployment not-found, prerequisite, replicas and revision-conflict status mappings are 404, 409, 400 and 409 respectively.
- `ProblemDetails` contains no `retryable`.
- Registry latest preserves optional `If-None-Match`, response `ETag`, `Cache-Control` and `304`.
- All reviewed enums equal their local source declarations; no generic `EntityStatus` exists.
- No standalone Runtime log operation, auth/RBAC surface, Generic Operation, Incident, Change Request, Dashboard aggregate, manual Catalog/Registry publication or Worker Job API exists.

Candidate 2 required two contract-only corrections: Registry conditional-read metadata and local RuntimeDeployment desired-state value `stopped`.
