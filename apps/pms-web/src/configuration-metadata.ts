import type { ConfigurationFieldMetadata } from "./model.js";

export const RUNTIME_BOOTSTRAP_FIELDS: readonly ConfigurationFieldMetadata[] = [
  field("RUNTIME_ENV", "Runtime environment", "Runtime safety profile.", "restart_required", true),
  field("HOST", "Listen host", "Runtime HTTP listen host.", "restart_required", true),
  field("PORT", "Listen port", "Runtime HTTP listen port.", "restart_required", true),
  field(
    "DATABASE_URL_FILE",
    "Database URL SecretRef",
    "Reference path for the injected database connection secret.",
    "restart_required",
    false,
    true,
  ),
  field(
    "ADAPTER_ENDPOINT",
    "Adapter endpoint",
    "Provider Adapter network endpoint.",
    "restart_required",
    true,
  ),
  field(
    "ADAPTER_TLS_KEY_PATH",
    "Adapter key SecretRef",
    "Reference path for the Runtime Adapter client key.",
    "restart_required",
    false,
    true,
  ),
  field(
    "ADAPTER_RPC_TIMEOUT_MS",
    "Adapter RPC timeout",
    "Provider Adapter RPC timeout in milliseconds.",
    "restart_required",
    false,
  ),
];

function field(
  path: string,
  displayName: string,
  description: string,
  applyMode: ConfigurationFieldMetadata["applyMode"],
  required: boolean,
  secret = false,
): ConfigurationFieldMetadata {
  return { path: `/${path}`, displayName, description, applyMode, required, secret };
}
