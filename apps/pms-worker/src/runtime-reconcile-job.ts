import type { JobLease } from "../../../packages/pms-domain/src/index.js";
import { runtimeInfrastructureOperationContext } from "../../../packages/runtime-deployment/src/index.js";
import type { RuntimeDeploymentReconciler } from "../../../packages/pms-application/src/index.js";
import type { PmsJobExecutionContext, PmsJobHandler } from "./job-registry.js";

export const RUNTIME_DEPLOYMENT_RECONCILE_JOB = "runtime_deployment.reconcile";

export function createRuntimeDeploymentReconcileJobHandler(
  reconciler: {
    reconcile(input: Parameters<RuntimeDeploymentReconciler["reconcile"]>[0]): Promise<unknown>;
  },
  timeoutMs = 30_000,
): PmsJobHandler {
  return {
    jobType: RUNTIME_DEPLOYMENT_RECONCILE_JOB,
    async execute(lease: JobLease, execution: PmsJobExecutionContext): Promise<void> {
      const providerId = lease.job.payload.providerId;
      const deploymentId = lease.job.payload.deploymentId;
      if (typeof providerId !== "string" || typeof deploymentId !== "string") {
        throw new Error("RUNTIME_DEPLOYMENT_RECONCILE_PAYLOAD_INVALID");
      }
      execution.signal.throwIfAborted();
      await reconciler.reconcile({
        providerId,
        deploymentId,
        context: runtimeInfrastructureOperationContext({
          operationId: execution.operationId,
          correlationId:
            typeof lease.job.payload.correlationId === "string"
              ? lease.job.payload.correlationId
              : `job:${lease.job.jobId}`,
          idempotencyKey: execution.idempotencyKey,
          timeoutMs,
          signal: execution.signal,
        }),
      });
      execution.signal.throwIfAborted();
    },
  };
}
