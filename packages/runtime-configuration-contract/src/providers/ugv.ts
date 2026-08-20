import { z } from "zod";
import { parseConfigurationDefinition } from "../model.js";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");
const optionalPath = z
  .string()
  .transform((value) => value.trim() || undefined)
  .optional();
const tls = z.enum(["disabled", "required"]);
const publicIdentity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/);
const privateEntityIdentity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const vehicleType = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);

const UgvProviderInputBaseSchema = z.object({
  PROVIDER_ID: publicIdentity.default("isr.vehicle.ugv.ugv1"),
  PROVIDER_VERSION: z.string().min(1).default("1.0.0"),
  UGV_RESOURCE_ID: publicIdentity.default("vehicle:ugv1"),
  UGV_ENTITY_ID: privateEntityIdentity.default("ugv1"),
  UGV_VEHICLE_TYPE: vehicleType.default("ugv"),
  UGV_EXECUTION_MODE: z.enum(["simulation", "live"]).default("simulation"),
  ADAPTER_HOST: z.string().min(1).default("0.0.0.0"),
  ADAPTER_PORT: z.coerce.number().int().min(1).max(65_535).default(7010),
  ADAPTER_TLS_MODE: tls.default("disabled"),
  ADAPTER_TLS_CA_PATH: optionalPath,
  ADAPTER_TLS_CERT_PATH: optionalPath,
  ADAPTER_TLS_KEY_PATH: optionalPath,
  UGV_ADAPTER_STORE_MODE: z.enum(["postgres", "memory"]).default("postgres"),
  UGV_ADAPTER_DATABASE_URL: z
    .url()
    .default("postgresql://ugv_adapter:ugv_adapter@127.0.0.1:5433/ugv_adapter"),
  UGV_ADAPTER_DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(32).default(8),
  UGV_MQTT_URL: z.string().min(1).default("mqtt://127.0.0.1:1883"),
  UGV_MQTT_CLIENT_ID: z.string().min(1).default("sdar-ugv-adapter-ugv1"),
  UGV_MQTT_USERNAME: optionalPath,
  UGV_MQTT_PASSWORD_FILE: optionalPath,
  UGV_MQTT_TLS_MODE: tls.default("disabled"),
  UGV_MQTT_TLS_CA_PATH: optionalPath,
  UGV_MQTT_TLS_CERT_PATH: optionalPath,
  UGV_MQTT_TLS_KEY_PATH: optionalPath,
  UGV_MQTT_SESSION_MODE: z.enum(["clean", "persistent"]).default("persistent"),
  UGV_MQTT_RECONNECT_MIN_MS: z.coerce.number().int().min(100).default(500),
  UGV_MQTT_RECONNECT_MAX_MS: z.coerce.number().int().min(500).default(30_000),
  UGV_MQTT_MAX_PAYLOAD_BYTES: z.coerce.number().int().min(128).max(1_048_576).default(65_536),
  UGV_MQTT_MAX_JSON_DEPTH: z.coerce.number().int().min(1).max(64).default(16),
  UGV_MQTT_MAX_JSON_NODES: z.coerce.number().int().min(16).max(100_000).default(4_096),
  UGV_MQTT_MAX_STRING_BYTES: z.coerce.number().int().min(64).max(1_048_576).default(16_384),
  UGV_MQTT_WIRE_MODE: z
    .enum(["auto", "ros_message_json", "direct_domain_json", "ros_bridge_json"])
    .default("auto"),
  UGV_CHASSIS_FRESHNESS_MS: z.coerce.number().int().positive().default(3_000),
  UGV_MISSION_FRESHNESS_MS: z.coerce.number().int().positive().default(3_000),
  UGV_HEALTH_FRESHNESS_MS: z.coerce.number().int().positive().default(5_000),
  UGV_TARGET_FRESHNESS_MS: z.coerce.number().int().positive().default(3_000),
  UGV_PAYLOAD_FRESHNESS_MS: z.coerce.number().int().positive().default(3_000),
  UGV_OBSERVATION_MAX_FUTURE_SKEW_MS: z.coerce.number().int().min(0).max(5_000).default(1_000),
  UGV_DEVICE_MCP_URL: z.url().default("http://127.0.0.1:19000/mcp"),
  UGV_DEVICE_MCP_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
  UGV_DEVICE_MCP_TLS_MODE: tls.default("disabled"),
  UGV_DEVICE_MCP_HEADERS_FILE: optionalPath,
  UGV_DEVICE_MCP_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(1_048_576)
    .default(65_536),
  UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT: bool.default(false),
  UGV_DEVICE_MCP_READ_RETRY_ATTEMPTS: z.coerce.number().int().min(0).max(3).default(1),
  UGV_DEVICE_MCP_CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().int().min(1).max(100).default(3),
  UGV_DEVICE_MCP_CIRCUIT_BREAKER_RESET_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(300_000)
    .default(5_000),
  UGV_DEVICE_MCP_CONTRACT_REPORT_PATH: z
    .string()
    .min(1)
    .default("reports/ugv-provider-v1/external-contract/ugv-device-mcp-tools.json"),
  UGV_ALLOW_NAVIGATION_WITH_RECON: bool.default(true),
  UGV_FIRE_ENABLED: bool.default(false),
  UGV_FIRE_REQUIRES_CHASSIS_STOPPED: bool.default(true),
  UGV_STATIONARY_SPEED_THRESHOLD_KMH: z.coerce.number().min(0).max(5).default(0.1),
  UGV_STATIONARY_STABILITY_MS: z.coerce.number().int().min(0).max(60_000).default(500),
  UGV_STATIONARY_MIN_SAMPLES: z.coerce.number().int().min(1).max(100).default(2),
  UGV_PHYSICAL_CONFIRMATION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(300_000)
    .default(30_000),
  UGV_OPERATION_FAILURE_DEGRADED_THRESHOLD: z.coerce.number().int().min(1).max(100).default(2),
  UGV_OPERATION_FAILURE_OPEN_THRESHOLD: z.coerce.number().int().min(1).max(100).default(3),
  UGV_OPERATION_RECOVERY_SUCCESS_THRESHOLD: z.coerce.number().int().min(1).max(100).default(2),
  UGV_EXECUTION_POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(250),
  PROVIDER_TELEMETRY_ENABLED: bool.default(true),
  PROVIDER_TELEMETRY_ENDPOINT: z.string().min(1).default("127.0.0.1:7002"),
  PROVIDER_TELEMETRY_TLS_MODE: tls.default("disabled"),
  PROVIDER_TELEMETRY_TLS_CA_PATH: optionalPath,
  PROVIDER_TELEMETRY_TLS_CERT_PATH: optionalPath,
  PROVIDER_TELEMETRY_TLS_KEY_PATH: optionalPath,
  RUNTIME_ENV: z.enum(["development", "test", "production"]).default("development"),
  ALLOW_INSECURE_INTERNAL_TRANSPORT: bool.default(false),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

const UgvProviderInputSchema = UgvProviderInputBaseSchema.superRefine((value, context) => {
  for (const [mode, ca, cert, key, name] of [
    [
      value.ADAPTER_TLS_MODE,
      value.ADAPTER_TLS_CA_PATH,
      value.ADAPTER_TLS_CERT_PATH,
      value.ADAPTER_TLS_KEY_PATH,
      "ADAPTER",
    ],
    [
      value.UGV_MQTT_TLS_MODE,
      value.UGV_MQTT_TLS_CA_PATH,
      value.UGV_MQTT_TLS_CERT_PATH,
      value.UGV_MQTT_TLS_KEY_PATH,
      "UGV_MQTT",
    ],
    [
      value.PROVIDER_TELEMETRY_TLS_MODE,
      value.PROVIDER_TELEMETRY_TLS_CA_PATH,
      value.PROVIDER_TELEMETRY_TLS_CERT_PATH,
      value.PROVIDER_TELEMETRY_TLS_KEY_PATH,
      "PROVIDER_TELEMETRY",
    ],
  ] as const)
    if (mode === "required" && (!ca || !cert || !key))
      context.addIssue({ code: "custom", message: `${name}_MTLS_FILES_REQUIRED` });
  if (value.RUNTIME_ENV === "production") {
    if (!value.ALLOW_INSECURE_INTERNAL_TRANSPORT && value.ADAPTER_TLS_MODE !== "required")
      context.addIssue({ code: "custom", message: "PRODUCTION_ADAPTER_MTLS_REQUIRED" });
    if (!value.ALLOW_INSECURE_INTERNAL_TRANSPORT && value.UGV_MQTT_TLS_MODE !== "required")
      context.addIssue({ code: "custom", message: "PRODUCTION_MQTT_TLS_REQUIRED" });
    if (value.UGV_MQTT_WIRE_MODE === "auto")
      context.addIssue({ code: "custom", message: "PRODUCTION_MQTT_WIRE_MODE_MUST_BE_EXPLICIT" });
    if (value.UGV_ADAPTER_STORE_MODE !== "postgres")
      context.addIssue({ code: "custom", message: "PRODUCTION_POSTGRES_STORE_REQUIRED" });
  }
  if (value.UGV_EXECUTION_MODE === "live") {
    if (value.UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT)
      context.addIssue({ code: "custom", message: "UGV_LIVE_MOCK_CONTRACT_FORBIDDEN" });
    if (value.UGV_ADAPTER_STORE_MODE !== "postgres")
      context.addIssue({ code: "custom", message: "UGV_LIVE_POSTGRES_STORE_REQUIRED" });
  }
  if (value.UGV_OPERATION_FAILURE_DEGRADED_THRESHOLD >= value.UGV_OPERATION_FAILURE_OPEN_THRESHOLD)
    context.addIssue({
      code: "custom",
      message: "UGV_OPERATION_FAILURE_THRESHOLDS_INVALID",
    });
});

export const UgvProviderResolvedSchema = UgvProviderInputBaseSchema.extend({
  ADAPTER_TLS_CA_PATH: z.string().optional(),
  ADAPTER_TLS_CERT_PATH: z.string().optional(),
  ADAPTER_TLS_KEY_PATH: z.string().optional(),
  UGV_MQTT_USERNAME: z.string().optional(),
  UGV_MQTT_PASSWORD_FILE: z.string().optional(),
  UGV_MQTT_TLS_CA_PATH: z.string().optional(),
  UGV_MQTT_TLS_CERT_PATH: z.string().optional(),
  UGV_MQTT_TLS_KEY_PATH: z.string().optional(),
  UGV_DEVICE_MCP_HEADERS_FILE: z.string().optional(),
  UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT: z.boolean(),
  UGV_ALLOW_NAVIGATION_WITH_RECON: z.boolean(),
  UGV_FIRE_ENABLED: z.boolean(),
  UGV_FIRE_REQUIRES_CHASSIS_STOPPED: z.boolean(),
  PROVIDER_TELEMETRY_ENABLED: z.boolean(),
  ALLOW_INSECURE_INTERNAL_TRANSPORT: z.boolean(),
  PROVIDER_TELEMETRY_TLS_CA_PATH: z.string().optional(),
  PROVIDER_TELEMETRY_TLS_CERT_PATH: z.string().optional(),
  PROVIDER_TELEMETRY_TLS_KEY_PATH: z.string().optional(),
});

export type UgvProviderConfiguration = z.infer<typeof UgvProviderResolvedSchema>;

export function loadUgvProviderConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): UgvProviderConfiguration {
  return UgvProviderResolvedSchema.parse(UgvProviderInputSchema.parse(environment));
}

const secretKeys = new Set([
  "ADAPTER_TLS_KEY_PATH",
  "UGV_ADAPTER_DATABASE_URL",
  "UGV_MQTT_PASSWORD_FILE",
  "UGV_MQTT_TLS_KEY_PATH",
  "UGV_DEVICE_MCP_HEADERS_FILE",
  "PROVIDER_TELEMETRY_TLS_KEY_PATH",
]);
const configurationKeys = Object.keys(UgvProviderResolvedSchema.shape);
const defaults = loadUgvProviderConfiguration({});
const configurationSchema = z.toJSONSchema(UgvProviderResolvedSchema);
const configurationProperties = configurationSchema.properties as
  Record<string, { default?: unknown }> | undefined;
if (Array.isArray(configurationSchema.required)) {
  configurationSchema.required = configurationSchema.required.filter((key) => !secretKeys.has(key));
}
for (const key of secretKeys) {
  const property = configurationProperties?.[key];
  if (property !== undefined) delete property.default;
}

export const UgvProviderConfigurationDefinition = parseConfigurationDefinition({
  schemaVersion: "1.0",
  definitionId: "provider.ugv",
  definitionVersion: 1,
  configGroup: "provider.ugv",
  targetTypes: ["provider_type", "provider"],
  inheritance: {
    enabled: true,
    order: ["provider", "provider_type", "system_default"],
  },
  schema: configurationSchema,
  defaults: Object.fromEntries(Object.entries(defaults).filter(([key]) => !secretKeys.has(key))),
  secretPaths: configurationKeys.filter((key) => secretKeys.has(key)).map((key) => `/${key}`),
  fields: configurationKeys.map((key) => {
    const immutable =
      key === "PROVIDER_ID" ||
      key === "PROVIDER_VERSION" ||
      key === "UGV_RESOURCE_ID" ||
      key === "UGV_ENTITY_ID" ||
      key === "UGV_VEHICLE_TYPE" ||
      key === "UGV_EXECUTION_MODE";
    return {
      path: `/${key}`,
      displayName: key,
      description: `UGV Provider ${key.toLowerCase()} setting.`,
      applyMode: immutable ? "immutable" : "restart_required",
      required: false,
      secret: secretKeys.has(key),
      overridePolicy: immutable
        ? { mode: "forbidden" }
        : {
            mode: "inheritable",
            allowedTargetTypes: ["provider_type", "provider"],
          },
    };
  }),
});
