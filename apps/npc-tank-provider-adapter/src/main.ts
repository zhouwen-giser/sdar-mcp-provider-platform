import pino from "pino";
import {
  MemoryProviderStore,
  PostgresProviderStore,
} from "../../../packages/provider-adapter-kit/src/index.js";
import { StreamableHttpNpcTankDeviceMcpClient } from "../../../packages/vehicle-device-mcp-client/src/index.js";
import {
  NpcTankMqttClient,
  npcTankMqttProfile,
  VehicleMqttIngress,
} from "../../../packages/vehicle-mqtt-ingress/src/index.js";
import {
  VehicleBusinessEventHub,
  VehicleTelemetry,
  type NpcTankSnapshot,
} from "../../../packages/vehicle-provider-core/src/index.js";
import { loadNpcTankProviderConfig } from "./config.js";
import { NpcTankProviderRuntime } from "./runtime.js";
import { NpcTankProviderServer } from "./server.js";

const config = loadNpcTankProviderConfig();
const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: ["password", "authorization", "headers", "*.password", "*.authorization", "*.headers"],
    censor: "[REDACTED]",
  },
});
const store =
  config.NPC_TANK_ADAPTER_STORE_MODE === "postgres"
    ? new PostgresProviderStore(
        config.NPC_TANK_ADAPTER_DATABASE_URL,
        config.NPC_TANK_ADAPTER_DATABASE_POOL_MAX,
        "npc_tank",
      )
    : new MemoryProviderStore();
