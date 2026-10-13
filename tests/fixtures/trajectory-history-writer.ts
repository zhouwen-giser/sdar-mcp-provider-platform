// Disposable subprocess fixture: real MQTT and PostgreSQL; never a device MCP.
import { readFileSync } from "node:fs";
import { PostgresProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import {
  VehicleMqttIngress,
  UgvMqttClient,
  ugvMqttProfile,
} from "../../packages/vehicle-mqtt-ingress/src/index.js";
import { PostgresReceptionStore } from "../../packages/trajectory-history/src/postgres-store.js";
import { TrajectoryReceptionJournal } from "../../packages/trajectory-history/src/journal.js";
import { TrajectoryHistoryReader } from "../../packages/trajectory-history/src/reader.js";
import { loadHistorySigningKey } from "../../packages/trajectory-history/src/signing-key.js";
import { UgvProviderRuntime } from "../../apps/ugv-provider-adapter/src/runtime.js";
import { UgvProviderServer } from "../../apps/ugv-provider-adapter/src/server.js";
import { UgvBusinessEventHub } from "../../apps/ugv-provider-adapter/src/business-events.js";
import { UgvTelemetry } from "../../apps/ugv-provider-adapter/src/telemetry.js";
import { MockUgvDeviceMcpClient } from "../../packages/vehicle-device-mcp-client/src/index.js";

const configFile = process.env.SMPP_TRAJECTORY_WORKER_CONFIG_FILE;
if (!configFile) throw Error("ISOLATED_WORKER_CONFIG_REQUIRED");
const config = JSON.parse(readFileSync(configFile, "utf8")) as {
  databaseUrl: string;
  brokerUrl: string;
  providerId: string;
  port: number;
  keyFile: string;
};
if (
  !new URL(config.databaseUrl).pathname.includes("test") ||
  !config.brokerUrl.startsWith("mqtt://127.0.0.1:")
)
  throw Error("ISOLATED_SIMULATED_WORKER_REQUIRED");
const store = new PostgresProviderStore(config.databaseUrl, 4);
const ingress = new VehicleMqttIngress(
  "direct_domain_json",
  { maxPayloadBytes: 65536, maxDepth: 16, maxNodes: 4096, maxStringBytes: 16384 },
  ugvMqttProfile({
    providerId: config.providerId,
    resourceId: "vehicle:ugv1",
    entityId: "ugv1",
    vehicleType: "ugv",
    executionMode: "simulation",
  }),
);
const history = new PostgresReceptionStore(store.pool, {
  providerId: config.providerId,
  resourceId: "vehicle:ugv1",
  deviceId: "ugv1",
  deviceIdentityAuthority: "PROVIDER_RESOURCE_CONFIGURATION",
  sourceSessionKey: "SIMULATED-crash-source",
});
const journal = new TrajectoryReceptionJournal(history, ingress, "SIMULATED");
await journal.initialize();
const reader = new TrajectoryHistoryReader(
  history,
  loadHistorySigningKey(config.keyFile),
  "SIMULATED",
);
const hub = new UgvBusinessEventHub(store);
const runtime = new UgvProviderRuntime(
  {
    providerId: config.providerId,
    resourceId: "vehicle:ugv1",
    executionMode: "simulation",
    fireEnabled: false,
    fireRequiresChassisStopped: true,
    allowNavigationWithRecon: false,
    freshness: { chassis: 3000, mission: 3000, health: 5000, target: 3000, payload: 3000 },
    trajectoryHistory: reader,
    pollIntervalMs: 60000,
  },
  store,
  ingress,
  new MockUgvDeviceMcpClient(),
  hub,
  new UgvTelemetry({
    providerId: config.providerId,
    enabled: false,
    endpoint: "127.0.0.1:7002",
    tlsMode: "disabled",
  }),
);
await runtime.initializeLocal();
const server = new UgvProviderServer(
  {
    providerId: config.providerId,
    providerVersion: "history-crash-test",
    host: "127.0.0.1",
    port: config.port,
    tlsMode: "disabled",
  },
  runtime,
  store,
  hub,
);
const port = await server.start();
const mqtt = new UgvMqttClient(
  {
    url: config.brokerUrl,
    clientId: "history-crash-writer",
    tlsMode: "disabled",
    sessionMode: "persistent",
    reconnectMinMs: 100,
    reconnectMaxMs: 1000,
    receptionJournal: journal,
  },
  ingress,
);
mqtt.start();
process.stdout.write(JSON.stringify({ ready: true, port, scope: history.scope }) + "\n");
const stop = async () => {
  await mqtt.stop();
  await server.close();
  await runtime.close();
};
process.once("SIGTERM", () => {
  void stop().then(() => process.exit(0));
});
