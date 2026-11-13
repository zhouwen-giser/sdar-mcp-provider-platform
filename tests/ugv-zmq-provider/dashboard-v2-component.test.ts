import { afterEach, describe, it, expect } from "vitest";
import { DashboardV2ComponentPlanner } from "../../packages/provider-adapter-kit/src/dashboard-v2-component-planner.js";
import { dashboardFixture, binding } from "./dashboard-v2-fixture.js";
let fixture: Awaited<ReturnType<typeof dashboardFixture>> | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});
describe("Dashboard V2 component-qualified route preview", () => {
  async function setup(timeout = 1000) {
    fixture = await dashboardFixture();
    return {
      f: fixture,
      planner: new DashboardV2ComponentPlanner(fixture.endpoint, binding, timeout),
      input: { start: fixture.start, waypoints: [fixture.destination] },
    };
  }
  it("retains overall degradation while accepting explicitly open scene and vehicle components", async () => {
    const { f, planner, input } = await setup();
    f.state.scenePhase = "failed";
    f.state.sceneOverrides = { error: "Dashboard self-check timed out" };
    f.state.runtimeOverrides = {
      phase: "DEGRADED",
      fault_component: "dashboard",
      reason: "Dashboard self-check timed out",
    };
    const result = await planner.plan(input);
    expect(result.plannerAdmission).toMatchObject({
      scenePhase: "failed",
      runtimePhase: "DEGRADED",
      degraded: true,
      acceptingCommands: true,
      requiredControlGroups: ["scene", "motion:ugv"],
      reason: "Dashboard self-check timed out",
      sceneError: "Dashboard self-check timed out",
    });
    expect(f.state.calls).toBe(1);
    expect(f.state.messages.filter((s) => s.startsWith("42"))).toHaveLength(1);
  });
  it.each([
    [{ accepting_commands: false }, "COMPONENT_UNAVAILABLE"],
    [{ ready_control_groups: ["scene", "eo:ugv"] }, "COMPONENT_UNAVAILABLE"],
    [{ ready_control_groups: ["motion:ugv"] }, "COMPONENT_UNAVAILABLE"],
    [{ available: false }, "ADMISSION_UNAVAILABLE"],
    [{ phase: "LOADING_SCENE" }, "SCENE_NOT_READY"],
    [{ phase: "DEGRADED" }, "SCENE_STATE_CHANGED"],
    [{ simulation_epoch: "999" }, "EPOCH_CHANGED"],
    [{ owner_id: "c".repeat(32) }, "DEPLOYMENT_CHANGED"],
    [{ profile_run_id: "c".repeat(32) }, "DEPLOYMENT_CHANGED"],
    [{ revision: null }, "ADMISSION_INVALID"],
  ])(
    "rejects invalid per-component admission %j before contacting the planner",
    async (override, code) => {
      const { f, planner, input } = await setup();
      f.state.runtimeOverrides = override;
      await expect(planner.plan(input)).rejects.toThrow(code);
      expect(f.state.calls).toBe(0);
    },
  );
  it("rejects scene transitions even if a runtime snapshot still admits components", async () => {
    const { f, planner, input } = await setup();
    f.state.scenePhase = "starting";
    await expect(planner.plan(input)).rejects.toThrow("SCENE_NOT_READY");
    expect(f.state.calls).toBe(0);
  });
  it("rejects a wrong scene even if map assets and coordinate samples match", async () => {
    const { f, planner, input } = await setup();
    f.state.sceneOverrides = { active_scenario: "another-scene" };
    await expect(planner.plan(input)).rejects.toThrow("SCENE_MISMATCH");
    expect(f.state.calls).toBe(0);
  });
  it("uses authoritative context, correlates request IDs and ENU route without motion", async () => {
    const { f, planner, input } = await setup();
    f.state.wrongIdFirst = true;
    const result = await planner.plan(input);
    expect(result.context).toMatchObject({
      entity_id: "ugv",
      mission_id: -1,
      mission_request_id: "",
      controller_instance_id: "SIMULATED-controller",
    });
    expect(result.planningRequestId).toBe(f.state.requests[0]?.planning_request_id);
    expect(f.state.latestPoints.at(-1)?.[0]).toBeCloseTo(80, 3);
    expect(f.state.latestPoints.at(-1)?.[1]).toBeCloseTo(-100, 3);
    expect(result.waypoints.at(-1)?.longitude).toBeCloseTo(f.destination.longitude, 8);
    expect(f.state.requests).toHaveLength(1);
    expect(f.state.messages.filter((s) => s.startsWith("42"))).toHaveLength(1);
  });
  for (const [field, value, code] of [
    ["mapMismatch", true, "SCENE_MISMATCH"],
    ["transformMismatch", true, "TRANSFORM_MISMATCH"],
    ["wrongEntity", true, "ENTITY_MISMATCH"],
    ["available", false, "CONTEXT_STALE"],
    ["mismatch", true, "GEOMETRY_MISMATCH"],
    ["changeContext", true, "CONTEXT_CHANGED"],
    ["ackError", "Dashboard controlled entity changed or is missing", "ENTITY_MISMATCH"],
  ] as const)
    it(`rejects ${field} explicitly`, async () => {
      const { f, planner, input } = await setup(200);
      Object.assign(f.state, { [field]: value });
      await expect(planner.plan(input)).rejects.toThrow(code);
      expect(f.state.calls).toBeLessThanOrEqual(1);
    });
  it("distinguishes mission identity rejection from controlled entity rejection", async () => {
    const { f, planner, input } = await setup();
    f.state.ackError = "Dashboard mission changed or its identity is missing";
    await expect(planner.plan(input)).rejects.toThrow("UGV_PLANNER_MISSION_CHANGED");
  });
  it("times out responses without retrying or sending control", async () => {
    const { f, planner, input } = await setup(150);
    f.state.delayMs = 1000;
    await expect(planner.plan(input)).rejects.toThrow("RESPONSE_TIMEOUT");
    expect(f.state.calls).toBe(1);
  });
  it("rejects a submitted start that differs from current vehicle position", async () => {
    const { f, planner, input } = await setup();
    input.start = f.frame.toGnss(500, 500);
    await expect(planner.plan(input)).rejects.toThrow("START_CHANGED");
    expect(f.state.calls).toBe(0);
  });
  it("closes an aborted read and never sends a navigation task", async () => {
    const { f, planner, input } = await setup();
    const abort = new AbortController();
    abort.abort();
    await expect(planner.plan(input, abort.signal)).rejects.toThrow("CANCELLED");
    expect(f.state.calls).toBe(0);
  });
});
