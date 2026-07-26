import type { UgvDeviceToolName } from "./tool-allowlist.js";

export interface DeviceToolCall {
  name: UgvDeviceToolName;
  arguments: Record<string, unknown>;
}

export function startDeviceCalls(
  operationName: string,
  argumentsValue: Record<string, unknown>,
): DeviceToolCall[] {
  if (operationName === "vehicle_navigate") return navigate(argumentsValue);
  if (operationName === "vehicle_area_recon")
    return [
      {
        name: "ugv_area_recon_configure",
        arguments: {
          area: area(argumentsValue.area),
          scan_count: integer(argumentsValue.scanCount, 1),
          zoom: finite(argumentsValue.zoom, 1),
          stop_on_target: argumentsValue.stopOnTarget === true,
          target_types: strings(argumentsValue.targetTypes),
        },
      },
      { name: "ugv_area_recon_control", arguments: { command: 1 } },
    ];
  if (operationName === "vehicle_track_target")
    return [
      {
        name: "ugv_gimbal_move",
        arguments: {
          mode: "absolute",
          yaw: 0,
          pitch: 0,
          angle_unit: "deg",
          ...(typeof argumentsValue.desiredZoom === "number"
            ? { zoom: argumentsValue.desiredZoom }
            : {}),
        },
      },
      {
        name: "ugv_area_recon_lock",
        arguments: { target_id: text(argumentsValue.targetId) },
      },
    ];
  if (operationName === "vehicle_emergency_stop")
    return [
      { name: "ugv_stop", arguments: {} },
      { name: "ugv_mission_control", arguments: { action: "stop" } },
      { name: "ugv_area_recon_control", arguments: { command: 4 } },
      { name: "ugv_area_recon_unlock", arguments: {} },
    ];
  return [];
}

export function controlDeviceCalls(
  operationName: string,
  command: "pause" | "resume" | "cancel",
): DeviceToolCall[] {
  if (operationName === "vehicle_navigate")
    return [
      { name: "ugv_mission_control", arguments: { action: command } },
      ...(command === "cancel" ? [{ name: "ugv_stop" as const, arguments: {} }] : []),
    ];
  if (operationName === "vehicle_area_recon")
    return [
      {
        name: "ugv_area_recon_control",
        arguments: { command: command === "pause" ? 2 : command === "resume" ? 3 : 4 },
      },
    ];
  if (operationName === "vehicle_track_target" && command === "cancel")
    return [{ name: "ugv_area_recon_unlock", arguments: {} }];
  if (operationName === "vehicle_fire_weapon" && command === "cancel")
    return [{ name: "ugv_area_recon_unlock", arguments: {} }];
  return [];
}

export function fireConfirmationCalls(targetId: string): DeviceToolCall[] {
  return [
    { name: "ugv_attack_target", arguments: { target_id: targetId } },
    {
      name: "ugv_area_recon_attack_confirm",
      arguments: { target_id: targetId, confirmed: true },
    },
  ];
}

function navigate(argumentsValue: Record<string, unknown>): DeviceToolCall[] {
  if (!object(argumentsValue.mission)) throw new Error("UGV_NAVIGATION_MISSION_INVALID");
  const mission = argumentsValue.mission;
  if (mission.type === "return_home") return [{ name: "ugv_return_home", arguments: {} }];
  if (mission.type === "distance")
    return [
      {
        name: "ugv_move_distance",
        arguments: {
          direction: enumValue(mission.direction, ["forward", "backward", "left", "right"]),
          distance_m: positive(mission.distanceM),
        },
      },
    ];
  const rawWaypoints = mission.type === "point" ? [mission.target] : mission.waypoints;
  if (!Array.isArray(rawWaypoints) || rawWaypoints.length === 0)
    throw new Error("UGV_NAVIGATION_WAYPOINTS_INVALID");
  const waypoints = rawWaypoints.map((value) => {
    if (!object(value)) throw new Error("UGV_NAVIGATION_WAYPOINT_INVALID");
    return {
      latitude: latitude(value.latitude),
      longitude: longitude(value.longitude),
      altitude: finite(value.altitude, 0),
    };
  });
  return [
    {
      name: "ugv_path_follow_mission",
      arguments: {
        waypoints,
        speed_limit_kmh: positive(argumentsValue.speedLimitKmh, 20),
        stop_on_obstacle: argumentsValue.stopOnObstacle !== false,
      },
    },
  ];
}

function area(value: unknown): Record<string, unknown> {
  if (!object(value) || !Array.isArray(value.polygon) || value.polygon.length < 3)
    throw new Error("UGV_RECON_AREA_INVALID");
  return {
    coordinate_frame: "WGS84",
    polygon: value.polygon.map((point) => {
      if (!object(point)) throw new Error("UGV_RECON_POINT_INVALID");
      return { latitude: latitude(point.latitude), longitude: longitude(point.longitude) };
    }),
  };
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("UGV_TEXT_INVALID");
  return value;
}
function finite(value: unknown, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("UGV_NUMBER_INVALID");
  return value;
}
function positive(value: unknown, fallback?: number): number {
  const parsed = finite(value, fallback);
  if (parsed <= 0) throw new Error("UGV_POSITIVE_NUMBER_REQUIRED");
  return parsed;
}
function integer(value: unknown, fallback?: number): number {
  const parsed = positive(value, fallback);
  if (!Number.isInteger(parsed)) throw new Error("UGV_INTEGER_REQUIRED");
  return parsed;
}
function latitude(value: unknown): number {
  const parsed = finite(value);
  if (parsed < -90 || parsed > 90) throw new Error("UGV_LATITUDE_INVALID");
  return parsed;
}
function longitude(value: unknown): number {
  const parsed = finite(value);
  if (parsed < -180 || parsed > 180) throw new Error("UGV_LONGITUDE_INVALID");
  return parsed;
}
function strings(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error("UGV_STRING_ARRAY_INVALID");
  return value as string[];
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T))
    throw new Error("UGV_ENUM_INVALID");
  return value as T;
}
