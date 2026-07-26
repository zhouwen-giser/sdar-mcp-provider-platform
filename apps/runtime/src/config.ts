import { z } from "zod";

const BooleanEnvironmentSchema = z
  .union([z.string(), z.boolean()])
  .transform((value) => parseBooleanEnv(value));

const EnvironmentSchema = z
  .object({
    RUNTIME_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
    LOG_LEVEL: z.string().default("info"),
    PROVIDER_ID: z.string().min(1).max(128).default("mock-provider"),
    OTEL_ENABLED: BooleanEnvironmentSchema.default(false),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().default("http://127.0.0.1:4318"),
    OTEL_EXPORTER_OTLP_TLS_MODE: z.enum(["disabled", "required"]).default("disabled"),
    OTEL_EXPORTER_OTLP_CA_PATH: z.string().min(1).optional(),
    OTEL_EXPORTER_OTLP_CERT_PATH: z.string().min(1).optional(),
    OTEL_EXPORTER_OTLP_KEY_PATH: z.string().min(1).optional(),
    OTEL_EXPORTER_OTLP_HEADERS_FILE: z.string().min(1).optional(),
    OTEL_EXPORTER_OTLP_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
    OTEL_SERVICE_INSTANCE_ID: z.string().min(1).max(256).optional(),
    PROVIDER_TELEMETRY_INGRESS_ENABLED: BooleanEnvironmentSchema.default(false),
    PROVIDER_TELEMETRY_HOST: z.string().min(1).max(255).default("127.0.0.1"),
    PROVIDER_TELEMETRY_PORT: z.coerce.number().int().min(1).max(65_535).default(7002),
    PROVIDER_TELEMETRY_TLS_MODE: z.enum(["disabled", "required"]).default("disabled"),
    PROVIDER_TELEMETRY_TLS_CA_PATH: z.string().min(1).optional(),
    PROVIDER_TELEMETRY_TLS_CERT_PATH: z.string().min(1).optional(),
    PROVIDER_TELEMETRY_TLS_KEY_PATH: z.string().min(1).optional(),
    PROVIDER_TELEMETRY_MAX_BATCH: z.coerce.number().int().min(1).max(10_000).default(100),
    PROVIDER_TELEMETRY_MAX_EVENT_BYTES: z.coerce
      .number()
      .int()
      .min(256)
      .max(8_388_608)
      .default(65_536),
    PROVIDER_TELEMETRY_MAX_DEPTH: z.coerce.number().int().min(1).max(64).default(16),
    PROVIDER_TELEMETRY_MAX_NODES: z.coerce.number().int().min(16).max(100_000).default(4_096),
    PROVIDER_TELEMETRY_RATE_LIMIT: z.coerce.number().int().min(1).max(100_000).default(600),
    DATABASE_URL: z.url().default("postgresql://sdar:sdar@127.0.0.1:5432/sdar_runtime"),
    ADAPTER_ENDPOINT: z.string().refine(validAdapterEndpoint).default("127.0.0.1:7001"),
    ADAPTER_TLS_MODE: z.enum(["disabled", "required"]).default("disabled"),
    ADAPTER_TLS_CA_PATH: z.string().min(1).optional(),
    ADAPTER_TLS_CERT_PATH: z.string().min(1).optional(),
    ADAPTER_TLS_KEY_PATH: z.string().min(1).optional(),
    ADAPTER_RPC_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(5_000),
    AUTH_MODE: z.enum(["development", "trusted_headers", "jwt_hs256"]).default("development"),
    MCP_LEGACY_ENDPOINT_ENABLED: BooleanEnvironmentSchema.default(false),
    BUSINESS_EVENTS_ENABLED: BooleanEnvironmentSchema.default(false),
    BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY: BooleanEnvironmentSchema.default(false),
    BUSINESS_EVENTS_RETENTION_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(7_776_000_000)
      .default(604_800_000),
    BUSINESS_EVENTS_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(10_000).default(500),
    BUSINESS_EVENTS_MAX_SUBSCRIPTIONS: z.coerce.number().int().min(1).max(10_000).default(256),
    BUSINESS_EVENTS_MAX_SUBSCRIPTIONS_PER_AUTH: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000)
      .default(32),
    BUSINESS_EVENTS_MAX_QUEUE_MESSAGES: z.coerce.number().int().min(1).max(1_024).default(64),
    BUSINESS_EVENTS_MAX_QUEUE_BYTES: z.coerce
      .number()
      .int()
      .min(4_096)
      .max(16_777_216)
      .default(1_048_576),
    BUSINESS_EVENTS_REPLAY_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(256),
    BUSINESS_EVENTS_MAX_STREAM_DURATION_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(86_400_000)
      .default(3_600_000),
    BUSINESS_EVENTS_MAX_EVENT_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(1_048_576)
      .default(65_536),
    BUSINESS_EVENTS_MAX_PAYLOAD_DEPTH: z.coerce.number().int().min(1).max(64).default(16),
    BUSINESS_EVENTS_MAX_PAYLOAD_NODES: z.coerce.number().int().min(16).max(100_000).default(4_096),
    BUSINESS_EVENTS_MAX_PAYLOAD_STRING_BYTES: z.coerce
      .number()
      .int()
      .min(64)
      .max(1_048_576)
      .default(16_384),
    BUSINESS_EVENT_MAPPING_DEADLINE_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(300_000)
      .default(60_000),
    BUSINESS_EVENT_MAX_FUTURE_SKEW_MS: z.coerce
      .number()
      .int()
      .min(0)
      .max(3_600_000)
      .default(300_000),
    BUSINESS_EVENT_CLOCK_SKEW_SAFETY_MS: z.coerce
      .number()
      .int()
      .min(0)
      .max(3_600_000)
      .default(300_000),
    TASK_NOTIFICATION_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(10_000).default(500),
    TASK_NOTIFICATION_MAX_SUBSCRIPTIONS: z.coerce.number().int().min(1).max(10_000).default(256),
    TASK_NOTIFICATION_MAX_SUBSCRIPTIONS_PER_AUTH: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000)
      .default(32),
    TASK_NOTIFICATION_MAX_TASK_BINDINGS: z.coerce.number().int().min(1).max(100_000).default(4_096),
    TASK_NOTIFICATION_MAX_QUEUE_MESSAGES: z.coerce.number().int().min(1).max(1_024).default(64),
    TASK_NOTIFICATION_MAX_QUEUE_BYTES: z.coerce
      .number()
      .int()
      .min(4_096)
      .max(16_777_216)
      .default(1_048_576),
    TASK_NOTIFICATION_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(256),
    JWT_HS256_SECRET: z.string().min(32).optional(),
    JWT_ISSUER: z.string().min(1).optional(),
    JWT_AUDIENCE: z.string().min(1).optional(),
    HTTP_BODY_LIMIT_BYTES: z.coerce.number().int().min(1_024).max(16_777_216).default(1_048_576),
    ARGUMENT_MAX_BYTES: z.coerce.number().int().min(256).max(8_388_608).default(1_048_576),
    ARGUMENT_MAX_DEPTH: z.coerce.number().int().min(1).max(64).default(32),
    ARGUMENT_MAX_NODES: z.coerce.number().int().min(16).max(100_000).default(10_000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(300),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
    RATE_LIMIT_MAX_KEYS: z.coerce.number().int().min(16).max(1_000_000).default(10_000),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    IDEMPOTENCY_LEASE_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
    IDEMPOTENCY_WAIT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
    IDEMPOTENCY_POLL_MS: z.coerce.number().int().min(5).max(1_000).default(20),
    COMMAND_CLAIM_LEASE_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
    SCHEDULE_CLAIM_LEASE_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
    RECOVERY_LEASE_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
    LEASE_SAFETY_MARGIN_MS: z.coerce.number().int().min(100).max(60_000).default(500),
    DB_PUBLICATION_BUDGET_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    ALLOW_WEAK_LEASE_CONFIGURATION: BooleanEnvironmentSchema.default(false),
    INTERNAL_ENDPOINTS_ENABLED: BooleanEnvironmentSchema.default(false),
    INTERNAL_ADMIN_TOKEN: z.string().min(32).optional(),
    ADAPTER_HEALTH_POLL_MS: z.coerce.number().int().min(100).max(300_000).default(5_000),
    ADAPTER_HEALTH_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(10).default(2),
    ADAPTER_MANIFEST_POLL_MS: z.coerce.number().int().min(100).max(3_600_000).default(60_000),
    SCHEDULER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    COMMAND_DISPATCH_CONCURRENCY: z.coerce.number().int().min(1).max(128).default(8),
    SCHEDULER_CONCURRENCY: z.coerce.number().int().min(1).max(128).default(8),
    OUTBOX_CLEANER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(60_000),
    RECOVERY_POLL_MS: z.coerce.number().int().min(500).max(300_000).default(5_000),
    TTL_CLEANER_POLL_MS: z.coerce.number().int().min(500).max(3_600_000).default(60_000),
    TTL_PURGE_GRACE_MS: z.coerce.number().int().min(1_000).max(604_800_000).default(86_400_000),
    OUTBOX_PUBLISHED_RETENTION_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(7_776_000_000)
      .default(86_400_000),
    TTL_CLEANER_BATCH_SIZE: z.coerce.number().int().min(1).max(10_000).default(128),
    OUTBOX_SINK: z.enum(["internal_noop", "webhook"]).default("internal_noop"),
    OUTBOX_WEBHOOK_URL: z.url().optional(),
    OUTBOX_POLL_MS: z.coerce.number().int().min(100).max(300_000).default(1_000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(10_000).default(100),
    OUTBOX_WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
  })
  .superRefine((value, context) => {
    if (
      value.ADAPTER_TLS_MODE === "required" &&
      (value.ADAPTER_TLS_CA_PATH === undefined ||
        value.ADAPTER_TLS_CERT_PATH === undefined ||
        value.ADAPTER_TLS_KEY_PATH === undefined)
    ) {
      context.addIssue({ code: "custom", message: "mTLS requires CA, certificate, and key paths" });
    }
    if (value.AUTH_MODE === "jwt_hs256" && value.JWT_HS256_SECRET === undefined) {
      context.addIssue({ code: "custom", message: "jwt_hs256 requires JWT_HS256_SECRET" });
    }
    if (
      value.PROVIDER_TELEMETRY_INGRESS_ENABLED &&
      value.PROVIDER_TELEMETRY_TLS_MODE === "required" &&
      (value.PROVIDER_TELEMETRY_TLS_CA_PATH === undefined ||
        value.PROVIDER_TELEMETRY_TLS_CERT_PATH === undefined ||
        value.PROVIDER_TELEMETRY_TLS_KEY_PATH === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Provider telemetry mTLS requires CA, certificate, and key paths",
      });
    }
    if (value.RUNTIME_ENV === "production") {
      if (value.AUTH_MODE === "development") {
        context.addIssue({ code: "custom", message: "production forbids development auth" });
      }
      if (value.ADAPTER_TLS_MODE !== "required") {
        context.addIssue({ code: "custom", message: "production requires Adapter mTLS" });
      }
      if (
        value.PROVIDER_TELEMETRY_INGRESS_ENABLED &&
        value.PROVIDER_TELEMETRY_TLS_MODE !== "required"
      ) {
        context.addIssue({
          code: "custom",
          message: "production Provider telemetry ingress requires mTLS",
        });
      }
      if (value.ALLOW_WEAK_LEASE_CONFIGURATION) {
        context.addIssue({
          code: "custom",
          message: "production forbids weak lease configuration",
        });
      }
      if (
        value.OTEL_ENABLED &&
        !value.OTEL_EXPORTER_OTLP_ENDPOINT.toLowerCase().startsWith("https://")
      ) {
        context.addIssue({ code: "custom", message: "production OTLP requires HTTPS" });
      }
    }
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
    if (value.OUTBOX_SINK === "webhook" && value.OUTBOX_WEBHOOK_URL === undefined) {
      context.addIssue({ code: "custom", message: "webhook Outbox requires OUTBOX_WEBHOOK_URL" });
    }
    if (
      value.RUNTIME_ENV === "production" &&
      value.OUTBOX_WEBHOOK_URL !== undefined &&
      !value.OUTBOX_WEBHOOK_URL.startsWith("https://")
    ) {
      context.addIssue({ code: "custom", message: "production Outbox webhook requires HTTPS" });
    }
    if (value.INTERNAL_ENDPOINTS_ENABLED && value.INTERNAL_ADMIN_TOKEN === undefined) {
      context.addIssue({
        code: "custom",
        message: "INTERNAL_ENDPOINTS_ENABLED requires INTERNAL_ADMIN_TOKEN",
      });
    }
  });

