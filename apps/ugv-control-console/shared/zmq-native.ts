import v13Catalog from "./zmq-site-control-v13-catalog.json" with { type: "json" };
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
];
export const SITE_CONTROL_PROFILE = "zmq_v1_2_0_site_control_13";
export const SITE_CONTROL_V13_PROFILE = "zmq_v1_3_0_site_control_13";
export function siteControlV13Tools(tools: readonly Tool[]) {
  return tools.some(
    (t) => record(t._meta?.["io.sdar/ugvZmq"]).catalogProfile === SITE_CONTROL_V13_PROFILE,
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
  return tools.some((t) => record(t._meta?.["io.sdar/ugvZmq"]).catalogProfile === SITE_PROFILE);
}
export function nativeContract(
  name: string,
  resourceId: string,
  profile = nativeCatalog.profile,
): Tool | undefined {
  const catalog =
    profile === SITE_CONTROL_V13_PROFILE
      ? v13Catalog
      : profile === SITE_CONTROL_PROFILE
        ? controlCatalog
        : profile === SITE_PROFILE
          ? siteCatalog
          : profile === nativeCatalog.profile
            ? nativeCatalog
            : undefined;
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
  const site = siteReadonlyTools(tools),
    control = siteControlTools(tools),
    catalog = siteControlV13Tools(tools)
      ? v13Catalog
      : control
        ? controlCatalog
        : site
          ? siteCatalog
          : nativeCatalog;
  if (
    (site || control) &&
    tools.some(
      (t) =>
        record(t._meta?.["io.sdar/ugvZmq"]).catalogProfile !==
        (siteControlV13Tools(tools)
          ? SITE_CONTROL_V13_PROFILE
          : control
            ? SITE_CONTROL_PROFILE
            : SITE_PROFILE),
    )
  )
    return "ZMQ_NATIVE_CONTRACT_MISMATCH";
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
