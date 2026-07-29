import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type {
  RuntimeBootstrapArtifact,
  RuntimeInfrastructureInstanceTarget,
} from "@sdar/runtime-deployment";

const EFFECTIVE_CONFIG_ALLOWLIST = new Set([
  "RUNTIME_ENV",
  "HOST",
  "DATABASE_POOL_MAX",
  "ADAPTER_ENDPOINT",
  "ADAPTER_TLS_MODE",
  "ADAPTER_TLS_CA_PATH",
  "ADAPTER_TLS_CERT_PATH",
  "ADAPTER_TLS_KEY_PATH",
  "ADAPTER_RPC_TIMEOUT_MS",
  "LOG_LEVEL",
  "OTEL_ENABLED",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TLS_MODE",
  "OTEL_EXPORTER_OTLP_CA_PATH",
  "OTEL_EXPORTER_OTLP_CERT_PATH",
  "OTEL_EXPORTER_OTLP_KEY_PATH",
  "OTEL_EXPORTER_OTLP_HEADERS_FILE",
  "OTEL_EXPORTER_OTLP_TIMEOUT_MS",
] as const);

const RESERVED_KEYS = new Set([
  "PORT",
  "PROVIDER_ID",
  "DATABASE_URL",
  "DATABASE_URL_FILE",
  "RUNTIME_DEPLOYMENT_ID",
  "RUNTIME_INSTANCE_ID",
  "OTEL_SERVICE_INSTANCE_ID",
  "PMS_RUNTIME_CONFIG_URL",
  "PMS_RUNTIME_CONFIG_TOKEN_FILE",
  "PMS_RUNTIME_CONFIG_CACHE_PATH",
  "PMS_BOOTSTRAP_CHECKSUM",
  "PMS_CONFIG_REVISION",
  "PMS_RUNTIME_VERSION",
]);

const SECRET_FILE_KEYS = new Set([
  "DATABASE_URL_FILE",
  "PMS_RUNTIME_CONFIG_TOKEN_FILE",
  "ADAPTER_TLS_CA_PATH",
  "ADAPTER_TLS_CERT_PATH",
  "ADAPTER_TLS_KEY_PATH",
  "OTEL_EXPORTER_OTLP_CA_PATH",
  "OTEL_EXPORTER_OTLP_CERT_PATH",
  "OTEL_EXPORTER_OTLP_KEY_PATH",
  "OTEL_EXPORTER_OTLP_HEADERS_FILE",
]);

export type BootstrapEnvironmentValue = string | number | boolean;

export interface BootstrapConfigRendererInput {
  readonly target: RuntimeInfrastructureInstanceTarget;
  readonly configRevision: number;
  readonly configChecksum: string;
  readonly httpPort: number;
  readonly databaseUrlFile: string;
  readonly pms?: {
    readonly baseUrl: string;
    readonly tokenFile: string;
    readonly cachePath: string;
  };
  readonly effectiveConfig: Readonly<Record<string, BootstrapEnvironmentValue>>;
}

export interface RenderedBootstrapConfig extends RuntimeBootstrapArtifact {
  readonly environment: Readonly<Record<string, string>>;
}

export type BootstrapConfigRendererErrorCode =
  | "BOOTSTRAP_CONFIG_INVALID_INPUT"
  | "BOOTSTRAP_CONFIG_UNKNOWN_ENV"
  | "BOOTSTRAP_CONFIG_IMMUTABLE_OVERRIDE"
  | "BOOTSTRAP_CONFIG_SECRET_VALUE_FORBIDDEN"
  | "BOOTSTRAP_CONFIG_PMS_URL_INVALID";

export class BootstrapConfigRendererError extends Error {
  constructor(
    readonly code: BootstrapConfigRendererErrorCode,
    readonly field?: string,
  ) {
    super(code);
    this.name = "BootstrapConfigRendererError";
  }
}

