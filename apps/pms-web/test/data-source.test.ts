import { describe, expect, it, vi } from "vitest";
import { MockPmsWebDataSource } from "../src/data/mock-data-source.js";
import { PROTOTYPE_SCENARIOS, buildScenario } from "../src/data/scenarios.js";

describe("MockPmsWebDataSource", () => {
  it("defines every required scenario", () => {
    expect(PROTOTYPE_SCENARIOS).toHaveLength(14);
    for (const scenario of PROTOTYPE_SCENARIOS) expect(() => buildScenario(scenario)).not.toThrow();
  });

  it("projects scenario data and notifies subscribers", async () => {
    const source = new MockPmsWebDataSource("healthy", { id: () => "operation" });
    const listener = vi.fn();
    source.subscribe(listener);
    source.setScenario("incident-active");

    expect((await source.incidents())[0]?.status).toBe("MITIGATING");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("keeps writes in deterministic prototype memory", () => {
    const source = new MockPmsWebDataSource("healthy", { id: () => "operation" });
    const operation = source.startOperation({ label: "模拟", steps: ["one"] });
    source.advanceOperation(operation.operationId);
    source.advanceOperation(operation.operationId);
    expect(source.operations()[0]?.status).toBe("COMPLETED");
  });

  it("returns a mock error without any transport", async () => {
    const source = new MockPmsWebDataSource("network-error");
    await expect(source.providers()).rejects.toThrow("MOCK_DATA_UNAVAILABLE");
  });
});
