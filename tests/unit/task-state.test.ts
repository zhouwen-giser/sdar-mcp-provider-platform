import { describe, expect, it } from "vitest";
import { mapAdapterSnapshot } from "../../packages/domain/src/index.js";

const snapshot = (state: string) => ({
  state,
  reasonCode: `${state}_REASON`,
  message: state,
  retryable: false,
  result: { value: 1 },
});

describe("Adapter Snapshot mapping", () => {
  it.each([
    ["ACCEPTED", "working", "accepted"],
    ["QUEUED", "working", "queued"],
    ["RUNNING", "working", "running"],
    ["PAUSED", "working", "paused"],
    ["RESUMING", "working", "resuming"],
    ["STOPPING", "working", "stopping"],
    ["WAITING_INPUT", "input_required", null],
  ])("maps %s to %s/%s", (adapterState, status, substate) => {
    expect(mapAdapterSnapshot(snapshot(adapterState))).toMatchObject({
      mcpStatus: status,
      substate,
      terminal: false,
    });
  });

  it("maps successful Adapter output directly to structuredContent", () => {
    const mapped = mapAdapterSnapshot(snapshot("SUCCEEDED"));
    expect(mapped.mcpStatus).toBe("completed");
    expect(mapped.result).toMatchObject({ isError: false, structuredContent: { value: 1 } });
  });

  it.each([
    ["BUSINESS_FAILED", "business_failure"],
    ["PARTIALLY_COMPLETED", "partial_completion"],
  ])("maps %s to a structured business result", (adapterState, outcome) => {
    const mapped = mapAdapterSnapshot(snapshot(adapterState));
    expect(mapped.mcpStatus).toBe("completed");
    expect(mapped.result).toMatchObject({ isError: true, structuredContent: { outcome } });
  });

  it("uses failed only for technical failure and cancelled for proven cancellation", () => {
    expect(mapAdapterSnapshot(snapshot("TECHNICAL_FAILED"))).toMatchObject({
      mcpStatus: "failed",
      internalState: "TERMINAL_FAILED",
    });
    expect(mapAdapterSnapshot(snapshot("CANCELLED"))).toMatchObject({
      mcpStatus: "cancelled",
      internalState: "TERMINAL_CANCELLED",
    });
  });
});
