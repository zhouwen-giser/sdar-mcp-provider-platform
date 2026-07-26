export const UGV_DEVICE_TOOL_ALLOWLIST = [
  "ugv_path_follow_mission",
  "ugv_return_home",
  "ugv_move_distance",
  "ugv_mission_control",
  "ugv_stop",
  "ugv_attack_target",
  "ugv_area_recon_configure",
  "ugv_area_recon_lock",
  "ugv_area_recon_unlock",
  "ugv_gimbal_move",
  "ugv_area_recon_attack_confirm",
  "ugv_area_recon_control",
  "ugv_area_recon_reset",
  "ugv_area_recon_get_status",
  "ugv_area_recon_get_targets",
  "ugv_area_recon_get_exceptions",
  "ugv_laser_range",
  "ugv_get_capabilities",
] as const;
export type UgvDeviceToolName = (typeof UGV_DEVICE_TOOL_ALLOWLIST)[number];
const ALLOWLIST = new Set<string>(UGV_DEVICE_TOOL_ALLOWLIST);

export function isAllowedUgvDeviceTool(name: string): name is UgvDeviceToolName {
  return ALLOWLIST.has(name);
}

export const OPERATION_REQUIRED_TOOLS: Record<string, UgvDeviceToolName[]> = {
  vehicle_get_state: [],
  vehicle_get_payload_status: ["ugv_area_recon_get_status", "ugv_area_recon_get_exceptions"],
  vehicle_get_targets: ["ugv_area_recon_get_targets"],
  vehicle_laser_range: ["ugv_laser_range"],
  vehicle_navigate: [
    "ugv_path_follow_mission",
    "ugv_return_home",
    "ugv_move_distance",
    "ugv_mission_control",
    "ugv_stop",
  ],
  vehicle_area_recon: [
    "ugv_area_recon_configure",
    "ugv_area_recon_control",
    "ugv_area_recon_get_status",
    "ugv_area_recon_get_targets",
    "ugv_area_recon_get_exceptions",
  ],
  vehicle_track_target: ["ugv_gimbal_move", "ugv_area_recon_lock", "ugv_area_recon_unlock"],
  vehicle_fire_weapon: ["ugv_attack_target", "ugv_area_recon_attack_confirm"],
  vehicle_emergency_stop: [
    "ugv_stop",
    "ugv_mission_control",
    "ugv_area_recon_control",
    "ugv_area_recon_unlock",
  ],
};
