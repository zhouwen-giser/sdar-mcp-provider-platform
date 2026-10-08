import { z } from "zod";
import type { VehicleSnapshot } from "./types.js";

/** Evidence already normalized by the UGV ingress; this model adds no execution identity. */
export const UgvSemanticSourceSchema = z
  .object({
    missionTaskState: z.union([z.number().int(), z.literal("unknown")]).optional(),
    reconMotionStatus: z.union([z.number().int(), z.literal("unknown")]).optional(),
    lockStage: z.number().int().optional(),
    reconType: z.number().int().optional(),
    loadStatus: z.number().int().optional(),
    cameraFault: z.boolean().optional(),
    online: z.boolean().optional(),
    sensorHealth: z.enum(["normal", "fault", "unknown"]).optional(),
  })
  .strict();
export type UgvSemanticSource = z.infer<typeof UgvSemanticSourceSchema>;

const nativeState = z.union([z.number().int(), z.literal("unknown"), z.null()]);
const nativeCode = z.number().int().nullable();
export const UgvBusinessSemanticsSchema = z
  .object({
    schemaVersion: z.literal("ugv.business-semantics/1"),
    missionTaskState: z.enum([
      "idle",
      "starting",
      "running",
      "paused",
      "cancelled",
      "succeeded",
      "failed",
      "unknown",
    ]),
    reconPhase: z.enum([
      "idle",
      "configuring",
      "ready",
      "starting",
      "running",
      "resuming",
      "pausing",
      "paused",
      "cancelled",
      "failed",
      "completed",
      "stopping",
      "manual_intervention",
      "unknown",
    ]),
    visualLockState: z.enum(["unlocked", "locking", "locked", "unknown"]),
    sensorMode: z.enum(["adaptive", "visible", "infrared", "dc", "unknown"]),
    payloadHealth: z.enum(["normal", "fault", "offline", "unknown"]),
    // Only load code 4 is established as a fault by airport-map-geometry.ts.
    payloadLoadState: z.enum(["fault", "unknown"]),
    native: z
      .object({
        missionTaskState: nativeState,
        reconMotionStatus: nativeState,
        lockStage: nativeCode,
        reconType: nativeCode,
        loadStatus: nativeCode,
        cameraFault: z.boolean().nullable(),
        online: z.boolean().nullable(),
        sensorHealth: z.enum(["normal", "fault", "unknown"]).nullable(),
      })
      .strict(),
  })
  .strict();
export type UgvBusinessSemantics = z.infer<typeof UgvBusinessSemanticsSchema>;
export const UGV_BUSINESS_SEMANTICS_JSON_SCHEMA = z.toJSONSchema(UgvBusinessSemanticsSchema);

// Codebooks: task-state-mapper.ts, native-lock-business-processor.ts and tool-mapping.ts.
const mission: Readonly<Record<number, UgvBusinessSemantics["missionTaskState"]>> = {
  [-1]: "idle",
  0: "starting",
  1: "running",
  2: "paused",
  3: "cancelled",
  4: "succeeded",
  5: "failed",
};
const recon: Readonly<Record<number, UgvBusinessSemantics["reconPhase"]>> = {
  1: "idle",
  2: "configuring",
  3: "ready",
  4: "starting",
  5: "running",
  6: "resuming",
  7: "pausing",
  8: "paused",
  9: "cancelled",
  10: "failed",
  11: "completed",
  12: "stopping",
  13: "manual_intervention",
};
const lock: Readonly<Record<number, UgvBusinessSemantics["visualLockState"]>> = {
  1: "unlocked",
  2: "locking",
  3: "locked",
};
const sensor: Readonly<Record<number, UgvBusinessSemantics["sensorMode"]>> = {
  1: "adaptive",
  2: "visible",
  3: "infrared",
  4: "dc",
};

/** A pure projection, never a task-state reducer or authority/correlation decision. */
export function projectUgvSemanticSource(source: UgvSemanticSource): UgvBusinessSemantics {
  return {
    schemaVersion: "ugv.business-semantics/1",
    missionTaskState:
      typeof source.missionTaskState === "number"
        ? (mission[source.missionTaskState] ?? "unknown")
        : "unknown",
    reconPhase:
      typeof source.reconMotionStatus === "number"
        ? (recon[source.reconMotionStatus] ?? "unknown")
        : "unknown",
    visualLockState:
      source.lockStage === undefined ? "unknown" : (lock[source.lockStage] ?? "unknown"),
    sensorMode:
      source.reconType === undefined ? "unknown" : (sensor[source.reconType] ?? "unknown"),
    payloadHealth:
      source.loadStatus === 4 || source.cameraFault === true || source.sensorHealth === "fault"
        ? "fault"
        : source.online === false
          ? "offline"
          : source.loadStatus === undefined &&
              source.online === true &&
              source.cameraFault === false &&
              source.sensorHealth === "normal"
            ? "normal"
            : "unknown",
    payloadLoadState: source.loadStatus === 4 ? "fault" : "unknown",
    native: {
      missionTaskState: source.missionTaskState ?? null,
      reconMotionStatus: source.reconMotionStatus ?? null,
      lockStage: source.lockStage ?? null,
      reconType: source.reconType ?? null,
      loadStatus: source.loadStatus ?? null,
      cameraFault: source.cameraFault ?? null,
      online: source.online ?? null,
      sensorHealth: source.sensorHealth ?? null,
    },
  };
}

export function ugvSemanticSource(snapshot: VehicleSnapshot): UgvSemanticSource {
  const recon = snapshot.payload.reconnaissance;
  const online = recon.online ?? snapshot.payload.online;
  return {
    missionTaskState: snapshot.chassis.mission.state,
    ...(recon.motionStatus === undefined ? {} : { reconMotionStatus: recon.motionStatus }),
    ...(recon.lock?.stage === undefined ? {} : { lockStage: recon.lock.stage }),
    ...(recon.reconType === undefined ? {} : { reconType: recon.reconType }),
    ...(recon.loadStatus === undefined ? {} : { loadStatus: recon.loadStatus }),
    ...(recon.cameraFault === undefined ? {} : { cameraFault: recon.cameraFault }),
    ...(online === undefined ? {} : { online }),
    sensorHealth: snapshot.health.components.sensor,
  };
}

export function projectUgvBusinessSemantics(snapshot: VehicleSnapshot): UgvBusinessSemantics {
  return projectUgvSemanticSource(ugvSemanticSource(snapshot));
}
