import { readFileSync, statSync } from "node:fs";
import { openSiteReadonlyProvider } from "./site-bootstrap.js";
import { openZmqProvider } from "./bootstrap.js";
import { loadGowmStorageConfig } from "../../../packages/gowm-shared-storage-adapter/src/index.js";
const path = process.env.UGV_ZMQ_PROVIDER_CONFIG_FILE;
if (!path) throw Error("UGV_ZMQ_PROVIDER_CONFIG_FILE_REQUIRED");
if ((statSync(path).mode & 0o077) !== 0) throw Error("ZMQ_PRIVATE_CONFIG_PERMISSIONS_REQUIRED");
const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
if (
  Object.keys(value).some(
    (k) =>
      ![
        "databaseUrl",
        "observationDatabaseUrl",
        "profile",
        "observerSettings",
        "controlSettings",
        "mode",
        "contractSha256",
        "plannerFrame",
        "handoffGrantFile",
        "management",
        "host",
        "port",
      ].includes(k),
  )
)
  throw Error("ZMQ_PROVIDER_CONFIG_FIELD_UNKNOWN");
const gowm = loadGowmStorageConfig(process.env);
if (value.mode !== undefined && value.mode !== "site_readonly" && value.mode !== "site_control")
  throw Error("ZMQ_PROVIDER_MODE_INVALID");
if (value.mode === "site_readonly" && value.controlSettings !== undefined)
  throw Error("ZMQ_SITE_CONTROL_SETTINGS_FORBIDDEN");
if (value.mode === "site_control") {
  const grantPath = value.handoffGrantFile;
  if (typeof grantPath !== "string" || statSync(grantPath).mode & 0o077)
    throw Error("ZMQ_PRIVATE_HANDOFF_GRANT_REQUIRED");
  value.handoffGrant = JSON.parse(readFileSync(grantPath, "utf8")) as unknown;
  delete value.handoffGrantFile;
}
const app =
  value.mode === "site_readonly"
    ? await openSiteReadonlyProvider({ ...value, ...(gowm ? { gowm } : {}) } as Parameters<
        typeof openSiteReadonlyProvider
      >[0])
    : await openZmqProvider({ ...value, ...(gowm ? { gowm } : {}) } as Parameters<
        typeof openZmqProvider
      >[0]);
process.stdout.write(
  JSON.stringify({
    event: "zmq_provider_started",
    providerId:
      "profile" in app
        ? app.profile.providerBinding.providerId
        : app.scope.profile.providerBinding.providerId,
    resourceId: app.runtime.resourceId,
    port: app.port,
    qualification: "mode" in app ? app.mode : "isolated_simulator_only",
  }) + "\n",
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().catch(() => {
      process.exitCode = 1;
    });
  });
