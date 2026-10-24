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
export function zmqConsoleTool(name: string, resourceId: string) {
  const query = [INSPECTION_RESULT, EFFECT_RESULT].includes(name),
    inspection = name === ZMQ_INSPECT || name === INSPECTION_RESULT;
  if (![ZMQ_INSPECT, EFFECT_APPLY, INSPECTION_RESULT, EFFECT_RESULT].includes(name))
    throw Error("ZMQ_CONSOLE_TOOL_UNKNOWN");
  const properties: Record<string, unknown> = { resourceId: { const: resourceId } },
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
