import pino from "pino";
import { readFileSync } from "node:fs";
import {
  MemoryProviderStore,
  PostgresProviderStore,
} from "../../../packages/provider-adapter-kit/src/index.js";
import { StreamableHttpUgvDeviceMcpClient } from "../../../packages/vehicle-device-mcp-client/src/index.js";
import {
  UgvMqttClient,
  VehicleMqttIngress,
  ugvMqttProfile,
} from "../../../packages/vehicle-mqtt-ingress/src/index.js";
import { UgvBusinessEventHub } from "./business-events.js";
import { loadUgvProviderConfig } from "./config.js";
import { UgvProviderRuntime } from "./runtime.js";
import { UgvProviderServer } from "./server.js";
import { UgvTelemetry } from "./telemetry.js";

const config = loadUgvProviderConfig();
const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: ["password", "authorization", "headers", "*.password", "*.authorization", "*.headers"],
    censor: "[REDACTED]",
  },
});
const store =
  config.UGV_ADAPTER_STORE_MODE === "postgres"
    ? new PostgresProviderStore(
        config.UGV_ADAPTER_DATABASE_URL,
        config.UGV_ADAPTER_DATABASE_POOL_MAX,
      )
    : new MemoryProviderStore();
const identity = {
  providerId: config.PROVIDER_ID,
  resourceId: config.UGV_RESOURCE_ID,
  entityId: config.UGV_ENTITY_ID,
  vehicleType: config.UGV_VEHICLE_TYPE,
  executionMode: config.UGV_EXECUTION_MODE,
} as const;
const ingress = new VehicleMqttIngress(
  config.UGV_MQTT_WIRE_MODE,
  {
    maxPayloadBytes: config.UGV_MQTT_MAX_PAYLOAD_BYTES,
    maxDepth: config.UGV_MQTT_MAX_JSON_DEPTH,
    maxNodes: config.UGV_MQTT_MAX_JSON_NODES,
    maxStringBytes: config.UGV_MQTT_MAX_STRING_BYTES,
  },
  ugvMqttProfile(identity),
);
const mqtt = new UgvMqttClient(
  {
    url: config.UGV_MQTT_URL,
    clientId: config.UGV_MQTT_CLIENT_ID,
    ...(config.UGV_MQTT_USERNAME ? { username: config.UGV_MQTT_USERNAME } : {}),
    ...(config.UGV_MQTT_PASSWORD_FILE ? { passwordFile: config.UGV_MQTT_PASSWORD_FILE } : {}),
    tlsMode: config.UGV_MQTT_TLS_MODE,
    ...(config.UGV_MQTT_TLS_CA_PATH ? { tlsCaPath: config.UGV_MQTT_TLS_CA_PATH } : {}),
    ...(config.UGV_MQTT_TLS_CERT_PATH ? { tlsCertPath: config.UGV_MQTT_TLS_CERT_PATH } : {}),
    ...(config.UGV_MQTT_TLS_KEY_PATH ? { tlsKeyPath: config.UGV_MQTT_TLS_KEY_PATH } : {}),
    sessionMode: config.UGV_MQTT_SESSION_MODE,
    reconnectMinMs: config.UGV_MQTT_RECONNECT_MIN_MS,
    reconnectMaxMs: config.UGV_MQTT_RECONNECT_MAX_MS,
  },
  ingress,
);
const device = new StreamableHttpUgvDeviceMcpClient(
  {
    url: config.UGV_DEVICE_MCP_URL,
    timeoutMs: config.UGV_DEVICE_MCP_TIMEOUT_MS,
    ...(config.UGV_DEVICE_MCP_HEADERS_FILE
      ? { headersFile: config.UGV_DEVICE_MCP_HEADERS_FILE }
      : {}),
    maxResponseBytes: config.UGV_DEVICE_MCP_MAX_RESPONSE_BYTES,
    contractReportPath: config.UGV_DEVICE_MCP_CONTRACT_REPORT_PATH,
    useMockContractWhenUnavailable: config.UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT,
    useCapturedContractWhenUnavailable: config.UGV_DEVICE_MCP_ALLOW_CAPTURED_CONTRACT,
    readRetryAttempts: config.UGV_DEVICE_MCP_READ_RETRY_ATTEMPTS,
    circuitBreakerThreshold: config.UGV_DEVICE_MCP_CIRCUIT_BREAKER_THRESHOLD,
    circuitBreakerResetMs: config.UGV_DEVICE_MCP_CIRCUIT_BREAKER_RESET_MS,
  },
  store,
);
const telemetry = new UgvTelemetry({
  providerId: config.PROVIDER_ID,
  resourceId: config.UGV_RESOURCE_ID,
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
  onOutcome: (outcome) => {
    const details = {
      outcome: outcome.kind,
      amount: outcome.amount,
      reasonCode: outcome.reasonCode,
      counters: outcome.snapshot,
    };
    if (["rejected", "transport_failed", "dropped"].includes(outcome.kind))
      logger.warn(details, "UGV Provider telemetry delivery issue");
    else logger.debug(details, "UGV Provider telemetry delivery outcome");
  },
});
const businessEvents = new UgvBusinessEventHub(store, config.UGV_RESOURCE_ID);
const runtime = new UgvProviderRuntime(
  {
    providerId: config.PROVIDER_ID,
    resourceId: config.UGV_RESOURCE_ID,
    entityId: config.UGV_ENTITY_ID,
    executionMode: config.UGV_EXECUTION_MODE,
    freshness: {
      chassis: config.UGV_CHASSIS_FRESHNESS_MS,
      mission: config.UGV_MISSION_FRESHNESS_MS,
      health: config.UGV_HEALTH_FRESHNESS_MS,
      target: config.UGV_TARGET_FRESHNESS_MS,
      payload: config.UGV_PAYLOAD_FRESHNESS_MS,
      maximumFutureSkewMs: config.UGV_OBSERVATION_MAX_FUTURE_SKEW_MS,
    },
    allowNavigationWithRecon: config.UGV_ALLOW_NAVIGATION_WITH_RECON,
    fireEnabled: config.UGV_FIRE_ENABLED,
    fireRequiresChassisStopped: config.UGV_FIRE_REQUIRES_CHASSIS_STOPPED,
    diagnostics: {
      enabled: config.UGV_DIAGNOSTICS_ENABLED,
      controlToken:
        config.UGV_DIAGNOSTICS_CONTROL_TOKEN_FILE === undefined
          ? ""
          : readFileSync(config.UGV_DIAGNOSTICS_CONTROL_TOKEN_FILE, "utf8").trim(),
      maximumTtlMs: config.UGV_DIAGNOSTICS_MAX_TTL_MS,
    },
    stationarySpeedThresholdKmh: config.UGV_STATIONARY_SPEED_THRESHOLD_KMH,
    stationaryStabilityMs: config.UGV_STATIONARY_STABILITY_MS,
    stationaryMinimumSamples: config.UGV_STATIONARY_MIN_SAMPLES,
    physicalConfirmationTimeoutMs: config.UGV_PHYSICAL_CONFIRMATION_TIMEOUT_MS,
    failureBudget: {
      degradedThreshold: config.UGV_OPERATION_FAILURE_DEGRADED_THRESHOLD,
      openThreshold: config.UGV_OPERATION_FAILURE_OPEN_THRESHOLD,
      recoverySuccessThreshold: config.UGV_OPERATION_RECOVERY_SUCCESS_THRESHOLD,
    },
    pollIntervalMs: config.UGV_EXECUTION_POLL_INTERVAL_MS,
  },
  store,
  ingress,
  device,
  businessEvents,
  telemetry,
);
const server = new UgvProviderServer(
  {
    providerId: config.PROVIDER_ID,
    providerVersion: config.PROVIDER_VERSION,
    identity,
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

await runtime.initializeLocal();
const port = await server.start();
mqtt.start();
logger.info(
  {
    providerId: config.PROVIDER_ID,
    deliveryStage: config.UGV_DELIVERY_STAGE,
    executionMode: config.UGV_EXECUTION_MODE,
    allToolSideEffectsEnabled: config.UGV_EXECUTION_MODE === "live" && config.UGV_FIRE_ENABLED,
    port,
    readiness: runtime.readiness().state,
  },
  "UGV Provider Adapter started in NOT_READY",
);
const stop = async () => {
  await mqtt.stop();
  await server.close();
  await runtime.close();
  await telemetry.closeAndDrain();
};
void runtime
  .initializeDependencies()
  .then(() =>
    logger.info(
      { providerId: config.PROVIDER_ID, readiness: runtime.readiness() },
      "UGV Provider Adapter dependency initialization completed",
    ),
  )
  .catch((error: unknown) => {
    logger.error({ error }, "UGV Provider Adapter dependency initialization failed");
    void stop().finally(() => {
      process.exitCode = 1;
    });
  });
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
