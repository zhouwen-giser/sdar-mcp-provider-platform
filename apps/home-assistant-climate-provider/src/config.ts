import { readFileSync } from "node:fs";
import { z } from "zod";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");
const path = z
  .string()
  .transform((v) => v.trim() || undefined)
  .optional();
const tls = z.enum(["disabled", "required"]);
const schema = z.object({
  PROVIDER_ID: z.string().min(1).default("home-assistant-climate"),
  PROVIDER_VERSION: z.string().min(1).default("0.1.0"),
  ADAPTER_HOST: z.string().min(1).default("0.0.0.0"),
  ADAPTER_PORT: z.coerce.number().int().min(1).max(65535).default(7020),
  ADAPTER_TLS_MODE: tls.default("disabled"),
  ADAPTER_TLS_CA_PATH: path,
  ADAPTER_TLS_CERT_PATH: path,
  ADAPTER_TLS_KEY_PATH: path,
  HOME_ASSISTANT_URL: z.url(),
  HOME_ASSISTANT_TOKEN_FILE: z.string().min(1),
  HOME_ASSISTANT_ALLOW_INSECURE_HTTP: bool.default(false),
  HOME_ASSISTANT_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  HOME_ASSISTANT_CONFIRM_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  HOME_ASSISTANT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  HOME_ASSISTANT_WS_RECONNECT_MIN_MS: z.coerce.number().int().positive().default(500),
  HOME_ASSISTANT_WS_RECONNECT_MAX_MS: z.coerce.number().int().positive().default(30000),
  CLIMATE_RESOURCES_FILE: z.string().min(1),
  PROVIDER_STATE_PATH: z.string().min(1),
  PROVIDER_TELEMETRY_ENABLED: bool.default(true),
  PROVIDER_TELEMETRY_ENDPOINT: z.string().min(1).default("127.0.0.1:7002"),
  PROVIDER_TELEMETRY_TLS_MODE: tls.default("disabled"),
  PROVIDER_TELEMETRY_TLS_CA_PATH: path,
  PROVIDER_TELEMETRY_TLS_CERT_PATH: path,
  PROVIDER_TELEMETRY_TLS_KEY_PATH: path,
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  RUNTIME_ENV: z.enum(["development", "test", "production"]).default("development"),
});
export type ClimateProviderConfig = z.infer<typeof schema> & { homeAssistantToken: string };

export function loadClimateConfig(env: NodeJS.ProcessEnv): ClimateProviderConfig {
  if (Object.hasOwn(env, "HOME_ASSISTANT_TOKEN"))
    throw new Error("HOME_ASSISTANT_TOKEN_ENVIRONMENT_FORBIDDEN");
  const value = schema.parse(env);
  const url = new URL(value.HOME_ASSISTANT_URL);
  if (
    value.RUNTIME_ENV === "production" &&
    url.protocol === "http:" &&
    !value.HOME_ASSISTANT_ALLOW_INSECURE_HTTP
  )
    throw new Error("HOME_ASSISTANT_INSECURE_HTTP_FORBIDDEN");
  if (!new Set(["http:", "https:"]).has(url.protocol))
    throw new Error("HOME_ASSISTANT_URL_PROTOCOL_INVALID");
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
  const homeAssistantToken = readFileSync(value.HOME_ASSISTANT_TOKEN_FILE, "utf8").trim();
  if (!homeAssistantToken) throw new Error("HOME_ASSISTANT_TOKEN_FILE_EMPTY");
  return { ...value, homeAssistantToken };
}
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
