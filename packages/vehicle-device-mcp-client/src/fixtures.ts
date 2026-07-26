import { createHash } from "node:crypto";
import { UGV_DEVICE_TOOL_ALLOWLIST } from "./tool-allowlist.js";

export interface CapturedToolContract {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  capturedAt: string;
  schemaHash: string;
}

export function mockUgvToolContracts(
  capturedAt = new Date().toISOString(),
): CapturedToolContract[] {
  return UGV_DEVICE_TOOL_ALLOWLIST.map((name) => {
    const inputSchema = fixtureSchema(name);
    return {
      name,
      description: `Mock-only canonical fixture for ${name}.`,
      inputSchema,
      capturedAt,
      schemaHash: createHash("sha256").update(canonical(inputSchema)).digest("hex"),
    };
  });
}

function fixtureSchema(name: string): Record<string, unknown> {
  const object = (properties: Record<string, unknown>, required: string[] = []) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false,
  });
  if (name === "ugv_path_follow_mission")
    return object(
      {
        waypoints: { type: "array", minItems: 1, items: { type: "object" } },
        speed_limit_kmh: { type: "number", exclusiveMinimum: 0 },
        stop_on_obstacle: { type: "boolean" },
      },
      ["waypoints", "speed_limit_kmh", "stop_on_obstacle"],
    );
  if (name === "ugv_move_distance")
    return object(
      {
        direction: { type: "string", enum: ["forward", "backward", "left", "right"] },
        distance_m: { type: "number", exclusiveMinimum: 0 },
      },
      ["direction", "distance_m"],
    );
  if (name === "ugv_mission_control")
    return object(
      {
        action: {
          type: "string",
          enum: ["start", "pause", "resume", "terminate", "cancel", "stop"],
        },
      },
      ["action"],
    );
  if (name === "ugv_area_recon_configure")
    return object(
      {
        area: { type: "object" },
        scan_count: { type: "integer", minimum: 1 },
        zoom: { type: "number", exclusiveMinimum: 0 },
        stop_on_target: { type: "boolean" },
        target_types: { type: "array", items: { type: "string" } },
      },
      ["area", "scan_count", "zoom", "stop_on_target", "target_types"],
    );
  if (name === "ugv_area_recon_control")
    return object({ command: { type: "integer", enum: [1, 2, 3, 4] } }, ["command"]);
  if (name === "ugv_area_recon_lock" || name === "ugv_attack_target")
    return object({ target_id: { type: "string", minLength: 1 } }, ["target_id"]);
  if (name === "ugv_area_recon_attack_confirm")
    return object({ target_id: { type: "string", minLength: 1 }, confirmed: { const: true } }, [
      "target_id",
      "confirmed",
    ]);
  if (name === "ugv_gimbal_move")
    return object(
      {
        mode: { type: "string", enum: ["absolute", "relative", "velocity", "reset"] },
        yaw: { type: "number" },
        pitch: { type: "number" },
        angle_unit: { const: "deg" },
      },
      ["mode"],
    );
  return object({});
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
