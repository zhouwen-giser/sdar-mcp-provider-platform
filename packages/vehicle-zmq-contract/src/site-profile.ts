import { z } from "zod";
import { DeploymentProfile } from "./profile.js";
// A separate version preserves the frozen simulation deployment contract.
export const SiteControlDeploymentProfile = z
  .object({
    ...DeploymentProfile.shape,
    schemaVersion: z.literal("ugv.zmq-site-deployment/1"),
    executionDomain: z.object({ mode: z.literal("live"), simulationId: z.null() }).strict(),
    components: DeploymentProfile.shape.components.safeExtend({
      chassis: DeploymentProfile.shape.components.shape.chassis.safeExtend({
        controllerSystemId: z
          .string()
          .regex(/^(?:0|[1-9][0-9]{0,19})$/)
          .refine((v) => BigInt(v) <= 0xffff_ffff_ffff_ffffn)
          .default("0"),
      }),
    }),
  })
  .strict()
  .superRefine((p, ctx) => {
    const endpoints = Object.values(p.components).flatMap((c) => [
      c.commandEndpoint,
      c.publicationEndpoint,
    ]);
    if (
      new Set(endpoints).size !== endpoints.length ||
      p.components.chassis.controllerSystemId === p.components.chassis.systemId
    )
      ctx.addIssue({ code: "custom", message: "ZMQ_SITE_BINDING_INVALID" });
  });
export const ControlDeploymentProfile = z.union([DeploymentProfile, SiteControlDeploymentProfile]);
export type ControlDeploymentProfile = z.infer<typeof ControlDeploymentProfile>;
export type SiteControlDeploymentProfile = z.infer<typeof SiteControlDeploymentProfile>;
