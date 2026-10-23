import { Pool } from "pg";
import { loadConfig } from "./config.js";
import { Store } from "./store.js";
import { Mcp } from "./mcp.js";
import { Service } from "./service.js";
import { createApp } from "./app.js";
const config = loadConfig(),
  pool = new Pool({
    connectionString: config.databaseUrl,
    max: 8,
    connectionTimeoutMillis: 8000,
    statement_timeout: 15000,
  });
const store = new Store(pool, config.domain);
await store.migrate();
await store.recover();
const app = createApp(
  config,
  new Service(new Mcp(config.mcpUrl, config.upstreamHeaders), store, config.credentials.username),
);
await app.listen({ host: config.host, port: config.port });
console.log(`UGV_CONSOLE_READY port=${config.port} tls=${config.secure}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().then(() => pool.end());
  });
