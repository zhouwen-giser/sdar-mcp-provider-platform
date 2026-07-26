import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { Pool } from "pg";
import {
  loadProviderPackageQueryService,
  ProviderManagementService,
} from "../../../packages/pms-application/src/index.js";
import {
  PostgresPmsUnitOfWork,
  runPmsMigrations,
} from "../../../packages/pms-persistence-postgres/src/index.js";
import { createPmsApi } from "./app.js";

const port = boundedPort(process.env.PMS_API_PORT);
const host = process.env.PMS_API_HOST ?? "127.0.0.1";
const pool = new Pool({ connectionString: await databaseUrl() });
await runPmsMigrations(pool);
const unitOfWork = new PostgresPmsUnitOfWork(pool);
const app = createPmsApi({
  providerPackages: await loadProviderPackageQueryService(),
  management: new ProviderManagementService(unitOfWork),
  readiness: async () => {
    await pool.query("SELECT 1");
    return { ready: true, checks: { database: "ready" } };
  },
});

await app.listen({ host, port });

async function stop(): Promise<void> {
  await app.close();
  await pool.end();
}

function onSignal(): void {
  void stop().catch(() => {
    process.exitCode = 1;
  });
}

process.once("SIGTERM", onSignal);
process.once("SIGINT", onSignal);

function boundedPort(source: string | undefined): number {
  const value = source === undefined ? 8090 : Number(source);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error("PMS_API_PORT_INVALID");
  }
  return value;
}

async function databaseUrl(): Promise<string> {
  if (process.env.PMS_DATABASE_URL !== undefined || process.env.DATABASE_URL !== undefined) {
    throw new Error("PMS_API_INLINE_DATABASE_SECRET_REJECTED");
  }
  const path = process.env.PMS_DATABASE_URL_FILE;
  if (path === undefined || !isAbsolute(path)) {
    throw new Error("PMS_DATABASE_URL_FILE_REQUIRED");
  }
  const value = (await readFile(path, "utf8")).trim();
  if (value.length === 0) throw new Error("PMS_DATABASE_URL_FILE_EMPTY");
  return value;
}
