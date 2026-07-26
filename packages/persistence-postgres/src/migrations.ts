import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";
import {
  resolveMigrationSet,
  type MigrationFile,
} from "../../database-migration-runner/src/index.js";

interface MigrationSourceFile {
  readonly filename: string;
  readonly absolutePath: string;
}

export async function listRuntimeMigrations(
  workspaceRoot = process.cwd(),
): Promise<readonly MigrationFile[]> {
  return resolveMigrationSet(workspaceRoot, "runtime");
}

export async function runMigrations(pool: Pool, compatibilityDirectory?: string): Promise<void> {
  const files =
    compatibilityDirectory === undefined
      ? await listRuntimeMigrations()
      : await listCompatibilityDirectory(compatibilityDirectory);
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
    for (const file of files) {
      const sql = await readFile(file.absolutePath, "utf8");
      const normalizedSql = sql.replaceAll("\r\n", "\n");
      const checksum = createHash("sha256").update(normalizedSql).digest("hex");
      const legacyCheckoutChecksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query<{ checksum: string }>(
        "SELECT checksum FROM runtime_schema_migration WHERE version = $1",
        [file.filename],
      );
      if (existing.rowCount === 1) {
        if (
          existing.rows[0]?.checksum !== checksum &&
          existing.rows[0]?.checksum !== legacyCheckoutChecksum
        )
          throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${file.filename}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO runtime_schema_migration(version, checksum) VALUES ($1, $2)",
          [file.filename, checksum],
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

async function listCompatibilityDirectory(
  directory: string,
): Promise<readonly MigrationSourceFile[]> {
  return (await readdir(directory))
    .filter((filename) => /^\d+_.+\.sql$/.test(filename))
    .sort()
    .map((filename) => ({
      filename,
      absolutePath: resolve(directory, filename),
    }));
}
