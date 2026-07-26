import { describe, expect, it } from "vitest";
import type { SnapshotTransition, TaskRecord } from "../../packages/domain/src/index.js";
import { mergeStopState } from "../../packages/persistence-postgres/src/index.js";

describe("H3 STOPPING state protection", () => {
  it.each(["RUNNING", "PAUSED"] as const)(
    "does not regress durable stop intent to Adapter %s",
    (adapterState) => {
      const merged = mergeStopState(stoppingTask(), workingTransition(adapterState));
      expect(merged).toMatchObject({
        internalState: "STOPPING",
        mcpStatus: "working",
        substate: "stopping",
        statusMessage: "Safe stop requested.",
      });
    },
  );

  it("allows authoritative terminal confirmation to complete STOPPING", () => {
    const terminal: SnapshotTransition = {
      internalState: "TERMINAL_CANCELLED",
      mcpStatus: "cancelled",
      substate: null,
      statusMessage: "Safely stopped.",
      result: null,
      error: null,
      terminal: true,
      observationType: "task.progress",
    };
    expect(mergeStopState(stoppingTask(), terminal)).toBe(terminal);
  });
});

function stoppingTask(): TaskRecord {
  return {
    internalState: "STOPPING",
    mcpStatus: "working",
    substate: "stopping",
    statusMessage: "Safe stop requested.",
    result: null,
    error: null,
    cancelRequested: true,
    stopReason: "USER_REQUESTED",
  } as unknown as TaskRecord;
}

function workingTransition(state: "RUNNING" | "PAUSED"): SnapshotTransition {
  return {
    internalState: state,
    mcpStatus: "working",
    substate: state === "RUNNING" ? "running" : "paused",
    statusMessage: `Adapter reports ${state}.`,
    result: null,
    error: null,
    terminal: false,
    observationType: "task.progress",
  };
}
