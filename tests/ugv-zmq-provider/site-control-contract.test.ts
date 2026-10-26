import { DeploymentProfile } from "../../packages/vehicle-zmq-contract/src/index.js";
import { describe, expect, it } from "vitest";
import { SiteControlDeploymentProfile } from "../../packages/vehicle-zmq-contract/src/site-profile.js";
import { controlScope } from "../../packages/vehicle-zmq-control/src/model.js";
import { testScope, rig } from "../ugv-zmq-control/helpers.js";
import {
  siteControlTool,
  siteControlOperation,
  SITE_CONTROL_PROFILE,
  SITE_TOOLS,
} from "../../packages/vehicle-zmq-control/src/site-control-catalog.js";
describe("versioned site-control contract", () => {
  function profile() {
    const old = testScope().profile;
    const { controllerSystemId, ...chassis } = old.components.chassis;
    void controllerSystemId;
    return SiteControlDeploymentProfile.parse({
      ...old,
      schemaVersion: "ugv.zmq-site-deployment/1",
      executionDomain: { mode: "live", simulationId: null },
      components: { ...old.components, chassis },
    });
  }
  it("defaults only the new sender to zero and preserves the isolated deployment contract", () => {
    expect(profile().components.chassis.controllerSystemId).toBe("0");
    expect(() => DeploymentProfile.parse(profile())).toThrow();
    expect(() => controlScope(profile(), testScope().settings)).toThrow();
    expect(() =>
      controlScope(profile(), {
        ...testScope().settings,
        mode: "site_control",
        handoffGrantHash: "a".repeat(64),
        siteEndpoints: [],
      }),
    ).toThrow();
  });
  it("publishes exactly thirteen tools with six task-required controls", () => {
    const tools = SITE_TOOLS.map((n) => siteControlTool(n, "vehicle:fixture"));
    expect(tools).toHaveLength(13);
    expect(
      tools.filter((t) => t._meta["io.sdar/taskExecution"].taskBehavior === "task_required"),
    ).toHaveLength(6);
    expect(
      tools.every((t) => t._meta["io.sdar/ugvZmq"].catalogProfile === SITE_CONTROL_PROFILE),
    ).toBe(true);
  });
  it("checks circular scan rates against configured request limits", async () => {
    const r = await rig();
    try {
      const operation = {
        name: "recon.circular" as const,
        params: {
          scan_mode: "circular" as const,
          yaw_center_rad: null,
          yaw_span_rad: null,
          pitch_rad: 0,
          yaw_speed_rad_s: 1.1,
          cycle_count: 1,
          task_timeout_ms: 300000,
          search_strategy: "recognize" as const,
        },
      };
      expect(r.engine.availability(operation)).toMatchObject({
        available: false,
        reasonCode: "ZMQ_DEPLOYMENT_LIMIT_EXCEEDED",
      });
    } finally {
      await r.engine.close();
    }
  });
  it("retains null target height and requires distinct manual provenance", () => {
    const args = {
      resourceId: "vehicle:fixture",
      targetSource: "manual",
      sourceNote: "operator selected simulation target",
      targetId: "object-1",
      position: { longitude_deg: 106, latitude_deg: 29, ellipsoid_height_m: null },
    };
    expect(siteControlOperation("simulation_apply_effect", args).operation.params).toMatchObject({
      position: { ellipsoid_height_m: null },
      targetSource: "manual",
    });
    expect(() =>
      siteControlOperation("simulation_apply_effect", {
        ...args,
        observation: { taskId: "other", externalExecutionId: "other", revision: 1 },
      }),
    ).toThrow();
  });
});
