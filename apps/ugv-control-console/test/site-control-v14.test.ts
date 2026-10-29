import { describe, it, expect } from "vitest";
import { classifyTask } from "../shared/model.js";
describe("simulation view outcome classification", () => {
  it("does not equate a completed MCP task with applied view evidence", () => {
    const base = {
      schemaVersion: "ugv.simulation-view-result/1",
      application: "unknown",
      occupancy: "held",
      missingEvidence: [],
    };
    expect(classifyTask({ status: "completed", result: { structuredContent: base } }).tone).toBe(
      "warning",
    );
    expect(
      classifyTask({
        status: "completed",
        result: { structuredContent: { ...base, application: "applied", occupancy: "released" } },
      }).tone,
    ).toBe("warning");
    expect(
      classifyTask({
        status: "completed",
        result: { structuredContent: { ...base, application: "partial" } },
      }).label,
    ).toBe("视场已应用，清理未确认");
  });
});
