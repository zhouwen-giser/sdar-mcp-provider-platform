import type { JobLease } from "../../../packages/pms-domain/src/index.js";
import type { RuntimeDatabasePreparationInput } from "../../../packages/pms-application/src/index.js";
import type { PmsJobHandler } from "./job-registry.js";

export const RUNTIME_DATABASE_PREPARATION_JOB = "runtime_deployment.reconcile";

export function createRuntimeDatabasePreparationJobHandler(job: {
  execute(input: RuntimeDatabasePreparationInput): Promise<unknown>;
}): PmsJobHandler {
  return {
    jobType: RUNTIME_DATABASE_PREPARATION_JOB,
    async execute(lease: JobLease): Promise<void> {
      await job.execute(parseInput(lease));
    },
  };
}

function parseInput(lease: JobLease): RuntimeDatabasePreparationInput {
  const providerId = lease.job.payload.providerId;
  const deploymentId = lease.job.payload.deploymentId;
  if (typeof providerId !== "string" || typeof deploymentId !== "string") {
    throw new Error("RUNTIME_DATABASE_PREPARATION_PAYLOAD_INVALID");
  }
  return Object.freeze({
    providerId,
    deploymentId,
    operationId: `job:${lease.job.jobId}:fence:${String(lease.fencingToken)}`,
  });
}
