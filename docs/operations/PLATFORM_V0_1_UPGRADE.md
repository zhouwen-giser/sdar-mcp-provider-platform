# SDAR MCP Provider Platform V0.1 upgrade and rollback

## Supported starting point

V0.1 upgrades the accepted Goal 1 platform foundation while preserving the
frozen Runtime protocol, existing Runtime migrations, workspace identities, and
Runtime entrypoints. Node.js 22 and pnpm 11 are the verified toolchain.

Before rollout, validate the Goal 1 handoff and ensure the production default
Provider Adapter mode is `vendor_managed`.

## Upgrade

1. Capture recoverable PMS and Runtime database backups.
2. Deploy application artifacts compatible with the existing frozen MCP
   profile and Adapter protocol.
3. Apply only additive PMS migrations to the PMS database.
4. Let RuntimeDeployment preparation select the existing mapped Runtime
   migration set. Do not copy PMS or Provider migrations into it.
5. Roll out one Provider deployment at a time. Verify desired/observed revision,
   live, ready, registration identity, Catalog, and Registry before continuing.
6. Run `TEST_DATABASE_URL=<local-postgres> pnpm verify:platform` in the release
   environment and retain its redacted evidence.

## Rollback

Database history is forward-only. Do not edit, remove, reorder, or reverse an
applied migration. Roll back application and routing artifacts to a previously
compatible build, keep the databases intact, and reconcile the desired Runtime
version. If a new schema is not backward compatible, halt and deliver a new
forward migration.

Stop or drain only explicitly selected platform Runtime deployments. PM2
cleanup must not affect unrelated processes. Secret rollback means selecting a
previous SecretRef or replacing an approved secret file; never copy a secret
value into configuration or PM2 metadata.

## Post-upgrade checks

- PMS API and Worker are ready against the PMS database.
- Running Runtime processes remain independent of PMS availability.
- PM2 online, `/health/live`, and `/health/ready` are all checked separately.
- Runtime identity matches deployment and instance identity.
- Catalog derives from Runtime discovery and unchanged Registry content does
  not create a revision.
- PMS Web exposes Provider, Configuration, Runtime, Catalog, Registry, and
  Audit without secret material.
