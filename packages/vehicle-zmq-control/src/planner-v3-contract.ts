import { z } from "zod";
import { PlanRouteResultV2 } from "./planner-v2-contract.js";

export const PlannerAdmissionEvidence = z
  .object({
    policy: z.literal("runtime_scene_and_entity_v1"),
    observedAt: z.iso.datetime(),
    scenePhase: z.enum(["ready", "failed"]),
    runtimePhase: z.enum(["RUNNING", "DEGRADED"]),
    ownerId: z.string().regex(/^[a-f0-9]{32}$/),
    profileRunId: z.string().regex(/^[a-f0-9]{32}$/),
    simulationEpoch: z.string().regex(/^[1-9][0-9]{0,19}$/),
    revision: z.string().regex(/^[0-9]{1,20}$/),
    readyControlGroups: z.array(z.string().min(1).max(128)).max(64),
    requiredControlGroups: z.array(z.enum(["scene", "motion:ugv"])).length(2),
    acceptingCommands: z.literal(true),
    degraded: z.boolean(),
    faultComponent: z.string().max(128),
    reason: z.string().max(2048),
    sceneError: z.string().max(2048),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type PlannerAdmissionEvidence = z.infer<typeof PlannerAdmissionEvidence>;
export const PlanRouteResultV3 = PlanRouteResultV2.extend({
  schemaVersion: z.literal("ugv.zmq-route-preview/3"),
  plannerAdmission: PlannerAdmissionEvidence,
}).strict();
