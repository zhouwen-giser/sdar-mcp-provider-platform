# Phase R9 Changed Files

- Runtime packaging: non-root Docker stage, durable Compose Adapter volume and
  `apps/runtime/src/migrate.ts`.
- `deploy/kubernetes`: Namespace, ServiceAccount, ConfigMap, secret shape,
  Deployment, Service, PodDisruptionBudget, NetworkPolicy and rollout guide.
- `tests/e2e/runtime-stack.test.ts`: official MCP client against initialized
  Runtime, Adapter and PostgreSQL.
- Release scripts: Kubernetes validation, CycloneDX generation/drift and capacity
  measurement; root `pnpm verify` and CI aggregation.
- Operations, configuration, upgrade, Adapter, API, state/reason and capacity
  documentation; README and CHANGELOG.
- `reports/sbom/runtime-v1.cdx.json` and Phase/final evidence documents.

Migration SQL and Proto IDL changes: none. Migration command/API and generated
SBOM are additive delivery surfaces.