export type RuntimeConfig = z.infer<typeof EnvironmentSchema> & {
  leaseValidationMode: "strict" | "degraded";
  leaseValidationMessage: string | null;
};

export function loadRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const value = EnvironmentSchema.parse(environment);
  const commandClaimLeaseMinimum =
    2 * value.ADAPTER_RPC_TIMEOUT_MS +
    value.DB_PUBLICATION_BUDGET_MS +
    value.LEASE_SAFETY_MARGIN_MS;
  const scheduleClaimLeaseMinimum =
    value.ADAPTER_RPC_TIMEOUT_MS + value.DB_PUBLICATION_BUDGET_MS + value.LEASE_SAFETY_MARGIN_MS;
  const recoveryLeaseMinimum =
    value.ADAPTER_RPC_TIMEOUT_MS + value.DB_PUBLICATION_BUDGET_MS + value.LEASE_SAFETY_MARGIN_MS;
  const idempotencyLeaseMinimum =
    2 * value.ADAPTER_RPC_TIMEOUT_MS +
    value.DB_PUBLICATION_BUDGET_MS +
    value.LEASE_SAFETY_MARGIN_MS;
  const violations: string[] = [];
  if (value.COMMAND_CLAIM_LEASE_MS < commandClaimLeaseMinimum) {
    violations.push(
      "COMMAND_CLAIM_LEASE_MS must be >= " +
        String(commandClaimLeaseMinimum) +
        " for current timeout and budget",
    );
  }
  if (value.SCHEDULE_CLAIM_LEASE_MS < scheduleClaimLeaseMinimum) {
    violations.push(
      "SCHEDULE_CLAIM_LEASE_MS must be >= " +
        String(scheduleClaimLeaseMinimum) +
        " for current timeout and budget",
    );
  }
  if (value.RECOVERY_LEASE_MS < recoveryLeaseMinimum) {
    violations.push(
      "RECOVERY_LEASE_MS must be >= " +
        String(recoveryLeaseMinimum) +
        " for current timeout and budget",
    );
  }
  if (value.IDEMPOTENCY_LEASE_MS < idempotencyLeaseMinimum) {
    violations.push(
      "IDEMPOTENCY_LEASE_MS must be >= " +
        String(idempotencyLeaseMinimum) +
        " for current timeout and budget",
    );
  }
  if (violations.length > 0) {
    if (value.RUNTIME_ENV === "production" || !value.ALLOW_WEAK_LEASE_CONFIGURATION) {
      throw new Error(violations.join("; "));
    }
    return {
      ...value,
      leaseValidationMode: "degraded",
      leaseValidationMessage: violations.join("; "),
    };
  }
  return { ...value, leaseValidationMode: "strict", leaseValidationMessage: null };
}

export function parseBooleanEnv(value: string | boolean): boolean {
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

function validAdapterEndpoint(value: string): boolean {
  if (!/^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\]):\d{1,5}$/.test(value)) return false;
  const port = Number(value.slice(value.lastIndexOf(":") + 1));
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}
