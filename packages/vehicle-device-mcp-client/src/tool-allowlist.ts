/**
 * UGV tools declared by the supplied simulator protocol. `ugv_laser_range` is
 * retained as an optional, capability-gated extension because older simulator
 * builds exposed it. Live tools/list remains authoritative.
 */
export const UGV_DEVICE_TOOL_ALLOWLIST = [
  "ugv_path_follow_mission",
  "ugv_return_home",
  "ugv_move_distance",
  "ugv_mission_control",
  "ugv_motion_stop",
  "get_status",
  "get_capabilities",
  "ugv_area_recon_configure",
  "ugv_area_recon_control",
  "ugv_area_recon_lock",
  "ugv_area_recon_get_status",
  "ugv_area_recon_get_targets",
  "ugv_area_recon_reset",
  "ugv_area_recon_attack_confirm",
  "ugv_gimbal_move",
  "ugv_laser_range",
] as const;

export type UgvDeviceToolName = (typeof UGV_DEVICE_TOOL_ALLOWLIST)[number];

const ALLOWLIST = new Set<string>(UGV_DEVICE_TOOL_ALLOWLIST);

export function isAllowedUgvDeviceTool(name: string): name is UgvDeviceToolName {
  return ALLOWLIST.has(name);
}

export const UGV_READ_ONLY_DEVICE_TOOLS = new Set<UgvDeviceToolName>([
  "get_status",
  "get_capabilities",
  "ugv_area_recon_get_status",
  "ugv_area_recon_get_targets",
  "ugv_laser_range",
]);

export function isMutatingUgvDeviceTool(name: UgvDeviceToolName): boolean {
  return !UGV_READ_ONLY_DEVICE_TOOLS.has(name);
}

export type UgvOperationPhase = "start" | "pause" | "resume" | "cancel" | "read";

/**
 * Broad operation inventory retained for manifest/conformance consumers. Runtime
 * availability should use requiredUgvDeviceTools(), which selects only the
 * primitive needed by the requested navigation/control branch.
 */
export const OPERATION_REQUIRED_TOOLS: Record<string, UgvDeviceToolName[]> = {
  vehicle_get_state: ["get_status"],
  vehicle_get_capabilities: ["get_capabilities"],
  vehicle_get_payload_status: ["ugv_area_recon_get_status"],
  vehicle_get_targets: ["ugv_area_recon_get_targets"],
  vehicle_laser_range: ["ugv_laser_range"],
  vehicle_navigate: [
    "ugv_path_follow_mission",
    "ugv_return_home",
    "ugv_move_distance",
    "ugv_mission_control",
  ],
  vehicle_area_recon: [
    "ugv_area_recon_configure",
    "ugv_area_recon_control",
    "ugv_area_recon_get_status",
  ],
  vehicle_track_target: ["ugv_area_recon_lock", "ugv_area_recon_get_status"],
  vehicle_control_gimbal: ["ugv_gimbal_move"],
  vehicle_fire_weapon: ["ugv_area_recon_attack_confirm"],
  vehicle_emergency_stop: [
    "ugv_motion_stop",
    "ugv_mission_control",
    "ugv_area_recon_control",
    "ugv_area_recon_lock",
  ],
};

export function requiredUgvDeviceTools(
  operationName: string,
  argumentsValue: Record<string, unknown> = {},
  phase: UgvOperationPhase = "start",
): UgvDeviceToolName[] {
  if (operationName === "vehicle_navigate") {
    if (phase !== "start") return ["ugv_mission_control"];
    const mission = object(argumentsValue.mission);
    const submitTool =
      mission?.type === "distance"
        ? "ugv_move_distance"
        : mission?.type === "return_home"
          ? "ugv_return_home"
          : "ugv_path_follow_mission";
    return [submitTool, "ugv_mission_control"];
  }
  if (operationName === "vehicle_area_recon") {
    if (phase === "start")
      return ["ugv_area_recon_configure", "ugv_area_recon_control", "ugv_area_recon_get_status"];
    return ["ugv_area_recon_control"];
  }
  if (operationName === "vehicle_track_target") return ["ugv_area_recon_lock"];
  if (operationName === "vehicle_control_gimbal") return ["ugv_gimbal_move"];
  return [...(OPERATION_REQUIRED_TOOLS[operationName] ?? [])];
}

export const requiredToolsForUgvOperation = requiredUgvDeviceTools;

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
