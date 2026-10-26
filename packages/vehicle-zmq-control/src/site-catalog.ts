import { z } from "zod";
import { jsonToProtoStruct } from "../../adapter-protocol/src/index.js";
import type { ProviderStore } from "../../provider-adapter-kit/src/index.js";
import { NavigationPlanningRequestSchema } from "../../provider-adapter-kit/src/navigation-planner.js";
import {
  zmqTool,
  zmqProviderManifest,
  ZMQ_PROVIDER_TOOLS,
} from "../../vehicle-zmq-control/src/catalog.js";

export const SITE_PROFILE = "zmq_v1_1_0_readonly_13";
export const PLAN_ROUTE = "vehicle_zmq_plan_route";
export const SITE_TOOLS = [...ZMQ_PROVIDER_TOOLS, PLAN_ROUTE] as const;
export const SITE_READONLY_REASON = "ZMQ_SITE_READONLY_CONTROL_DISABLED";
const point = z
  .object({ longitude: z.number().min(-180).max(180), latitude: z.number().min(-90).max(90) })
  .strict();
export const PlanRouteInput = NavigationPlanningRequestSchema.extend({
  resourceId: z.string().min(1),
  start: point,
  waypoints: z.array(point).min(1).max(64),
}).strict();
export const PlanRouteResult = z
  .object({
    schemaVersion: z.literal("ugv.zmq-route-preview/1"),
    previewId: z.string().min(1),
    resourceId: z.string().min(1),
    adoption: z.literal("preview_only"),
    correlation: z.literal("geometry_only_no_request_id"),
    createdAt: z.iso.datetime(),
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    routeSource: z.string().min(1),
    sourceRecordId: z.string().min(1),
    sourceMessageSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sourceMessage: z.string().min(1).max(262144),
    transform: z
      .object({
        policy: z.literal("airport_south_positive_v1"),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    start: point,
    waypoints: z.array(point).min(2).max(1024),
    requestedWaypoints: z.array(point).min(1).max(64),
    sourceFreshness: z.literal("unverified"),
    completeSpatialEvidence: z.literal(false),
  })
  .strict();
const json = (schema: z.ZodType) => {
  const { $schema, ...value } = z.toJSONSchema(schema);
  void $schema;
  return value;
};
export function siteTool(name: string, resourceId: string): ReturnType<typeof zmqTool> {
  if (name !== PLAN_ROUTE) {
    const base = zmqTool(name, resourceId);
    return {
      ...base,
      ...(name === "vehicle_get_capabilities"
        ? {
            outputSchema: {
              type: "object",
              properties: { schemaVersion: { const: "ugv.zmq-site-capabilities/1" } },
              required: ["schemaVersion"],
              additionalProperties: true,
            },
          }
        : {}),
      _meta: {
        ...base._meta,
        "io.sdar/ugvZmq": {
          ...base._meta["io.sdar/ugvZmq"],
          catalogProfile: SITE_PROFILE,
          qualification: "site_readonly",
        },
      },
    };
  }
  const input = json(PlanRouteInput);
  input.required = ["resourceId", "start", "waypoints"];
  (input.properties as Record<string, unknown>).resourceId = { type: "string", const: resourceId };
  return {
    name,
    inputSchema: input,
    outputSchema: json(PlanRouteResult),
    _meta: {
      "io.sdar/ugvZmq": {
        consoleContract: "ugv.zmq-provider/1",
        operation: name,
        protocol: "socket.io-4",
        catalogProfile: SITE_PROFILE,
        qualification: "site_readonly",
      },
      "io.sdar/tool-execution-semantics": {
        effect: "read_only",
        execution: "synchronous",
        cancellation: "unsupported",
        idempotency: "server_managed",
        replay: "allowed",
      },
      "io.sdar/taskExecution": {
        profileVersion: "1.0",
        taskBehavior: "synchronous_only",
        availability: "dynamic",
        supportsScheduling: false,
        supportsMaxElapsed: false,
        supportsCancellation: false,
        supportsPauseResume: false,
        supportsObservations: false,
        supportsInputRequired: false,
        idempotency: "server_managed",
      },
      "io.sdar/resourceBinding": {
        mode: "ARGUMENT_REFERENCE",
        resourceIdJsonPointer: "/resourceId",
      },
    },
  };
}
export function siteManifest(providerId: string, resourceId: string, store: ProviderStore) {
  const base = zmqProviderManifest(providerId, resourceId, store);
  return {
    ...base,
    providerVersion: "1.1.0",
    operations: SITE_TOOLS.map((name) => {
      const t = siteTool(name, resourceId),
        old = base.operations.find((o) => o.name === name);
      if (old)
        return {
          ...old,
          description: `ZMQ site read-only ${name}; device controls disabled; source qualification pending.`,
          inputSchema: jsonToProtoStruct(t.inputSchema),
          outputSchema: jsonToProtoStruct(t.outputSchema),
        };
      return {
        name,
        description:
          "7879 route preview only; geometry correlation; no device dispatch or navigation task.",
        execution: "SYNCHRONOUS",
        inputSchema: jsonToProtoStruct(t.inputSchema),
        outputSchema: jsonToProtoStruct(t.outputSchema),
        resourceBinding: t._meta["io.sdar/resourceBinding"],
        capabilities: {
          availability: true,
          scheduling: false,
          maxElapsed: false,
          cancel: false,
          pauseResume: false,
          inputRequired: false,
          idempotency: true,
          observations: false,
        },
      };
    }),
  };
}
