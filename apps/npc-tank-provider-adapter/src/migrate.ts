import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { resolveMigrationSet } from "../../../packages/database-migration-runner/src/index.js";

interface MigrationExecutor {
  query(sql: string): Promise<unknown>;
}

export async function runNpcTankProviderMigrations(
  executor: MigrationExecutor,
  workspaceRoot = process.cwd(),
): Promise<void> {
  const migrations = await resolveMigrationSet(workspaceRoot, "provider:npc-tank");
  for (const migration of migrations) {
    await executor.query(await readFile(migration.absolutePath, "utf8"));
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.NPC_TANK_ADAPTER_DATABASE_URL;
  if (!connectionString) throw new Error("NPC_TANK_ADAPTER_DATABASE_URL_REQUIRED");
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await runNpcTankProviderMigrations(pool);
  } finally {
    await pool.end();
  }
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  await main();
}
