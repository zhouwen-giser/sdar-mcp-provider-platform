import v151ControlCatalog from "./zmq-v151-control-catalog.json" with { type: "json" };
import v151ReadonlyCatalog from "./zmq-v151-readonly-catalog.json" with { type: "json" };
import v15ControlCatalog from "./zmq-v15-control-catalog.json" with { type: "json" };
import v15ReadonlyCatalog from "./zmq-v15-readonly-catalog.json" with { type: "json" };
import v13Catalog from "./zmq-site-control-v13-catalog.json" with { type: "json" };
import v14Catalog from "./zmq-site-control-v14-catalog.json" with { type: "json" };
import controlCatalog from "./zmq-site-control-catalog.json" with { type: "json" };
import siteCatalog from "./zmq-site-catalog.json" with { type: "json" };
import nativeCatalog from "./zmq-native-catalog.json" with { type: "json" };
import { record, taskProfile, type Tool } from "./model.js";

const ordered = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(ordered)
    : v !== null && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(record(v))
            .sort()
            .map((key) => [key, ordered(record(v)[key])]),
        )
      : v;
const canonical = (v: unknown): string =>
  v === undefined ? "undefined" : JSON.stringify(ordered(v));
export const NATIVE_CONTROL_TOOLS = [
  "vehicle_zmq_navigate",
  "vehicle_zmq_area_recon",
  "vehicle_zmq_circular_recon",
  "vehicle_zmq_camera",
  "simulation_adjust_view",
];
export const SITE_CONTROL_PROFILE = "zmq_v1_2_0_site_control_13";
export const SITE_CONTROL_V13_PROFILE = "zmq_v1_3_0_site_control_13";
export const SITE_CONTROL_V15_PROFILE = "zmq_v1_5_0_site_control_15";
export const SITE_READONLY_V15_PROFILE = "zmq_v1_5_0_readonly_15";
export const SITE_CONTROL_V151_PROFILE = "zmq_v1_5_1_site_control_15";
export const SITE_READONLY_V151_PROFILE = "zmq_v1_5_1_readonly_15";
export const FRAME_TOOL = "vehicle_zmq_get_frame";
export function siteV15Tools(tools: readonly Tool[]) {
  return tools.some((t) =>
    [
      SITE_CONTROL_V15_PROFILE,
      SITE_READONLY_V15_PROFILE,
      SITE_CONTROL_V151_PROFILE,
      SITE_READONLY_V151_PROFILE,
    ].includes(String(record(t._meta?.["io.sdar/ugvZmq"]).catalogProfile)),
  );
}
export const SITE_CONTROL_V14_PROFILE = "zmq_v1_4_0_site_control_14";
export function siteControlV14Tools(tools: readonly Tool[]) {
  return tools.some((t) =>
    [SITE_CONTROL_V14_PROFILE, SITE_CONTROL_V15_PROFILE, SITE_CONTROL_V151_PROFILE].includes(
      String(record(t._meta?.["io.sdar/ugvZmq"]).catalogProfile),
    ),
  );
}
export function siteControlV13Tools(tools: readonly Tool[]) {
  return tools.some((t) =>
    [
      SITE_CONTROL_V13_PROFILE,
      SITE_CONTROL_V14_PROFILE,
      SITE_CONTROL_V15_PROFILE,
      SITE_CONTROL_V151_PROFILE,
    ].includes(String(record(t._meta?.["io.sdar/ugvZmq"]).catalogProfile)),
  );
}
export function siteControlTools(tools: readonly Tool[]) {
  return (
    siteControlV13Tools(tools) ||
    tools.some((t) => record(t._meta?.["io.sdar/ugvZmq"]).catalogProfile === SITE_CONTROL_PROFILE)
  );
}
export const SITE_PROFILE = "zmq_v1_1_0_readonly_13";
export const PLAN_ROUTE = "vehicle_zmq_plan_route";
export function siteReadonlyTools(tools: readonly Tool[]) {
  return tools.some((t) =>
    [SITE_PROFILE, SITE_READONLY_V15_PROFILE, SITE_READONLY_V151_PROFILE].includes(
      String(record(t._meta?.["io.sdar/ugvZmq"]).catalogProfile),
    ),
  );
}
const catalogs = [
  nativeCatalog,
  siteCatalog,
  controlCatalog,
  v13Catalog,
  v14Catalog,
  v15ControlCatalog,
  v15ReadonlyCatalog,
  v151ControlCatalog,
  v151ReadonlyCatalog,
];
export function nativeContract(
  name: string,
  resourceId: string,
  profile = nativeCatalog.profile,
): Tool | undefined {
  const catalog = catalogs.find((c) => c.profile === profile);
  const raw = catalog?.tools.find((t) => t.name === name);
  if (!raw) return undefined;
  const tool = structuredClone(raw) as unknown as Tool;
  record(record(tool.inputSchema.properties).resourceId).const = resourceId;
  return tool;
}
export function nativeToolReason(tool: Tool, resourceId: string): string | null {
  const profile = record(tool._meta?.["io.sdar/ugvZmq"]).catalogProfile;
  const expected = nativeContract(
    tool.name,
    resourceId,
    typeof profile === "string" ? profile : nativeCatalog.profile,
  );
  if (
    !expected ||
    canonical(tool.inputSchema) !== canonical(expected.inputSchema) ||
    canonical(tool.outputSchema) !== canonical(expected.outputSchema) ||
    canonical(tool._meta?.["io.sdar/taskBusiness"]) !==
      canonical(expected._meta?.["io.sdar/taskBusiness"]) ||
    canonical(tool._meta?.["io.sdar/resourceBinding"]) !==
      canonical(expected._meta?.["io.sdar/resourceBinding"]) ||
    canonical(tool._meta?.["io.sdar/tool-execution-semantics"]) !==
      canonical(expected._meta?.["io.sdar/tool-execution-semantics"]) ||
    canonical(tool._meta?.["io.sdar/ugvZmq"]) !== canonical(expected._meta?.["io.sdar/ugvZmq"]) ||
    canonical(taskProfile(tool)) !== canonical(taskProfile(expected))
  )
    return "ZMQ_NATIVE_CONTRACT_MISMATCH";
  return null;
}
/** Formal native Providers must expose the whole reviewed catalog before any read or control. */
export function nativeCatalogReason(tools: readonly Tool[], resourceId: string): string | null {
  const profiles = new Set(
    tools.map((t) => record(t._meta?.["io.sdar/ugvZmq"]).catalogProfile ?? nativeCatalog.profile),
  );
  const catalog = catalogs.find((c) => c.profile === [...profiles][0]);
  if (profiles.size !== 1 || !catalog) return "ZMQ_NATIVE_CONTRACT_MISMATCH";
  if (
    canonical(tools.map((t) => t.name).sort()) !==
    canonical(catalog.tools.map((t) => t.name).sort())
  )
    return "ZMQ_NATIVE_TOOL_SET_MISMATCH";
  for (const tool of tools) {
    const reason = nativeToolReason(tool, resourceId);
    if (reason) return reason;
  }
  return null;
}
