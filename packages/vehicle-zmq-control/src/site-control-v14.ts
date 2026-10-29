import { z } from "zod";
import { ZMQ_BUSINESS_PROFILE } from "./catalog.js";
import { SITE_TOOLS as SITE_CATALOG_TOOLS } from "./site-catalog.js";
import {
  siteControlV13Tool,
  siteControlV13Manifest,
  siteControlV13Operation,
  siteControlV13OutputSchema,
} from "./site-control-v13.js";
import {
  VIEW_PROFILE,
  VIEW_TOOL,
  VIEW_PROTOCOL,
  ViewParameters,
  ViewResult,
} from "./simulation-view-contract.js";
import type { ProviderStore } from "../../provider-adapter-kit/src/index.js";
import { jsonToProtoStruct } from "../../adapter-protocol/src/index.js";
import { Operation } from "./model.js";

export const SITE_VIEW_TOOLS = [...SITE_CATALOG_TOOLS, VIEW_TOOL];
const json = (schema: z.ZodType): Record<string, unknown> => {
  const { $schema, ...rest } = z.toJSONSchema(schema);
  void $schema;
  return rest;
};
export function siteControlV14OutputSchema(name: string, dto = false) {
  return name === VIEW_TOOL ? json(ViewResult) : siteControlV13OutputSchema(name, dto);
}
export function siteControlV14Tool(name: string, resourceId: string) {
  const base = siteControlV13Tool(
    name === VIEW_TOOL ? "simulation_apply_effect" : name,
    resourceId,
  );
  return {
    ...base,
    name,
    ...(name === VIEW_TOOL
      ? {
          inputSchema: json(ViewParameters.extend({ resourceId: z.literal(resourceId) })),
          outputSchema: json(ViewResult),
        }
      : {}),
    _meta: {
      ...base._meta,
      "io.sdar/ugvZmq": {
        ...(name === VIEW_TOOL
          ? { consoleContract: "ugv.simulation-view/1" }
          : base._meta["io.sdar/ugvZmq"]),
        catalogProfile: VIEW_PROFILE,
        ...(name === VIEW_TOOL
          ? {
              operation: VIEW_TOOL,
              protocol: VIEW_PROTOCOL,
              qualification: "project_owned_simulation_view",
              cameraOwnership: "project_owned",
              eoRecognitionAffected: false,
              resultEvidence: "actual_fov_and_new_frame",
            }
          : {}),
      },
    },
  };
}
export function siteControlV14Manifest(
  providerId: string,
  resourceId: string,
  store: ProviderStore,
) {
  const base = siteControlV13Manifest(providerId, resourceId, store);
  const template = base.operations.find((o) => o.name === "simulation_apply_effect");
  if (!template) throw Error("ZMQ_VIEW_PROFILE_TEMPLATE_MISSING");
  return {
    ...base,
    providerVersion: "1.4.0",
    operations: [
      ...base.operations,
      {
        ...template,
        name: VIEW_TOOL,
        description:
          "Adjust the project's own CARLA view; requires camera recreation acknowledgement and actual FOV/new frame evidence.",
        businessFeedbackProfile: jsonToProtoStruct(ZMQ_BUSINESS_PROFILE),
      },
    ].map((operation) => {
      const tool = siteControlV14Tool(operation.name, resourceId);
      return {
        ...operation,
        inputSchema: jsonToProtoStruct(tool.inputSchema),
        outputSchema: jsonToProtoStruct(tool.outputSchema),
      };
    }),
  };
}
export function siteControlV14Operation(name: string, args: Record<string, unknown>) {
  if (name !== VIEW_TOOL) return siteControlV13Operation(name, args);
  const { resourceId, ...params } = ViewParameters.extend({ resourceId: z.string().min(1) }).parse(
    args,
  );
  return { resourceId, operation: Operation.parse({ name: "camera.simulationView", params }) };
}
