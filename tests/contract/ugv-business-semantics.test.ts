import { describe, expect, it } from "vitest";
import {
  normalizeMqttObservation,
  normalizeNpcTankMqttObservation,
} from "../../packages/vehicle-mqtt-ingress/src/normalizers.js";
import {
  UgvBusinessSemanticsSchema,
  projectUgvSemanticSource,
  projectUgvBusinessSemantics,
} from "../../packages/vehicle-provider-core/src/ugv-business-semantics.js";
import { createUgvSnapshot } from "../../packages/vehicle-provider-core/src/snapshot.js";
import {
  mapVehicleTaskState,
  mapReconMotionStatus,
  projectReconMotionStatus,
} from "../../packages/vehicle-provider-core/src/task-state-mapper.js";

describe("UGV stable business semantics", () => {
  it.each([
    [-1, "idle"],
    [0, "starting"],
    [1, "running"],
    [2, "paused"],
    [3, "cancelled"],
    [4, "succeeded"],
    [5, "failed"],
    [777, "unknown"],
  ] as const)("projects mission code %s to %s", (missionTaskState, expected) => {
    expect(projectUgvSemanticSource({ missionTaskState }).missionTaskState).toBe(expected);
  });
  it.each([
    [1, "idle"],
    [2, "configuring"],
    [3, "ready"],
    [4, "starting"],
    [5, "running"],
    [6, "resuming"],
    [7, "pausing"],
    [8, "paused"],
    [9, "cancelled"],
    [10, "failed"],
    [11, "completed"],
    [12, "stopping"],
    [13, "manual_intervention"],
    [99, "unknown"],
    [777, "unknown"],
  ] as const)("projects recon code %s to %s", (reconMotionStatus, expected) => {
    expect(projectUgvSemanticSource({ reconMotionStatus }).reconPhase).toBe(expected);
  });
  it.each([
    [1, "unlocked"],
    [2, "locking"],
    [3, "locked"],
    [4, "unknown"],
    [777, "unknown"],
  ] as const)("does not guess unqualified lock stage %s", (lockStage, expected) => {
    expect(projectUgvSemanticSource({ lockStage }).visualLockState).toBe(expected);
  });
  it.each([
    [1, "adaptive"],
    [2, "visible"],
    [3, "infrared"],
    [4, "dc"],
    [777, "unknown"],
  ] as const)("projects sensor code %s", (reconType, expected) => {
    expect(projectUgvSemanticSource({ reconType }).sensorMode).toBe(expected);
  });
  it("keeps unknown codes, missing data and numeric load state explicit", () => {
    const output = projectUgvSemanticSource({
      missionTaskState: 777,
      reconMotionStatus: 778,
      lockStage: 779,
      reconType: 780,
      loadStatus: 781,
    });
    expect(UgvBusinessSemanticsSchema.parse(output)).toEqual(output);
    expect(output).toMatchObject({
      missionTaskState: "unknown",
      reconPhase: "unknown",
      visualLockState: "unknown",
      sensorMode: "unknown",
      payloadHealth: "unknown",
      payloadLoadState: "unknown",
      native: { loadStatus: 781 },
    });
    expect(projectUgvBusinessSemantics(createUgvSnapshot())).toMatchObject({
      missionTaskState: "unknown",
      reconPhase: "unknown",
      native: { loadStatus: null },
    });
    expect(mapVehicleTaskState(777, true).state).toBe("RECONCILE");
    expect(mapReconMotionStatus(778, true).state).toBe("RECONCILE");
    expect(projectReconMotionStatus(778)).toBe("unknown");
  });
  it("derives health only from qualified flags and component health", () => {
    expect(projectUgvSemanticSource({ loadStatus: 1 }).payloadHealth).toBe("unknown");
    expect(projectUgvSemanticSource({ loadStatus: 4, cameraFault: false })).toMatchObject({
      payloadHealth: "fault",
      payloadLoadState: "fault",
    });
    expect(projectUgvSemanticSource({ cameraFault: true, online: true }).payloadHealth).toBe(
      "fault",
    );
    expect(projectUgvSemanticSource({ sensorHealth: "fault" }).payloadHealth).toBe("fault");
    expect(projectUgvSemanticSource({ online: false }).payloadHealth).toBe("offline");
    expect(
      projectUgvSemanticSource({ online: true, cameraFault: false, sensorHealth: "normal" })
        .payloadHealth,
    ).toBe("normal");
    expect(
      projectUgvSemanticSource({
        loadStatus: 731,
        online: true,
        cameraFault: false,
        sensorHealth: "normal",
      }).payloadHealth,
    ).toBe("unknown");
  });
  it("preserves future UGV codes through ingress without changing NPC admission", () => {
    expect(
      normalizeMqttObservation("/ugv/mission_state", { id: 1, state: 777 }).patch.chassis?.mission
        ?.state,
    ).toBe(777);
    expect(
      normalizeMqttObservation("/ugv/area_recon/status", {
        status: 778,
        lock: { stage: 779 },
        recon_type: 780,
        load_status: 781,
      }).patch.payload?.reconnaissance,
    ).toMatchObject({
      motionStatus: 778,
      state: "unknown",
      lock: { stage: 779 },
      reconType: 780,
      loadStatus: 781,
    });
    expect(() =>
      normalizeNpcTankMqttObservation("/npc_tank1/mission_state", { id: 1, state: 777 }),
    ).toThrow("NPC_TANK_MQTT_TASK_STATE_INVALID");
    expect(() => normalizeMqttObservation("/ugv/mission_state", { id: 1, state: -1 })).toThrow(
      "UGV_MQTT_TASK_STATE_INVALID",
    );
  });
});
