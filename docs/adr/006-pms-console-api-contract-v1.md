# ADR-006: PMS Console API Contract V1 Frozen Boundary

Status: Accepted and frozen from Candidate 3.

Validation start: `ecf72ef734362f6bd4831d9480c13f5f73c4f268`.

Business merge base: `8af9b76086eebc8b6e516cda4ca29068dc4d5ef7`.

## Decision

The Console API is a transport adapter over existing SMPP application/query ports. It does not become a business layer. Unsupported PMS Web surfaces remain Web-composed, deferred or forbidden. Concurrency, error, audit and lifecycle semantics remain object-specific.

Authentication, authorization, login, sessions and RBAC are excluded from V1. `X-Actor-ID` remains required audit metadata for writes; it is not authentication. No production route is implemented by this delivery.

The repository owner explicitly accepted the exact pre-existing, non-protocol scope/lint/format findings recorded in `FREEZE_EXCEPTIONS.json`. All contract, source, generated-artifact, breaking-change, protected-business and remote-currency gates passed.
