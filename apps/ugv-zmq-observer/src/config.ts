import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { z } from "zod";
import { DeploymentProfile } from "../../../packages/vehicle-zmq-contract/src/index.js";
import {
  ObserverSettings,
  observerIdentity,
  sha256,
} from "../../../packages/vehicle-zmq-observer/src/index.js";
import { checkContracts } from "../../../scripts/ugv-zmq/check-contracts.js";

export function loadObservationConfig(env: NodeJS.ProcessEnv = process.env) {
  const settingsPath = resolve(
    env.UGV_ZMQ_OBSERVER_SETTINGS_FILE ?? "deploy/ugv-zmq/observer.settings.json",
  );
  const profilePath = resolve(
    env.UGV_ZMQ_DEPLOYMENT_PROFILE_FILE ?? "deploy/ugv-zmq/deployment.candidate.json",
  );
  const settings = ObserverSettings.parse(
    JSON.parse(readFileSync(settingsPath, "utf8")) as unknown,
  );
  const profileBytes = readFileSync(profilePath);
  const profile = DeploymentProfile.parse(JSON.parse(profileBytes.toString("utf8")) as unknown);
  if (profile.components.chassis.systemId === null)
    throw Error("ZMQ_OBSERVATION_CHASSIS_ID_REQUIRED");
  const databaseUrl = env.UGV_ZMQ_OBSERVATION_DATABASE_URL;
  if (!databaseUrl) throw Error("ZMQ_OBSERVATION_DATABASE_URL_REQUIRED");
  z.url()
    .refine((value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol))
    .parse(databaseUrl);
  checkContracts(resolve("contracts/ugv-zmq/v1"));
  const contractSha = sha256(readFileSync(resolve("contracts/ugv-zmq/v1/contract-lock.json")));
  const scope = observerIdentity(
    profile,
    settings.diagnosticPartition,
    sha256(profileBytes),
    contractSha,
  );
  const duration = env.UGV_ZMQ_OBSERVER_DURATION_MS;
  const durationMs =
    duration === undefined ? null : z.coerce.number().int().min(1000).max(60000).parse(duration);
  return { settings, profile, scope, databaseUrl, durationMs };
}
export function observationPool(config: ReturnType<typeof loadObservationConfig>) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 4,
    connectionTimeoutMillis: config.settings.databaseTimeoutMs,
    query_timeout: config.settings.databaseTimeoutMs,
    statement_timeout: config.settings.databaseTimeoutMs,
    application_name: "smpp-ugv-zmq-observer",
  });
  pool.on("error", () => undefined);
  return pool;
}
