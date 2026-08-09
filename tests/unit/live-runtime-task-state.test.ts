import { describe, expect, it } from "vitest";
import { summarizeRuntimeTaskStates } from "../../scripts/live-runtime-task-state.js";

describe("live Runtime task-state evidence", () => {
  it("counts nonterminal and start-confirmation uncertainty from authoritative states", () => {
    expect(
      summarizeRuntimeTaskStates([
        { internal_state: "TERMINAL_COMPLETED", count: "7" },
        { internal_state: "RUNNING", count: "2" },
        { internal_state: "WAITING_START_CONFIRMATION", count: "1" },
      ]),
    ).toEqual({ active: 3, uncertain: 1 });
  });

  it("does not infer uncertainty from an arbitrary state name fragment", () => {
    expect(
      summarizeRuntimeTaskStates([{ internal_state: "SOME_UNCERTAIN_LABEL", count: 1 }]),
    ).toEqual({ active: 1, uncertain: 0 });
  });

  it("includes unsettled and uncertain admission intents without hiding them", () => {
    expect(
      summarizeRuntimeTaskStates([{ internal_state: "RUNNING", count: "2" }], {
        active: "3",
        uncertain: "1",
      }),
    ).toEqual({ active: 5, uncertain: 1 });
  });

  it("rejects malformed database counts", () => {
    expect(() =>
      summarizeRuntimeTaskStates([{ internal_state: "RUNNING", count: "not-a-count" }]),
    ).toThrow("RUNTIME_TASK_STATE_COUNT_INVALID");
    expect(() => summarizeRuntimeTaskStates([], { active: "1", uncertain: "NaN" })).toThrow(
      "RUNTIME_TASK_STATE_COUNT_INVALID",
    );
  });
});
