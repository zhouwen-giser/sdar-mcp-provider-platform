import { describe, expect, it } from "vitest";
import {
  RUNTIME_DEPLOYMENT_STATUSES,
  rehydrateRuntimeDeployment,
  runtimeConfigProfileId,
  runtimeDeploymentId,
  runtimeEnvironmentId,
  runtimeProviderId,
  databaseProfileId,
  type RuntimeDeploymentStatus,
} from "../../packages/runtime-deployment/src/index.js";

const ALLOWED: Readonly<Record<RuntimeDeploymentStatus, readonly RuntimeDeploymentStatus[]>> = {
  REQUESTED: ["DATABASE_PROVISIONING", "DRAINING", "STOPPED", "FAILED"],
  DATABASE_PROVISIONING: ["MIGRATING", "DRAINING", "FAILED"],
  MIGRATING: ["CONFIG_PREPARING", "DRAINING", "FAILED"],
  CONFIG_PREPARING: ["STARTING", "DRAINING", "FAILED"],
  STARTING: ["HEALTH_CHECKING", "DRAINING", "FAILED"],
  HEALTH_CHECKING: ["DISCOVERING", "DEGRADED", "DRAINING", "FAILED"],
  DISCOVERING: ["ACTIVE", "DEGRADED", "DRAINING", "FAILED"],
  ACTIVE: ["DEGRADED", "DRAINING", "FAILED"],
  STOPPED: ["CONFIG_PREPARING", "REQUESTED"],
  DRAINING: ["STOPPED", "FAILED"],
  DEGRADED: ["DISCOVERING", "DRAINING", "FAILED"],
  FAILED: ["REQUESTED", "STOPPED"],
};

describe("RuntimeDeployment state-machine properties", () => {
  it("accepts exactly the declared transition relation for every status pair", () => {
    for (const current of RUNTIME_DEPLOYMENT_STATUSES) {
      for (const target of RUNTIME_DEPLOYMENT_STATUSES) {
        const deployment = atStatus(current);
        if (target === current) {
          expect(
            deployment.transition(
              target,
              { expectedStatus: current, expectedRevision: 7 },
              new Date(),
            ),
          ).toBe(false);
        } else if (ALLOWED[current].includes(target)) {
          expect(
            deployment.transition(
              target,
              { expectedStatus: current, expectedRevision: 7 },
              new Date(),
            ),
          ).toBe(true);
          expect(deployment.snapshot).toMatchObject({
            status: target,
            observedRevision: 8,
          });
        } else {
          expect(() =>
            deployment.transition(
              target,
              { expectedStatus: current, expectedRevision: 7 },
              new Date(),
            ),
          ).toThrow(expect.objectContaining({ code: "INVALID_RUNTIME_DEPLOYMENT_TRANSITION" }));
        }
      }
    }
  });

  it("never permits stale desired or observed revision writes", () => {
    const desired = atStatus("REQUESTED");
    expect(() => desired.changeDesiredState("draining", 0, 6, new Date())).toThrow(
      expect.objectContaining({ code: "RUNTIME_DEPLOYMENT_REVISION_CONFLICT" }),
    );

    const observed = atStatus("REQUESTED");
    expect(() =>
      observed.transition(
        "DATABASE_PROVISIONING",
        { expectedStatus: "REQUESTED", expectedRevision: 6 },
        new Date(),
      ),
    ).toThrow(expect.objectContaining({ code: "RUNTIME_DEPLOYMENT_REVISION_CONFLICT" }));
  });

  it("makes concurrent recovery deterministic without permitting a direct ACTIVE shortcut", () => {
    const recovered = atStatus("DEGRADED");
    expect(
      recovered.transition(
        "DISCOVERING",
        { expectedStatus: "DEGRADED", expectedRevision: 7 },
        new Date(),
      ),
    ).toBe(true);
    expect(
      recovered.transition(
        "DISCOVERING",
        { expectedStatus: "DEGRADED", expectedRevision: 7 },
        new Date(),
      ),
    ).toBe(false);

    expect(() =>
      atStatus("DEGRADED").transition(
        "ACTIVE",
        { expectedStatus: "DEGRADED", expectedRevision: 7 },
        new Date(),
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_RUNTIME_DEPLOYMENT_TRANSITION" }));

    const diverged = atStatus("DEGRADED");
    diverged.transition(
      "DRAINING",
      { expectedStatus: "DEGRADED", expectedRevision: 7 },
      new Date(),
    );
    expect(() =>
      diverged.transition(
        "DISCOVERING",
        { expectedStatus: "DEGRADED", expectedRevision: 7 },
        new Date(),
      ),
    ).toThrow(expect.objectContaining({ code: "RUNTIME_DEPLOYMENT_STATE_CONFLICT" }));
  });
});

function atStatus(status: RuntimeDeploymentStatus) {
  return rehydrateRuntimeDeployment({
    deploymentId: runtimeDeploymentId("deployment-1"),
    providerId: runtimeProviderId("provider-1"),
    environment: runtimeEnvironmentId("production"),
    desiredState: "running",
    desiredReplicas: 1,
    runtimeVersion: "0.1.0",
    databaseProfileId: databaseProfileId("database-1"),
    configProfileId: runtimeConfigProfileId("config-1"),
    status,
    desiredRevision: 7,
    observedRevision: 7,
  });
}
