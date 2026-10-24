import { readFileSync, statSync } from "node:fs";
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
        "host",
        "port",
      ].includes(k),
  )
)
  throw Error("ZMQ_PROVIDER_CONFIG_FIELD_UNKNOWN");
const gowm = loadGowmStorageConfig(process.env);
const app = await openZmqProvider({ ...value, ...(gowm ? { gowm } : {}) } as Parameters<
  typeof openZmqProvider
>[0]);
process.stdout.write(
  JSON.stringify({
    event: "zmq_provider_started",
    providerId: app.scope.profile.providerBinding.providerId,
    resourceId: app.runtime.resourceId,
    port: app.port,
    qualification: "isolated_simulator_only",
    controlScopeHash: app.scope.hash,
  }) + "\n",
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().catch(() => {
      process.exitCode = 1;
    });
  });
