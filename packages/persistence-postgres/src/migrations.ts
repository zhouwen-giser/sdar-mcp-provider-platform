import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";

export async function runMigrations(
  pool: Pool,
  directory = resolve(process.cwd(), "migrations"),
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('sdar_runtime_migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS runtime_schema_migration (
        version text PRIMARY KEY,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);
    const files = (await readdir(directory)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
    for (const file of files) {
      const sql = await readFile(resolve(directory, file), "utf8");
      const normalizedSql = sql.replaceAll("\r\n", "\n");
      const checksum = createHash("sha256").update(normalizedSql).digest("hex");
      const legacyCheckoutChecksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query<{ checksum: string }>(
        "SELECT checksum FROM runtime_schema_migration WHERE version = $1",
        [file],
      );
      if (existing.rowCount === 1) {
        if (
          existing.rows[0]?.checksum !== checksum &&
          existing.rows[0]?.checksum !== legacyCheckoutChecksum
        )
          throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${file}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO runtime_schema_migration(version, checksum) VALUES ($1, $2)",
          [file, checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('sdar_runtime_migrations'))");
    client.release();
  }
}
