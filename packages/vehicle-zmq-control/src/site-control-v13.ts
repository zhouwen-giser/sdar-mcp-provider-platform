import { z } from "zod";
import {
  siteControlTool,
  siteControlManifest,
  siteControlOperation,
  siteControlOutputSchema,
} from "./site-control-catalog.js";
import type { ProviderStore } from "../../provider-adapter-kit/src/index.js";
import { jsonToProtoStruct } from "../../adapter-protocol/src/index.js";

export const SITE_CONTROL_V13_PROFILE = "zmq_v1_3_0_site_control_13";
export const regionTool = (name: string) =>
  ["vehicle_zmq_area_recon", "vehicle_zmq_inspect_area"].includes(name);
const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const input = z
  .object({
    resourceId: z.string().min(1),
    area: z
      .object({
        crs: z.literal("OGC:CRS84"),
        searchStrategy: z.enum(["recognize", "track"]),
        vertices: z
          .array(
            z
              .object({
                longitude: z.number().gte(-180).lt(180),
                latitude: z.number().min(-90).max(90),
                ellipsoidHeightM: z.number().optional(),
                ellipsoidHeightSource: z.enum(["provided", "default_zero"]).optional(),
              })
              .strict(),
          )
          .length(4),
      })
      .strict(),
  })
  .strict();
/** Resolve an operator-selected default; it never represents measured terrain. */
export function resolveRegionArguments(name: string, args: Record<string, unknown>) {
  if (!regionTool(name)) return { arguments: args, parameterResolution: undefined };
  const value = input.parse(args);
  for (const p of value.area.vertices)
    if (
      (p.ellipsoidHeightSource === "default_zero" &&
        p.ellipsoidHeightM !== undefined &&
        p.ellipsoidHeightM !== 0) ||
      (p.ellipsoidHeightSource === "provided" && p.ellipsoidHeightM === undefined)
    )
      throw Error("ZMQ_HEIGHT_PROVENANCE_MISMATCH");
  const effective = {
    ...value,
    area: {
      ...value.area,
      vertices: value.area.vertices.map((p) => ({
        longitude: p.longitude,
        latitude: p.latitude,
        ellipsoidHeightM: p.ellipsoidHeightM ?? 0,
      })),
    },
  };
  return {
    arguments: effective,
    parameterResolution: {
      schemaVersion: "ugv.zmq-region-parameters/1",
      policy: "missing_height_zero",
      requestedArguments: structuredClone(args),
      effectiveArguments: effective,
      vertices: value.area.vertices.map((p, index) => ({
        index,
        source:
          p.ellipsoidHeightSource ??
          (p.ellipsoidHeightM === undefined ? "default_zero" : "provided"),
        ellipsoidHeightM: p.ellipsoidHeightM ?? 0,
      })),
    },
  };
}
export function siteControlV13OutputSchema(name: string, dto = false) {
  const root = siteControlOutputSchema(name, dto);
  if (regionTool(name)) {
    record(root.properties).parameterResolution = { type: "object", additionalProperties: true };
    (root.required as string[]).push("parameterResolution");
  }
  return root;
}
export function siteControlV13Tool(name: string, resourceId: string) {
  const tool = siteControlTool(name, resourceId);
  if (regionTool(name)) {
    const area = record(record(tool.inputSchema.properties).area);
    const vertex = record(record(record(area.properties).vertices).items);
    vertex.required = ["longitude", "latitude"];
    record(vertex.properties).ellipsoidHeightM = { type: "number", default: 0 };
    record(vertex.properties).ellipsoidHeightSource = {
      type: "string",
      enum: ["provided", "default_zero"],
    };
  }
  return {
    ...tool,
    outputSchema: regionTool(name) ? siteControlV13OutputSchema(name) : tool.outputSchema,
    _meta: {
      ...tool._meta,
      "io.sdar/ugvZmq": {
        ...tool._meta["io.sdar/ugvZmq"],
        catalogProfile: SITE_CONTROL_V13_PROFILE,
        regionHeightDefault: "zero_meters_operator_default",
      },
    },
  };
}
export function siteControlV13Manifest(
  providerId: string,
  resourceId: string,
  store: ProviderStore,
) {
  const manifest = siteControlManifest(providerId, resourceId, store);
  return {
    ...manifest,
    providerVersion: "1.3.0",
    operations: manifest.operations.map((o) => {
      const tool = siteControlV13Tool(o.name, resourceId);
      return {
        ...o,
        inputSchema: jsonToProtoStruct(tool.inputSchema),
        outputSchema: jsonToProtoStruct(tool.outputSchema),
      };
    }),
  };
}
export function siteControlV13Operation(name: string, args: Record<string, unknown>) {
  return siteControlOperation(name, resolveRegionArguments(name, args).arguments);
}
