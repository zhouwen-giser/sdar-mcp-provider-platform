import { z } from "zod";
import { parseConfigurationDefinition } from "../model.js";

const BooleanEnvironmentSchema = z
  .union([z.string(), z.boolean()])
  .transform((value) => parseBooleanEnvironment(value));

const RuntimeObservabilityInputSchema = z
  .object({
    RUNTIME_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.string().default("info"),
    OTEL_ENABLED: BooleanEnvironmentSchema.default(false),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().default("http://127.0.0.1:4318"),
    OTEL_EXPORTER_OTLP_TLS_MODE: z.enum(["disabled", "required"]).default("disabled"),
    OTEL_EXPORTER_OTLP_CA_PATH: z.string().min(1).optional(),
    OTEL_EXPORTER_OTLP_CERT_PATH: z.string().min(1).optional(),
    OTEL_EXPORTER_OTLP_KEY_PATH: z.string().min(1).optional(),
    OTEL_EXPORTER_OTLP_HEADERS_FILE: z.string().min(1).optional(),
    OTEL_EXPORTER_OTLP_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
    OTEL_SERVICE_INSTANCE_ID: z.string().min(1).max(256).optional(),
  })
  .superRefine((value, context) => {
    if (
      value.OTEL_EXPORTER_OTLP_TLS_MODE === "required" &&
      (value.OTEL_EXPORTER_OTLP_CA_PATH === undefined ||
        value.OTEL_EXPORTER_OTLP_CERT_PATH === undefined ||
        value.OTEL_EXPORTER_OTLP_KEY_PATH === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "OTLP mTLS requires CA, certificate, and key paths",
      });
    }
    if (
      value.RUNTIME_ENV === "production" &&
      value.OTEL_ENABLED &&
      !value.OTEL_EXPORTER_OTLP_ENDPOINT.toLowerCase().startsWith("https://")
    ) {
      context.addIssue({ code: "custom", message: "production OTLP requires HTTPS" });
    }
  });

