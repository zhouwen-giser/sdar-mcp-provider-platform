import { readFileSync } from "node:fs";
import { z } from "zod";
import { parseConfigurationDefinition } from "../model.js";

const LEGACY_DATABASE_URL_DEFAULT = "postgresql://sdar:sdar@127.0.0.1:5432/sdar_runtime";

const AdapterEndpointSchema = z.string().refine(validAdapterEndpoint);

const RuntimeBootstrapInputSchema = z.object({
  RUNTIME_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  PROVIDER_ID: z.string().min(1).max(128).default("mock-provider"),
  DATABASE_URL: z.url().optional(),
  DATABASE_URL_FILE: z.string().min(1).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  ADAPTER_ENDPOINT: AdapterEndpointSchema.default("127.0.0.1:7001"),
  ADAPTER_TLS_MODE: z.enum(["disabled", "required"]).default("disabled"),
  ADAPTER_TLS_CA_PATH: z.string().min(1).optional(),
  ADAPTER_TLS_CERT_PATH: z.string().min(1).optional(),
  ADAPTER_TLS_KEY_PATH: z.string().min(1).optional(),
  ADAPTER_RPC_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(5_000),
});

export const RuntimeBootstrapResolvedSchema = z.object({
  RUNTIME_ENV: z.enum(["development", "test", "production"]),
  HOST: z.string(),
  PORT: z.number().int().min(1).max(65_535),
  PROVIDER_ID: z.string().min(1).max(128),
  DATABASE_URL: z.url(),
  DATABASE_POOL_MAX: z.number().int().min(1).max(100),
  ADAPTER_ENDPOINT: AdapterEndpointSchema,
  ADAPTER_TLS_MODE: z.enum(["disabled", "required"]),
  ADAPTER_TLS_CA_PATH: z.string().min(1).optional(),
  ADAPTER_TLS_CERT_PATH: z.string().min(1).optional(),
  ADAPTER_TLS_KEY_PATH: z.string().min(1).optional(),
  ADAPTER_RPC_TIMEOUT_MS: z.number().int().positive().max(60_000),
});

export type RuntimeBootstrapEnvironment = z.infer<typeof RuntimeBootstrapResolvedSchema>;
export type RuntimeSecretFileReader = (path: string) => string;
export type RuntimeSecretFileErrorCode =
  "DATABASE_URL_FILE_READ_FAILED" | "DATABASE_URL_FILE_EMPTY" | "DATABASE_URL_FILE_INVALID";

export class RuntimeSecretFileError extends Error {
  readonly code: RuntimeSecretFileErrorCode;

  constructor(code: RuntimeSecretFileErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = "RuntimeSecretFileError";
    this.code = code;
  }
}

export function loadRuntimeBootstrapEnvironment(
  environment: NodeJS.ProcessEnv,
  readSecretFile: RuntimeSecretFileReader = defaultSecretFileReader,
): RuntimeBootstrapEnvironment {
  const input = RuntimeBootstrapInputSchema.parse(environment);
  let databaseUrl = input.DATABASE_URL ?? LEGACY_DATABASE_URL_DEFAULT;

  if (input.DATABASE_URL_FILE !== undefined) {
    let fileValue: string;
    try {
      fileValue = readSecretFile(input.DATABASE_URL_FILE).trim();
    } catch (cause) {
      throw new RuntimeSecretFileError("DATABASE_URL_FILE_READ_FAILED", { cause });
    }
    if (fileValue.length === 0) {
      throw new RuntimeSecretFileError("DATABASE_URL_FILE_EMPTY");
    }
    if (!z.url().safeParse(fileValue).success) {
      throw new RuntimeSecretFileError("DATABASE_URL_FILE_INVALID");
    }
    databaseUrl = fileValue;
  }

  return RuntimeBootstrapResolvedSchema.parse({
    RUNTIME_ENV: input.RUNTIME_ENV,
    HOST: input.HOST,
    PORT: input.PORT,
    PROVIDER_ID: input.PROVIDER_ID,
    DATABASE_URL: databaseUrl,
    DATABASE_POOL_MAX: input.DATABASE_POOL_MAX,
    ADAPTER_ENDPOINT: input.ADAPTER_ENDPOINT,
    ADAPTER_TLS_MODE: input.ADAPTER_TLS_MODE,
    ADAPTER_TLS_CA_PATH: input.ADAPTER_TLS_CA_PATH,
    ADAPTER_TLS_CERT_PATH: input.ADAPTER_TLS_CERT_PATH,
    ADAPTER_TLS_KEY_PATH: input.ADAPTER_TLS_KEY_PATH,
    ADAPTER_RPC_TIMEOUT_MS: input.ADAPTER_RPC_TIMEOUT_MS,
  });
}

