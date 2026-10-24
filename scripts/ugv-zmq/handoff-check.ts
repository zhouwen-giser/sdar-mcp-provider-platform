import { readFileSync, statSync } from "node:fs";
import { Pool } from "pg";
import { z } from "zod";
import { readZmqHandoffState } from "../../packages/vehicle-zmq-control/src/handoff.js";
const path = process.env.UGV_ZMQ_HANDOFF_CONFIG_FILE;
if (!path || (statSync(path).mode & 0o077) !== 0)
  throw Error("ZMQ_PRIVATE_HANDOFF_CONFIG_REQUIRED");
const config = z
  .object({
    runtimeDatabaseUrl: z.url(),
    providerDatabaseUrl: z.url(),
    providerId: z.string().min(1),
  })
  .strict()
  .parse(JSON.parse(readFileSync(path, "utf8")));
// Shared mode must use its registered owner pools; do not issue unscoped reads from this standalone CLI.
if (process.env.SMPP_STORAGE_MODE === "gowm-shared")
  throw Error("ZMQ_HANDOFF_GOWM_OWNER_POOLS_REQUIRED");
const a = new Pool({
    connectionString: config.runtimeDatabaseUrl,
    max: 1,
    connectionTimeoutMillis: 2000,
  }),
  b = new Pool({
    connectionString: config.providerDatabaseUrl,
    max: 1,
    connectionTimeoutMillis: 2000,
  });
try {
  const report = await readZmqHandoffState(a, b, config.providerId);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exitCode = report.databaseIdle ? 0 : 2;
} finally {
  await a.end();
  await b.end();
}
