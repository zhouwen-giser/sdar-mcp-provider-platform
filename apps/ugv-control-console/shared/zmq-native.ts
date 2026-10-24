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
export function nativeContract(name: string, resourceId: string): Tool | undefined {
  const raw = nativeCatalog.tools.find((t) => t.name === name);
  if (!raw) return undefined;
  const tool = structuredClone(raw) as unknown as Tool;
  record(record(tool.inputSchema.properties).resourceId).const = resourceId;
  return tool;
}
export function nativeToolReason(tool: Tool, resourceId: string): string | null {
  const expected = nativeContract(tool.name, resourceId);
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
  if (
    canonical(tools.map((t) => t.name).sort()) !==
    canonical(nativeCatalog.tools.map((t) => t.name).sort())
  )
    return "ZMQ_NATIVE_TOOL_SET_MISMATCH";
  for (const tool of tools) {
    const reason = nativeToolReason(tool, resourceId);
    if (reason) return reason;
  }
  return null;
}
