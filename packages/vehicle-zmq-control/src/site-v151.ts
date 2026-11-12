import { z } from "zod";
import { jsonToProtoStruct } from "../../adapter-protocol/src/index.js";
import type { ProviderStore } from "../../provider-adapter-kit/src/types.js";
import { siteV15Tool, siteV15Manifest } from "./site-v15.js";
import { PlanRouteResultV2 } from "./planner-v2-contract.js";
import { SITE_CONTROL_V151_PROFILE, SITE_READONLY_V151_PROFILE } from "./catalog-profiles.js";
export { SITE_CONTROL_V151_PROFILE, SITE_READONLY_V151_PROFILE };
export function siteV151Tool(name: string, resourceId: string, readonly = false) {
  const base = siteV15Tool(name, resourceId, readonly),
    profile = readonly ? SITE_READONLY_V151_PROFILE : SITE_CONTROL_V151_PROFILE;
  const output = structuredClone(base.outputSchema);
  if (name === "vehicle_get_capabilities")
    (output.properties as Record<string, unknown>).catalogProfile = { const: profile };
  const { $schema, ...planner } = z.toJSONSchema(PlanRouteResultV2);
  void $schema;
  return {
    ...base,
    outputSchema: name === "vehicle_zmq_plan_route" ? planner : output,
    _meta: {
      ...base._meta,
      "io.sdar/ugvZmq": {
        ...base._meta["io.sdar/ugvZmq"],
        catalogProfile: profile,
        southboundContract: "chassis2.1_explicit_rx_framing_eo2.3_effect1.0",
        ...(name === "vehicle_zmq_plan_route"
          ? {
              protocol: "dashboard-v2",
              correlation: "request_id_epoch_context_and_geometry",
              coordinateFrame: "map_enu",
              plannerSource: "isr.dashboard.road-planner/v2",
              routeTransform: {
                policy: "scene_enu_wgs84_v1",
                reference: "deployment_and_result",
                heightPolicy: "scene_reference_plane_not_measured",
              },
            }
          : {}),
      },
    },
  };
}
export function siteV151Manifest(
  providerId: string,
  resourceId: string,
  store: ProviderStore,
  readonly = false,
) {
  const base = siteV15Manifest(providerId, resourceId, store, readonly);
  return {
    ...base,
    providerVersion: "1.5.1",
    operations: base.operations.map((o) => {
      const t = siteV151Tool(o.name, resourceId, readonly);
      return {
        ...o,
        inputSchema: jsonToProtoStruct(t.inputSchema),
        outputSchema: jsonToProtoStruct(t.outputSchema),
      };
    }),
  };
}
