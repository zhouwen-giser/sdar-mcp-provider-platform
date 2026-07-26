import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { RUNTIME_VERSION } from "../../../../packages/domain/src/index.js";
import {
  BusinessEventProviderOpsRecorder,
  BusinessEventRepository,
} from "../../../../packages/persistence-postgres/src/index.js";
import { BusinessEventRotationService } from "./rotation-service.js";

const options = parseArguments(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
try {
  const result = await new BusinessEventRotationService(
    new BusinessEventRepository(pool, {
      providerOpsRecorder: new BusinessEventProviderOpsRecorder({
        runtimeVersion: RUNTIME_VERSION,
        instanceId: process.env.OTEL_SERVICE_INSTANCE_ID ?? randomUUID(),
      }),
    }),
    Number(process.env.BUSINESS_EVENTS_RETENTION_MS ?? "604800000"),
  ).rotate({
    providerId: options.providerId,
    reasonCode: options.reason,
    requestId: options.requestId,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await pool.end();
}

function parseArguments(argumentsValue: string[]): {
  providerId: string;
  reason: string;
  requestId: string;
} {
  const value = (name: string): string => {
    const index = argumentsValue.indexOf(name);
    const resolved = index < 0 ? undefined : argumentsValue[index + 1];
    if (resolved === undefined || resolved.length === 0) throw new Error(`Missing ${name}`);
    return resolved;
  };
  const providerId = value("--provider-id");
  const reason = value("--reason");
  const requestId = value("--request-id");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(providerId))
    throw new Error("INVALID_PROVIDER_ID");
  if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(reason)) throw new Error("INVALID_ROTATION_REASON");
  if (requestId.length > 256) throw new Error("INVALID_ROTATION_REQUEST_ID");
  return { providerId, reason, requestId };
}
