# Contract Review Checklist

## Candidate semantic gates

- Every OpenAPI operation has exact route and source evidence.
- Every write maps to one existing application command.
- Configuration Draft, Effective Preview, Publication Result and Config Revision match existing SMPP shapes.
- Rollback uses the existing `configuration.rolled_back` audit action.
- Business enums are exact copies or explicit existing projections.
- Error codes and HTTP statuses map to current PMS API semantics.
- No ungrounded retryability policy is present.
- Authentication, authorization, login, sessions and RBAC are explicitly deferred.
- `X-Actor-ID` is documented only as audit metadata.
- Generic Operation, Incident, Change Request and Environment management are absent.
- Registry and Catalog authority are unchanged.
- Secret values and credential-bearing URLs are absent.
- The standalone Runtime process log-reference operation is absent.
- Generated schemas, TypeScript types and examples are synchronized with OpenAPI.

## Freeze-only gates

- Exact Git baseline is checked out.
- Repository-local business baseline and final manifests are complete and identical.
- Repository typecheck, lint, format and build pass.
- Git diff contains only allowed contract paths.
- `contract-lock.json` is generated in that checkout and its hashes verify.
