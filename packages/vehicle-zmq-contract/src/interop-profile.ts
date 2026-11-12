import { z } from "zod";
import {
  ControlDeploymentProfile as PreviousProfile,
  SiteControlDeploymentProfileV2,
} from "./site-profile.js";
export * from "./site-profile.js";

const uint64 = z
  .string()
  .regex(/^[1-9][0-9]{0,19}$/)
  .refine((s) => BigInt(s) <= 0xffffffffffffffffn);
export const PlannerMapReference = z
  .object({
    sceneId: z.string().min(1).max(128),
    mapId: z.string().min(1).max(128),
    sceneSha256: z.string().regex(/^[a-f0-9]{64}$/),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    altitude: z.number(),
  })
  .strict();
export const SiteInteropDeploymentProfile = z
  .object({
    ...SiteControlDeploymentProfileV2.shape,
    schemaVersion: z.literal("ugv.zmq-site-deployment/3"),
    components: SiteControlDeploymentProfileV2.shape.components
      .extend({
        chassis: SiteControlDeploymentProfileV2.shape.components.shape.chassis
          .extend({
            publicationFraming: z.enum(["prefix_wire_length_crc", "prefix_business_length_crc"]),
            // Receive compatibility is not evidence to change command encoding.
            commandFraming: z.literal("prefix_wire_length_crc"),
          })
          .strict(),
      })
      .strict(),
    planner: SiteControlDeploymentProfileV2.shape.planner.safeExtend({
      protocolVersion: z.literal("dashboard-v2"),
      entityId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/),
      entityType: z.literal("ugv"),
      systemId: uint64,
      mapReference: PlannerMapReference,
      maxContextAgeMs: z.number().int().min(1).max(1000).default(1000),
    }),
  })
  .strict()
  .superRefine((p, ctx) => {
    const endpoints = Object.values(p.components).flatMap((c) => [
      c.commandEndpoint,
      c.publicationEndpoint,
    ]);
    if (p.components.eo.framePullEndpoint) endpoints.push(p.components.eo.framePullEndpoint);
    if (new Set(endpoints).size !== endpoints.length)
      ctx.addIssue({ code: "custom", message: "ZMQ_COMPONENT_ENDPOINTS_COLLIDE" });
    if (p.components.chassis.systemId === p.components.chassis.controllerSystemId)
      ctx.addIssue({ code: "custom", message: "ZMQ_CONTROLLER_EQUALS_VEHICLE" });
    if (p.planner.systemId !== p.components.chassis.systemId)
      ctx.addIssue({ code: "custom", message: "ZMQ_PLANNER_CHASSIS_BINDING_MISMATCH" });
  });
export type SiteInteropDeploymentProfile = z.infer<typeof SiteInteropDeploymentProfile>;
export const ControlDeploymentProfile = z.union([PreviousProfile, SiteInteropDeploymentProfile]);
export type ControlDeploymentProfile = z.infer<typeof ControlDeploymentProfile>;
export const SiteDeploymentProfile = z.union([PreviousProfile, SiteInteropDeploymentProfile]);
