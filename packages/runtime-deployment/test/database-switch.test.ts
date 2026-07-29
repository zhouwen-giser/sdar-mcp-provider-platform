import { describe, expect, it } from "vitest";
import { guardRuntimeDatabaseSwitch } from "../src/index.js";

describe("Runtime Task Authority database switch guard", () => {
  it("permits a changed database only after every replica is stopped", () => {
    expect(
      guardRuntimeDatabaseSwitch({
        currentDatabaseProfileId: "database-a",
        targetDatabaseProfileId: "database-b",
        desiredState: "stopped",
        desiredReplicas: 0,
        processStates: ["stopped", "missing"],
      }),
    ).toEqual({ outcome: "allowed", allStopRequired: true });
  });

  it.each([
    ["running", 1, ["online"]],
    ["draining", 0, ["stopping"]],
    ["stopped", 0, ["online", "stopped"]],
  ] as const)(
    "forbids rolling database switch for desired=%s replicas=%s states=%j",
    (desiredState, desiredReplicas, processStates) => {
      expect(() =>
        guardRuntimeDatabaseSwitch({
          currentDatabaseProfileId: "database-a",
          targetDatabaseProfileId: "database-b",
          desiredState,
          desiredReplicas,
          processStates,
        }),
      ).toThrow(
        expect.objectContaining({
          code: "RUNTIME_DATABASE_SWITCH_REQUIRES_ALL_STOPPED",
        }),
      );
    },
  );

  it("does not require a stop when the Task Authority database is unchanged", () => {
    expect(
      guardRuntimeDatabaseSwitch({
        currentDatabaseProfileId: "database-a",
        targetDatabaseProfileId: "database-a",
        desiredState: "running",
        desiredReplicas: 1,
        processStates: ["online"],
      }),
    ).toEqual({ outcome: "unchanged", allStopRequired: false });
  });
});
