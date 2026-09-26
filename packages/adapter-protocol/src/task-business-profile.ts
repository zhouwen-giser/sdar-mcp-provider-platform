import { z } from "zod";

export const TASK_BUSINESS_OPERATION_PROFILE_SCHEMA_VERSION =
  "sdar.task-business-operation-profile/1.0-rc2" as const;

const id = z.string().min(1).max(256);
const artifactType = z.enum([
  "navigation.destination",
  "navigation.route",
  "navigation.trajectory",
  "navigation.waypoints",
  "recon.area",
  "recon.coverage_plan",
  "recon.current_footprint",
  "recon.covered_area",
  "target.object",
  "target.track",
]);
const actionType = z.enum([
  "sensor.visual_lock",
  "sensor.visual_reacquire",
  "navigation.replan",
  "recon.resume_scan",
]);
const interventionType = z.enum([
  "navigation.adjust_plan",
  "navigation.change_destination",
  "recon.adjust_area",
  "recon.adjust_scan",
  "target.change_visual_lock",
]);
const types = <T extends z.ZodType<string>>(item: T) =>
  z
    .array(item)
    .max(32)
    .refine((items) => new Set(items).size === items.length, "DUPLICATE_BUSINESS_TYPE");

/** Present only when the operation's source, reads and applicable writes are actually wired. */
export const TaskBusinessOperationProfileSchema = z
  .object({
    schemaVersion: z.literal(TASK_BUSINESS_OPERATION_PROFILE_SCHEMA_VERSION),
    profileVersion: z.literal("1.0-rc2"),
    availability: z.literal("available"),
    source: z
      .object({
        sourceId: z.literal("vehicle.business"),
        deliverySemantics: z.literal("durable_at_least_once"),
        replaySupported: z.literal(true),
      })
      .strict(),
    artifactTypes: types(artifactType),
    actionTypes: types(actionType),
    requiredInputTypes: types(id),
    interventionTypes: types(interventionType),
    methods: z
      .object({
        contextGet: z.literal("io.sdar/taskBusiness/context/get"),
        snapshotPartGet: z.literal("io.sdar/taskBusiness/snapshotParts/get").optional(),
        artifactGet: z.literal("io.sdar/taskBusiness/artifacts/get"),
        eventsListen: z.literal("io.sdar/businessEvents/listen"),
        contentGet: z.boolean(),
        inputUpdate: z.boolean(),
        interventionApply: z.boolean(),
      })
      .strict(),
    semantics: z
      .object({
        artifact: z.array(z.enum(["requested", "planned", "observed", "derived"])).min(1),
        coordinateFrames: types(id),
        transformRef: id.optional(),
        observationClockDomains: z
          .array(z.enum(["utc", "simulator_relative", "device_monotonic"]))
          .min(1),
      })
      .strict(),
    limits: z
      .object({
        maxInlineArtifactBytes: z.number().int().min(1_024).max(1_048_576),
        maxWaitMs: z.number().int().min(1_000).max(3_600_000),
        trajectoryMinSamples: z.number().int().min(2).max(100),
      })
      .strict(),
    policy: z
      .object({
        visualLockOwner: z.enum(["disabled", "device_native", "provider"]),
        decisionMode: z.enum(["none", "user_required", "agent_allowed"]),
        onExpire: z.enum(["release_and_resume_scan", "end_observation", "reissue_request"]),
        onDismiss: z.enum(["release_and_resume_scan", "end_observation", "reissue_request"]),
        footprintMode: z.enum(["disabled", "device_reported", "estimated"]),
        coverageMode: z.enum(["disabled", "device_reported", "derived"]),
      })
      .strict(),
    qualification: z
      .object({
        routeAdoption: z.enum(["qualified", "not_supported"]),
        footprint: z.enum(["qualified", "not_supported"]),
        automaticVisualLock: z.enum(["qualified", "not_supported"]),
        runtimeReplan: z.enum(["qualified", "not_supported"]),
      })
      .strict(),
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (profile.requiredInputTypes.length > 0 && !profile.methods.inputUpdate) {
      ctx.addIssue({
        code: "custom",
        message: "BUSINESS_INPUT_METHOD_REQUIRED",
        path: ["methods", "inputUpdate"],
      });
    }
    if (profile.interventionTypes.length > 0 && !profile.methods.interventionApply) {
      ctx.addIssue({
        code: "custom",
        message: "BUSINESS_INTERVENTION_METHOD_REQUIRED",
        path: ["methods", "interventionApply"],
      });
    }
    if (profile.artifactTypes.length > 0 && !profile.methods.contentGet) {
      ctx.addIssue({
        code: "custom",
        message: "BUSINESS_CONTENT_METHOD_REQUIRED",
        path: ["methods", "contentGet"],
      });
    }
    if (
      profile.qualification.routeAdoption !== "qualified" &&
      profile.artifactTypes.includes("navigation.route")
    ) {
      ctx.addIssue({ code: "custom", message: "ROUTE_NOT_QUALIFIED", path: ["artifactTypes"] });
    }
    if (
      profile.qualification.footprint !== "qualified" &&
      profile.artifactTypes.includes("recon.current_footprint")
    ) {
      ctx.addIssue({ code: "custom", message: "FOOTPRINT_NOT_QUALIFIED", path: ["artifactTypes"] });
    }
    if (
      profile.qualification.runtimeReplan !== "qualified" &&
      profile.interventionTypes.some(
        (kind) => kind === "navigation.adjust_plan" || kind === "navigation.change_destination",
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "REPLAN_NOT_QUALIFIED",
        path: ["interventionTypes"],
      });
    }
    if (
      profile.policy.visualLockOwner !== "disabled" &&
      profile.qualification.automaticVisualLock !== "qualified"
    ) {
      ctx.addIssue({
        code: "custom",
        message: "VISUAL_LOCK_NOT_QUALIFIED",
        path: ["policy", "visualLockOwner"],
      });
    }
  });
export type TaskBusinessOperationProfile = z.infer<typeof TaskBusinessOperationProfileSchema>;

export function taskBusinessOperationProfileJsonSchema(): object {
  return z.toJSONSchema(TaskBusinessOperationProfileSchema);
}
