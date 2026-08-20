import {
  UgvOperationQualificationService,
  type CapturedToolContract,
  type UgvOperationQualification,
  type UgvQualificationMatrixInput,
} from "../../../packages/vehicle-device-mcp-client/src/index.js";
import { normalizeVehicleCapabilities } from "../../../packages/vehicle-provider-core/src/index.js";

export interface UgvCapabilityQualification {
  matrix: readonly UgvOperationQualification[];
  support: {
    capabilityQuery: boolean;
    navigation: {
      point: boolean;
      route: boolean;
      distance: boolean;
      returnHome: boolean;
      pauseResumeCancel: boolean;
    };
    reconnaissance: { area: boolean; circular: boolean };
    targetTracking: boolean;
    gimbal: boolean;
    fire: boolean;
    emergencyStop: boolean;
    laserRange: boolean;
  };
}

export function qualifyUgvCapabilities(
  context: UgvQualificationMatrixInput,
): UgvCapabilityQualification {
  const qualification = new UgvOperationQualificationService();
  const qualify = (
    operationName: string,
    argumentsValue: Readonly<Record<string, unknown>> = {},
    phase?: "start" | "read" | "pause" | "resume" | "cancel",
  ) =>
    qualification.qualify({
      ...context,
      operationName,
      arguments: argumentsValue,
      ...(phase === undefined ? {} : { phase }),
    }).qualified;
  const lifecycle = ["pause", "resume", "cancel"] as const;
  return {
    matrix: qualification.matrix(context),
    support: {
      capabilityQuery: qualify("vehicle_get_capabilities", {}, "read"),
      navigation: {
        point: qualify("vehicle_navigate", { mission: { type: "point" } }),
        route: qualify("vehicle_navigate", { mission: { type: "route" } }),
        distance: qualify("vehicle_navigate", { mission: { type: "distance" } }),
        returnHome: qualify("vehicle_navigate", { mission: { type: "return_home" } }),
        pauseResumeCancel: lifecycle.every((phase) =>
          qualify("vehicle_navigate", { mission: { type: "point" } }, phase),
        ),
      },
      reconnaissance: {
        area: qualify("vehicle_area_recon", { scanMode: "area" }),
        circular: qualify("vehicle_area_recon", { scanMode: "circular" }),
      },
      targetTracking: qualify("vehicle_track_target"),
      gimbal: qualify("vehicle_control_gimbal"),
      fire: qualify("vehicle_fire_weapon"),
      emergencyStop: qualify("vehicle_emergency_stop"),
      laserRange: qualify("vehicle_laser_range", {}, "read"),
    },
  };
}

export function normalizeUgvCapabilities(
  result: Record<string, unknown>,
  contracts: readonly CapturedToolContract[],
  observedAt = new Date().toISOString(),
  resourceId = "vehicle:ugv1",
  qualificationInput: Omit<UgvQualificationMatrixInput, "contracts"> = {
    executionMode: "simulation",
  },
): Record<string, unknown> {
  const normalized = normalizeVehicleCapabilities(
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
  const support = qualifyUgvCapabilities({
    ...qualificationInput,
    contracts,
  }).support;
  const navigation = normalized.navigation as Record<string, unknown>;
  const payload = normalized.payload as Record<string, unknown>;
  const reconnaissance = payload.reconnaissance as Record<string, unknown>;
  const gimbal = payload.gimbal as Record<string, unknown>;
  return {
    ...normalized,
    navigation: {
      ...navigation,
      ...support.navigation,
    },
    payload: {
      ...payload,
      reconnaissance: {
        ...reconnaissance,
        ...support.reconnaissance,
      },
      gimbal: { ...gimbal, supported: support.gimbal },
      targetTracking: support.targetTracking,
      laserRange: support.laserRange,
    },
  };
}
