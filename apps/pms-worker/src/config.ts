import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export interface PmsWorkerConfig {
  readonly databaseUrlFile: string;
  readonly workerId: string;
  readonly pollIntervalMs: number;
  readonly leaseDurationMs: number;
  readonly claimLimit: number;
  readonly retryDelayMs: number;
  readonly workspaceRoot: string;
}

export async function loadPmsWorkerConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PmsWorkerConfig> {
  if (environment.PMS_DATABASE_URL !== undefined || environment.DATABASE_URL !== undefined) {
    throw new Error("PMS_WORKER_INLINE_DATABASE_SECRET_REJECTED");
  }
  const databaseUrlFile = required(environment, "PMS_DATABASE_URL_FILE");
  if (!isAbsolute(databaseUrlFile)) throw new Error("PMS_DATABASE_URL_FILE_MUST_BE_ABSOLUTE");
  await readDatabaseUrlFile(databaseUrlFile);
  return Object.freeze({
    databaseUrlFile,
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
  });
}

export async function readDatabaseUrlFile(path: string): Promise<string> {
  const value = (await readFile(path, "utf8")).trim();
  if (value.length === 0) throw new Error("PMS_DATABASE_URL_FILE_EMPTY");
  return value;
}

function required(environment: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`PMS_WORKER_CONFIG_REQUIRED:${name}`);
  return value;
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
