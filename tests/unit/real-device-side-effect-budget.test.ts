import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reserveSideEffectBudget } from "../../scripts/real-device-side-effect-budget.js";

describe("real-device durable side-effect budget", () => {
  it("reserves before use and survives process-level retries", () => {
    const path = join(mkdtempSync(join(tmpdir(), "side-effect-budget-")), "budget.json");
    const request = {
      runId: "run-1",
      reservationId: "task-1",
      scope: "light-qualification",
      resourceId: "main-light",
      kind: "power-change",
      limit: 1,
      globalLimit: 2,
    };
    expect(reserveSideEffectBudget(path, request)).toEqual({
      count: 1,
      globalCount: 1,
      alreadyReserved: false,
    });
    expect(reserveSideEffectBudget(path, request)).toEqual({
      count: 1,
      globalCount: 1,
      alreadyReserved: true,
    });
    expect(() => reserveSideEffectBudget(path, { ...request, reservationId: "task-2" })).toThrow(
      "REAL_DEVICE_SIDE_EFFECT_BUDGET_EXCEEDED",
    );
  });

  it("fails closed for corrupt state and an orphaned lock", () => {
    const directory = mkdtempSync(join(tmpdir(), "side-effect-budget-corrupt-"));
    const path = join(directory, "budget.json");
    const request = {
      runId: "run-1",
      reservationId: "task-1",
      scope: "climate-qualification",
      resourceId: "climate",
      kind: "power-on",
      limit: 1,
      globalLimit: 1,
    };
    writeFileSync(path, "{}\n");
    expect(() => reserveSideEffectBudget(path, request)).toThrow(
      "INVALID_REAL_DEVICE_SIDE_EFFECT_BUDGET_FILE",
    );
    writeFileSync(path, '{"version":1,"runs":{}}\n');
    writeFileSync(`${path}.lock`, "locked\n");
    expect(() => reserveSideEffectBudget(path, request)).toThrow(
      "REAL_DEVICE_SIDE_EFFECT_BUDGET_LOCKED",
    );
  });

  it("enforces one durable global budget across scopes and resources", () => {
    const path = join(mkdtempSync(join(tmpdir(), "side-effect-global-budget-")), "budget.json");
    const base = {
      runId: "global-run",
      scope: "three-device-e2e",
      kind: "power-change",
      limit: 2,
      globalLimit: 2,
    };
    expect(
      reserveSideEffectBudget(path, {
        ...base,
        reservationId: "main-on",
        resourceId: "main-light",
      }),
    ).toMatchObject({ globalCount: 1 });
    expect(
      reserveSideEffectBudget(path, {
        ...base,
        reservationId: "aux-off",
        resourceId: "aux-light",
      }),
    ).toMatchObject({ globalCount: 2 });
    expect(() =>
      reserveSideEffectBudget(path, {
        ...base,
        reservationId: "climate-mode",
        scope: "climate-qualification",
        resourceId: "climate",
      }),
    ).toThrow("REAL_DEVICE_GLOBAL_SIDE_EFFECT_BUDGET_EXCEEDED");
    expect(() =>
      reserveSideEffectBudget(path, {
        ...base,
        reservationId: "different-limit",
        resourceId: "main-light",
        globalLimit: 3,
      }),
    ).toThrow("REAL_DEVICE_GLOBAL_SIDE_EFFECT_BUDGET_CONFLICT");
  });
});