export class BootstrapConfigRenderer {
  render(input: BootstrapConfigRendererInput): RenderedBootstrapConfig {
    validateInput(input);
    const effective = renderEffectiveConfig(input.effectiveConfig);
    const environment: Record<string, string> = {
      ...effective,
      PORT: String(input.httpPort),
      PROVIDER_ID: input.target.providerId,
      DATABASE_URL_FILE: input.databaseUrlFile,
      RUNTIME_DEPLOYMENT_ID: input.target.deploymentId,
      RUNTIME_INSTANCE_ID: input.target.instanceId,
      OTEL_SERVICE_INSTANCE_ID: input.target.instanceId,
      PMS_BOOTSTRAP_CHECKSUM: input.configChecksum,
      PMS_CONFIG_REVISION: String(input.configRevision),
      PMS_RUNTIME_VERSION: input.target.runtimeVersion,
    };
    if (input.pms !== undefined) {
      validatePms(input.pms, environment.RUNTIME_ENV);
      environment.PMS_RUNTIME_CONFIG_URL = new URL(input.pms.baseUrl).toString();
      environment.PMS_RUNTIME_CONFIG_TOKEN_FILE = input.pms.tokenFile;
      environment.PMS_RUNTIME_CONFIG_CACHE_PATH = input.pms.cachePath;
    }
    const sortedEnvironment = sortRecord(environment);
    const preview = Object.fromEntries(
      Object.entries(sortedEnvironment).map(([key, value]) => [
        key,
        SECRET_FILE_KEYS.has(key) ? "<secret-file>" : value,
      ]),
    );
    return Object.freeze({
      artifactId: artifactId(input, sortedEnvironment),
      target: Object.freeze({ ...input.target }),
      configRevision: input.configRevision,
      configChecksum: input.configChecksum,
      httpPort: input.httpPort,
      databaseUrlFileRef: input.databaseUrlFile,
      ...(input.pms === undefined ? {} : { pmsTokenFileRef: input.pms.tokenFile }),
      environment: Object.freeze(sortedEnvironment),
      redactedPreview: Object.freeze(preview),
    });
  }
}

function renderEffectiveConfig(
  effectiveConfig: Readonly<Record<string, BootstrapEnvironmentValue>>,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of Object.keys(effectiveConfig).sort()) {
    if (RESERVED_KEYS.has(key)) {
      throw new BootstrapConfigRendererError("BOOTSTRAP_CONFIG_IMMUTABLE_OVERRIDE", key);
    }
    if (!EFFECTIVE_CONFIG_ALLOWLIST.has(key as never)) {
      const code = /(?:SECRET|PASSWORD|TOKEN|DATABASE_URL)$/i.test(key)
        ? "BOOTSTRAP_CONFIG_SECRET_VALUE_FORBIDDEN"
        : "BOOTSTRAP_CONFIG_UNKNOWN_ENV";
      throw new BootstrapConfigRendererError(code, key);
    }
    const value = effectiveConfig[key];
    if (
      value === undefined ||
      (typeof value === "string" && (value.length === 0 || /[\0\r\n]/.test(value)))
    ) {
      throw new BootstrapConfigRendererError("BOOTSTRAP_CONFIG_INVALID_INPUT", key);
    }
    if (SECRET_FILE_KEYS.has(key) && (typeof value !== "string" || !validFile(value))) {
      throw new BootstrapConfigRendererError("BOOTSTRAP_CONFIG_INVALID_INPUT", key);
    }
    environment[key] = String(value);
  }
  return environment;
}

function validateInput(input: BootstrapConfigRendererInput): void {
  const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  const processName = /^sdar-runtime-[a-z0-9][a-z0-9-]{0,112}$/;
  if (
    !identifier.test(input.target.providerId) ||
    !identifier.test(input.target.deploymentId) ||
    !identifier.test(input.target.environment) ||
    !identifier.test(input.target.runtimeVersion) ||
    !identifier.test(input.target.instanceId) ||
    !processName.test(input.target.processName) ||
    !Number.isSafeInteger(input.target.ordinal) ||
    input.target.ordinal < 0 ||
    !Number.isSafeInteger(input.configRevision) ||
    input.configRevision < 0 ||
    !/^[0-9a-f]{64}$/.test(input.configChecksum) ||
    !validPort(input.httpPort) ||
    !validFile(input.databaseUrlFile)
  ) {
    throw new BootstrapConfigRendererError("BOOTSTRAP_CONFIG_INVALID_INPUT");
  }
}

function validatePms(
  pms: NonNullable<BootstrapConfigRendererInput["pms"]>,
  runtimeEnvironment: string | undefined,
): void {
  let url: URL;
  try {
    url = new URL(pms.baseUrl);
  } catch {
    throw new BootstrapConfigRendererError("BOOTSTRAP_CONFIG_PMS_URL_INVALID", "baseUrl");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    (runtimeEnvironment === "production" && url.protocol !== "https:")
  ) {
    throw new BootstrapConfigRendererError("BOOTSTRAP_CONFIG_PMS_URL_INVALID", "baseUrl");
  }
  if (!validFile(pms.tokenFile) || !validFile(pms.cachePath)) {
    throw new BootstrapConfigRendererError("BOOTSTRAP_CONFIG_INVALID_INPUT", "pms");
  }
}

function validPort(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= 65_535;
}

function validFile(value: string): boolean {
  return isAbsolute(value) && value.length <= 4_096 && !/[\0\r\n]/.test(value);
}

function sortRecord(value: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function artifactId(
  input: BootstrapConfigRendererInput,
  environment: Readonly<Record<string, string>>,
): string {
  return `bootstrap-${createHash("sha256")
    .update(
      JSON.stringify({
        target: input.target,
        configRevision: input.configRevision,
        configChecksum: input.configChecksum,
        environment,
      }),
    )
    .digest("hex")
    .slice(0, 24)}`;
}
