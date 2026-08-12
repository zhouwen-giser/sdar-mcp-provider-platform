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

const NpcTankProviderInputBaseSchema = z.object({
  PROVIDER_ID: z.string().min(1).default("isr.vehicle.npc-tank.npc-tank1"),
  PROVIDER_VERSION: z.string().min(1).default("0.1.0"),
  ADAPTER_HOST: z.string().min(1).default("0.0.0.0"),
  ADAPTER_PORT: z.coerce.number().int().min(1).max(65_535).default(7013),
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
  NPC_TANK_MQTT_RECONNECT_MAX_MS: z.coerce.number().int().min(500).default(30_000),
  NPC_TANK_MQTT_MAX_PAYLOAD_BYTES: z.coerce.number().int().min(128).max(1_048_576).default(65_536),
  NPC_TANK_MQTT_MAX_JSON_DEPTH: z.coerce.number().int().min(1).max(64).default(16),
  NPC_TANK_MQTT_MAX_JSON_NODES: z.coerce.number().int().min(16).max(100_000).default(4_096),
  NPC_TANK_MQTT_MAX_STRING_BYTES: z.coerce.number().int().min(64).max(1_048_576).default(16_384),
  NPC_TANK_MQTT_WIRE_MODE: z
    .enum(["auto", "ros_message_json", "direct_domain_json", "ros_bridge_json"])
    .default("auto"),
  NPC_TANK_CHASSIS_FRESHNESS_MS: z.coerce.number().int().positive().default(3_000),
  NPC_TANK_MISSION_FRESHNESS_MS: z.coerce.number().int().positive().default(3_000),
  NPC_TANK_HEALTH_FRESHNESS_MS: z.coerce.number().int().positive().default(5_000),
  NPC_TANK_TARGET_FRESHNESS_MS: z.coerce.number().int().positive().default(3_000),
  NPC_TANK_PAYLOAD_FRESHNESS_MS: z.coerce.number().int().positive().default(3_000),
  NPC_TANK_DEVICE_MCP_URL: z.url().default("http://127.0.0.1:19003/mcp"),
  NPC_TANK_DEVICE_MCP_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
  NPC_TANK_DEVICE_MCP_TLS_MODE: tls.default("disabled"),
  NPC_TANK_DEVICE_MCP_HEADERS_FILE: optionalPath,
  NPC_TANK_DEVICE_MCP_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(1_048_576)
    .default(65_536),
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
  ALLOW_INSECURE_INTERNAL_TRANSPORT: bool.default(false),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

const NpcTankProviderInputSchema = NpcTankProviderInputBaseSchema.superRefine((value, context) => {
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
    if (!value.ALLOW_INSECURE_INTERNAL_TRANSPORT && value.ADAPTER_TLS_MODE !== "required")
      context.addIssue({ code: "custom", message: "PRODUCTION_ADAPTER_MTLS_REQUIRED" });
    if (!value.ALLOW_INSECURE_INTERNAL_TRANSPORT && value.NPC_TANK_MQTT_TLS_MODE !== "required")
      context.addIssue({ code: "custom", message: "PRODUCTION_MQTT_TLS_REQUIRED" });
    if (value.NPC_TANK_MQTT_WIRE_MODE === "auto")
      context.addIssue({ code: "custom", message: "PRODUCTION_MQTT_WIRE_MODE_MUST_BE_EXPLICIT" });
    if (value.NPC_TANK_ADAPTER_STORE_MODE !== "postgres")
      context.addIssue({ code: "custom", message: "PRODUCTION_POSTGRES_STORE_REQUIRED" });
  }
});

export const NpcTankProviderResolvedSchema = NpcTankProviderInputBaseSchema.extend({
  ADAPTER_TLS_CA_PATH: z.string().optional(),
  ADAPTER_TLS_CERT_PATH: z.string().optional(),
  ADAPTER_TLS_KEY_PATH: z.string().optional(),
  NPC_TANK_MQTT_USERNAME: z.string().optional(),
  NPC_TANK_MQTT_PASSWORD_FILE: z.string().optional(),
  NPC_TANK_MQTT_TLS_CA_PATH: z.string().optional(),
  NPC_TANK_MQTT_TLS_CERT_PATH: z.string().optional(),
  NPC_TANK_MQTT_TLS_KEY_PATH: z.string().optional(),
  NPC_TANK_DEVICE_MCP_HEADERS_FILE: z.string().optional(),
  NPC_TANK_DEVICE_MCP_ALLOW_MOCK_CONTRACT: z.boolean(),
  NPC_TANK_ALLOW_NAVIGATION_WITH_RECON: z.boolean(),
  NPC_TANK_FIRE_REQUIRES_CHASSIS_STOPPED: z.boolean(),
  PROVIDER_TELEMETRY_ENABLED: z.boolean(),
  ALLOW_INSECURE_INTERNAL_TRANSPORT: z.boolean(),
  PROVIDER_TELEMETRY_TLS_CA_PATH: z.string().optional(),
  PROVIDER_TELEMETRY_TLS_CERT_PATH: z.string().optional(),
  PROVIDER_TELEMETRY_TLS_KEY_PATH: z.string().optional(),
});

export type NpcTankProviderConfiguration = z.infer<typeof NpcTankProviderResolvedSchema>;

export function loadNpcTankProviderConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): NpcTankProviderConfiguration {
  return NpcTankProviderResolvedSchema.parse(NpcTankProviderInputSchema.parse(environment));
}

const secretKeys = new Set([
  "ADAPTER_TLS_KEY_PATH",
  "NPC_TANK_ADAPTER_DATABASE_URL",
  "NPC_TANK_MQTT_PASSWORD_FILE",
  "NPC_TANK_MQTT_TLS_KEY_PATH",
  "NPC_TANK_DEVICE_MCP_HEADERS_FILE",
  "PROVIDER_TELEMETRY_TLS_KEY_PATH",
]);
const configurationKeys = Object.keys(NpcTankProviderResolvedSchema.shape);
const defaults = loadNpcTankProviderConfiguration({});
const configurationSchema = z.toJSONSchema(NpcTankProviderResolvedSchema);
const configurationProperties = configurationSchema.properties as
  Record<string, { default?: unknown }> | undefined;
if (Array.isArray(configurationSchema.required)) {
  configurationSchema.required = configurationSchema.required.filter((key) => !secretKeys.has(key));
}
for (const key of secretKeys) {
  const property = configurationProperties?.[key];
  if (property !== undefined) delete property.default;
}

export const NpcTankProviderConfigurationDefinition = parseConfigurationDefinition({
  schemaVersion: "1.0",
  definitionId: "provider.npcTank",
  definitionVersion: 1,
  configGroup: "provider.npcTank",
  targetTypes: ["provider_type", "provider"],
  inheritance: {
    enabled: true,
    order: ["provider", "provider_type", "system_default"],
  },
  schema: configurationSchema,
  defaults: Object.fromEntries(Object.entries(defaults).filter(([key]) => !secretKeys.has(key))),
  secretPaths: configurationKeys.filter((key) => secretKeys.has(key)).map((key) => `/${key}`),
  fields: configurationKeys.map((key) => {
    const immutable = key === "PROVIDER_ID" || key === "PROVIDER_VERSION";
    return {
      path: `/${key}`,
      displayName: key,
      description: `NPC Tank Provider ${key.toLowerCase()} setting.`,
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
