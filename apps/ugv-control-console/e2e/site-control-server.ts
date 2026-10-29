import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  controlSiteFixture,
  siteStart,
} from "../../../tests/ugv-zmq-provider/site-control-fixture.js";
import { createApp } from "../server/app.js";
import { Service } from "../server/service.js";
import { Store } from "../server/store.js";
import { makeCredentials } from "../server/security.js";
import { password } from "../test/fixture.js";
import { viewFixture } from "../../../tests/ugv-zmq-provider/view-fixture.js";
const path = process.env.SMPP_ZMQ_TEST_CONFIG_FILE;
if (!path) throw Error("ISOLATED_TEST_CONFIG_REQUIRED");
const config = JSON.parse(readFileSync(path, "utf8")) as { databaseUrl: string };
const v13 = process.env.SMPP_ZMQ_UI_V13 === "true",
  v14 = process.env.SMPP_ZMQ_UI_V14 === "true",
  port = v14 ? 19115 : v13 ? 19114 : 19113;
const view = v14 ? await viewFixture() : undefined;
const f = await controlSiteFixture(
    config.databaseUrl,
    "jwt_hs256",
    v14 ? "zmq_v1_4_0_site_control_14" : v13 ? "zmq_v1_3_0_site_control_13" : undefined,
    view?.settings,
  ),
  store = new Store(f.admin, "site-browser:" + randomUUID());
await store.migrate();
f.devices.positionOverride = siteStart;
const app = createApp(
  {
    host: "127.0.0.1",
    port,
    origins: [`http://127.0.0.1:${port}`],
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
await app.listen({ host: "127.0.0.1", port });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app
      .close()
      .then(() => f.close())
      .then(() => view?.close());
  });
