import { describe, expect, it } from "vitest";
import { normalizeBusinessTerminal } from "../../packages/persistence-postgres/src/index.js";

const base = {
  taskId: "task-1",
  internalState: "TERMINAL_COMPLETED",
  mcpTaskStatus: "completed",
  uncertaintyClass: null,
  error: null,
};

describe("SMPP business terminal normalization", () => {
  it("keeps MCP completion separate from a business error result", () => {
    const terminal = normalizeBusinessTerminal({
      ...base,
      result: { isError: true, structuredContent: { reasonCode: "TARGET_REJECTED" } },
    });
    expect(terminal).toEqual({
      schemaVersion: "sdar.smpp-business-terminal/v1",
      taskId: "task-1",
      mcpTaskStatus: "completed",
      businessStatus: "failed",
      providerExecutionStatus: "completed",
      transportStatus: "completed",
      isError: true,
      reasonCode: "TARGET_REJECTED",
    });
  });

  it("reports a response-lost transport axis independently", () => {
    expect(
      normalizeBusinessTerminal({
        ...base,
        result: { isError: false },
        uncertaintyClass: "response_lost_after_adapter_success",
      }),
    ).toMatchObject({
      businessStatus: "succeeded",
      providerExecutionStatus: "completed",
      transportStatus: "response_lost_after_commit",
    });
  });

  it("does not turn cancellation or a missing result into success", () => {
    expect(
      normalizeBusinessTerminal({
        ...base,
        internalState: "TERMINAL_CANCELLED",
        mcpTaskStatus: "cancelled",
        result: null,
      }).businessStatus,
    ).toBe("not_applicable");
    expect(normalizeBusinessTerminal({ ...base, result: null }).businessStatus).toBe("unknown");
  });

  it("contains no Goal or Benchmark assertion", () => {
    const terminal = normalizeBusinessTerminal({ ...base, result: { isError: false } });
    expect(terminal).not.toHaveProperty("goalAchieved");
    expect(terminal).not.toHaveProperty("benchmarkPass");
  });
});
