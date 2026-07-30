# Candidate 2 Reconciliation

Reference ZIP SHA-256 `49a08389ffe0d593b323fbf1574efc2884446312ca6019d67cd8ffedff27ec6b` matched its sidecar checksum.

Candidate 2 was extracted under `/tmp` and only Scope Lock paths were merged. Standalone `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` and `tsconfig.json` were not copied. Contract scripts and pinned tooling were merged into the real root manifests through pnpm.

Local-source reconciliation produced Candidate 3 with these material divergences:

- Added Registry `If-None-Match`, `ETag`, `Cache-Control` and `304` because `apps/pms-api/src/registry-routes.ts` exposes them.
- Added `stopped` to `RuntimeDeployment.desiredState` because the local `RUNTIME_DEPLOYMENT_DESIRED_STATES` enum contains it.
- Replaced historical validation authority with the dynamic remote/start/merge-base SHAs.
- Expanded protected manifests to every Scope Lock business root and excluded Git-ignored install artifacts.
- Replaced re-export-only/weak checks with local file, blob and symbol verification for 36 operations, 28 schemas and 32 errors.
- Added Redocly 2.40.0, openapi-typescript 7.13.0, openapi-changes 0.2.7 and AJV 2020-12 gates.
- Added a dereferenced YAML artifact, standalone JSON Schemas, generated freshness and exact enum checks.
- Replaced Python jsonschema checks because the host module did not provide Draft 2020-12.

Authentication, login, authorization, sessions, OIDC/OAuth and RBAC remain deferred. Candidate 3 is frozen as the final authoritative V1 contract under the explicit non-protocol exception decision recorded in `FREEZE_EXCEPTIONS.json`.
