import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");
const optionalPath = z
  .string()
  .transform((value) => value.trim() || undefined)
  .optional();
const tls = z.enum(["disabled", "required"]);
const schema = z
  .object({
    PROVIDER_ID: z.string().min(1).default("isr.vehicle.ugv.ugv1"),
    PROVIDER_VERSION: z.string().min(1).default("1.0.0"),
    ADAPTER_HOST: z.string().min(1).default("0.0.0.0"),
    ADAPTER_PORT: z.coerce.number().int().min(1).max(65535).default(7010),
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
    UGV_MQTT_RECONNECT_MAX_MS: z.coerce.number().int().min(500).default(30000),
    UGV_MQTT_MAX_PAYLOAD_BYTES: z.coerce.number().int().min(128).max(1048576).default(65536),
    UGV_MQTT_MAX_JSON_DEPTH: z.coerce.number().int().min(1).max(64).default(16),
    UGV_MQTT_MAX_JSON_NODES: z.coerce.number().int().min(16).max(100000).default(4096),
    UGV_MQTT_MAX_STRING_BYTES: z.coerce.number().int().min(64).max(1048576).default(16384),
    UGV_MQTT_WIRE_MODE: z.enum(["auto", "ros_message_json", "direct_domain_json"]).default("auto"),
    UGV_CHASSIS_FRESHNESS_MS: z.coerce.number().int().positive().default(3000),
    UGV_MISSION_FRESHNESS_MS: z.coerce.number().int().positive().default(3000),
    UGV_HEALTH_FRESHNESS_MS: z.coerce.number().int().positive().default(5000),
    UGV_TARGET_FRESHNESS_MS: z.coerce.number().int().positive().default(3000),
    UGV_PAYLOAD_FRESHNESS_MS: z.coerce.number().int().positive().default(3000),
    UGV_DEVICE_MCP_URL: z.url().default("http://127.0.0.1:19000/mcp"),
    UGV_DEVICE_MCP_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(5000),
    UGV_DEVICE_MCP_TLS_MODE: tls.default("disabled"),
    UGV_DEVICE_MCP_HEADERS_FILE: optionalPath,
    UGV_DEVICE_MCP_MAX_RESPONSE_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(1048576)
      .default(65536),
    UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT: bool.default(false),
    UGV_DEVICE_MCP_CONTRACT_REPORT_PATH: z
      .string()
      .min(1)
      .default("reports/ugv-provider-v1/external-contract/ugv-device-mcp-tools.json"),
    UGV_ALLOW_NAVIGATION_WITH_RECON: bool.default(true),
    UGV_FIRE_REQUIRES_CHASSIS_STOPPED: bool.default(true),
    UGV_EXECUTION_POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(250),
    PROVIDER_TELEMETRY_ENABLED: bool.default(true),
    PROVIDER_TELEMETRY_ENDPOINT: z.string().min(1).default("127.0.0.1:7002"),
    PROVIDER_TELEMETRY_TLS_MODE: tls.default("disabled"),
    PROVIDER_TELEMETRY_TLS_CA_PATH: optionalPath,
    PROVIDER_TELEMETRY_TLS_CERT_PATH: optionalPath,
    PROVIDER_TELEMETRY_TLS_KEY_PATH: optionalPath,
    RUNTIME_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  })
  .superRefine((value, context) => {
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
      if (value.ADAPTER_TLS_MODE !== "required")
        context.addIssue({ code: "custom", message: "PRODUCTION_ADAPTER_MTLS_REQUIRED" });
      if (value.UGV_MQTT_TLS_MODE !== "required")
        context.addIssue({ code: "custom", message: "PRODUCTION_MQTT_TLS_REQUIRED" });
      if (value.UGV_MQTT_WIRE_MODE === "auto")
        context.addIssue({ code: "custom", message: "PRODUCTION_MQTT_WIRE_MODE_MUST_BE_EXPLICIT" });
      if (value.UGV_ADAPTER_STORE_MODE !== "postgres")
        context.addIssue({ code: "custom", message: "PRODUCTION_POSTGRES_STORE_REQUIRED" });
    }
  });

export type UgvProviderConfig = z.infer<typeof schema>;
export function loadUgvProviderConfig(
  environment: NodeJS.ProcessEnv = process.env,
): UgvProviderConfig {
  return schema.parse(environment);
}
