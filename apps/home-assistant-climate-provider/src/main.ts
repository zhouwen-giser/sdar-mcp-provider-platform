import pino from "pino";
import { loadClimateConfig } from "./config.js";
import { ClimateConfirmationWorker, ClimateExecutionEngine } from "./execution.js";
import {
  HomeAssistantClimateClient,
  HomeAssistantClimateWebSocket,
  normalizeClimateState,
} from "./home-assistant.js";
import { ClimateResourceRegistry, loadClimateResources } from "./resources.js";
import { ClimateProviderServer } from "./server.js";
import { JsonClimateStore } from "./store.js";
import { ProviderClimateTelemetry } from "./telemetry.js";
const config = loadClimateConfig(process.env);
const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: ["homeAssistantToken", "token", "authorization", "*.token", "*.authorization"],
    censor: "[REDACTED]",
  },
});
const registry = new ClimateResourceRegistry(loadClimateResources(config.CLIMATE_RESOURCES_FILE));
const rest = new HomeAssistantClimateClient({
  baseUrl: config.HOME_ASSISTANT_URL,
  token: config.homeAssistantToken,
  timeoutMs: config.HOME_ASSISTANT_REQUEST_TIMEOUT_MS,
});
const store = new JsonClimateStore(config.PROVIDER_STATE_PATH);
const telemetry = new ProviderClimateTelemetry(
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
const engine = new ClimateExecutionEngine(
  store,
  registry,
  rest,
  telemetry,
  config.HOME_ASSISTANT_CONFIRM_TIMEOUT_MS,
);
const websocket = new HomeAssistantClimateWebSocket({
  baseUrl: config.HOME_ASSISTANT_URL,
  token: config.homeAssistantToken,
  entityIds: registry.entityIds(),
  reconnectMinMs: config.HOME_ASSISTANT_WS_RECONNECT_MIN_MS,
  reconnectMaxMs: config.HOME_ASSISTANT_WS_RECONNECT_MAX_MS,
});
websocket.onState((state) => {
  const r = registry.fromEntity(state.entity_id);
  if (r !== undefined) void engine.observe(normalizeClimateState(r.resourceId, state));
});
const worker = new ClimateConfirmationWorker(store, engine, config.HOME_ASSISTANT_POLL_INTERVAL_MS);
const server = new ClimateProviderServer(
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
logger.info({ providerId: config.PROVIDER_ID, port }, "Home Assistant climate Provider started");
const stop = async (): Promise<void> => {
  worker.stop();
  websocket.stop();
  telemetry.stop();
  await server.close();
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
