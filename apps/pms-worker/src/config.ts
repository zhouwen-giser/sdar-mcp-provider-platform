import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const RUNTIME_CONFIGURATION_KEYS = [
  "PMS_POSTGRES_PROVISIONING_CREDENTIAL_FILE",
  "PMS_RUNTIME_RELEASE_ROOT",
  "PMS_RUNTIME_SECRET_ROOT",
  "PMS_RUNTIME_CONFIG_CACHE_ROOT",
  "PMS_RUNTIME_CONTROL_PLANE_URL",
  "PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_ROOT",
  "PMS_PM2_HOME",
  "PMS_RUNTIME_RECONCILE_INTERVAL_MS",
  "PMS_RUNTIME_RECONCILE_TIMEOUT_MS",
  "PMS_RUNTIME_HEALTH_TIMEOUT_MS",
] as const;

export interface PmsWorkerRuntimeConfig {
  readonly postgresProvisioningCredentialFile: string;
  readonly runtimeReleaseRoot: string;
  readonly runtimeSecretRoot: string;
  readonly runtimeConfigCacheRoot: string;
  readonly runtimeControlPlaneUrl: string;
  readonly runtimeControlPlaneCredentialRoot: string;
  readonly pm2Home: string;
  readonly runtimeReconcileIntervalMs: number;
  readonly runtimeReconcileTimeoutMs: number;
  readonly runtimeHealthTimeoutMs: number;
}

export interface PmsWorkerConfig {
  readonly databaseUrlFile: string;
  readonly workerId: string;
  readonly pollIntervalMs: number;
  readonly leaseDurationMs: number;
  readonly claimLimit: number;
  readonly retryDelayMs: number;
  readonly workspaceRoot: string;
  readonly runtime?: PmsWorkerRuntimeConfig;
}

export async function loadPmsWorkerConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PmsWorkerConfig> {
  rejectInlineSecrets(environment);
  rejectLegacyRuntimeTokenFile(environment);
  const databaseUrlFile = required(environment, "PMS_DATABASE_URL_FILE");
  await validateSecretFile(databaseUrlFile, "PMS_DATABASE_URL_FILE");
  const base = {
    databaseUrlFile: resolve(databaseUrlFile),
    workerId: environment.PMS_WORKER_ID ?? `pms-worker-${String(process.pid)}`,
    pollIntervalMs: boundedInteger(environment.PMS_WORKER_POLL_INTERVAL_MS, 1_000, 10, 60_000),
    leaseDurationMs: boundedInteger(
      environment.PMS_WORKER_LEASE_DURATION_MS,
      30_000,
      1_000,
      86_400_000,
    ),
    claimLimit: boundedInteger(environment.PMS_WORKER_CLAIM_LIMIT, 10, 1, 500),
    retryDelayMs: boundedInteger(environment.PMS_WORKER_RETRY_DELAY_MS, 5_000, 100, 3_600_000),
    workspaceRoot: resolve(environment.PMS_WORKSPACE_ROOT ?? process.cwd()),
  };
  if (!runtimeConfigurationRequested(environment)) return Object.freeze(base);
  return Object.freeze({
    ...base,
    runtime: await loadRuntimeConfig(environment),
  });
}

export async function readDatabaseUrlFile(path: string): Promise<string> {
  await validateSecretFile(path, "PMS_DATABASE_URL_FILE");
  return (await readFile(path, "utf8")).trim();
}

export function requirePmsWorkerRuntimeConfig(config: PmsWorkerConfig): PmsWorkerRuntimeConfig {
  if (config.runtime === undefined) {
    throw new Error("PMS_WORKER_RUNTIME_CONFIG_REQUIRED");
  }
  return config.runtime;
}

