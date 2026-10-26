import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { siteFixture } from "../../../tests/ugv-zmq-provider/site-fixture.js";
import { createApp } from "../server/app.js";
import { Service } from "../server/service.js";
import { Store } from "../server/store.js";
import { makeCredentials } from "../server/security.js";
import { password } from "../test/fixture.js";
const path = process.env.SMPP_ZMQ_TEST_CONFIG_FILE;
if (!path) throw Error("ISOLATED_TEST_CONFIG_REQUIRED");
const config = JSON.parse(readFileSync(path, "utf8")) as { databaseUrl: string };
const f = await siteFixture(config.databaseUrl),
  store = new Store(f.admin, "site-browser:" + randomUUID());
await store.migrate();
const app = createApp(
  {
    host: "127.0.0.1",
    port: 19112,
    origins: ["http://127.0.0.1:19112"],
    mcpUrl: f.mcp.url,
    databaseUrl: config.databaseUrl,
    credentials: makeCredentials("operator", password),
    upstreamHeaders: f.mcp.headers,
    domain: store.domain,
    webRoot: fileURLToPath(new URL("../dist", import.meta.url)),
    secure: false,
  },
  new Service(f.mcp, store, "operator"),
);
await app.listen({ host: "127.0.0.1", port: 19112 });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().then(() => f.close());
  });
