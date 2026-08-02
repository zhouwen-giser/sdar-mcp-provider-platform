# PMS Console API Contract V1 Frozen Review

- Frozen from Candidate 3.
- Operations: 36.
- Component schemas: 28.
- Validated examples: 15, mapped across all 36 operations.
- Problem codes: 32.
- Authentication scope: deferred.
- Local source conformance: passed.
- Protected business manifests: byte-identical.
- Migration and protocol impact: none.
- Remote ancestry and currency: passed.
- Freeze status: frozen with explicit non-protocol repository exceptions.

Candidate 3 remediates two local-source mismatches in Candidate 2: Registry conditional reads expose `If-None-Match`, `ETag` and `304`, and RuntimeDeployment desired state includes local enum value `stopped`.

Generic Operation, Incident, Change Request, Dashboard aggregate, manual Catalog editing, manual Registry publication, Worker Job management, standalone Runtime logs and auth/RBAC remain excluded.