async function loadRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<PmsWorkerRuntimeConfig> {
  const postgresProvisioningCredentialFile = required(
    environment,
    "PMS_POSTGRES_PROVISIONING_CREDENTIAL_FILE",
  );
  await validateSecretFile(
    postgresProvisioningCredentialFile,
    "PMS_POSTGRES_PROVISIONING_CREDENTIAL_FILE",
  );
  const runtimeControlPlaneCredentialRoot = required(
    environment,
    "PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_ROOT",
  );
  const runtimeControlPlaneUrl = validateControlPlaneUrl(
    required(environment, "PMS_RUNTIME_CONTROL_PLANE_URL"),
  );
  const roots = {
    runtimeReleaseRoot: required(environment, "PMS_RUNTIME_RELEASE_ROOT"),
    runtimeSecretRoot: required(environment, "PMS_RUNTIME_SECRET_ROOT"),
    runtimeConfigCacheRoot: required(environment, "PMS_RUNTIME_CONFIG_CACHE_ROOT"),
    runtimeControlPlaneCredentialRoot,
    pm2Home: required(environment, "PMS_PM2_HOME"),
  };
  await Promise.all([
    validateRoot(roots.runtimeReleaseRoot, "PMS_RUNTIME_RELEASE_ROOT", false),
    validateRoot(roots.runtimeSecretRoot, "PMS_RUNTIME_SECRET_ROOT", true),
    validateRoot(roots.runtimeConfigCacheRoot, "PMS_RUNTIME_CONFIG_CACHE_ROOT", true),
    validateRoot(
      roots.runtimeControlPlaneCredentialRoot,
      "PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_ROOT",
      true,
    ),
    validateRoot(roots.pm2Home, "PMS_PM2_HOME", true),
  ]);
  assertDistinctRoots(Object.values(roots));
  const runtimeReconcileIntervalMs = requiredBoundedInteger(
    environment.PMS_RUNTIME_RECONCILE_INTERVAL_MS,
    "PMS_RUNTIME_RECONCILE_INTERVAL_MS",
    1_000,
    300_000,
  );
  const runtimeReconcileTimeoutMs = requiredBoundedInteger(
    environment.PMS_RUNTIME_RECONCILE_TIMEOUT_MS,
    "PMS_RUNTIME_RECONCILE_TIMEOUT_MS",
    1_000,
    300_000,
  );
  const runtimeHealthTimeoutMs = requiredBoundedInteger(
    environment.PMS_RUNTIME_HEALTH_TIMEOUT_MS,
    "PMS_RUNTIME_HEALTH_TIMEOUT_MS",
    100,
    60_000,
  );
  if (runtimeHealthTimeoutMs > runtimeReconcileTimeoutMs) {
    throw new Error("PMS_WORKER_RUNTIME_TIMEOUT_ORDER_INVALID");
  }
  return Object.freeze({
    postgresProvisioningCredentialFile: resolve(postgresProvisioningCredentialFile),
    runtimeControlPlaneUrl,
    runtimeControlPlaneCredentialRoot: resolve(roots.runtimeControlPlaneCredentialRoot),
    runtimeReleaseRoot: resolve(roots.runtimeReleaseRoot),
    runtimeSecretRoot: resolve(roots.runtimeSecretRoot),
    runtimeConfigCacheRoot: resolve(roots.runtimeConfigCacheRoot),
    pm2Home: resolve(roots.pm2Home),
    runtimeReconcileIntervalMs,
    runtimeReconcileTimeoutMs,
    runtimeHealthTimeoutMs,
  });
}

function rejectLegacyRuntimeTokenFile(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const legacyKey = ["PMS", "RUNTIME", "CONTROL", "PLANE", "TOKEN", "FILE"].join("_");
  if (environment[legacyKey] !== undefined) {
    throw new Error("PMS_WORKER_LEGACY_RUNTIME_TOKEN_FILE_REJECTED");
  }
}

function validateControlPlaneUrl(source: string): string {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error("PMS_WORKER_CONTROL_PLANE_URL_INVALID");
  }
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error("PMS_WORKER_CONTROL_PLANE_URL_INVALID");
  }
  return url.toString();
}

function rejectInlineSecrets(environment: Readonly<Record<string, string | undefined>>): void {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) continue;
    if (key === "DATABASE_URL" || (key.startsWith("PMS_") && key.endsWith("DATABASE_URL"))) {
      throw new Error("PMS_WORKER_INLINE_DATABASE_SECRET_REJECTED");
    }
    if (
      key.startsWith("PMS_POSTGRES_PROVISIONING_") &&
      !key.endsWith("_FILE") &&
      /(?:CREDENTIAL|PASSWORD|SECRET|TOKEN)/.test(key)
    ) {
      throw new Error("PMS_WORKER_INLINE_PROVISIONING_SECRET_REJECTED");
    }
    if (
      key.startsWith("PMS_RUNTIME_") &&
      !key.endsWith("_FILE") &&
      !key.endsWith("_ROOT") &&
      /(?:CREDENTIAL|PASSWORD|SECRET|TOKEN)/.test(key)
    ) {
      throw new Error("PMS_WORKER_INLINE_RUNTIME_SECRET_REJECTED");
    }
    if (
      (key.startsWith("PMS_PM2_") || key.startsWith("PM2_")) &&
      /(?:CREDENTIAL|PASSWORD|SECRET|TOKEN)/.test(key)
    ) {
      throw new Error("PMS_WORKER_INLINE_PM2_SECRET_REJECTED");
    }
  }
}