export const RuntimeBootstrapConfigurationDefinition = parseConfigurationDefinition({
  schemaVersion: "1.0",
  definitionId: "runtime.bootstrap",
  definitionVersion: 1,
  configGroup: "runtime.bootstrap",
  targetTypes: ["runtime_deployment", "runtime_instance"],
  inheritance: {
    enabled: true,
    order: ["runtime_instance", "runtime_deployment", "system_default"],
  },
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      RUNTIME_ENV: { enum: ["development", "test", "production"] },
      HOST: { type: "string" },
      PORT: { type: "integer", minimum: 1, maximum: 65_535 },
      PROVIDER_ID: { type: "string", minLength: 1, maxLength: 128 },
      DATABASE_URL: { type: "string", format: "uri" },
      DATABASE_URL_FILE: { type: "string", minLength: 1 },
      DATABASE_POOL_MAX: { type: "integer", minimum: 1, maximum: 100 },
      ADAPTER_ENDPOINT: { type: "string" },
      ADAPTER_TLS_MODE: { enum: ["disabled", "required"] },
      ADAPTER_TLS_CA_PATH: { type: "string", minLength: 1 },
      ADAPTER_TLS_CERT_PATH: { type: "string", minLength: 1 },
      ADAPTER_TLS_KEY_PATH: { type: "string", minLength: 1 },
      ADAPTER_RPC_TIMEOUT_MS: { type: "integer", minimum: 1, maximum: 60_000 },
    },
  },
  defaults: {
    RUNTIME_ENV: "development",
    HOST: "0.0.0.0",
    PORT: 8080,
    PROVIDER_ID: "mock-provider",
    DATABASE_POOL_MAX: 10,
    ADAPTER_ENDPOINT: "127.0.0.1:7001",
    ADAPTER_TLS_MODE: "disabled",
    ADAPTER_RPC_TIMEOUT_MS: 5_000,
  },
  secretPaths: ["/DATABASE_URL", "/DATABASE_URL_FILE", "/ADAPTER_TLS_KEY_PATH"],
  fields: [
    field("RUNTIME_ENV", "Runtime environment", "Runtime safety profile.", "restart_required"),
    field("HOST", "Listen host", "Runtime HTTP listen host.", "restart_required"),
    field("PORT", "Listen port", "Runtime HTTP listen port.", "restart_required"),
    field(
      "PROVIDER_ID",
      "Provider ID",
      "Immutable logical Provider identity.",
      "immutable",
      false,
      "forbidden",
    ),
    field(
      "DATABASE_URL",
      "Legacy database URL",
      "Legacy direct database connection secret.",
      "restart_required",
      true,
    ),
    field(
      "DATABASE_URL_FILE",
      "Database URL file",
      "Path to the injected database connection secret.",
      "restart_required",
      true,
    ),
    field(
      "DATABASE_POOL_MAX",
      "Database pool maximum",
      "Maximum Runtime database pool size.",
      "restart_required",
    ),
    field(
      "ADAPTER_ENDPOINT",
      "Adapter endpoint",
      "Provider Adapter network endpoint.",
      "restart_required",
    ),
    field(
      "ADAPTER_TLS_MODE",
      "Adapter TLS mode",
      "Provider Adapter transport security mode.",
      "restart_required",
    ),
    field(
      "ADAPTER_TLS_CA_PATH",
      "Adapter CA path",
      "Path to the Adapter trust anchor.",
      "restart_required",
    ),
    field(
      "ADAPTER_TLS_CERT_PATH",
      "Adapter certificate path",
      "Path to the Runtime Adapter client certificate.",
      "restart_required",
    ),
    field(
      "ADAPTER_TLS_KEY_PATH",
      "Adapter key path",
      "SecretRef path to the Runtime Adapter client key.",
      "restart_required",
      true,
    ),
    field(
      "ADAPTER_RPC_TIMEOUT_MS",
      "Adapter RPC timeout",
      "Provider Adapter RPC timeout in milliseconds.",
      "restart_required",
    ),
  ],
});

function field(
  path: string,
  displayName: string,
  description: string,
  applyMode: "restart_required" | "immutable",
  secret = false,
  overrideMode: "inheritable" | "forbidden" = "inheritable",
) {
  return {
    path: `/${path}`,
    displayName,
    description,
    applyMode,
    required: path === "PROVIDER_ID",
    secret,
    overridePolicy:
      overrideMode === "forbidden"
        ? { mode: "forbidden" }
        : {
            mode: "inheritable",
            allowedTargetTypes: ["runtime_deployment", "runtime_instance"],
          },
  };
}

function defaultSecretFileReader(path: string): string {
  return readFileSync(path, "utf8");
}

function validAdapterEndpoint(value: string): boolean {
  if (!/^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\]):\d{1,5}$/.test(value)) return false;
  const port = Number(value.slice(value.lastIndexOf(":") + 1));
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}
