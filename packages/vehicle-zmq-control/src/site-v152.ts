import { z } from "zod";
import { jsonToProtoStruct } from "../../adapter-protocol/src/index.js";
import type { ProviderStore } from "../../provider-adapter-kit/src/types.js";
import { siteV151Tool, siteV151Manifest } from "./site-v151.js";
import { PlanRouteResultV3 } from "./planner-v3-contract.js";
import { SITE_CONTROL_V152_PROFILE, SITE_READONLY_V152_PROFILE } from "./catalog-profiles.js";
export { SITE_CONTROL_V152_PROFILE, SITE_READONLY_V152_PROFILE };

export function siteV152Tool(name: string, resourceId: string, readonly = false) {
  const base = siteV151Tool(name, resourceId, readonly),
    profile = readonly ? SITE_READONLY_V152_PROFILE : SITE_CONTROL_V152_PROFILE;
  const output = structuredClone(base.outputSchema);
  if (name === "vehicle_get_capabilities")
    (output.properties as Record<string, unknown>).catalogProfile = { const: profile };
  const { $schema, ...planner } = z.toJSONSchema(PlanRouteResultV3);
  void $schema;
  return {
    ...base,
    outputSchema: name === "vehicle_zmq_plan_route" ? planner : output,
    _meta: {
      ...base._meta,
      "io.sdar/ugvZmq": {
        ...base._meta["io.sdar/ugvZmq"],
        catalogProfile: profile,
        ...(name === "vehicle_zmq_plan_route"
          ? { readinessPolicy: "runtime_scene_and_entity_v1" }
          : {}),
      },
    },
  };
}
export function siteV152Manifest(
  providerId: string,
  resourceId: string,
  store: ProviderStore,
  readonly = false,
) {
  const base = siteV151Manifest(providerId, resourceId, store, readonly);
  return {
    ...base,
    providerVersion: "1.5.2",
    operations: base.operations.map((o) => {
      const tool = siteV152Tool(o.name, resourceId, readonly);
      return {
        ...o,
        inputSchema: jsonToProtoStruct(tool.inputSchema),
        outputSchema: jsonToProtoStruct(tool.outputSchema),
      };
    }),
  };
}
