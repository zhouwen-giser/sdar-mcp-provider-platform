import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { Pool } from "pg";
import {
  createPm2JavascriptApi,
  Pm2ProcessManager,
} from "../packages/pm2-runtime-adapter/src/index.ts";

const root = process.cwd();
const pm2Homes = await prefixedDirectories(tmpdir(), "sdar-pm2-");
const releaseFixtures = await prefixedDirectories(
  resolve(root, "tests/worker-pm2-production"),
  ".runtime-release-",
);
let deletedProcesses = 0;

for (const pm2Home of pm2Homes) {
  const api = createPm2JavascriptApi({ pm2Home });
  const manager = new Pm2ProcessManager(api, resolve(pm2Home, "releases"));
  try {
    for (const processObservation of await manager.list()) {
      const processName = processObservation.target.processName;
      if (!processName.startsWith("sdar-runtime-")) {
        throw new Error("WORKER_PM2_CLEANUP_PROCESS_OUT_OF_SCOPE");
      }
      await manager.delete(processName);
      deletedProcesses += 1;
    }
  } finally {
    try {
      api.disconnect();
    } catch {
      // Cleanup remains scoped by the isolated PM2 home.
    }
    await rm(pm2Home, { recursive: true, force: true });
  }
}

const databaseCleanup = await cleanupPostgres();
await Promise.all(
  releaseFixtures.map((directory) => rm(directory, { recursive: true, force: true })),
);
await mkdir(resolve(root, "reports/ci"), { recursive: true });
await writeFile(
  resolve(root, "reports/ci/worker-pm2-cleanup.json"),
  `${JSON.stringify(
    {
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      deletedProcesses,
      deletedPm2Homes: pm2Homes.length,
      deletedReleaseFixtures: releaseFixtures.length,
      ...databaseCleanup,
      secretsIncluded: false,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write("WORKER_PM2_CI_CLEANUP_OK\n");

async function prefixedDirectories(parent, prefix) {
  const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => resolve(parent, entry.name));
}

async function cleanupPostgres() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (connectionString === undefined) {
    return { droppedSchemas: 0, droppedDatabases: 0, droppedRoles: 0 };
  }
  const pool = new Pool({ connectionString });
  try {
    const schemas = await names(
      pool,
      "SELECT schema_name AS name FROM information_schema.schemata WHERE schema_name LIKE 'worker_pm2_%'",
    );
    const databases = await names(
      pool,
      "SELECT datname AS name FROM pg_database WHERE datname LIKE 'sdar_rt_worker_e2e_%'",
    );
    const roles = await names(
      pool,
      "SELECT rolname AS name FROM pg_roles WHERE rolname LIKE 'sdar_rt_worker_e2e_%'",
    );
    for (const database of databases) {
      await pool.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",
        [database],
      );
      await pool.query(`DROP DATABASE IF EXISTS ${identifier(database)}`);
    }
    for (const role of roles) await pool.query(`DROP ROLE IF EXISTS ${identifier(role)}`);
    for (const schema of schemas) {
      await pool.query(`DROP SCHEMA IF EXISTS ${identifier(schema)} CASCADE`);
    }
    return {
      droppedSchemas: schemas.length,
      droppedDatabases: databases.length,
      droppedRoles: roles.length,
    };
  } finally {
    await pool.end();
  }
}

async function names(pool, query) {
  return (await pool.query(query)).rows.map(({ name }) => String(name));
}

function identifier(value) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error("WORKER_PM2_CLEANUP_IDENTIFIER_INVALID");
  }
  return `"${value}"`;
}
