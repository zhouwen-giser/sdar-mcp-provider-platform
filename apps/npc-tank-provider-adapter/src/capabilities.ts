import type { CapturedToolContract } from "../../../packages/vehicle-device-mcp-client/src/index.js";
import { normalizeVehicleCapabilities } from "../../../packages/vehicle-provider-core/src/index.js";

export function normalizeNpcTankCapabilities(
  result: Record<string, unknown>,
  contracts: readonly CapturedToolContract[],
  observedAt = new Date().toISOString(),
): Record<string, unknown> {
  return normalizeVehicleCapabilities(
    result,
    contracts,
    {
      resourceId: "vehicle:npc_tank1",
      pathFollowTool: "npc_tank_path_follow_mission",
      moveDistanceTool: "npc_tank_move_distance",
      returnHomeTool: "npc_tank_return_home",
      missionControlTool: "npc_tank_mission_control",
      reconConfigureTool: "npc_tank_area_recon_configure",
      targetLockTool: "npc_tank_area_recon_lock",
      gimbalTool: "npc_tank_gimbal_move",
      planningDensities: ["adaptive", "dense", "medium", "sparse"],
      reconScanModes: [1, 2],
      gimbalModes: ["absolute", "relative", "velocity", "reset"],
      needPlanDefault: false,
      movingWhileRecon: true,
      continuousPitchSweep: false,
    },
    observedAt,
  );
}
