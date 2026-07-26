import { describe, expect, it, vi } from "vitest";
import type { JobLease } from "../../../packages/pms-domain/src/index.js";
import {
  createRuntimeDatabasePreparationJobHandler,
  RUNTIME_DATABASE_PREPARATION_JOB,
} from "../src/index.js";

describe("Runtime database preparation worker handler", () => {
  it("uses the lease fencing token as the recoverable operation identity", async () => {
    const execute = vi.fn(() => Promise.resolve({}));
    const handler = createRuntimeDatabasePreparationJobHandler({ execute });

    await handler.execute(lease({ providerId: "provider-a", deploymentId: "deployment-1" }));

    expect(handler.jobType).toBe(RUNTIME_DATABASE_PREPARATION_JOB);
    expect(execute).toHaveBeenCalledWith({
      providerId: "provider-a",
      deploymentId: "deployment-1",
      operationId: "job:job-1:fence:7",
    });
  });

  it("rejects malformed job payloads before calling the application job", async () => {
    const execute = vi.fn(() => Promise.resolve({}));
    const handler = createRuntimeDatabasePreparationJobHandler({ execute });

    await expect(handler.execute(lease({ providerId: "provider-a" }))).rejects.toThrow(
      "RUNTIME_DATABASE_PREPARATION_PAYLOAD_INVALID",
    );
    expect(execute).not.toHaveBeenCalled();
  });
});

function lease(payload: Readonly<Record<string, string>>): JobLease {
  const now = new Date("2026-07-26T00:00:00.000Z");
  return {
    job: {
      jobId: "job-1",
      jobType: RUNTIME_DATABASE_PREPARATION_JOB,
      payload,
      status: "leased",
      attempt: 1,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    },
    owner: "worker-1",
    token: "11111111-1111-4111-8111-111111111111",
    fencingToken: 7n,
    expiresAt: new Date("2026-07-26T00:01:00.000Z"),
  };
}
