import { z } from "zod";
import {
  AIRPORT_TRANSFORM_SHA256,
  AIRPORT_ROUTE_SOURCE,
} from "../../provider-adapter-kit/src/navigation-planner.js";
import { siteTool, siteManifest, SITE_TOOLS, PLAN_ROUTE } from "./site-catalog.js";
import { zmqOperation, ZMQ_CONTROL_TOOLS } from "./catalog.js";
import { Operation } from "./model.js";
import { nativeDtoOutputSchema, nativeOutputSchema } from "./result-schemas.js";
import { jsonToProtoStruct } from "../../adapter-protocol/src/index.js";
import type { ProviderStore } from "../../provider-adapter-kit/src/index.js";
import { RESERVED_RESULT_FIELDS } from "../../domain/src/index.js";
export const SITE_CONTROL_PROFILE = "zmq_v1_2_0_site_control_13";
const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
/** Version only the new DTO. The v1 contract generator is deliberately untouched. */
export function siteControlOutputSchema(name: string, dto = false): Record<string, unknown> {
  const root = structuredClone(nativeDtoOutputSchema(name));
  function visit(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const o = record(value);
    if (typeof o.const === "string" && /^ugv\.zmq-.*\/(1)$/.test(o.const))
      o.const = o.const.replace(/\/1$/, "/2");
    if (o.const === "isolated_simulator_only") o.const = "site_control";
    const p = record(o.properties);
    if (p.executionMode && record(p.executionMode).const === "simulation") {
      p.executionMode = { const: "live", type: "string" };
      p.simulationId = { type: "null" };
    }
    if (p.runtimeAdmission) p.runtimeAdmission = { const: "site_runtime", type: "string" };
    Object.values(o).forEach(visit);
  }
  visit(root);
  if (name === "simulation_apply_effect") {
    record(root.properties).targetProvenance = {
      type: "object",
      additionalProperties: true,
      properties: {
        kind: { enum: ["observation", "manual"] },
        sourceNote: { type: ["string", "null"] },
        authorizationContextHash: { type: "string" },
        correlationId: { type: "string" },
      },
      required: ["kind", "sourceNote", "authorizationContextHash", "correlationId"],
    };
    (root.required as string[]).push("targetProvenance");
  }
  if (!dto) {
    root.properties = Object.fromEntries(
      Object.entries(record(root.properties)).filter(
        ([key]) => !RESERVED_RESULT_FIELDS.some((v) => v === key),
      ),
    );
    root.required = (root.required as string[]).filter(
      (k) => !RESERVED_RESULT_FIELDS.some((v) => v === k),
    );
  }
  if (["vehicle_get_inspection_result", "simulation_get_effect_result"].includes(name))
    return { anyOf: [root, dto ? nativeDtoOutputSchema(name) : nativeOutputSchema(name)] };
  return root;
}
export function siteControlTool(name: string, resourceId: string) {
  const base = siteTool(name, resourceId);
  if (name === "simulation_apply_effect") {
    const input = base.inputSchema,
      p = record(input.properties);
    p.targetSource = { type: "string", enum: ["observation", "manual"], default: "observation" };
    p.sourceNote = { type: "string", minLength: 1, maxLength: 1024 };
    input.required = (input.required as string[]).filter((k) => k !== "observation");
    input.allOf = [
      {
        if: { required: ["targetSource"], properties: { targetSource: { const: "manual" } } },
        then: {
          properties: { sourceNote: p.sourceNote, observation: false },
          required: ["sourceNote"],
        },
        else: {
          properties: { observation: p.observation, sourceNote: false },
          required: ["observation"],
        },
      },
    ];
  }
  return {
    ...base,
    outputSchema:
      name === "vehicle_get_targets"
        ? {
            ...base.outputSchema,
            properties: {
              ...record(base.outputSchema.properties),
              effectCandidates: {
                type: "array",
                maxItems: 256,
                items: { type: "object", additionalProperties: true },
              },
            },
            required: [...(base.outputSchema.required as string[]), "effectCandidates"],
          }
        : name === PLAN_ROUTE
          ? base.outputSchema
          : ["vehicle_get_state", "vehicle_get_payload_status", "vehicle_get_targets"].includes(
                name,
              )
            ? base.outputSchema
            : name === "vehicle_get_capabilities"
              ? {
                  type: "object",
                  properties: { schemaVersion: { const: "ugv.zmq-site-capabilities/2" } },
                  required: ["schemaVersion"],
                  additionalProperties: true,
                }
              : siteControlOutputSchema(name),
    _meta: {
      ...base._meta,
      "io.sdar/ugvZmq": {
        ...base._meta["io.sdar/ugvZmq"],
        catalogProfile: SITE_CONTROL_PROFILE,
        qualification: "site_control",
        ...(name === PLAN_ROUTE
          ? {
              routeTransform: {
                policy: "airport_south_positive_v1",
                sha256: AIRPORT_TRANSFORM_SHA256,
              },
              plannerSource: AIRPORT_ROUTE_SOURCE,
            }
          : {}),
      },
    },
  };
}
export function siteControlManifest(providerId: string, resourceId: string, store: ProviderStore) {
  const base = siteManifest(providerId, resourceId, store);
  return {
    ...base,
    providerVersion: "1.2.0",
    operations: base.operations.map((operation) => {
      const tool = siteControlTool(operation.name, resourceId);
      return {
        ...operation,
        description: `ZMQ site control ${operation.name}; source gaps remain explicit.`,
        inputSchema: jsonToProtoStruct(tool.inputSchema),
        outputSchema: jsonToProtoStruct(tool.outputSchema),
      };
    }),
  };
}
export function siteControlOperation(name: string, args: Record<string, unknown>) {
  if (name !== "simulation_apply_effect") return zmqOperation(name, args);
  const { resourceId, ...params } = z
    .object({
      resourceId: z.string().min(1),
      targetId: z.unknown(),
      position: z.unknown(),
      observation: z.unknown().optional(),
      targetSource: z.enum(["observation", "manual"]).optional(),
      sourceNote: z.string().optional(),
    })
    .strict()
    .parse(args);
  return { resourceId, operation: Operation.parse({ name: "simulation.applyEffect", params }) };
}
export { SITE_TOOLS, ZMQ_CONTROL_TOOLS };
