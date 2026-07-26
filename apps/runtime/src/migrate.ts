import { Pool } from "pg";
import { runMigrations } from "../../../packages/persistence-postgres/src/index.js";
import { loadRuntimeConfig } from "./config.js";

const config = loadRuntimeConfig();
const pool = new Pool({ connectionString: config.DATABASE_URL, max: 1 });

try {
  await runMigrations(pool);
  const result = await pool.query<{ version: string; checksum: string }>(
    "SELECT version, checksum FROM runtime_schema_migration ORDER BY version",
  );
  process.stdout.write(`${JSON.stringify({ status: "migrated", migrations: result.rows })}\n`);
} finally {
  await pool.end();
}
