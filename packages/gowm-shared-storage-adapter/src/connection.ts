import { requireValue } from "./value.js";
import { Pool, type PoolClient } from "pg";
import type { GowmStorageConfig } from "./config.js";
import { registerScope } from "./scope.js";

export function createGowmPool(config: GowmStorageConfig, max = 8): Pool {
  const option = (value: string) => {
    if (value.includes("\0")) throw new Error("INVALID_STORAGE_IDENTITY");
    return value.replace(/([\\\s])/g, "\\$1");
  };
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max,
    options:
      "-c search_path=ugv_smpp,public" +
      ` -c smpp.device_id=${option(requireValue(config.allowedDeviceIds[0]))}` +
      ` -c smpp.service_key=${option(config.serviceKey)}` +
      ` -c smpp.binding_id=${option(config.bindingId)}` +
      ` -c smpp.source_session_key=${option(config.sourceSessionKey)}`,
    application_name: "smpp-gowm-shared",
  });
  registerScope(pool, config);
  return pool;
}

export async function inTransaction<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await action(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
