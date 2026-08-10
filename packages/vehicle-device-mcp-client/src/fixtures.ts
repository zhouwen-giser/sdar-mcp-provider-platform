import { createHash } from "node:crypto";
import { UGV_DEVICE_TOOL_ALLOWLIST, type UgvDeviceToolName } from "./tool-allowlist.js";

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
    const inputSchema = ugvFixtureInputSchema(name);
    const outputSchema = ugvFixtureOutputSchema(name);
    const annotations = {
      readOnlyHint: [
        "get_status",
        "get_capabilities",
        "ugv_area_recon_get_status",
        "ugv_area_recon_get_targets",
        "ugv_laser_range",
      ].includes(name),
    };
    return {
      name,
      description: `Protocol-v2 UGV contract fixture for ${name}.`,
      inputSchema,
      outputSchema,
      annotations,
      capturedAt,
      schemaHash: capturedToolSchemaHash({ name, inputSchema, outputSchema, annotations }),
    };
  });
}

export function capturedToolSchemaHash(
  value: Pick<CapturedToolContract, "name" | "inputSchema" | "outputSchema" | "annotations">,
): string {
  return createHash("sha256")
    .update(
      canonical({
        name: value.name,
        inputSchema: value.inputSchema,
        outputSchema: value.outputSchema ?? null,
        annotations: value.annotations ?? null,
      }),
    )
    .digest("hex");
}

export function ugvFixtureInputSchema(name: UgvDeviceToolName): Record<string, unknown> {
  const missionId = { type: "integer", minimum: 0, default: 0 };
  if (name === "ugv_path_follow_mission")
    return schema({
      task_points: {
        type: ["array", "null"],
        items: {
          type: "object",
          properties: {
            longitude: { type: "number", minimum: -180, maximum: 180 },
            latitude: { type: "number", minimum: -90, maximum: 90 },
            altitude: { type: "number" },
          },
          required: ["longitude", "latitude"],
          additionalProperties: false,
        },
        default: null,
      },
      json_url: { type: "string", default: "" },
      need_plan: { type: ["boolean", "null"], default: null },
      density: {
        type: "string",
        enum: ["adaptive", "dense", "medium", "sparse"],
        default: "adaptive",
      },
      mission_id: missionId,
    });
  if (name === "ugv_return_home") return schema({ mission_id: missionId });
  if (name === "ugv_move_distance")
    return schema(
      {
        direction: {
          type: "string",
          enum: ["forward", "back", "left", "right", "前", "后", "左", "右"],
        },
        distance: { type: "number", exclusiveMinimum: 0 },
        mission_id: missionId,
      },
      ["direction", "distance"],
    );
  if (name === "ugv_mission_control")
    return schema(
      {
        action: { type: "string", enum: ["start", "pause", "terminate"] },
        mission_id: missionId,
      },
      ["action"],
    );
  if (name === "ugv_area_recon_configure")
    return schema({
      region_points: {
        type: ["array", "null"],
        items: {
          type: "object",
          properties: {
            longitude: { type: "number", minimum: -180, maximum: 180 },
            latitude: { type: "number", minimum: -90, maximum: 90 },
            altitude: { type: "number" },
          },
          required: ["longitude", "latitude"],
          additionalProperties: false,
        },
        default: null,
      },
      region_type: { type: "integer", enum: [2, 3, 4, 5], default: 5 },
      target_types: { type: ["array", "null"], items: { type: "integer" }, default: null },
      scan_num: { type: "integer", minimum: 0, default: 0 },
      lock_duration_limit: { type: "integer", minimum: 0, default: 0 },
      recon_type: { type: "integer", enum: [1, 2, 3, 4], default: 1 },
      scan_speed: { type: "number", exclusiveMinimum: 0, default: 30 },
      scan_mode: { type: "integer", enum: [1, 2], default: 1 },
      scan_pitch: { type: "number", default: 0 },
      mission_id: missionId,
    });
  if (name === "ugv_area_recon_control")
    return schema(
      {
        cmd_type: { type: "integer", enum: [1, 2, 3, 4] },
        mission_id: missionId,
      },
      ["cmd_type"],
    );
  if (name === "ugv_area_recon_lock")
    return schema(
      {
        lock: { type: "boolean" },
        target_id: { type: "integer", minimum: 0, default: 0 },
        mission_id: missionId,
      },
      ["lock"],
    );
  if (name === "ugv_area_recon_reset") return schema({ mission_id: missionId });
  if (name === "ugv_area_recon_attack_confirm")
    return schema(
      {
        confirm: { type: "integer", enum: [1, 2] },
        mission_id: missionId,
      },
      ["confirm"],
    );
  if (name === "ugv_gimbal_move")
    return schema(
      {
        mode: { type: "string", enum: ["absolute", "relative", "velocity", "reset"] },
        yaw: { type: "number", default: 0 },
        pitch: { type: "number", default: 0 },
        yaw_speed: { type: "number", default: 30 },
        pitch_speed: { type: "number", default: 30 },
        delta_zoom: { type: "number", default: 0 },
        mission_id: missionId,
      },
      ["mode"],
    );
  return schema({});
}

export function ugvFixtureOutputSchema(name: UgvDeviceToolName): Record<string, unknown> {
  if (name === "get_status") return { type: "object", additionalProperties: true };
  if (name === "get_capabilities") return { type: "object", additionalProperties: true };
  if (name === "ugv_area_recon_get_status")
    return schema(
      {
        status: { type: "integer", enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 99] },
        status_label: { type: "string" },
        scan_mode: { type: "integer", enum: [1, 2] },
        scan_mode_label: { type: "string" },
        scan_pitch: { type: "number" },
        out_of_range: { type: "boolean" },
        camera_fault: { type: "boolean" },
        scan_num: { type: "integer", minimum: 0 },
        progress: { type: "number", minimum: 0, maximum: 100 },
        work_mode: { type: "integer" },
        recon_type: { type: "integer" },
        load_status: { type: "integer" },
        load_status_label: { type: "string" },
        lock: { type: "object" },
        attack_ready: { type: "boolean" },
        online: { type: "boolean" },
        gimbal: { type: "object" },
      },
      ["status", "out_of_range", "camera_fault"],
      true,
    );
  if (name === "ugv_area_recon_get_targets")
    return schema({ targets: { type: "array", items: { type: "object" } } }, ["targets"], true);
  if (name === "ugv_laser_range") return { type: "object", additionalProperties: true };

  const commonProperties: Record<string, unknown> = {
    mission_id: { type: "integer" },
    state: { type: "integer", minimum: 0, maximum: 5 },
    state_label: { type: "string" },
    message: { type: "string" },
    error_code: { type: "integer" },
  };
  if (name === "ugv_area_recon_configure")
    return schema(
      {
        ...commonProperties,
        res: { type: "boolean" },
        fail_data: { type: "string" },
        coverability: { type: "object" },
      },
      ["mission_id", "state", "state_label", "message", "error_code", "res", "fail_data"],
      true,
    );
  if (
    name === "ugv_area_recon_control" ||
    name === "ugv_area_recon_lock" ||
    name === "ugv_area_recon_reset" ||
    name === "ugv_area_recon_attack_confirm"
  )
    return schema(
      { ...commonProperties, cmd_res: { type: "integer" }, fail_data: { type: "string" } },
      ["mission_id", "state", "state_label", "message", "error_code", "cmd_res"],
      true,
    );
  return schema(commonProperties, ["mission_id", "state", "state_label", "message", "error_code"]);
}

function schema(
  properties: Record<string, unknown>,
  required: string[] = [],
  additionalProperties = false,
): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties };
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
