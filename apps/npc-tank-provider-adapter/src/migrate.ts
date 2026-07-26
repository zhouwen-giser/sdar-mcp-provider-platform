import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

const connectionString = process.env.NPC_TANK_ADAPTER_DATABASE_URL;
if (!connectionString) throw new Error("NPC_TANK_ADAPTER_DATABASE_URL_REQUIRED");
const pool = new Pool({ connectionString, max: 1 });
try {
  const sql = await readFile(resolve("migrations/025_npc_tank_provider.sql"), "utf8");
  await pool.query(sql);
} finally {
  await pool.end();
}
