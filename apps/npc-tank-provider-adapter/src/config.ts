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
    PROVIDER_ID: z.string().min(1).default("isr.vehicle.npc-tank.npc-tank1"),
    PROVIDER_VERSION: z.string().min(1).default("0.1.0"),
    ADAPTER_HOST: z.string().min(1).default("0.0.0.0"),
    ADAPTER_PORT: z.coerce.number().int().min(1).max(65535).default(7013),
    ADAPTER_TLS_MODE: tls.default("disabled"),
    ADAPTER_TLS_CA_PATH: optionalPath,
    ADAPTER_TLS_CERT_PATH: optionalPath,
    ADAPTER_TLS_KEY_PATH: optionalPath,
    NPC_TANK_ADAPTER_STORE_MODE: z.enum(["postgres", "memory"]).default("postgres"),
    NPC_TANK_ADAPTER_DATABASE_URL: z
      .url()
      .default("postgresql://npc_adapter:npc_adapter@127.0.0.1:5436/npc_adapter"),
    NPC_TANK_ADAPTER_DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(32).default(8),
    NPC_TANK_MQTT_URL: z.string().min(1).default("mqtt://127.0.0.1:1886"),
    NPC_TANK_MQTT_CLIENT_ID: z.string().min(1).default("sdar-npc-tank-adapter-npc-tank1"),
    NPC_TANK_MQTT_USERNAME: optionalPath,
    NPC_TANK_MQTT_PASSWORD_FILE: optionalPath,
    NPC_TANK_MQTT_TLS_MODE: tls.default("disabled"),
    NPC_TANK_MQTT_TLS_CA_PATH: optionalPath,
    NPC_TANK_MQTT_TLS_CERT_PATH: optionalPath,
    NPC_TANK_MQTT_TLS_KEY_PATH: optionalPath,
    NPC_TANK_MQTT_SESSION_MODE: z.enum(["clean", "persistent"]).default("persistent"),
    NPC_TANK_MQTT_RECONNECT_MIN_MS: z.coerce.number().int().min(100).default(500),
    NPC_TANK_MQTT_RECONNECT_MAX_MS: z.coerce.number().int().min(500).default(30000),
    NPC_TANK_MQTT_MAX_PAYLOAD_BYTES: z.coerce.number().int().min(128).max(1048576).default(65536),
    NPC_TANK_MQTT_MAX_JSON_DEPTH: z.coerce.number().int().min(1).max(64).default(16),
    NPC_TANK_MQTT_MAX_JSON_NODES: z.coerce.number().int().min(16).max(100000).default(4096),
    NPC_TANK_MQTT_MAX_STRING_BYTES: z.coerce.number().int().min(64).max(1048576).default(16384),
    NPC_TANK_MQTT_WIRE_MODE: z
      .enum(["auto", "ros_message_json", "direct_domain_json"])
      .default("auto"),
    NPC_TANK_CHASSIS_FRESHNESS_MS: z.coerce.number().int().positive().default(3000),
    NPC_TANK_MISSION_FRESHNESS_MS: z.coerce.number().int().positive().default(3000),
    NPC_TANK_HEALTH_FRESHNESS_MS: z.coerce.number().int().positive().default(5000),
    NPC_TANK_TARGET_FRESHNESS_MS: z.coerce.number().int().positive().default(3000),
    NPC_TANK_PAYLOAD_FRESHNESS_MS: z.coerce.number().int().positive().default(3000),
    NPC_TANK_DEVICE_MCP_URL: z.url().default("http://127.0.0.1:19003/mcp"),
    NPC_TANK_DEVICE_MCP_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(5000),
    NPC_TANK_DEVICE_MCP_TLS_MODE: tls.default("disabled"),
    NPC_TANK_DEVICE_MCP_HEADERS_FILE: optionalPath,
    NPC_TANK_DEVICE_MCP_MAX_RESPONSE_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(1048576)
      .default(65536),
    NPC_TANK_DEVICE_MCP_ALLOW_MOCK_CONTRACT: bool.default(false),
    NPC_TANK_DEVICE_MCP_CONTRACT_REPORT_PATH: z
      .string()
      .min(1)
      .default("reports/npc-tank-provider-v1/external-contract/npc-tank-device-mcp-tools.json"),
    NPC_TANK_NAVIGATION_SELECTION_REPORT_PATH: z
      .string()
      .min(1)
      .default("reports/npc-tank-provider-v1/navigation-tool-selection.json"),
    NPC_TANK_EO_SCAN_CAPABILITY_REPORT_PATH: z
      .string()
      .min(1)
      .default("reports/npc-tank-provider-v1/eo-scan-capability.json"),
    NPC_TANK_ALLOW_NAVIGATION_WITH_RECON: bool.default(true),
    NPC_TANK_FIRE_REQUIRES_CHASSIS_STOPPED: bool.default(true),
    NPC_TANK_EXECUTION_POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(250),
    PROVIDER_TELEMETRY_ENABLED: bool.default(true),
    PROVIDER_TELEMETRY_ENDPOINT: z.string().min(1).default("127.0.0.1:7005"),
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
        value.NPC_TANK_MQTT_TLS_MODE,
        value.NPC_TANK_MQTT_TLS_CA_PATH,
        value.NPC_TANK_MQTT_TLS_CERT_PATH,
        value.NPC_TANK_MQTT_TLS_KEY_PATH,
        "NPC_TANK_MQTT",
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
      if (value.NPC_TANK_MQTT_TLS_MODE !== "required")
        context.addIssue({ code: "custom", message: "PRODUCTION_MQTT_TLS_REQUIRED" });
      if (value.NPC_TANK_MQTT_WIRE_MODE === "auto")
        context.addIssue({ code: "custom", message: "PRODUCTION_MQTT_WIRE_MODE_MUST_BE_EXPLICIT" });
      if (value.NPC_TANK_ADAPTER_STORE_MODE !== "postgres")
        context.addIssue({ code: "custom", message: "PRODUCTION_POSTGRES_STORE_REQUIRED" });
    }
  });

export type NpcTankProviderConfig = z.infer<typeof schema>;
export function loadNpcTankProviderConfig(
  environment: NodeJS.ProcessEnv = process.env,
): NpcTankProviderConfig {
  return schema.parse(environment);
}
