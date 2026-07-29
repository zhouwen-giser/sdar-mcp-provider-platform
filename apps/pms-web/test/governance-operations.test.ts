import { describe, expect, it } from "vitest";
import { MockPmsWebDataSource } from "../src/data/mock-data-source.js";

describe("governance and operations prototype", () => {
  it("blocks a breaking catalog revision and simulates discovery", async () => {
    let id = 0;
    const source = new MockPmsWebDataSource("catalog-breaking", {
      id: () => String(++id),
    });
    const operation = (await source.catalogOperations())[0];
    expect(operation?.compatibility).toBe("BREAKING");
    expect(operation?.registryStatus).toBe("BLOCKED");
    expect(source.rediscoverCatalog("provider-ha-east").simulated).toBe(true);
  });

  it("requeues a job as a new attempt without marking it successful", async () => {
    let id = 0;
    const source = new MockPmsWebDataSource("worker-backlog", {
      id: () => String(++id),
    });
    const job = (await source.jobs()).find((item) => item.jobId === "job-reconcile-backlog");
    expect(job).toBeDefined();
    source.requeueJob(job?.jobId ?? "");
    const requeued = (await source.jobs()).find((item) => item.jobId === job?.jobId);
    expect(requeued?.attempts).toBe(4);
    expect(requeued?.status).toBe("PENDING");
  });

  it("closes an incident only after the simulated operation completes", async () => {
    let id = 0;
    const source = new MockPmsWebDataSource("incident-active", {
      id: () => String(++id),
    });
    let operation = source.closeIncident("inc-runtime-drift-042");
    expect((await source.incidents())[0]?.status).toBe("MITIGATING");
    while (operation.status !== "COMPLETED")
      operation = source.advanceOperation(operation.operationId);
    expect((await source.incidents())[0]?.status).toBe("CLOSED");
  });

  it("redacts all credential values in audit evidence", async () => {
    const source = new MockPmsWebDataSource();
    const serialized = JSON.stringify(await source.auditEvents());
    expect(serialized).toContain("REDACTED");
    expect(serialized).not.toMatch(/password|token|secret-value/i);
  });
});
