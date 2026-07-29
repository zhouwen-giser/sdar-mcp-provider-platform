import { describe, expect, it, vi } from "vitest";
import type { JobLease } from "../../../packages/pms-domain/src/index.js";
import {
  createRuntimeDeploymentReconcileJobHandler,
  RUNTIME_DEPLOYMENT_RECONCILE_JOB,
} from "../src/index.js";

describe("RuntimeDeployment reconcile worker handler", () => {
  it("binds job lease fencing and correlation to one reconcile execution", async () => {
    const reconcile = vi.fn((input: unknown) => {
      void input;
      return Promise.resolve({});
    });
    const handler = createRuntimeDeploymentReconcileJobHandler({ reconcile }, 12_000);

    await handler.execute(lease());

    expect(handler.jobType).toBe(RUNTIME_DEPLOYMENT_RECONCILE_JOB);
    expect(reconcile).toHaveBeenCalledOnce();
    expect(reconcile.mock.calls[0]?.[0]).toMatchObject({
      providerId: "provider-a",
      deploymentId: "deployment-1",
      context: {
        operationId: "job:job-1:fence:9",
        correlationId: "request-1",
        idempotencyKey: "job-1:9",
        timeoutMs: 12_000,
      },
    });
  });

  it("rejects malformed jobs before reconciliation", async () => {
    const reconcile = vi.fn((input: unknown) => {
      void input;
      return Promise.resolve({});
    });
    const handler = createRuntimeDeploymentReconcileJobHandler({ reconcile });
    const valid = lease();
    const invalid: JobLease = {
      ...valid,
      job: { ...valid.job, payload: { providerId: "provider-a" } },
    };

    await expect(handler.execute(invalid)).rejects.toThrow(
      "RUNTIME_DEPLOYMENT_RECONCILE_PAYLOAD_INVALID",
    );
    expect(reconcile).not.toHaveBeenCalled();
  });
});

function lease(): JobLease {
  const now = new Date("2026-07-26T00:00:00.000Z");
  return {
    job: {
      jobId: "job-1",
      jobType: RUNTIME_DEPLOYMENT_RECONCILE_JOB,
      payload: {
        providerId: "provider-a",
        deploymentId: "deployment-1",
        correlationId: "request-1",
      },
      status: "leased",
      attempt: 1,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    },
    owner: "worker-1",
    token: "11111111-1111-4111-8111-111111111111",
    fencingToken: 9n,
    expiresAt: new Date("2026-07-26T00:01:00.000Z"),
  };
}
