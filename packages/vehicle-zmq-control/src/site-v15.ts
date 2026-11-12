import { VehicleObservationStateV3 } from "../../vehicle-zmq-observer/src/state.js";
import { z } from "zod";
import type { ProviderStore } from "../../provider-adapter-kit/src/types.js";
import { jsonToProtoStruct } from "../../adapter-protocol/src/index.js";
import { FrameInput, FrameResult, FRAME_TOOL } from "../../vehicle-zmq-frames/src/contract.js";
import { siteControlV14Manifest, siteControlV14Tool, SITE_VIEW_TOOLS } from "./site-control-v14.js";
import { SITE_CONTROL_V15_PROFILE, SITE_READONLY_V15_PROFILE } from "./catalog-profiles.js";
export { SITE_CONTROL_V15_PROFILE, SITE_READONLY_V15_PROFILE };
export const SITE_V15_TOOLS = [...SITE_VIEW_TOOLS, FRAME_TOOL];
const json = (schema: z.ZodType): Record<string, unknown> => {
  const { $schema, ...rest } = z.toJSONSchema(schema);
  void $schema;
  return rest;
};
export function siteV15Tool(name: string, resourceId: string, readonly = false) {
  const profile = readonly ? SITE_READONLY_V15_PROFILE : SITE_CONTROL_V15_PROFILE;
  const base = siteControlV14Tool(
    name === FRAME_TOOL ? "vehicle_zmq_plan_route" : name,
    resourceId,
  );
  const input = name === FRAME_TOOL ? json(FrameInput) : base.inputSchema;
  if (name === FRAME_TOOL) {
    (input.properties as Record<string, unknown>).resourceId = {
      type: "string",
      const: resourceId,
    };
    input.oneOf = [
      {
        properties: { cameraId: {}, frameId: {}, retrievalId: false, offset: false },
        required: ["cameraId", "frameId"],
      },
      {
        properties: { retrievalId: {}, offset: {}, cameraId: false, frameId: false },
        required: ["retrievalId", "offset"],
      },
    ];
  }
  let output = name === FRAME_TOOL ? json(FrameResult) : structuredClone(base.outputSchema);
  if (["vehicle_get_state", "vehicle_get_payload_status", "vehicle_get_targets"].includes(name)) {
    output = json(VehicleObservationStateV3);
    if (name === "vehicle_get_targets" && !readonly) {
      (output.properties as Record<string, unknown>).effectCandidates = {
        type: "array",
        maxItems: 256,
        items: { type: "object", additionalProperties: true },
      };
      (output.required as string[]).push("effectCandidates");
    }
  }
  if (name === "vehicle_get_capabilities") {
    (output.properties as Record<string, unknown>).schemaVersion = {
      const: readonly ? "ugv.zmq-site-capabilities/1" : "ugv.zmq-site-capabilities/2",
    };
    (output.properties as Record<string, unknown>).catalogProfile = { const: profile };
    (output.required as string[]).push("catalogProfile");
  }
  return {
    ...base,
    name,
    inputSchema: input,
    outputSchema: output,
    _meta: {
      ...base._meta,
      "io.sdar/ugvZmq": {
        ...base._meta["io.sdar/ugvZmq"],
        catalogProfile: profile,
        qualification: readonly ? "site_readonly" : "site_control",
        southboundContract: "chassis2.1_eo2.3_effect1.0",
        ...([
          "vehicle_zmq_area_recon",
          "vehicle_zmq_inspect_area",
          "vehicle_zmq_circular_recon",
          "vehicle_zmq_camera",
        ].includes(name)
          ? { protocol: "2.3" }
          : {}),
        ...(name === "vehicle_zmq_navigate" ? { protocol: "2.1" } : {}),
        ...(name === "vehicle_get_inspection_result"
          ? { protocol: "platform_retained", historicalProtocols: ["2.2", "2.3"] }
          : {}),
        ...([
          "vehicle_get_state",
          "vehicle_get_capabilities",
          "vehicle_get_payload_status",
          "vehicle_get_targets",
        ].includes(name)
          ? { protocol: "native-v2" }
          : {}),
        ...(name === FRAME_TOOL
          ? {
              operation: FRAME_TOOL,
              protocol: "2.3",
              consoleContract: "ugv.zmq-frame/1",
              cacheRetention: "temporary_5min_capacity_eviction",
              association: "exact_device_camera_frame",
            }
          : {}),
      },
    },
  };
}
export function siteV15Manifest(
  providerId: string,
  resourceId: string,
  store: ProviderStore,
  readonly = false,
) {
  const base = siteControlV14Manifest(providerId, resourceId, store);
  const template = base.operations.find((o) => o.name === "vehicle_zmq_plan_route");
  if (!template) throw Error("ZMQ_FRAME_PROFILE_TEMPLATE_MISSING");
  return {
    ...base,
    providerVersion: "1.5.0",
    operations: [
      ...base.operations,
      {
        ...template,
        name: FRAME_TOOL,
        description:
          "Read an exact observed JPEG frame or an authorized temporary chunk; no device control or permanent image storage.",
      },
    ].map((o) => {
      const tool = siteV15Tool(o.name, resourceId, readonly);
      return {
        ...o,
        inputSchema: jsonToProtoStruct(tool.inputSchema),
        outputSchema: jsonToProtoStruct(tool.outputSchema),
      };
    }),
  };
}
