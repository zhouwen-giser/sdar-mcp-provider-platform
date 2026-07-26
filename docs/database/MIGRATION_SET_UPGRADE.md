# Migration set upgrade

This guide upgrades a delivered installation from the single `migrations/`
layout to owner-scoped Migration sets. The SQL bytes and the full-filename
version identifiers are unchanged. The authoritative path mapping and SHA-256
values are recorded in `migrations/migration-source-map.json`.

## Resulting ownership

| Set                 | Authority database        | Directory                        | Entrypoint                                           |
| ------------------- | ------------------------- | -------------------------------- | ---------------------------------------------------- |
| `runtime`           | Runtime Task Authority    | `migrations/runtime/`            | `dist/apps/runtime/src/migrate.js`                   |
| `provider:ugv`      | UGV Provider Adapter      | `migrations/providers/ugv/`      | `dist/apps/ugv-provider-adapter/src/migrate.js`      |
| `provider:npc-tank` | NPC Tank Provider Adapter | `migrations/providers/npc-tank/` | `dist/apps/npc-tank-provider-adapter/src/migrate.js` |

PMS owns a separate, initially empty `migrations/pms/` namespace. It must not
apply or inspect Runtime or Provider business migrations.

Runtime no longer discovers SQL immediately under `migrations/`. Its default
Runner resolves only the `runtime` set. Each Provider entrypoint has its set
compiled into the entrypoint and exposes no set selector. Unknown set names,
directory escape, symlinks, and unapproved duplicate numeric prefixes fail
closed in the shared resolver.

The only directory-based compatibility API is an explicit argument used by
forward-upgrade tests to apply a deliberately constructed legacy subset. It is
not used by Runtime startup or any production migration entrypoint, does not
recurse, and has no implicit `migrations/` default.

## Pre-upgrade checks

1. Stop Runtime and Adapter writers and take restorable backups of every
   affected PostgreSQL database.
2. Record the deployed application commit and image digest.
3. Verify that every current SQL file matches the `newPath` and `sha256` in
   `migrations/migration-source-map.json`. Do not repair a mismatch by editing
   an applied SQL file.
4. Inventory the legacy Runtime history:

   ```sql
   SELECT version, checksum, applied_at
   FROM runtime_schema_migration
   ORDER BY version;
   ```

5. Inventory Provider-owned data before copying it:

   ```sql
   SELECT table_name
   FROM information_schema.tables
   WHERE table_schema = current_schema()
     AND (table_name LIKE 'ugv\_%' ESCAPE '\'
       OR table_name LIKE 'npc\_tank\_%' ESCAPE '\')
   ORDER BY table_name;
   ```

The delivered legacy Runner may have applied `024_ugv_provider.sql` and
`025_npc_tank_provider.sql` to the Runtime database. Those history rows are
valid historical facts. The new Runtime Runner ignores them because it
enumerates only the 24 Runtime files; it does not delete or rewrite them.

## Upgrade procedure

1. Provision one Runtime Task Authority database shared by replicas of that
   logical Provider, plus independently scoped UGV and NPC Tank Adapter
   databases or schemas. Do not point the two logical Providers at the same
   unpartitioned Runtime Task tables.
2. Build the exact release artifact:

   ```bash
   pnpm build
   ```

3. Run the Runtime migration entrypoint against the Runtime authority database:

   ```bash
   node dist/apps/runtime/src/migrate.js
   ```

   Supply database credentials through the deployment's approved SecretRef or
   `*_FILE` mechanism. Never place a credential in this document, a command
   argument, PM2 Ecosystem data, a report, or Git.

4. In the supplier-managed UGV deployment, run:

   ```bash
   node dist/apps/ugv-provider-adapter/src/migrate.js
   ```

5. In the supplier-managed NPC Tank deployment, run:

   ```bash
   node dist/apps/npc-tank-provider-adapter/src/migrate.js
   ```

6. If Provider tables contain legacy production state, keep writers stopped
   and copy only the matching prefix from the legacy database to its new
   Provider database with approved DBA tooling:

   - `ugv_*` to the UGV database;
   - `npc_tank_*` to the NPC Tank database.

   Validate row counts, primary/foreign keys, and the most recent execution and
   event-source revisions before enabling either Adapter. The platform does not
   silently move business data.

7. Run the isolation gate against a non-production PostgreSQL target:

   ```bash
   pnpm test:migration-isolation
   ```

   The test environment must inject `TEST_DATABASE_URL` from its approved
   SecretRef without placing the value in the command or shell history.
   The gate creates three temporary schemas, applies each set twice, proves
   representative tables are present only under their owner, writes
   `reports/evidence/migration-isolation.json`, and removes the schemas.

8. Start one canary Runtime replica and each supplier-managed Adapter. Confirm
   Runtime readiness and Provider health before restoring normal traffic.

## Verification

For the Runtime database, `runtime_schema_migration` must contain the 24
delivered Runtime filenames on a fresh installation. A legacy database may
also retain historical 024/025 rows. In both cases, fresh Runtime application
must not create `ugv_*` or `npc_tank_*` tables.

The UGV database must contain `ugv_execution` and must not contain
`provider_task`, `runtime_schema_migration`, or `npc_tank_execution`. The NPC
Tank database must contain `npc_tank_execution` and must not contain
`provider_task`, `runtime_schema_migration`, or `ugv_execution`.

Re-running every entrypoint must complete without an error. The integration
gate is the repeatable proof of these invariants.

## Rollback

Migration SQL is append-only. Rollback means restoring the previous application
artifact and routing, not renaming, editing, reversing, or deleting an applied
Migration or its history row.

- Keep the old Runtime database and any legacy Provider tables through the
  verification window.
- To roll application code back, deploy the exact previous artifact that
  contains its matching root-layout files. Do not combine an old executable
  with the new filesystem layout.
- Stop new Provider writes before switching back. If data was copied, reconcile
  records written after the cutover before redirecting the old Adapter.
- Restore a database backup only under an approved incident procedure when a
  forward-compatible application rollback is insufficient.
- Do not copy Provider tables into a fresh Runtime database as a rollback
  shortcut.

After recovery, diagnose and correct the application or deployment issue, then
resume the forward upgrade. Never change the bytes of the delivered 001–025
Migration files.
