# Runtime database provisioning runbook

This runbook covers the Goal 2 P2 control-plane workflow that prepares one PostgreSQL Runtime
database for one logical Provider. It does not cover PMS database administration, Provider-owned
databases, or database backup automation.

## Authority and credential boundaries

The PMS control database, each Provider Runtime Task database, and any Provider Adapter database
are separate logical authorities.

- The provisioning identity is an installation-scoped PostgreSQL identity used only by the
  provisioning adapter. It may create the allowlisted Runtime role and database, but is never
  injected into a Runtime process.
- The Runtime identity is Provider-scoped. It is `NOSUPERUSER`, `NOCREATEDB`, and `NOCREATEROLE`.
  It receives `CONNECT` for its database and `USAGE, CREATE` for that database's `public` schema.
- The PMS application identity receives no Runtime Task database table or schema privileges.
- Secret values are supplied to adapters through SecretRefs or deployment-specific `*_FILE`
  paths. Do not put connection URLs, passwords, or secret contents in commands, PM2 ecosystem
  files, logs, audit metadata, evidence, or Git.

PostgreSQL commonly grants database `CONNECT` through `PUBLIC`. The enforced data boundary is
schema/table authority: another Runtime or PMS identity cannot read or create objects in the
Provider Runtime schema. Operators may additionally revoke public database connectivity as
cluster policy, but that policy is outside this workflow.

## Environment prerequisites

Before applying:

1. PostgreSQL is reachable from the provisioning worker and supports advisory locks.
2. A restricted provisioning credential is available through the deployment's secret mechanism.
3. The DatabaseProfile has distinct admin and Runtime SecretRefs, a supported SSL mode, and the
   stable Provider-derived database and Runtime role names.
4. The selected Runtime version is supported by the Runtime Migration Runner.
5. `migrations/runtime` is present and unchanged. PMS and Provider migration sets are not scanned.
6. The worker can persist Deployment status and preparation checkpoints before and after external
   calls.

`TEST_DATABASE_URL` is required only by the repository's controlled local/integration test
harness. It is not a production Runtime secret contract.

## Apply flow

The `runtime_deployment.reconcile` job uses the lease fencing token in its operation identity and
per-step idempotency keys. The application workflow is:

1. Move `REQUESTED` to `DATABASE_PROVISIONING`.
2. Ensure the Runtime credential referenced by the DatabaseProfile.
3. Create or confirm the restricted Runtime role.
4. Create or confirm the Provider Runtime database.
5. Grant and verify Runtime access.
6. Move to `MIGRATING`.
7. Run only the fixed Runtime migration set under an advisory lock and verify checksums.
8. Move to `CONFIG_PREPARING`.

The durable checkpoints are `runtime_secret`, `role`, `database`, `grant`, `verify`, and
`migration`. Each external call completes before its checkpoint is written. No network or
PostgreSQL provisioning call is held inside a PMS database transaction.

## Failure and recovery

A failed step maps to a stable, redacted error code, records the last checkpoint, writes a failure
audit event, and moves the Deployment to `FAILED` when the current state permits it. The underlying
exception text, SQL connection string, and secret material are not audit fields.

To recover:

1. Confirm the Deployment is `FAILED` and inspect the stable error code and completed checkpoint
   list.
2. Correct the external condition—for example reachability, credential authorization, advisory
   lock contention, or supported Runtime version.
3. Re-enqueue the same deployment reconciliation through the supported management action. Do not
   edit task state, checkpoints, or Deployment revisions directly.
4. The retry moves `FAILED` through `REQUESTED`, re-enters `DATABASE_PROVISIONING`, skips durable
   completed steps, and resumes at the first incomplete step.
5. Verify the Deployment reaches `CONFIG_PREPARING` before allowing later process-start work.

Migration failure deliberately preserves the database and applied migration history. Never recover
by deleting and recreating the database, modifying an applied migration, or running rollback SQL.
Checksum mismatch and unsupported Runtime version are non-retryable until the release/configuration
problem is corrected.

## Verification

From the repository root, with the test database URL supplied by a secure local environment:

```bash
pnpm test:db-provisioner
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm exec vitest run tests/database-provisioning-e2e
pnpm build
```

The E2E creates two temporary Provider databases, migrates both through their Runtime identities,
proves Runtime A cannot read Provider B's Runtime tables, proves PMS cannot read or create in a
Runtime database, checks that Runtime roles have no elevated role/database privileges, and removes
all temporary roles and databases. Its redacted result is
`reports/evidence/G2-P2-B08-database-isolation.json`.

These are controlled local PostgreSQL integration results. They are not evidence of a production
backup restore, external managed-database qualification, or system-level interoperability.

## Cleanup and deletion

Normal failure recovery never deletes a database or secret. Database deletion requires the exact
explicit Provider/database deletion policy and an operator reason. Secret cleanup independently
requires its exact deployment/instance/name policy. Stop clients and verify the selected Provider,
environment, database, and role before either action.

## Backup and non-goals

P2 does not implement backup, point-in-time recovery, cross-region replication, restore drills,
capacity planning, or managed-service credential rotation. Production operators must use the
database platform's backup and restore controls and should capture a recoverable backup before
release migration. A backup does not authorize migration rollback or mutation of shipped migration
files.
