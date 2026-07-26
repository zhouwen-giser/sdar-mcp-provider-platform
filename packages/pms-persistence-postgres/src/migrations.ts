import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { resolveMigrationSet } from "../../database-migration-runner/src/index.js";

export async function runPmsMigrations(pool: Pool, workspaceRoot = process.cwd()): Promise<void> {
  const migrations = await resolveMigrationSet(workspaceRoot, "pms");
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('sdar_pms_migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS pms_schema_migration (
        version text PRIMARY KEY
          CHECK (version ~ '^[0-9]{3}_[a-z0-9]+(?:_[a-z0-9]+)*\\.sql$'),
        checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);
    for (const migration of migrations) {
      const sql = (await readFile(migration.absolutePath, "utf8")).replaceAll("\r\n", "\n");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query<{ checksum: string }>(
        "SELECT checksum FROM pms_schema_migration WHERE version=$1",
        [migration.filename],
      );
      if (existing.rows[0] !== undefined) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`PMS_MIGRATION_CHECKSUM_MISMATCH:${migration.filename}`);
        }
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO pms_schema_migration(version,checksum) VALUES ($1,$2)", [
          migration.filename,
          checksum,
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('sdar_pms_migrations'))");
    client.release();
  }
}