export const RuntimeObservabilityResolvedSchema = z.object({
  LOG_LEVEL: z.string(),
  OTEL_ENABLED: z.boolean(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url(),
  OTEL_EXPORTER_OTLP_TLS_MODE: z.enum(["disabled", "required"]),
  OTEL_EXPORTER_OTLP_CA_PATH: z.string().min(1).optional(),
  OTEL_EXPORTER_OTLP_CERT_PATH: z.string().min(1).optional(),
  OTEL_EXPORTER_OTLP_KEY_PATH: z.string().min(1).optional(),
  OTEL_EXPORTER_OTLP_HEADERS_FILE: z.string().min(1).optional(),
  OTEL_EXPORTER_OTLP_TIMEOUT_MS: z.number().int().min(100).max(60_000),
  OTEL_SERVICE_INSTANCE_ID: z.string().min(1).max(256).optional(),
});

export type RuntimeObservabilityEnvironment = z.infer<typeof RuntimeObservabilityResolvedSchema>;
export type RuntimeObservabilityEffectivePlainOutput = Omit<
  RuntimeObservabilityEnvironment,
  | "OTEL_EXPORTER_OTLP_CA_PATH"
  | "OTEL_EXPORTER_OTLP_CERT_PATH"
  | "OTEL_EXPORTER_OTLP_KEY_PATH"
  | "OTEL_EXPORTER_OTLP_HEADERS_FILE"
>;

export function loadRuntimeObservabilityEnvironment(
  environment: NodeJS.ProcessEnv,
): RuntimeObservabilityEnvironment {
  const value = RuntimeObservabilityInputSchema.parse(environment);
  return RuntimeObservabilityResolvedSchema.parse(value);
}

export function toRuntimeObservabilityEffectivePlainOutput(
  value: RuntimeObservabilityEnvironment,
): RuntimeObservabilityEffectivePlainOutput {
  return {
    LOG_LEVEL: value.LOG_LEVEL,
    OTEL_ENABLED: value.OTEL_ENABLED,
    OTEL_EXPORTER_OTLP_ENDPOINT: value.OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_EXPORTER_OTLP_TLS_MODE: value.OTEL_EXPORTER_OTLP_TLS_MODE,
    OTEL_EXPORTER_OTLP_TIMEOUT_MS: value.OTEL_EXPORTER_OTLP_TIMEOUT_MS,
    OTEL_SERVICE_INSTANCE_ID: value.OTEL_SERVICE_INSTANCE_ID,
  };
}

export const RuntimeObservabilityConfigurationDefinition = parseConfigurationDefinition({
  schemaVersion: "1.0",
  definitionId: "runtime.observability",
  definitionVersion: 1,
  configGroup: "runtime.observability",
  targetTypes: ["runtime_deployment", "runtime_instance"],
  inheritance: {
    enabled: true,
    order: ["runtime_instance", "runtime_deployment", "system_default"],
  },
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      LOG_LEVEL: { type: "string" },
      OTEL_ENABLED: { type: "boolean" },
      OTEL_EXPORTER_OTLP_ENDPOINT: { type: "string", format: "uri" },
      OTEL_EXPORTER_OTLP_TLS_MODE: { enum: ["disabled", "required"] },
      OTEL_EXPORTER_OTLP_CA_PATH: { type: "string", minLength: 1 },
      OTEL_EXPORTER_OTLP_CERT_PATH: { type: "string", minLength: 1 },
      OTEL_EXPORTER_OTLP_KEY_PATH: { type: "string", minLength: 1 },
      OTEL_EXPORTER_OTLP_HEADERS_FILE: { type: "string", minLength: 1 },
      OTEL_EXPORTER_OTLP_TIMEOUT_MS: { type: "integer", minimum: 100, maximum: 60_000 },
      OTEL_SERVICE_INSTANCE_ID: { type: "string", minLength: 1, maxLength: 256 },
    },
  },
  defaults: {
    LOG_LEVEL: "info",
    OTEL_ENABLED: false,
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
    OTEL_EXPORTER_OTLP_TLS_MODE: "disabled",
    OTEL_EXPORTER_OTLP_TIMEOUT_MS: 10_000,
  },
  secretPaths: [
    "/OTEL_EXPORTER_OTLP_CA_PATH",
    "/OTEL_EXPORTER_OTLP_CERT_PATH",
    "/OTEL_EXPORTER_OTLP_KEY_PATH",
    "/OTEL_EXPORTER_OTLP_HEADERS_FILE",
  ],
  fields: [
    field("LOG_LEVEL", "Log level", "Runtime structured log verbosity.", "hot_reload", false),
    field(
      "OTEL_ENABLED",
      "OpenTelemetry enabled",
      "Enables Runtime metrics, traces, and logs export.",
      "hot_reload",
      false,
    ),
    field(
      "OTEL_EXPORTER_OTLP_ENDPOINT",
      "OTLP endpoint",
      "OpenTelemetry collector endpoint.",
      "reconnect_required",
      false,
    ),
    field(
      "OTEL_EXPORTER_OTLP_TLS_MODE",
      "OTLP TLS mode",
      "OpenTelemetry collector transport security mode.",
      "reconnect_required",
      false,
    ),
    field(
      "OTEL_EXPORTER_OTLP_CA_PATH",
      "OTLP CA SecretRef",
      "File reference for the OTLP trust anchor.",
      "reconnect_required",
      true,
    ),
    field(
      "OTEL_EXPORTER_OTLP_CERT_PATH",
      "OTLP certificate SecretRef",
      "File reference for the OTLP client certificate.",
      "reconnect_required",
      true,
    ),
    field(
      "OTEL_EXPORTER_OTLP_KEY_PATH",
      "OTLP key SecretRef",
      "File reference for the OTLP client private key.",
      "reconnect_required",
      true,
    ),
    field(
      "OTEL_EXPORTER_OTLP_HEADERS_FILE",
      "OTLP headers SecretRef",
      "File reference for secret OTLP request headers.",
      "reconnect_required",
      true,
    ),
    field(
      "OTEL_EXPORTER_OTLP_TIMEOUT_MS",
      "OTLP timeout",
      "OpenTelemetry export timeout in milliseconds.",
      "reconnect_required",
      false,
    ),
    field(
      "OTEL_SERVICE_INSTANCE_ID",
      "Telemetry instance ID",
      "Stable Runtime telemetry resource instance identity.",
      "restart_required",
      false,
    ),
  ],
});

function field(
  path: string,
  displayName: string,
  description: string,
  applyMode: "hot_reload" | "reconnect_required" | "restart_required",
  secret: boolean,
) {
  return {
    path: `/${path}`,
    displayName,
    description,
    applyMode,
    required: false,
    secret,
    overridePolicy: {
      mode: "inheritable",
      allowedTargetTypes: ["runtime_deployment", "runtime_instance"],
    },
  };
}

function parseBooleanEnvironment(value: string | boolean): boolean {
  if (typeof value === "boolean") return value;
  switch (value.toLowerCase()) {
    case "true":
    case "1":
      return true;
    case "false":
    case "0":
      return false;
    default:
      throw new Error(`INVALID_BOOLEAN_ENV:${value}`);
  }
}