const ingress = new VehicleMqttIngress<NpcTankSnapshot>(
  config.NPC_TANK_MQTT_WIRE_MODE,
  {
    maxPayloadBytes: config.NPC_TANK_MQTT_MAX_PAYLOAD_BYTES,
    maxDepth: config.NPC_TANK_MQTT_MAX_JSON_DEPTH,
    maxNodes: config.NPC_TANK_MQTT_MAX_JSON_NODES,
    maxStringBytes: config.NPC_TANK_MQTT_MAX_STRING_BYTES,
  },
  npcTankMqttProfile(),
);
const mqtt = new NpcTankMqttClient(
  {
    url: config.NPC_TANK_MQTT_URL,
    clientId: config.NPC_TANK_MQTT_CLIENT_ID,
    ...(config.NPC_TANK_MQTT_USERNAME ? { username: config.NPC_TANK_MQTT_USERNAME } : {}),
    ...(config.NPC_TANK_MQTT_PASSWORD_FILE
      ? { passwordFile: config.NPC_TANK_MQTT_PASSWORD_FILE }
      : {}),
    tlsMode: config.NPC_TANK_MQTT_TLS_MODE,
    ...(config.NPC_TANK_MQTT_TLS_CA_PATH ? { tlsCaPath: config.NPC_TANK_MQTT_TLS_CA_PATH } : {}),
    ...(config.NPC_TANK_MQTT_TLS_CERT_PATH
      ? { tlsCertPath: config.NPC_TANK_MQTT_TLS_CERT_PATH }
      : {}),
    ...(config.NPC_TANK_MQTT_TLS_KEY_PATH ? { tlsKeyPath: config.NPC_TANK_MQTT_TLS_KEY_PATH } : {}),
    sessionMode: config.NPC_TANK_MQTT_SESSION_MODE,
    reconnectMinMs: config.NPC_TANK_MQTT_RECONNECT_MIN_MS,
    reconnectMaxMs: config.NPC_TANK_MQTT_RECONNECT_MAX_MS,
  },
  ingress,
);
const device = new StreamableHttpNpcTankDeviceMcpClient(
  {
    url: config.NPC_TANK_DEVICE_MCP_URL,
    timeoutMs: config.NPC_TANK_DEVICE_MCP_TIMEOUT_MS,
    ...(config.NPC_TANK_DEVICE_MCP_HEADERS_FILE
      ? { headersFile: config.NPC_TANK_DEVICE_MCP_HEADERS_FILE }
      : {}),
    maxResponseBytes: config.NPC_TANK_DEVICE_MCP_MAX_RESPONSE_BYTES,
    contractReportPath: config.NPC_TANK_DEVICE_MCP_CONTRACT_REPORT_PATH,
    useMockContractWhenUnavailable: config.NPC_TANK_DEVICE_MCP_ALLOW_MOCK_CONTRACT,
  },
  store,
);
const telemetry = new VehicleTelemetry({
  providerId: config.PROVIDER_ID,
  resourceId: "vehicle:npc_tank1",
  resourceType: "isr.vehicle.npc_tank",
  enabled: config.PROVIDER_TELEMETRY_ENABLED,
  endpoint: config.PROVIDER_TELEMETRY_ENDPOINT,
  tlsMode: config.PROVIDER_TELEMETRY_TLS_MODE,
  ...(config.PROVIDER_TELEMETRY_TLS_CA_PATH
    ? { caPath: config.PROVIDER_TELEMETRY_TLS_CA_PATH }
    : {}),
  ...(config.PROVIDER_TELEMETRY_TLS_CERT_PATH
    ? { certPath: config.PROVIDER_TELEMETRY_TLS_CERT_PATH }
    : {}),
  ...(config.PROVIDER_TELEMETRY_TLS_KEY_PATH
    ? { keyPath: config.PROVIDER_TELEMETRY_TLS_KEY_PATH }
    : {}),
});
const businessEvents = new VehicleBusinessEventHub(store, {
  reasonPrefix: "NPC_TANK",
  resourceId: "vehicle:npc_tank1",
});
const runtime = new NpcTankProviderRuntime(
  {
    providerId: config.PROVIDER_ID,
    providerVersion: config.PROVIDER_VERSION,
    freshness: {
      chassis: config.NPC_TANK_CHASSIS_FRESHNESS_MS,
      mission: config.NPC_TANK_MISSION_FRESHNESS_MS,
      health: config.NPC_TANK_HEALTH_FRESHNESS_MS,
      target: config.NPC_TANK_TARGET_FRESHNESS_MS,
      payload: config.NPC_TANK_PAYLOAD_FRESHNESS_MS,
    },
    allowNavigationWithRecon: config.NPC_TANK_ALLOW_NAVIGATION_WITH_RECON,
    fireRequiresChassisStopped: config.NPC_TANK_FIRE_REQUIRES_CHASSIS_STOPPED,
    pollIntervalMs: config.NPC_TANK_EXECUTION_POLL_INTERVAL_MS,
    navigationReportPath: config.NPC_TANK_NAVIGATION_SELECTION_REPORT_PATH,
    eoScanReportPath: config.NPC_TANK_EO_SCAN_CAPABILITY_REPORT_PATH,
  },
  store,
  ingress,
  device,
  businessEvents,
  telemetry,
);
const server = new NpcTankProviderServer(
  {
    providerId: config.PROVIDER_ID,
    providerVersion: config.PROVIDER_VERSION,
    host: config.ADAPTER_HOST,
    port: config.ADAPTER_PORT,
    tlsMode: config.ADAPTER_TLS_MODE,
    ...(config.ADAPTER_TLS_CA_PATH ? { tlsCaPath: config.ADAPTER_TLS_CA_PATH } : {}),
    ...(config.ADAPTER_TLS_CERT_PATH ? { tlsCertPath: config.ADAPTER_TLS_CERT_PATH } : {}),
    ...(config.ADAPTER_TLS_KEY_PATH ? { tlsKeyPath: config.ADAPTER_TLS_KEY_PATH } : {}),
  },
  runtime,
  store,
  businessEvents,
);

await runtime.initialize();
mqtt.start();
const port = await server.start();
logger.info({ providerId: config.PROVIDER_ID, port }, "NPC Tank Provider Adapter started");
const stop = async () => {
  await mqtt.stop();
  await server.close();
  telemetry.close();
  await runtime.close();
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