function runtimeConfigurationRequested(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return RUNTIME_CONFIGURATION_KEYS.some((key) => environment[key] !== undefined);
}

async function validateSecretFile(path: string, name: string): Promise<void> {
  if (!isAbsolute(path)) throw new Error(`PMS_WORKER_SECRET_FILE_INVALID:${name}`);
  let status;
  let canonical;
  try {
    [status, canonical] = await Promise.all([lstat(path), realpath(path)]);
  } catch {
    throw new Error(`PMS_WORKER_SECRET_FILE_INVALID:${name}`);
  }
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    canonical !== resolve(path) ||
    status.size === 0
  ) {
    throw new Error(`PMS_WORKER_SECRET_FILE_INVALID:${name}`);
  }
  const permissions = status.mode & 0o777;
  if (
    process.platform !== "win32" &&
    ((permissions & ~0o600) !== 0 || (permissions & 0o400) === 0)
  ) {
    throw new Error(`PMS_WORKER_SECRET_FILE_PERMISSIONS:${name}`);
  }
  const parent = dirname(path);
  let parentStatus;
  try {
    parentStatus = await lstat(parent);
  } catch {
    throw new Error(`PMS_WORKER_SECRET_PARENT_UNSAFE:${name}`);
  }
  if (
    parentStatus.isSymbolicLink() ||
    !parentStatus.isDirectory() ||
    (process.platform !== "win32" && (parentStatus.mode & 0o022) !== 0) ||
    (await realpath(parent)) !== resolve(parent)
  ) {
    throw new Error(`PMS_WORKER_SECRET_PARENT_UNSAFE:${name}`);
  }
  if ((await readFile(path, "utf8")).trim().length === 0) {
    throw new Error(`PMS_WORKER_SECRET_FILE_INVALID:${name}`);
  }
}

async function validateRoot(path: string, name: string, privateRoot: boolean): Promise<void> {
  if (!isAbsolute(path)) throw new Error(`PMS_WORKER_ROOT_INVALID:${name}`);
  let status;
  let canonical;
  try {
    [status, canonical] = await Promise.all([lstat(path), realpath(path)]);
  } catch {
    throw new Error(`PMS_WORKER_ROOT_INVALID:${name}`);
  }
  if (status.isSymbolicLink() || !status.isDirectory() || canonical !== resolve(path)) {
    throw new Error(`PMS_WORKER_ROOT_INVALID:${name}`);
  }
  const permissions = status.mode & 0o777;
  if (
    process.platform !== "win32" &&
    ((permissions & 0o022) !== 0 || (privateRoot && (permissions & 0o077) !== 0))
  ) {
    throw new Error(`PMS_WORKER_ROOT_PERMISSIONS:${name}`);
  }
}

function assertDistinctRoots(roots: readonly string[]): void {
  for (let left = 0; left < roots.length; left += 1) {
    for (let right = left + 1; right < roots.length; right += 1) {
      const leftRoot = resolve(roots[left] ?? "");
      const rightRoot = resolve(roots[right] ?? "");
      if (contains(leftRoot, rightRoot) || contains(rightRoot, leftRoot)) {
        throw new Error("PMS_WORKER_ROOT_OVERLAP");
      }
    }
  }
}

function contains(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function required(environment: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`PMS_WORKER_CONFIG_REQUIRED:${name}`);
  return value;
}

function requiredBoundedInteger(
  source: string | undefined,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (source === undefined || source.length === 0) {
    throw new Error(`PMS_WORKER_CONFIG_REQUIRED:${name}`);
  }
  return boundedInteger(source, 0, minimum, maximum);
}

function boundedInteger(
  source: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = source === undefined ? fallback : Number(source);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error("PMS_WORKER_CONFIG_BOUNDS");
  }
  return value;
}
