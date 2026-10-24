import { parseCoordinates, validatePolygon } from "./coordinates.js";
import { array, record, text, taskProfile, type Json, type Tool } from "./model.js";

export const ZMQ_INSPECT = "vehicle_zmq_inspect_area";
export const EFFECT_APPLY = "simulation_apply_effect";
export const INSPECTION_RESULT = "vehicle_get_inspection_result";
export const EFFECT_RESULT = "simulation_get_effect_result";
const numeric = { type: "number" };
const position = {
  type: "object",
  additionalProperties: false,
  required: ["longitude_deg", "latitude_deg", "ellipsoid_height_m"],
  properties: {
    longitude_deg: { type: "number", minimum: -180, exclusiveMaximum: 180 },
    latitude_deg: { type: "number", minimum: -90, maximum: 90 },
    ellipsoid_height_m: { type: ["number", "null"] },
  },
};
/** Candidate contract only. Publication/qualification is a separate phase-5 operation. */
export function zmqConsoleTool(name: string, resourceId: string): Tool {
  const query = [INSPECTION_RESULT, EFFECT_RESULT].includes(name),
    inspection = name === ZMQ_INSPECT || name === INSPECTION_RESULT;
  if (![ZMQ_INSPECT, EFFECT_APPLY, INSPECTION_RESULT, EFFECT_RESULT].includes(name))
    throw Error("ZMQ_CONSOLE_TOOL_UNKNOWN");
  const properties: Json = { resourceId: { const: resourceId } },
    required = ["resourceId"];
  if (query) {
    Object.assign(properties, {
      taskId: { type: "string", minLength: 1, maxLength: 256 },
      executionId: { type: "string", minLength: 1, maxLength: 256 },
      afterRevision: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 8 },
    });
    required.push("taskId", "executionId", "afterRevision", "limit");
  } else if (inspection) {
    properties.area = {
      type: "object",
      additionalProperties: false,
      required: ["crs", "vertices", "searchStrategy"],
      properties: {
        crs: { const: "OGC:CRS84" },
        vertices: {
          type: "array",
          minItems: 4,
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["longitude", "latitude", "ellipsoidHeightM"],
            properties: {
              longitude: { type: "number", minimum: -180, exclusiveMaximum: 180 },
              latitude: { type: "number", minimum: -90, maximum: 90 },
              ellipsoidHeightM: numeric,
            },
          },
        },
        searchStrategy: { enum: ["recognize", "track"] },
      },
    };
    required.push("area");
  } else {
    Object.assign(properties, {
      targetId: { type: "string", minLength: 1, maxLength: 64 },
      position,
      observation: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "externalExecutionId", "revision"],
        properties: {
          taskId: { type: "string", minLength: 1, maxLength: 128 },
          externalExecutionId: { type: "string", minLength: 1, maxLength: 128 },
          revision: { type: "integer", minimum: 1 },
        },
      },
    });
    required.push("targetId", "position", "observation");
  }
  return {
    name,
    inputSchema: { type: "object", additionalProperties: false, required, properties },
    _meta: {
      "io.sdar/ugvZmq": {
        consoleContract: "ugv.zmq-console/1",
        operation: name,
        protocol: inspection ? "2.2" : "1.0",
      },
      "io.sdar/taskExecution": {
        profileVersion: "1.0",
        taskBehavior: query ? "synchronous_only" : "task_required",
        idempotency: "server_managed",
        supportsPauseResume: !query && inspection,
        supportsCancellation: !query && inspection,
        supportsScheduling: !query,
        supportsMaxElapsed: !query,
      },
    },
  };
}
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
export function zmqToolReason(tool: Tool | undefined, resourceId: string): string | null {
  if (!tool) return "TOOL_UNPUBLISHED";
  if (![ZMQ_INSPECT, EFFECT_APPLY, INSPECTION_RESULT, EFFECT_RESULT].includes(tool.name))
    return null;
  const expected = zmqConsoleTool(tool.name, resourceId);
  if (
    canonical(tool.inputSchema) !== canonical(expected.inputSchema) ||
    canonical(tool._meta?.["io.sdar/ugvZmq"]) !== canonical(expected._meta?.["io.sdar/ugvZmq"])
  )
    return "ZMQ_CONSOLE_CONTRACT_MISMATCH";
  const p = taskProfile(tool),
    ep = taskProfile(expected);
  for (const key of Object.keys(ep)) if (p[key] !== ep[key]) return "ZMQ_TASK_PROFILE_MISMATCH";
  return null;
}
export function inspectionArguments(
  resourceId: string,
  coordinates: string,
  height: string,
  searchStrategy: string,
) {
  const points = validatePolygon(parseCoordinates(coordinates));
  if (!height.trim() || !Number.isFinite(Number(height)))
    throw Error("请提供已确认的 WGS84 椭球高，不能默认使用 0");
  if (points.length !== 4) throw Error("ZMQ 区域必须恰好四个严格凸顶点");
  const signs = points.map((p, i) => {
    const b = points[(i + 1) % 4],
      c = points[(i + 2) % 4];
    return Math.sign(
      (b.longitude - p.longitude) * (c.latitude - b.latitude) -
        (b.latitude - p.latitude) * (c.longitude - b.longitude),
    );
  });
  if (!signs.every((s) => s === 1) && !signs.every((s) => s === -1))
    throw Error("ZMQ 区域必须是严格凸四边形");
  if (points.some((p) => p.longitude >= 180)) throw Error("ZMQ 经度必须小于 180");
  return {
    resourceId,
    area: {
      crs: "OGC:CRS84",
      vertices: points.map((p) => ({ ...p, ellipsoidHeightM: Number(height) })),
      searchStrategy,
    },
  };
}
export function validateZmqGeometry(args: Json) {
  const area = record(args.area),
    vertices = array(area.vertices).map(record);
  inspectionArguments(
    text(args.resourceId),
    vertices.map((v) => `${text(v.longitude)},${text(v.latitude)}`).join("\n"),
    text(vertices[0]?.ellipsoidHeightM),
    text(area.searchStrategy),
  );
}
