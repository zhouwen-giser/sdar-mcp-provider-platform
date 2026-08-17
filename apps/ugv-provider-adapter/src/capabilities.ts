import type { CapturedToolContract } from "../../../packages/vehicle-device-mcp-client/src/index.js";
import { normalizeVehicleCapabilities } from "../../../packages/vehicle-provider-core/src/index.js";

export function normalizeUgvCapabilities(
  result: Record<string, unknown>,
  contracts: readonly CapturedToolContract[],
  observedAt = new Date().toISOString(),
  resourceId = "vehicle:ugv1",
): Record<string, unknown> {
  return normalizeVehicleCapabilities(
    result,
    contracts,
    {
      resourceId,
      pathFollowTool: "ugv_path_follow_mission",
      moveDistanceTool: "ugv_move_distance",
      returnHomeTool: "ugv_return_home",
      missionControlTool: "ugv_mission_control",
      reconConfigureTool: "ugv_area_recon_configure",
      targetLockTool: "ugv_area_recon_lock",
      gimbalTool: "ugv_gimbal_move",
      laserRangeTool: "ugv_laser_range",
      planningDensities: ["adaptive", "dense", "medium", "sparse"],
      reconScanModes: [1, 2],
      gimbalModes: ["absolute", "relative", "velocity", "reset"],
      movingWhileRecon: true,
      continuousPitchSweep: true,
    },
    observedAt,
  );
}
