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
const componentsV2 = z
  .object({
    chassis: z
      .object({
        ...DeploymentProfile.shape.components.shape.chassis.shape,
        protocolVersion: z.literal("2.1"),
      })
      .strict(),
    eo: z
      .object({
        ...DeploymentProfile.shape.components.shape.eo.shape,
        protocolVersion: z.literal("2.3"),
        framePullEndpoint:
          DeploymentProfile.shape.components.shape.eo.shape.commandEndpoint.nullable(),
      })
      .strict(),
    simulationEffect: DeploymentProfile.shape.components.shape.simulationEffect,
  })
  .strict();
const v2Fields = { ...DeploymentProfile.shape, components: componentsV2 };
function validateV2(p: { components: z.infer<typeof componentsV2> }, ctx: z.RefinementCtx) {
  const endpoints = Object.values(p.components).flatMap((c) => [
    c.commandEndpoint,
    c.publicationEndpoint,
  ]);
  if (p.components.eo.framePullEndpoint) endpoints.push(p.components.eo.framePullEndpoint);
  if (new Set(endpoints).size !== endpoints.length)
    ctx.addIssue({ code: "custom", message: "ZMQ_COMPONENT_ENDPOINTS_COLLIDE" });
  if (
    p.components.chassis.systemId !== null &&
    p.components.chassis.systemId === p.components.chassis.controllerSystemId
  )
    ctx.addIssue({ code: "custom", message: "ZMQ_CONTROLLER_EQUALS_VEHICLE" });
}
export const DeploymentProfileV2 = z
  .object({ ...v2Fields, schemaVersion: z.literal("ugv.zmq-deployment/2") })
  .strict()
  .superRefine(validateV2);
export const SiteControlDeploymentProfileV2 = z
  .object({
    ...v2Fields,
    schemaVersion: z.literal("ugv.zmq-site-deployment/2"),
    executionDomain: SiteControlDeploymentProfile.shape.executionDomain,
    components: componentsV2.extend({
      chassis: componentsV2.shape.chassis.extend({
        controllerSystemId:
          SiteControlDeploymentProfile.shape.components.shape.chassis.shape.controllerSystemId,
      }),
    }),
  })
  .strict()
  .superRefine(validateV2);
export const ControlDeploymentProfile = z.union([
  DeploymentProfile,
  SiteControlDeploymentProfile,
  DeploymentProfileV2,
  SiteControlDeploymentProfileV2,
]);
export type ControlDeploymentProfile = z.infer<typeof ControlDeploymentProfile>;
export type SiteControlDeploymentProfile = z.infer<typeof SiteControlDeploymentProfile>;

export const SiteDeploymentProfile = z.union([
  SiteControlDeploymentProfile,
  SiteControlDeploymentProfileV2,
]);
