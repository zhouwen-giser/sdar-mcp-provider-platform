import { describe, expect, it } from "vitest";
import { UgvBusinessEventHub } from "../../apps/ugv-provider-adapter/src/business-events.js";
import { MemoryProviderStore } from "../../packages/provider-adapter-kit/src/index.js";

describe("UGV source event envelope", () => {
  it("emits valid IDs and exclusive task/resource scope bindings", async () => {
    const hub = new UgvBusinessEventHub(new MemoryProviderStore());
    const task = await hub.publish({
      sourceId: "vehicle.execution",
      scope: "task",
      occurredAt: "2026-09-25T00:00:00Z",
      eventType: "vehicle.mission.started",
      description: "Mission started",
      reasonCode: "UGV_WAITING_DEVICE_CONFIRMATION",
      externalExecutionId: "vehicle:ugv1:chassis:run-1",
      resourceRef: "vehicle:ugv1",
      severityHint: "info",
      rawPayload: { state: "STARTING" },
    });
    expect(task.sourceEventId).toMatch(/^[a-f0-9]{64}$/);
    expect(task.externalExecutionId).toBe("vehicle:ugv1:chassis:run-1");
    expect(task.resourceRef).toBeUndefined();

    const target = await hub.publish({
      sourceId: "vehicle.target",
      scope: "resource",
      occurredAt: "2026-09-25T00:00:01Z",
      eventType: "vehicle.target.detected",
      description: "Target observed",
      reasonCode: "UGV_TARGET_OBSERVED",
      resourceRef: "vehicle:ugv1",
      severityHint: "info",
      rawPayload: { targetCountBucket: "one" },
    });
    expect(target.sourceEventId).toMatch(/^[a-f0-9]{64}$/);
    expect(target.resourceRef).toBe("vehicle:ugv1");
    expect(target.externalExecutionId).toBeUndefined();
  });
});
