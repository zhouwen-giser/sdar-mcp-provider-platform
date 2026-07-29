# SDAR MCP Provider Platform V0.1 operations

The private platform release identity is `sdar-mcp-provider-platform@0.1.0`.
The managed Runtime component has its own lifecycle and remains
`@sdar/runtime@2.0.0-rc.1`.

## Authority boundaries

PMS is the control plane for Provider, configuration, deployment, Catalog,
Registry, and audit data. It must not query or mutate Runtime Task, Command,
Scheduler, Recovery, Notification, or Outbox business tables. Runtime remains
the Task Authority and MCP data plane and must be able to cold-start without
PMS. Provider Adapters own device connectivity and side effects;
`vendor_managed` is the production default.

Operation Catalog authority is exclusively the Runtime response to
`server/discover` plus `tools/list`. PMS stores projections and Registry
snapshots; neither is allowed to invent operations.

## Deployment order

1. Build or pull the immutable `sdar/pms-api:0.1.0-rc`,
   `sdar/pms-worker:0.1.0-rc`, and `sdar/pms-web:0.1.0-rc` images. Verify their
   OCI revision label matches the qualified commit; never deploy a `latest` tag.
2. Back up the PMS database and each affected Provider Runtime database using
   the database platform's supported controls.
3. Deploy the PMS API and Worker with `PMS_DATABASE_URL_FILE`. Apply only the
   PMS migration set.
4. Register Provider Packages and Providers, create separated DatabaseProfile
   SecretRefs, and publish a valid configuration revision.
5. Reconcile RuntimeDeployment. The worker provisions or verifies the
   Provider-scoped database and role, runs the fixed Runtime migration set once
   under its lock, prepares secret files, and then invokes the PM2 adapter.
6. Verify PM2 reports the allowlisted process online, then independently verify
   `/health/live` and `/health/ready`. Only both health checks and a matching
   observed revision permit `ACTIVE`.
7. Verify Runtime registration identity and synchronize Catalog and Registry.
   A content-identical snapshot must remain a no-op revision.
8. Deploy PMS Web with `PMS_WEB_API_BASE`, then inspect its Runtime, Catalog,
   Registry, and Audit views. Audit output
   is metadata-free and must contain no connection strings or secret values.

PM2 accepts only the platform Runtime entrypoint, controlled working directory,
stable process name, fork mode, and allowlisted environment. It is not a
general script or command runner.

## Secrets

Supply credentials only through SecretRef resolution or absolute `*_FILE`
paths. Never place values in Git, command arguments, reports, audit metadata,
logs, or PM2 ecosystem files. Runtime receives its Provider-scoped database
credential, never the provisioning identity or PMS database credential.

## Health and reconciliation

`online` means only that PM2 has a process. `live` proves the Runtime process is
responding; `ready` proves its dependencies and authoritative state are ready.
Reconciliation is revision-fenced and converges desired versus observed state.
Do not edit revisions or job leases directly.

If PMS is unavailable, already-running Runtime processes continue from local
configuration and Runtime persistence. Restore PMS and allow reconciliation to
resume. For a Runtime crash, PM2 may restart the process, but the deployment is
not `ACTIVE` until live and ready checks recover.

## Failure recovery

- Database preparation: correct the stable redacted error, then retry the
  deployment. Completed durable checkpoints are reused.
- Migration: preserve the database, applied history, checksums, and failure
  evidence. Never modify or delete a shipped migration.
- PM2: confirm the process belongs to the platform namespace and entrypoint
  allowlist. Never manage unrelated PM2 processes.
- Identity mismatch: quarantine the observation and correct deployment,
  instance, Provider, and Runtime identity before retrying registration.
- Catalog/Registry drift: query Runtime discovery directly, then resynchronize;
  do not patch Catalog rows to manufacture agreement.

Use `docs/operations/DATABASE_PROVISIONING_RUNBOOK.md`,
`docs/operations/PMS_WORKER.md`, `docs/operations/PMS_WEB.md`, and
`docs/operations/configuration.md` for component detail. A single-host example
is provided at `deploy/pms/compose.yaml`; its secret and Runtime release bind
mounts must be provisioned before startup.

## Verification

From the repository root with a disposable local PostgreSQL URL supplied by the
environment:

```bash
TEST_DATABASE_URL=<local-postgres> pnpm verify:platform
TEST_DATABASE_URL=<local-postgres> pnpm test:pms-api-production
TEST_DATABASE_URL=<local-postgres> pnpm test:worker-pm2-production
pnpm --filter @sdar/pms-web test
pnpm --filter @sdar/pms-web build
node scripts/verify-release-images.mjs
```

The gate starts controlled local processes and a real isolated PM2 daemon. It
does not contact or certify external devices.
