import { z } from "zod";
import {
  ControlDeploymentProfile as PreviousProfile,
  SiteInteropDeploymentProfile,
} from "./interop-profile.js";
export * from "./interop-profile.js";

/** Explicitly opts into component admission; /3 retains its original ready-only contract. */
export const SitePlannerAdmissionProfile = z
  .object({
    ...SiteInteropDeploymentProfile.shape,
    schemaVersion: z.literal("ugv.zmq-site-deployment/4"),
    planner: SiteInteropDeploymentProfile.shape.planner.safeExtend({
      readinessPolicy: z.literal("runtime_scene_and_entity_v1"),
    }),
  })
  .strict()
  .superRefine((p, ctx) => {
    const { readinessPolicy, ...planner } = p.planner;
    void readinessPolicy;
    const checked = SiteInteropDeploymentProfile.safeParse({
      ...p,
      schemaVersion: "ugv.zmq-site-deployment/3",
      planner,
    });
    if (!checked.success)
      for (const issue of checked.error.issues)
        ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  });
export type SitePlannerAdmissionProfile = z.infer<typeof SitePlannerAdmissionProfile>;
export const ControlDeploymentProfile = z.union([PreviousProfile, SitePlannerAdmissionProfile]);
export type ControlDeploymentProfile = z.infer<typeof ControlDeploymentProfile>;
export const SiteDeploymentProfile = ControlDeploymentProfile;
