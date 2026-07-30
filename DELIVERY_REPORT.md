# PMS Console API Contract V1.0 Frozen Delivery

## Outcome

Final status is `FROZEN`. Candidate 3 is the authoritative PMS Console API Contract V1.0.

Candidate 2 was reconciled against the local SMPP source. The frozen contract retains 36 operations, adds no unsupported surface, restores the existing Registry `If-None-Match`/`ETag`/`304` behavior, and copies `RuntimeDeploymentDesiredState` exactly by restoring `stopped`.

Local source, semantic assertions, Redocly validation, deterministic bundling, generated TypeScript, generated JSON Schemas, example validation, breaking detection, typecheck, build, protected-business equality, remote currency and protocol/migration non-impact passed.

The repository owner explicitly approved the six pre-existing scope findings and their associated root lint/format findings as non-protocol freeze exceptions. The exact, narrow approval is recorded in `contracts/pms-console-api/v1/FREEZE_EXCEPTIONS.json`; it does not waive any protocol, source, generated-artifact, business-impact or remote-currency gate.

The authoritative lock is `contracts/pms-console-api/v1/contract-lock.json`. The Frozen ZIP and checksum are under `reports/pms-console-api-contract-v1/delivery/`.

## Goal 07 — PMS API Console V1 Conformance

The existing `pms-api` now registers all 36 frozen operations under `/api/console/v1` when the
production dependency set is present. The implementation is a transport adapter over existing
Application and Query services; it does not add domain objects, persistence behavior, migrations,
worker jobs, authentication, or PMS Web changes.

Implementation status is `complete`. Work validation status is `local_validation_required`
because repository `node_modules` are unavailable and dependency installation is prohibited.
Dependency-free lock, route-inventory, protected-path, JSON, syntax, Git whitespace, and delivery
integrity checks are executable in this package. See `LOCAL_VALIDATION_REQUIRED.md` for the
dependency-backed validation commands that remain to be run locally.
