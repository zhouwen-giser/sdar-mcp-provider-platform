# H7 Changed Files

## Runtime, persistence and protocol

- `apps/runtime/src/config.ts`, `runtime.ts`, `rate-limiter.ts`
- `packages/persistence-postgres/src/idempotency.ts`
- `packages/mcp-protocol/src/handler.ts`
- `migrations/012_idempotency_claim_lease.sql`

## Image, evidence and automation

- `Dockerfile`, `package.json`
- `scripts/check-runtime-image.mjs`, `generate-sbom.mjs`, `run-conformance.mjs`
- `reports/image/runtime-v1-rc2.json`
- refreshed capacity and TypeScript/Python conformance reports

## Tests and documentation

- H7 unit, PostgreSQL upgrade/pool and E2E tests
- ADR-010 and operations/database/protocol documentation
- execution plan, traceability matrix and `reports/runtime-v1-rc2/phase-H7/*`
