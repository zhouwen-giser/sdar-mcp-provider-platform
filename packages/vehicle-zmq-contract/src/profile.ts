import { z } from "zod";
import { WireId } from "./schema.js";

const uint64 = z
  .string()
  .regex(/^[1-9][0-9]{0,19}$/)
  .refine((s) => BigInt(s) <= 0xffff_ffff_ffff_ffffn);
const endpoint = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "tcp:" &&
    !!url.hostname &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    !url.pathname &&
    !!url.port &&
    url.hostname !== "*"
  );
}, "ZMQ_ENDPOINT_INVALID");
export const EvidenceReference = z
  .object({ path: z.string().min(1).max(512), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const G0_EVIDENCE = [
  "deploymentIdentity",
  "timeAndCoordinates",
  "opticalGeometryAndLimits",
  "capabilityScope",
  "serverImplementation",
  "plannerPolicy",
  "providerGoldenFrames",
] as const;
export const ZMQ_OPERATIONS = [
  "state.read",
  "navigation.point",
  "navigation.route",
  "navigation.returnHome",
  "recon.area",
  "recon.circular",
  "camera.position",
  "camera.zoom",
  "inspection.complete",
  "simulation.effect",
] as const;
const evidence = z
  .object({
    deploymentIdentity: EvidenceReference.nullable(),
    timeAndCoordinates: EvidenceReference.nullable(),
    opticalGeometryAndLimits: EvidenceReference.nullable(),
    capabilityScope: EvidenceReference.nullable(),
    serverImplementation: EvidenceReference.nullable(),
    plannerPolicy: EvidenceReference.nullable(),
    providerGoldenFrames: EvidenceReference.nullable(),
  })
  .strict();
export const DeploymentProfile = z
  .object({
    schemaVersion: z.literal("ugv.zmq-deployment/1"),
    status: z.literal("candidate"),
    executionDomain: z
      .object({
        mode: z.literal("simulation"),
        simulationId: z.string().min(1).max(256).nullable(),
      })
      .strict(),
    providerBinding: z
      .object({
        providerId: z.string().min(1).max(256).nullable(),
        resourceId: z.string().min(1).max(256).nullable(),
        sourceSessionKey: z.string().min(1).max(256).nullable(),
      })
      .strict(),
    components: z
      .object({
        chassis: z
          .object({
            protocolVersion: z.literal("2.0"),
            commandEndpoint: endpoint,
            publicationEndpoint: endpoint,
            systemId: uint64.nullable(),
            controllerSystemId: uint64.nullable(),
          })
          .strict(),
        eo: z
          .object({
            protocolVersion: z.literal("2.2"),
            commandEndpoint: endpoint,
            publicationEndpoint: endpoint,
            deviceId: WireId,
          })
          .strict(),
        simulationEffect: z
          .object({
            protocolVersion: z.literal("1.0"),
            commandEndpoint: endpoint,
            publicationEndpoint: endpoint,
            deviceId: WireId,
          })
          .strict(),
      })
      .strict(),
    planner: z
      .object({
        policy: z.enum(["pending", "retain", "disable"]),
        endpoint: z.url().nullable(),
      })
      .strict()
      .refine((p) => {
        if (p.policy === "disable") return p.endpoint === null;
        if (p.endpoint === null) return true;
        const url = new URL(p.endpoint);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          url.pathname === "/"
        );
      }, "ZMQ_PLANNER_POLICY_INVALID"),
    intendedOperations: z
      .array(z.enum(ZMQ_OPERATIONS))
      .min(1)
      .refine((list) => new Set(list).size === list.length),
    evidence,
  })
  .strict()
  .superRefine((p, ctx) => {
    const endpoints = Object.values(p.components).flatMap((c) => [
      c.commandEndpoint,
      c.publicationEndpoint,
    ]);
    if (new Set(endpoints).size !== endpoints.length)
      ctx.addIssue({ code: "custom", message: "ZMQ_COMPONENT_ENDPOINTS_COLLIDE" });
    if (
      p.components.chassis.systemId !== null &&
      p.components.chassis.systemId === p.components.chassis.controllerSystemId
    )
      ctx.addIssue({ code: "custom", message: "ZMQ_CONTROLLER_EQUALS_VEHICLE" });
  });
export type DeploymentProfile = z.infer<typeof DeploymentProfile>;
export const ProtocolGap = z
  .object({
    code: z.string().regex(/^[A-Z0-9_]+$/),
    description: z.string().min(1),
    resolution: z.literal("requires_provider_contract_or_implementation_evidence"),
    blocks: z.array(z.enum(ZMQ_OPERATIONS)).min(1),
  })
  .strict();
export const ProtocolGaps = z.array(ProtocolGap);

/** Static G0 assessment. Wire conformance never turns into runtime admission. */
export function assessDeployment(
  input: unknown,
  gapsInput: unknown,
  evidenceValid: (reference: z.infer<typeof EvidenceReference>) => boolean,
) {
  const profile = DeploymentProfile.parse(input),
    gaps = ProtocolGaps.parse(gapsInput);
  const missing: string[] = [];
  if (profile.executionDomain.simulationId === null) missing.push("SIMULATION_ID_UNCONFIRMED");
  for (const key of ["providerId", "resourceId", "sourceSessionKey"] as const)
    if (profile.providerBinding[key] === null)
      missing.push(`PROVIDER_BINDING_${key.toUpperCase()}_UNCONFIRMED`);
  if (profile.components.chassis.systemId === null) missing.push("CHASSIS_SYSTEM_ID_UNCONFIRMED");
  if (profile.components.chassis.controllerSystemId === null)
    missing.push("CONTROLLER_SYSTEM_ID_UNCONFIRMED");
  if (
    profile.planner.policy === "pending" ||
    (profile.planner.policy === "retain" && profile.planner.endpoint === null)
  )
    missing.push("PLANNER_POLICY_UNCONFIRMED");
  for (const kind of G0_EVIDENCE) {
    const ref = profile.evidence[kind];
    if (ref === null) missing.push(`EVIDENCE_${kind.toUpperCase()}_MISSING`);
    else if (!evidenceValid(ref)) missing.push(`EVIDENCE_${kind.toUpperCase()}_INVALID`);
  }
  const decisions = profile.intendedOperations.map((operation) => ({
    operation,
    blockers: [...missing, ...gaps.filter((g) => g.blocks.includes(operation)).map((g) => g.code)],
    runtimeAdmission: "not_published" as const,
  }));
  return {
    schemaVersion: "ugv.zmq-g0-report/1",
    g0Ready: decisions.every((d) => d.blockers.length === 0),
    runtimeAdmission: "not_published",
    missing,
    decisions,
  };
}
