import { z } from "zod";
import {
  loadRuntimeBootstrapEnvironment,
  RuntimeBootstrapResolvedSchema,
} from "../../../packages/runtime-configuration-contract/src/runtime/bootstrap.js";
import {
  loadRuntimeObservabilityEnvironment,
  RuntimeObservabilityResolvedSchema,
} from "../../../packages/runtime-configuration-contract/src/runtime/observability.js";
import {
  loadRuntimeWorkerEventsEnvironment,
  RuntimeWorkerEventsResolvedSchema,
} from "../../../packages/runtime-configuration-contract/src/runtime/worker-events.js";

const EnvironmentSchema = z
  .object({
    ...RuntimeBootstrapResolvedSchema.shape,
    ...RuntimeObservabilityResolvedSchema.shape,
    ...RuntimeWorkerEventsResolvedSchema.shape,
    // Keep security-critical ingress keys explicit for the frozen source-level guard.
    OTEL_EXPORTER_OTLP_TLS_MODE:
      RuntimeObservabilityResolvedSchema.shape.OTEL_EXPORTER_OTLP_TLS_MODE,
    OTEL_EXPORTER_OTLP_HEADERS_FILE:
      RuntimeObservabilityResolvedSchema.shape.OTEL_EXPORTER_OTLP_HEADERS_FILE,
    PROVIDER_TELEMETRY_INGRESS_ENABLED:
      RuntimeWorkerEventsResolvedSchema.shape.PROVIDER_TELEMETRY_INGRESS_ENABLED,
    PROVIDER_TELEMETRY_TLS_MODE:
      RuntimeWorkerEventsResolvedSchema.shape.PROVIDER_TELEMETRY_TLS_MODE,
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
    if (value.RUNTIME_ENV === "production" && value.ADAPTER_TLS_MODE !== "required") {
      context.addIssue({ code: "custom", message: "production requires Adapter mTLS" });
    }
  });

export type RuntimeConfig = z.infer<typeof EnvironmentSchema> & {
  leaseValidationMode: "strict" | "degraded";
  leaseValidationMessage: string | null;
};

export function loadRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const bootstrap = loadRuntimeBootstrapEnvironment(environment);
  const observability = loadRuntimeObservabilityEnvironment(environment);
  const workerEvents = loadRuntimeWorkerEventsEnvironment(environment);
  const value = EnvironmentSchema.parse({
    ...bootstrap,
    ...observability,
    ...workerEvents,
  });
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
