import { describe, expect, it } from "vitest";
import { MockPmsWebDataSource } from "../src/data/mock-data-source.js";

describe("runtime lifecycle prototype", () => {
  it("synchronizes deployment lifecycle with the operation panel", async () => {
    let sequence = 0;
    const source = new MockPmsWebDataSource("healthy", {
      id: () => `operation-${String(++sequence)}`,
    });
    const { deployment, operation } = source.createRuntimeDeployment({
      providerId: "provider-ha-east",
      release: "@sdar/runtime@2.0.0-rc.1",
      databaseProfileId: "postgres-primary",
      configurationProfileId: "runtime-r43",
      placement: "local-pm2 / zone-a",
      replicas: 1,
    });

    expect(deployment.observedState).toBe("REQUESTED");
    let current = operation;
    while (current.status !== "COMPLETED") current = source.advanceOperation(current.operationId);

    expect((await source.deployment(deployment.deploymentId))?.observedState).toBe("ACTIVE");
    expect((await source.deployment(deployment.deploymentId))?.observedRevision).toBe(1);
  });

  it("recovers stale runtime through a reconcile job", async () => {
    let sequence = 0;
    const source = new MockPmsWebDataSource("runtime-stale", {
      id: () => `operation-${String(++sequence)}`,
    });
    const { job, operation } = source.reconcileRuntime("deploy-ha-primary");
    let current = operation;
    while (current.status !== "COMPLETED") current = source.advanceOperation(current.operationId);

    expect((await source.deployment("deploy-ha-primary"))?.observedState).toBe("ACTIVE");
    expect((await source.jobs()).find((item) => item.jobId === job.jobId)?.status).toBe("COMPLETED");
    expect((await source.runtimeProcesses())[0]?.registrationStatus).toBe("REGISTERED");
  });

  it("keeps PM2, health and registration states distinct", async () => {
    const source = new MockPmsWebDataSource("runtime-stale");
    const process = (await source.runtimeProcesses())[0];
    expect(process?.pm2Status).toBe("online");
    expect(process?.healthStatus).toBe("DEGRADED");
    expect(process?.registrationStatus).toBe("STALE");
  });
});
