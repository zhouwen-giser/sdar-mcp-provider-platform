import pino from "pino";
import { loadLightConfig } from "./config.js";
import { LightConfirmationWorker, LightExecutionEngine } from "./execution/execution-engine.js";
import {
  HomeAssistantLightClient,
  HomeAssistantLightWebSocket,
  normalizeLightState,
} from "./home-assistant.js";
import { LightResourceRegistry, loadLightResources } from "./resources.js";
import { LightProviderServer } from "./server.js";
import { JsonLightStore } from "./store.js";
import { ProviderLightTelemetry } from "./telemetry.js";

const config = loadLightConfig(process.env);
const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: ["homeAssistantToken", "token", "authorization", "*.token", "*.authorization"],
    censor: "[REDACTED]",
  },
});
const registry = new LightResourceRegistry(loadLightResources(config.LIGHT_RESOURCES_FILE));
const rest = new HomeAssistantLightClient({
  baseUrl: config.HOME_ASSISTANT_URL,
  token: config.homeAssistantToken,
  timeoutMs: config.HOME_ASSISTANT_REQUEST_TIMEOUT_MS,
});
const store = new JsonLightStore(config.PROVIDER_STATE_PATH);
const telemetry = new ProviderLightTelemetry(
  {
    providerId: config.PROVIDER_ID,
    endpoint: config.PROVIDER_TELEMETRY_ENDPOINT,
    enabled: config.PROVIDER_TELEMETRY_ENABLED,
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
  },
  registry,
  store,
);
const sideEffectsEnabled =
  process.env.ALLOW_REAL_DEVICE_SIDE_EFFECTS === "YES" &&
  typeof process.env.REAL_DEVICE_TEST_RUN_ID === "string" &&
  process.env.REAL_DEVICE_TEST_RUN_ID.trim().length > 0;
const engine = new LightExecutionEngine(
  store,
  registry,
  rest,
  telemetry,
  config.HOME_ASSISTANT_CONFIRM_TIMEOUT_MS,
  sideEffectsEnabled,
);
const websocket = new HomeAssistantLightWebSocket({
  baseUrl: config.HOME_ASSISTANT_URL,
  token: config.homeAssistantToken,
  entityIds: registry.entityIds(),
  reconnectMinMs: config.HOME_ASSISTANT_WS_RECONNECT_MIN_MS,
  reconnectMaxMs: config.HOME_ASSISTANT_WS_RECONNECT_MAX_MS,
});
websocket.onState((state) => {
  const resource = registry.fromEntity(state.entity_id);
  if (resource !== undefined) void engine.observe(normalizeLightState(resource.resourceId, state));
});
const worker = new LightConfirmationWorker(store, engine, config.HOME_ASSISTANT_POLL_INTERVAL_MS);
const server = new LightProviderServer(
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
  registry,
  rest,
  store,
  engine,
);
await rest.checkApi();
await engine.recover();
telemetry.start();
websocket.start();
worker.start();
const port = await server.start();
logger.info({ providerId: config.PROVIDER_ID, port }, "Home Assistant light Provider started");
const stop = async (): Promise<void> => {
  worker.stop();
  websocket.stop();
  telemetry.stop();
  await server.close();
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
