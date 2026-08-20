import {
  UGV_OPERATION_PROFILES,
  allDeviceTools,
  requiredDeviceToolsForVehicleOperation,
  type VehicleOperationPhase,
} from "./operation-profile.js";

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

export type UgvOperationPhase = VehicleOperationPhase;

/**
 * Broad operation inventory retained for manifest/conformance consumers. Runtime
 * availability should use requiredUgvDeviceTools(), which selects only the
 * primitive needed by the requested navigation/control branch.
 */
export const OPERATION_REQUIRED_TOOLS: Record<string, UgvDeviceToolName[]> = Object.fromEntries(
  UGV_OPERATION_PROFILES.map((profile) => [
    profile.operationName,
    allDeviceTools(profile).map(allowedProfileTool),
  ]),
);

export function requiredUgvDeviceTools(
  operationName: string,
  argumentsValue: Record<string, unknown> = {},
  phase: UgvOperationPhase = "start",
): UgvDeviceToolName[] {
  return requiredDeviceToolsForVehicleOperation(operationName, argumentsValue, phase).map(
    allowedProfileTool,
  );
}

export const requiredToolsForUgvOperation = requiredUgvDeviceTools;

function allowedProfileTool(toolName: string): UgvDeviceToolName {
  if (!isAllowedUgvDeviceTool(toolName)) throw new Error("UGV_OPERATION_PROFILE_TOOL_NOT_ALLOWED");
  return toolName;
}
