import {
  createGowmPool,
  verifyGowmStorage,
} from "../../../packages/gowm-shared-storage-adapter/src/index.js";
import { Pool } from "pg";
import { runMigrations } from "../../../packages/persistence-postgres/src/index.js";
import { loadRuntimeConfig } from "./config.js";

const config = loadRuntimeConfig();
const pool = config.gowmStorage
  ? createGowmPool(config.gowmStorage, 1)
  : new Pool({ connectionString: config.DATABASE_URL, max: 1 });

try {
  if (config.gowmStorage) {
    await verifyGowmStorage(pool, config.gowmStorage);
    process.stdout.write(
      JSON.stringify({ status: "verified", mode: "gowm-shared", migrationsApplied: 0 }) + "\n",
    );
  } else {
    await runMigrations(pool);
    const result = await pool.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM runtime_schema_migration ORDER BY version",
    );
    process.stdout.write(`${JSON.stringify({ status: "migrated", migrations: result.rows })}\n`);
  }
} finally {
  await pool.end();
}
