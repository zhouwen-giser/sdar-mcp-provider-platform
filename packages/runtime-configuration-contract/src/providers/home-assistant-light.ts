import { readFileSync } from "node:fs";
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

const HomeAssistantLightInputBaseSchema = z.object({
  PROVIDER_ID: z.string().min(1).default("home-assistant-light"),
  PROVIDER_VERSION: z.string().min(1).default("0.1.0"),
  ADAPTER_HOST: z.string().min(1).default("0.0.0.0"),
  ADAPTER_PORT: z.coerce.number().int().min(1).max(65_535).default(7021),
  ADAPTER_TLS_MODE: tls.default("disabled"),
  ADAPTER_TLS_CA_PATH: optionalPath,
  ADAPTER_TLS_CERT_PATH: optionalPath,
  ADAPTER_TLS_KEY_PATH: optionalPath,
  HOME_ASSISTANT_URL: z.url(),
  HOME_ASSISTANT_TOKEN_FILE: z.string().min(1),
  HOME_ASSISTANT_ALLOW_INSECURE_HTTP: bool.default(false),
  HOME_ASSISTANT_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  HOME_ASSISTANT_CONFIRM_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  HOME_ASSISTANT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  HOME_ASSISTANT_WS_RECONNECT_MIN_MS: z.coerce.number().int().positive().default(500),
  HOME_ASSISTANT_WS_RECONNECT_MAX_MS: z.coerce.number().int().positive().default(30_000),
  LIGHT_RESOURCES_FILE: z.string().min(1),
  PROVIDER_STATE_PATH: z.string().min(1),
  PROVIDER_TELEMETRY_ENABLED: bool.default(true),
  PROVIDER_TELEMETRY_ENDPOINT: z.string().min(1).default("127.0.0.1:7003"),
  PROVIDER_TELEMETRY_TLS_MODE: tls.default("disabled"),
  PROVIDER_TELEMETRY_TLS_CA_PATH: optionalPath,
  PROVIDER_TELEMETRY_TLS_CERT_PATH: optionalPath,
  PROVIDER_TELEMETRY_TLS_KEY_PATH: optionalPath,
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  RUNTIME_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export const HomeAssistantLightResolvedSchema = HomeAssistantLightInputBaseSchema.extend({
  ADAPTER_TLS_CA_PATH: z.string().optional(),
  ADAPTER_TLS_CERT_PATH: z.string().optional(),
  ADAPTER_TLS_KEY_PATH: z.string().optional(),
  HOME_ASSISTANT_ALLOW_INSECURE_HTTP: z.boolean(),
  PROVIDER_TELEMETRY_ENABLED: z.boolean(),
  PROVIDER_TELEMETRY_TLS_CA_PATH: z.string().optional(),
  PROVIDER_TELEMETRY_TLS_CERT_PATH: z.string().optional(),
  PROVIDER_TELEMETRY_TLS_KEY_PATH: z.string().optional(),
});

export type HomeAssistantLightConfiguration = z.infer<typeof HomeAssistantLightResolvedSchema> & {
  homeAssistantToken: string;
};

export function loadHomeAssistantLightConfiguration(
  environment: NodeJS.ProcessEnv,
): HomeAssistantLightConfiguration {
  if (Object.hasOwn(environment, "HOME_ASSISTANT_TOKEN")) {
    throw new Error("HOME_ASSISTANT_TOKEN_ENVIRONMENT_FORBIDDEN");
  }
  const value = HomeAssistantLightResolvedSchema.parse(
    HomeAssistantLightInputBaseSchema.parse(environment),
  );
  const url = new URL(value.HOME_ASSISTANT_URL);
  if (
    value.RUNTIME_ENV === "production" &&
    url.protocol === "http:" &&
    !value.HOME_ASSISTANT_ALLOW_INSECURE_HTTP
  ) {
    throw new Error("HOME_ASSISTANT_INSECURE_HTTP_FORBIDDEN");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol))
    throw new Error("HOME_ASSISTANT_URL_PROTOCOL_INVALID");
  if (url.username || url.password || url.search || url.hash)
    throw new Error("HOME_ASSISTANT_URL_SENSITIVE_COMPONENT_FORBIDDEN");
  validateTls(
    value.ADAPTER_TLS_MODE,
    value.ADAPTER_TLS_CA_PATH,
    value.ADAPTER_TLS_CERT_PATH,
    value.ADAPTER_TLS_KEY_PATH,
    "ADAPTER",
  );
  if (value.PROVIDER_TELEMETRY_ENABLED)
    validateTls(
      value.PROVIDER_TELEMETRY_TLS_MODE,
      value.PROVIDER_TELEMETRY_TLS_CA_PATH,
      value.PROVIDER_TELEMETRY_TLS_CERT_PATH,
      value.PROVIDER_TELEMETRY_TLS_KEY_PATH,
      "PROVIDER_TELEMETRY",
    );
  let homeAssistantToken: string;
  try {
    homeAssistantToken = readFileSync(value.HOME_ASSISTANT_TOKEN_FILE, "utf8").trim();
  } catch (cause) {
    throw new Error("HOME_ASSISTANT_TOKEN_FILE_READ_FAILED", { cause });
  }
  if (!homeAssistantToken) throw new Error("HOME_ASSISTANT_TOKEN_FILE_EMPTY");
  return { ...value, homeAssistantToken };
}

export function homeAssistantLightLogContext(
  configuration: HomeAssistantLightConfiguration,
): Readonly<{ providerId: string; providerVersion: string; port: number }> {
  return {
    providerId: configuration.PROVIDER_ID,
    providerVersion: configuration.PROVIDER_VERSION,
    port: configuration.ADAPTER_PORT,
  };
}

const secretKeys = new Set([
  "ADAPTER_TLS_KEY_PATH",
  "HOME_ASSISTANT_TOKEN_FILE",
  "PROVIDER_TELEMETRY_TLS_KEY_PATH",
]);
const configurationKeys = Object.keys(HomeAssistantLightResolvedSchema.shape);
const configurationSchema = z.toJSONSchema(HomeAssistantLightResolvedSchema);
const configurationProperties = configurationSchema.properties as
  Record<string, { default?: unknown }> | undefined;
for (const key of secretKeys) {
  const property = configurationProperties?.[key];
  if (property !== undefined) delete property.default;
}

export const HomeAssistantLightConfigurationDefinition = parseConfigurationDefinition({
  schemaVersion: "1.0",
  definitionId: "provider.homeAssistantLight",
  definitionVersion: 1,
  configGroup: "provider.homeAssistantLight",
  targetTypes: ["provider_type", "provider"],
  inheritance: { enabled: true, order: ["provider", "provider_type", "system_default"] },
  schema: configurationSchema,
  defaults: {
    PROVIDER_ID: "home-assistant-light",
    PROVIDER_VERSION: "0.1.0",
    ADAPTER_HOST: "0.0.0.0",
    ADAPTER_PORT: 7021,
    ADAPTER_TLS_MODE: "disabled",
    HOME_ASSISTANT_ALLOW_INSECURE_HTTP: false,
    HOME_ASSISTANT_REQUEST_TIMEOUT_MS: 5_000,
    HOME_ASSISTANT_CONFIRM_TIMEOUT_MS: 15_000,
    HOME_ASSISTANT_POLL_INTERVAL_MS: 500,
    HOME_ASSISTANT_WS_RECONNECT_MIN_MS: 500,
    HOME_ASSISTANT_WS_RECONNECT_MAX_MS: 30_000,
    PROVIDER_TELEMETRY_ENABLED: true,
    PROVIDER_TELEMETRY_ENDPOINT: "127.0.0.1:7003",
    PROVIDER_TELEMETRY_TLS_MODE: "disabled",
    LOG_LEVEL: "info",
    RUNTIME_ENV: "development",
  },
  secretPaths: configurationKeys.filter((key) => secretKeys.has(key)).map((key) => `/${key}`),
  fields: configurationKeys.map((key) => {
    const immutable = key === "PROVIDER_ID" || key === "PROVIDER_VERSION";
    return {
      path: `/${key}`,
      displayName: key,
      description: `Home Assistant Light Provider ${key.toLowerCase()} setting.`,
      applyMode: immutable ? "immutable" : "restart_required",
      required: [
        "HOME_ASSISTANT_URL",
        "HOME_ASSISTANT_TOKEN_FILE",
        "LIGHT_RESOURCES_FILE",
        "PROVIDER_STATE_PATH",
      ].includes(key),
      secret: secretKeys.has(key),
      overridePolicy: immutable
        ? { mode: "forbidden" }
        : { mode: "inheritable", allowedTargetTypes: ["provider_type", "provider"] },
    };
  }),
});

function validateTls(
  mode: "disabled" | "required",
  ca: string | undefined,
  cert: string | undefined,
  key: string | undefined,
  prefix: string,
): void {
  if (mode === "required" && (ca === undefined || cert === undefined || key === undefined))
    throw new Error(`${prefix}_MTLS_FILES_REQUIRED`);
}
