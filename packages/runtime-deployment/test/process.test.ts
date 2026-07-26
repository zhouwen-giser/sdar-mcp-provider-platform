import { describe, expect, it } from "vitest";
import {
  createRuntimeProcessProjection,
  evaluateRuntimeObservedHealth,
  rehydrateRuntimeProcessProjection,
  runtimeDeploymentId,
  runtimeInstanceId,
  updateRuntimeProcessObservation,
  type RuntimeProcessObservation,
} from "../src/index.js";

const now = new Date("2026-07-26T00:01:00.000Z");

describe("RuntimeProcess observed-state projection", () => {
  it("keeps stable instance identity while PID and observation revisions change", () => {
    const initial = processProjection({ pid: 101, processState: "starting" });
    const updated = updateRuntimeProcessObservation(
      initial,
      observation({ pid: 202, processState: "online" }),
      0,
    );

    expect(updated).toMatchObject({
      instanceId: "instance-01",
      pid: 202,
      observedRevision: 1,
    });
    expect(updated.instanceId).toBe(initial.instanceId);
    expect(updated.instanceId).not.toBe(String(updated.pid));
  });

  it("makes identical observations idempotent and rejects stale changed updates", () => {
    const initial = processProjection();
    expect(updateRuntimeProcessObservation(initial, observation(), 0)).toBe(initial);

    const changed = updateRuntimeProcessObservation(initial, observation({ restartCount: 1 }), 0);
    expect(changed.observedRevision).toBe(1);
    expect(() =>
      updateRuntimeProcessObservation(changed, observation({ restartCount: 2 }), 0),
    ).toThrow(expect.objectContaining({ code: "RUNTIME_PROCESS_REVISION_CONFLICT" }));
  });

  it("does not treat PM2 online alone as ready for ACTIVE", () => {
    const onlineOnly = processProjection({
      processState: "online",
      livenessState: "unknown",
      readinessState: "unknown",
    });

    expect(health(onlineOnly)).toEqual({
      health: "NOT_READY",
      readyForActive: false,
      reasonCode: "LIVENESS_UNKNOWN",
    });
  });

  it.each([
    [{ processState: "missing" }, "STOPPED", "PROCESS_ABSENT"],
    [{ processState: "stopped" }, "STOPPED", "PROCESS_ABSENT"],
    [{ processState: "starting" }, "STARTING", "PROCESS_NOT_ONLINE"],
    [{ processState: "stopping" }, "STARTING", "PROCESS_NOT_ONLINE"],
    [{ processState: "errored" }, "FAILED", "PROCESS_ERRORED"],
    [{ livenessState: "dead" }, "FAILED", "LIVENESS_FAILED"],
    [{ readinessState: "not_ready" }, "NOT_READY", "READINESS_FAILED"],
    [{ registrationState: "unregistered" }, "NOT_READY", "REGISTRATION_MISSING"],
    [{ registrationState: "identity_mismatch" }, "FAILED", "IDENTITY_MISMATCH"],
    [{ lastHeartbeatAt: null }, "STALE", "HEARTBEAT_MISSING"],
    [{ lastHeartbeatAt: new Date("2026-07-26T00:00:00.000Z") }, "STALE", "HEARTBEAT_STALE"],
    [{ runtimeVersion: null }, "NOT_READY", "RUNTIME_VERSION_MISSING"],
    [{ catalogState: "pending" }, "NOT_READY", "CATALOG_PENDING"],
    [{ catalogState: "invalid" }, "FAILED", "CATALOG_INVALID"],
    [{ configState: "unknown" }, "NOT_READY", "CONFIG_UNKNOWN"],
    [{ configState: "stale" }, "DEGRADED", "CONFIG_STALE"],
    [{ configState: "rejected" }, "FAILED", "CONFIG_REJECTED"],
    [{ configState: "restart_required" }, "DEGRADED", "CONFIG_RESTART_REQUIRED"],
  ] as const)("evaluates %o as %s", (overrides, expectedHealth, reasonCode) => {
    const evaluation = health(processProjection(overrides));
    expect(evaluation).toEqual({
      health: expectedHealth,
      readyForActive: false,
      reasonCode,
    });
  });

  it("requires every process, health, identity, heartbeat, Catalog, and config signal", () => {
    expect(health(processProjection())).toEqual({
      health: "READY",
      readyForActive: true,
      reasonCode: "READY",
    });
  });

  it("uses a strict greater-than boundary for stale heartbeats", () => {
    const atBoundary = processProjection({
      lastHeartbeatAt: new Date("2026-07-26T00:00:30.000Z"),
    });

    expect(health(atBoundary, 30_000).health).toBe("READY");
    expect(health(atBoundary, 29_999)).toMatchObject({
      health: "STALE",
      reasonCode: "HEARTBEAT_STALE",
    });
  });

  it("validates PM2 namespace, port, PID, heartbeat, and revision fields", () => {
    expect(() =>
      createRuntimeProcessProjection(
        {
          instanceId: runtimeInstanceId("instance-01"),
          deploymentId: runtimeDeploymentId("deployment-1"),
          pm2Name: "unmanaged-process",
          port: 30_001,
        },
        observation(),
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_RUNTIME_PROCESS_PROJECTION" }));
    expect(() => processProjection({ pid: 0 })).toThrow(
      expect.objectContaining({ code: "INVALID_RUNTIME_PROCESS_PROJECTION" }),
    );
    expect(() =>
      rehydrateRuntimeProcessProjection({
        ...processProjection(),
        observedRevision: -1,
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_RUNTIME_PROCESS_PROJECTION" }));
  });
});

function processProjection(overrides: Partial<RuntimeProcessObservation> = {}) {
  return createRuntimeProcessProjection(
    {
      instanceId: runtimeInstanceId("instance-01"),
      deploymentId: runtimeDeploymentId("deployment-1"),
      pm2Name: "sdar-runtime-production-ugv-01",
      port: 30_001,
    },
    observation(overrides),
  );
}

function observation(
  overrides: Partial<RuntimeProcessObservation> = {},
): RuntimeProcessObservation {
  return {
    pid: 101,
    processState: "online",
    livenessState: "live",
    readinessState: "ready",
    registrationState: "registered",
    catalogState: "valid",
    configState: "current",
    lastHeartbeatAt: new Date("2026-07-26T00:00:45.000Z"),
    runtimeVersion: "2.0.0-rc.1",
    configRevision: 3,
    restartCount: 0,
    ...overrides,
  };
}

function health(process: ReturnType<typeof processProjection>, heartbeatStaleAfterMs = 30_000) {
  return evaluateRuntimeObservedHealth(process, { now, heartbeatStaleAfterMs });
}
