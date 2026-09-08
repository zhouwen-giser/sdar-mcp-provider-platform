import { readFileSync } from "node:fs";
/** Internal deployment identity; never added to the public MCP operation schema. */
export interface GowmStorageConfig {
  readonly mode: "gowm-shared";
  readonly databaseUrl: string;
  readonly serviceKey: string;
  readonly allowedDeviceIds: readonly string[];
  readonly bindingId: string;
  readonly sourceSessionKey: string;
  readonly contractDir: string;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`GOWM_STORAGE_NOT_CONFIGURED: ${key}`);
  return value;
}

export function loadGowmStorageConfig(env: NodeJS.ProcessEnv): GowmStorageConfig | undefined {
  if (!env.SMPP_STORAGE_MODE || env.SMPP_STORAGE_MODE === "standalone") return undefined;
  if (env.SMPP_STORAGE_MODE !== "gowm-shared") throw new Error("GOWM_STORAGE_MODE_INVALID");
  if (env.GOWM_DATABASE_URL_FILE) {
    let fileUrl: string;
    try {
      fileUrl = readFileSync(env.GOWM_DATABASE_URL_FILE, "utf8").trim();
    } catch {
      throw new Error("GOWM_STORAGE_NOT_CONFIGURED: GOWM_DATABASE_URL_FILE");
    }
    if (env.GOWM_DATABASE_URL && env.GOWM_DATABASE_URL !== fileUrl)
      throw new Error("GOWM_SHARED_DATABASE_MISMATCH");
    env = { ...env, GOWM_DATABASE_URL: fileUrl };
  }
  const databaseUrl = required(env, "GOWM_DATABASE_URL");
  if (env.DATABASE_URL_FILE) {
    const legacyUrl = readFileSync(env.DATABASE_URL_FILE, "utf8").trim();
    if (legacyUrl !== databaseUrl)
      throw new Error("GOWM_SHARED_DATABASE_MISMATCH: DATABASE_URL_FILE");
  }
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("GOWM_STORAGE_URL_INVALID");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.pathname.length < 2)
    throw new Error("GOWM_STORAGE_URL_INVALID");
  if (url.searchParams.has("options")) throw new Error("GOWM_STORAGE_URL_OPTIONS_FORBIDDEN");
  // A single explicit URL controls both pools. Conflicting legacy inputs fail closed.
  for (const key of ["DATABASE_URL", "UGV_ADAPTER_DATABASE_URL"]) {
    if (env[key] && env[key] !== databaseUrl)
      throw new Error(`GOWM_SHARED_DATABASE_MISMATCH: ${key}`);
  }
  let ids: unknown;
  try {
    ids = JSON.parse(required(env, "SMPP_ALLOWED_DEVICE_IDS"));
  } catch {
    throw new Error("DEVICE_SCOPE_REQUIRED: SMPP_ALLOWED_DEVICE_IDS must be a JSON array");
  }
  if (
    !Array.isArray(ids) ||
    ids.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(ids).size !== ids.length
  )
    throw new Error("DEVICE_SCOPE_REQUIRED");
  // Existing UGV ingress, arbiter and Device MCP client are single-device objects.
  if (ids.length !== 1)
    throw new Error("DEVICE_SCOPE_REQUIRED: configure one device per source instance");
  const bindingId = required(env, "SMPP_GOWM_BINDING_ID");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bindingId))
    throw new Error("DEVICE_BINDING_MISMATCH");
  return Object.freeze({
    mode: "gowm-shared",
    databaseUrl,
    serviceKey: required(env, "SMPP_SERVICE_KEY"),
    allowedDeviceIds: Object.freeze(ids as string[]),
    bindingId,
    sourceSessionKey: required(env, "SMPP_SOURCE_SESSION_KEY"),
    contractDir: env.SMPP_GOWM_CONTRACT_DIR ?? "contracts/gowm-shared-storage/current",
  });
}
