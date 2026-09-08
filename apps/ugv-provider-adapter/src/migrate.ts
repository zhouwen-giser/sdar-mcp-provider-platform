import {
  loadGowmStorageConfig,
  createGowmPool,
  verifyGowmStorage,
  scoped,
} from "../../../packages/gowm-shared-storage-adapter/src/index.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { resolveMigrationSet } from "../../../packages/database-migration-runner/src/index.js";

interface MigrationExecutor {
  query(sql: string): Promise<unknown>;
}

export async function runUgvProviderMigrations(
  executor: MigrationExecutor,
  workspaceRoot = process.cwd(),
): Promise<void> {
  if (scoped(executor)) throw new Error("GOWM_STORAGE_MIGRATION_FORBIDDEN");
  const migrations = await resolveMigrationSet(workspaceRoot, "provider:ugv");
  for (const migration of migrations) {
    await executor.query(await readFile(migration.absolutePath, "utf8"));
  }
}

async function main(): Promise<void> {
  const shared = loadGowmStorageConfig(process.env);
  const connectionString = shared?.databaseUrl ?? process.env.UGV_ADAPTER_DATABASE_URL;
  if (!connectionString) throw new Error("UGV_ADAPTER_DATABASE_URL_REQUIRED");
  const pool = shared ? createGowmPool(shared, 1) : new Pool({ connectionString, max: 1 });
  try {
    if (shared) await verifyGowmStorage(pool, shared);
    else await runUgvProviderMigrations(pool);
  } finally {
    await pool.end();
  }
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  await main();
}
