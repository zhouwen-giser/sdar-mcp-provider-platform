import { Pool } from "pg";
import { runtimeInfrastructureOperationContext } from "../packages/runtime-deployment/src/index.js";
import { createProductionRuntimeComposition } from "../apps/pms-worker/src/runtime-composition.js";
import { loadPmsWorkerConfig, readDatabaseUrlFile } from "../apps/pms-worker/src/config.js";

const providerId = process.argv[2];
const deploymentId = process.argv[3];
if (providerId === undefined || deploymentId === undefined) {
  throw new Error("PMS_RECONCILE_DIAGNOSTIC_ARGUMENTS_REQUIRED");
}

const config = await loadPmsWorkerConfig();
console.error("diagnostic:config");
const databaseUrl = await readDatabaseUrlFile(config.databaseUrlFile);
const pool = new Pool({ connectionString: databaseUrl });
console.error("diagnostic:pool");
const runtime = await createProductionRuntimeComposition(pool, config);
console.error("diagnostic:composition");
try {
  console.error("diagnostic:reconcile");
  const result = await runtime.reconciler.reconcile({
    providerId,
    deploymentId,
    context: runtimeInfrastructureOperationContext({
      operationId: `diag-${deploymentId}`,
      correlationId: `diag-${deploymentId}`,
      idempotencyKey: `diag-${deploymentId}-${String(Date.now())}`,
      timeoutMs: config.runtime?.runtimeReconcileTimeoutMs ?? 30_000,
    }),
  });
  console.log(
    JSON.stringify({
      outcome: "succeeded",
      status: result.deployment.status,
      progressed: result.progressed,
      orphanProcessNames: result.orphanProcessNames,
    }),
  );
} catch (error) {
  console.log(JSON.stringify({ outcome: "failed", error: describe(error) }));
  process.exitCode = 1;
} finally {
  console.error("diagnostic:close");
  await runtime.close();
  await pool.end();
}

function describe(error: unknown, depth = 0): unknown {
  if (depth > 4 || typeof error !== "object" || error === null) return "UNKNOWN";
  const record = error as {
    readonly code?: unknown;
    readonly name?: unknown;
    readonly cause?: unknown;
  };
  return {
    name: typeof record.name === "string" ? record.name : "Error",
    code: typeof record.code === "string" ? record.code : undefined,
    cause: record.cause === undefined ? undefined : describe(record.cause, depth + 1),
  };
}
