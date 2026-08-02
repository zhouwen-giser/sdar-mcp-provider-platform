# PMS Console API Contract V1.0

**Status: Contract Frozen — V1.0, from Candidate 3**  
**Validation start HEAD:** `ecf72ef734362f6bd4831d9480c13f5f73c4f268`  
**Business merge base:** `8af9b76086eebc8b6e516cda4ca29068dc4d5ef7`  
**Contract version target:** `1.0.0`

This contract defines a transport adapter under `/api/console/v1`. It does not implement routes and does not change SMPP business behavior. Every candidate operation maps to an existing query or command in `ENDPOINT_SOURCE_MAP.json`; browser workflows remain Web-composed.

## Authentication scope

Authentication, authorization, RBAC, login and session management are explicitly deferred. No `securitySchemes` are frozen in V1. Mutating operations require `X-Actor-ID` solely to preserve the existing audit context, and may accept `X-Correlation-ID` for trace continuity.

## Freeze meaning

This contract is frozen. The repository owner explicitly accepted the recorded pre-existing, non-protocol scope/lint/format findings in `FREEZE_EXCEPTIONS.json`; all protocol, local-source, generated-artifact, remote-currency and business non-impact gates passed.

`Contract Frozen` will not mean PMS API conformant, PMS Web conformant, or Console E2E aligned.
