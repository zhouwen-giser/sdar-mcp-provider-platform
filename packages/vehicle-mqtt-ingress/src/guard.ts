export type MqttWireMode = "auto" | "ros_message_json" | "direct_domain_json" | "ros_bridge_json";
export interface JsonLimits {
  maxPayloadBytes: number;
  maxDepth: number;
  maxNodes: number;
  maxStringBytes: number;
}

export function decodeMqttPayload(
  payload: Buffer,
  mode: MqttWireMode,
  limits: JsonLimits,
): unknown {
  if (payload.byteLength > limits.maxPayloadBytes) throw new Error("UGV_MQTT_PAYLOAD_TOO_LARGE");
  let outer: unknown;
  try {
    outer = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new Error("UGV_MQTT_MALFORMED_JSON");
  }
  validateJsonShape(outer, limits);
  if (mode === "ros_bridge_json") {
    if (!record(outer)) throw new Error("UGV_MQTT_WIRE_SHAPE_MISMATCH");
    if (!pureRosEnvelope(outer)) return outer;
    return rosEnvelope(outer, limits);
  }
  if (mode === "ros_message_json") {
    if (!pureRosEnvelope(outer)) throw new Error("UGV_MQTT_WIRE_SHAPE_MISMATCH");
    return rosEnvelope(outer, limits);
  }
  if (mode === "direct_domain_json") {
    // A `data` member is an envelope discriminator at this boundary. Reject
    // hybrid records so neither strict mode silently accepts the other mode.
    if (!directDomain(outer) || (record(outer) && Object.hasOwn(outer, "data")))
      throw new Error("UGV_MQTT_WIRE_SHAPE_MISMATCH");
    return outer;
  }
  if (record(outer) && Object.hasOwn(outer, "data") && !pureRosEnvelope(outer))
    throw new Error("UGV_MQTT_AMBIGUOUS_WIRE_SHAPE");
  const ros = pureRosEnvelope(outer) ? rosEnvelope(outer, limits) : undefined;
  const direct = directDomain(outer);
  if (ros !== undefined && direct) throw new Error("UGV_MQTT_AMBIGUOUS_WIRE_SHAPE");
  if (ros !== undefined) return ros;
  if (direct) return outer;
  throw new Error("UGV_MQTT_WIRE_SHAPE_MISMATCH");
}

export function validateJsonShape(value: unknown, limits: JsonLimits): void {
  let nodes = 0;
  const visit = (current: unknown, depth: number): void => {
    if (depth > limits.maxDepth) throw new Error("UGV_MQTT_JSON_DEPTH_EXCEEDED");
    nodes++;
    if (nodes > limits.maxNodes) throw new Error("UGV_MQTT_JSON_NODE_LIMIT_EXCEEDED");
    if (typeof current === "string" && Buffer.byteLength(current, "utf8") > limits.maxStringBytes)
      throw new Error("UGV_MQTT_STRING_LIMIT_EXCEEDED");
    if (Array.isArray(current)) for (const child of current) visit(child, depth + 1);
    else if (record(current))
      for (const [key, child] of Object.entries(current)) {
        if (Buffer.byteLength(key, "utf8") > limits.maxStringBytes)
          throw new Error("UGV_MQTT_STRING_LIMIT_EXCEEDED");
        visit(child, depth + 1);
      }
  };
  visit(value, 1);
}

function rosEnvelope(value: unknown, limits: JsonLimits): unknown {
  if (!record(value) || !Object.hasOwn(value, "data")) return undefined;
  const data = value.data;
  if (typeof data !== "string") return data;
  const trimmed = data.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return data;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    validateJsonShape(parsed, limits);
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("UGV_MQTT_")) throw error;
    throw new Error("UGV_MQTT_INNER_JSON_INVALID", { cause: error });
  }
}
function pureRosEnvelope(value: unknown): value is Record<string, unknown> {
  return (
    record(value) &&
    Object.hasOwn(value, "data") &&
    Object.keys(value).every((key) => key === "data" || key === "layout" || key === "header")
  );
}
function directDomain(value: unknown): boolean {
  return (
    record(value) &&
    Object.keys(value).some((key) => key !== "data" && key !== "layout" && key !== "header")
  );
}
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
