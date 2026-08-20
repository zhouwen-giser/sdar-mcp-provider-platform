import type { UgvDeviceToolName } from "./tool-allowlist.js";
import { DeviceToolRejectedError, UncertainMutatingDeviceCallError } from "./errors.js";
import {
  canonicalUgvMissionId,
  missionIdFromUgvResult,
  parseUgvMissionId,
  parseUgvTargetId,
  validateUgvToolResult,
} from "./ugv-result.js";

export interface DeviceToolCall {
  name: UgvDeviceToolName;
  arguments: Record<string, unknown>;
}

export type UgvDeviceInvoker = (
  name: UgvDeviceToolName,
  argumentsValue: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export type UgvStartMutationPhase = "PRIMARY" | "FOLLOWUP";

export interface UgvStartMutationCall {
  phase: UgvStartMutationPhase;
  call: DeviceToolCall;
}

export interface UgvAcceptedStartMutationCall extends UgvStartMutationCall {
  result: Record<string, unknown>;
  canonicalMissionId?: string;
}

export interface UgvFailedStartMutationCall extends UgvStartMutationCall {
  error: unknown;
  result?: Record<string, unknown>;
  canonicalMissionId?: string;
}

export interface ExecuteUgvStartFlowOptions {
  /** Called before a dependent mutating follow-up is dispatched. */
  onMissionId?: (canonicalMissionId: string, numericMissionId: number) => void | Promise<void>;
  /** Persists durable intent and dispatching state immediately before transport. */
  beforeMutationDispatch?: (context: UgvStartMutationCall) => void | Promise<void>;
  /** Persists the accepted outcome after any allocated mission ID is durable. */
  afterMutationAccepted?: (context: UgvAcceptedStartMutationCall) => void | Promise<void>;
  /** Persists an explicitly rejected or uncertain dispatched outcome. */
  afterMutationFailed?: (context: UgvFailedStartMutationCall) => void | Promise<void>;
  /** Recovery-only: skip a durably accepted primary and continue its dependent start. */
  resumeFromMissionId?: string | number;
  /** Injectable for deterministic bounded-velocity tests. */
  delay?: (durationMs: number) => Promise<void>;
}

export interface UgvStartFlowResult {
  calls: DeviceToolCall[];
  results: Record<string, unknown>[];
  missionIds: number[];
  canonicalMissionIds: string[];
}

/**
 * Execute the dependency-aware start flow. Navigation and reconnaissance first
 * submit/configure, persist the returned integer mission ID through the hook,
 * then invoke their lifecycle start call with that exact ID.
 */
export async function executeUgvStartFlow(
  operationName: string,
  argumentsValue: Record<string, unknown>,
  invoke: UgvDeviceInvoker,
  options: ExecuteUgvStartFlowOptions = {},
): Promise<UgvStartFlowResult> {
  const calls: DeviceToolCall[] = [];
  const results: Record<string, unknown>[] = [];
  const missionIds: number[] = [];

  const run = async (
    call: DeviceToolCall,
    persistMissionId = true,
    phase?: UgvStartMutationPhase,
  ): Promise<Record<string, unknown>> => {
    const callSnapshot = structuredClone(call);
    calls.push(callSnapshot);
    if (phase !== undefined)
      await options.beforeMutationDispatch?.({ phase, call: structuredClone(callSnapshot) });
    let responseReturned = false;
    let downstreamResult: Record<string, unknown> | undefined;
    let returnedMissionId: string | undefined;
    try {
      const downstream = await invoke(call.name, structuredClone(call.arguments));
      responseReturned = true;
      downstreamResult = structuredClone(downstream);
      const result = validateUgvToolResult(call.name, downstream, call.arguments);
      results.push(structuredClone(result));
      const missionId = missionIdFromUgvResult(call.name, result);
      const canonicalMissionId =
        missionId === undefined ? undefined : canonicalUgvMissionId(missionId);
      returnedMissionId = canonicalMissionId;
      if (
        persistMissionId &&
        missionId !== undefined &&
        missionId >= 0 &&
        !missionIds.includes(missionId)
      ) {
        missionIds.push(missionId);
        await options.onMissionId?.(canonicalUgvMissionId(missionId), missionId);
      }
      if (phase !== undefined)
        await options.afterMutationAccepted?.({
          phase,
          call: structuredClone(callSnapshot),
          result: structuredClone(result),
          ...(canonicalMissionId === undefined ? {} : { canonicalMissionId }),
        });
      return result;
    } catch (error) {
      const classified = classifyStartMutationFailure(call.name, error, responseReturned);
      if (phase !== undefined)
        try {
          await options.afterMutationFailed?.({
            phase,
            call: structuredClone(callSnapshot),
            error: classified,
            ...(downstreamResult === undefined
              ? {}
              : { result: structuredClone(downstreamResult) }),
            ...(returnedMissionId === undefined ? {} : { canonicalMissionId: returnedMissionId }),
          });
        } catch (persistenceError) {
          throw new UncertainMutatingDeviceCallError("UGV", call.name, {
            cause: persistenceError,
          });
        }
      throw classified;
    }
  };

  const initialCalls = startDeviceCalls(operationName, argumentsValue);
  if (operationName === "vehicle_navigate" || operationName === "vehicle_area_recon") {
    if (options.resumeFromMissionId !== undefined) {
      const missionId = parseUgvMissionId(options.resumeFromMissionId);
      missionIds.push(missionId);
      await run(buildUgvStartFollowupCall(operationName, missionId), false, "FOLLOWUP");
      return {
        calls,
        results,
        missionIds,
        canonicalMissionIds: missionIds.map(canonicalUgvMissionId),
      };
    }
    const initial = required(initialCalls[0], "UGV_INITIAL_DEVICE_CALL_REQUIRED");
    const initialResult = await run(initial, true, "PRIMARY");
    const missionId = required(
      missionIdFromUgvResult(initial.name, initialResult),
      "UGV_DEVICE_MISSION_ID_REQUIRED",
    );
    await run(buildUgvStartFollowupCall(operationName, missionId), false, "FOLLOWUP");
  } else if (operationName === "vehicle_emergency_stop") {
    let firstError: Error | undefined;
    for (const call of initialCalls)
      try {
        await run(call, false);
      } catch (error) {
        firstError ??= error instanceof Error ? error : new Error("UGV_DEVICE_CALL_FAILED");
      }
    if (firstError !== undefined) throw firstError;
  } else {
    for (const call of initialCalls) await run(call);
  }

  if (operationName === "vehicle_control_gimbal" && argumentsValue.mode === "velocity") {
    const missionId = required(missionIds[0], "UGV_DEVICE_MISSION_ID_REQUIRED");
    const durationMs = boundedDuration(argumentsValue.durationMs);
    await (options.delay ?? defaultDelay)(durationMs);
    await run(buildUgvGimbalStopCall(missionId), false);
  }

  return {
    calls,
    results,
    missionIds,
    canonicalMissionIds: missionIds.map(canonicalUgvMissionId),
  };
}

function classifyStartMutationFailure(
  toolName: UgvDeviceToolName,
  error: unknown,
  responseReturned: boolean,
): unknown {
  if (
    error instanceof DeviceToolRejectedError ||
    error instanceof UncertainMutatingDeviceCallError ||
    !responseReturned
  )
    return error;
  return new UncertainMutatingDeviceCallError("UGV", toolName, { cause: error });
}

export function startDeviceCalls(
  operationName: string,
  argumentsValue: Record<string, unknown>,
): DeviceToolCall[] {
  if (operationName === "vehicle_navigate") return [navigate(argumentsValue)];
  if (operationName === "vehicle_area_recon") return [reconConfigure(argumentsValue)];
  if (operationName === "vehicle_track_target")
    return [
      buildUgvTargetLockCall(
        true,
        parseUgvTargetId(argumentsValue.targetId),
        optionalMissionId(argumentsValue.missionId ?? argumentsValue.downstreamMissionId),
      ),
    ];
  if (operationName === "vehicle_control_gimbal") return [gimbal(argumentsValue)];
  if (operationName === "vehicle_emergency_stop")
    return buildUgvEmergencyStopCalls({
      chassisMissionId: optionalMissionId(argumentsValue.chassisMissionId),
      reconMissionId: optionalMissionId(argumentsValue.reconMissionId),
    });
  return [];
}

export const buildUgvStartCalls = startDeviceCalls;

export function buildUgvStartFollowupCall(
  operationName: string,
  missionId: number | string,
): DeviceToolCall {
  const parsed = parseUgvMissionId(missionId);
  if (operationName === "vehicle_navigate")
    return {
      name: "ugv_mission_control",
      arguments: { action: "start", mission_id: parsed },
    };
  if (operationName === "vehicle_area_recon")
    return {
      name: "ugv_area_recon_control",
      arguments: { cmd_type: 1, mission_id: parsed },
    };
  throw new Error("UGV_START_FOLLOWUP_UNSUPPORTED");
}

export function controlDeviceCalls(
  operationName: string,
  command: "pause" | "resume" | "cancel",
  persistedMissionId?: number | string,
): DeviceToolCall[] {
  const missionId = requiredMissionId(persistedMissionId);
  if (operationName === "vehicle_navigate")
    return [
      {
        name: "ugv_mission_control",
        arguments: {
          action: command === "resume" ? "start" : command === "cancel" ? "terminate" : "pause",
          mission_id: missionId,
        },
      },
    ];
  if (operationName === "vehicle_area_recon")
    return [
      {
        name: "ugv_area_recon_control",
        arguments: {
          cmd_type: command === "pause" ? 2 : command === "resume" ? 3 : 4,
          mission_id: missionId,
        },
      },
    ];
  if (operationName === "vehicle_track_target" && command === "cancel")
    return [buildUgvTargetLockCall(false, 0, missionId)];
  if (operationName === "vehicle_fire_weapon" && command === "cancel")
    throw new Error("UGV_FIRE_CANCEL_UNSUPPORTED");
  if (operationName === "vehicle_control_gimbal" && command === "cancel")
    return [buildUgvGimbalStopCall(missionId)];
  return [];
}

export function buildUgvEmergencyStopCalls(
  input: {
    chassisMissionId?: number | string;
    reconMissionId?: number | string;
  } = {},
): DeviceToolCall[] {
  const chassisMissionId = optionalMissionId(input.chassisMissionId);
  const reconMissionId = optionalMissionId(input.reconMissionId);
  return [
    { name: "ugv_motion_stop", arguments: {} },
    {
      name: "ugv_mission_control",
      arguments: { action: "terminate", mission_id: chassisMissionId },
    },
    {
      name: "ugv_area_recon_control",
      arguments: { cmd_type: 4, mission_id: reconMissionId },
    },
    buildUgvTargetLockCall(false, 0, reconMissionId),
  ];
}

export function buildUgvTargetLockCall(
  lock: boolean,
  targetId: number | string,
  missionId: number | string = 0,
): DeviceToolCall {
  return {
    name: "ugv_area_recon_lock",
    arguments: {
      lock,
      target_id: parseUgvTargetId(targetId, !lock),
      mission_id: parseUgvMissionId(missionId),
    },
  };
}

export function buildUgvGimbalStopCall(missionId: number | string): DeviceToolCall {
  return {
    name: "ugv_gimbal_move",
    arguments: {
      mode: "velocity",
      yaw: 0,
      pitch: 0,
      yaw_speed: 0,
      pitch_speed: 0,
      delta_zoom: 0,
      mission_id: parseUgvMissionId(missionId),
    },
  };
}

export function buildUgvAttackConfirmationCall(
  confirm: 1 | 2,
  missionId: number | string,
): DeviceToolCall {
  return {
    name: "ugv_area_recon_attack_confirm",
    arguments: { confirm, mission_id: parseUgvMissionId(missionId) },
  };
}

/** Backward-compatible name; target selection is owned by the prior lock call. */
export function fireConfirmationCalls(
  _targetId: string,
  persistedMissionId: number | string = 0,
): DeviceToolCall[] {
  return [buildUgvAttackConfirmationCall(1, persistedMissionId)];
}

function navigate(argumentsValue: Record<string, unknown>): DeviceToolCall {
  const mission = object(argumentsValue.mission, "UGV_NAVIGATION_MISSION_INVALID");
  if (mission.type === "return_home")
    return { name: "ugv_return_home", arguments: { mission_id: 0 } };
  if (mission.type === "distance")
    return {
      name: "ugv_move_distance",
      arguments: {
        direction: direction(mission.direction),
        distance: positive(mission.distanceM),
        mission_id: 0,
      },
    };
  if (mission.type !== "point" && mission.type !== "route")
    throw new Error("UGV_NAVIGATION_MISSION_INVALID");
  const rawWaypoints = mission.type === "point" ? [mission.target] : mission.waypoints;
  if (!Array.isArray(rawWaypoints) || rawWaypoints.length === 0)
    throw new Error("UGV_NAVIGATION_WAYPOINTS_INVALID");
  const taskPoints = rawWaypoints.map((value) => {
    const point = object(value, "UGV_NAVIGATION_WAYPOINT_INVALID");
    return {
      longitude: longitude(point.longitude),
      latitude: latitude(point.latitude),
      altitude: finite(point.altitude, 0),
    };
  });
  return {
    name: "ugv_path_follow_mission",
    arguments: {
      task_points: taskPoints,
      json_url: stringValue(argumentsValue.jsonUrl, ""),
      need_plan: planning(argumentsValue.needPlan ?? argumentsValue.planningMode),
      density: enumValue(argumentsValue.density ?? "adaptive", [
        "adaptive",
        "dense",
        "medium",
        "sparse",
      ]),
      mission_id: 0,
    },
  };
}

function reconConfigure(argumentsValue: Record<string, unknown>): DeviceToolCall {
  const scanMode = scanModeValue(argumentsValue.scanMode ?? "area");
  const regionPoints = scanMode === 2 ? null : reconRegionPoints(argumentsValue.area);
  return {
    name: "ugv_area_recon_configure",
    arguments: {
      region_points: regionPoints,
      region_type: integerIn(argumentsValue.regionType, [2, 3, 4, 5], 5),
      target_types: targetTypes(argumentsValue.targetTypes),
      scan_num: nonnegativeInteger(argumentsValue.scanNum ?? argumentsValue.scanCount, 0),
      lock_duration_limit: nonnegativeInteger(argumentsValue.lockDurationLimitSec, 0),
      recon_type: reconType(argumentsValue.reconType),
      scan_speed: positive(argumentsValue.scanSpeed, 30),
      scan_mode: scanMode,
      scan_pitch: finite(argumentsValue.scanPitch, 0),
      mission_id: 0,
    },
  };
}

function gimbal(argumentsValue: Record<string, unknown>): DeviceToolCall {
  const mode = enumValue(argumentsValue.mode, ["absolute", "relative", "velocity", "reset"]);
  if (mode === "velocity") boundedDuration(argumentsValue.durationMs);
  return {
    name: "ugv_gimbal_move",
    arguments: {
      mode,
      yaw: finite(argumentsValue.yaw, 0),
      pitch: finite(argumentsValue.pitch, 0),
      yaw_speed: finite(argumentsValue.yawSpeed, 30),
      pitch_speed: finite(argumentsValue.pitchSpeed, 30),
      delta_zoom: finite(argumentsValue.deltaZoom ?? argumentsValue.zoomDelta, 0),
      mission_id: optionalMissionId(argumentsValue.missionId),
    },
  };
}

function reconRegionPoints(value: unknown): Record<string, number>[] {
  const area = object(value, "UGV_RECON_AREA_INVALID");
  if (!Array.isArray(area.polygon) || area.polygon.length < 3)
    throw new Error("UGV_RECON_AREA_INVALID");
  return area.polygon.map((value) => {
    const point = object(value, "UGV_RECON_POINT_INVALID");
    return {
      longitude: longitude(point.longitude),
      latitude: latitude(point.latitude),
      altitude: finite(point.altitude, 0),
    };
  });
}

function targetTypes(value: unknown): number[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new Error("UGV_TARGET_TYPES_INVALID");
  return value.map((item) => parseUgvTargetId(item, true));
}

function planning(value: unknown): boolean | null {
  if (value === undefined || value === null || value === "auto") return null;
  if (value === true || value === "road_network" || value === "planned") return true;
  if (value === false || value === "direct") return false;
  throw new Error("UGV_NAVIGATION_PLANNING_MODE_INVALID");
}

function reconType(value: unknown): number {
  if (value === undefined) return 1;
  if (typeof value === "number") return integerIn(value, [1, 2, 3, 4]);
  const mapping: Record<string, number> = { adaptive: 1, visible: 2, infrared: 3, dc: 4 };
  const parsed = typeof value === "string" ? mapping[value] : undefined;
  if (parsed === undefined) throw new Error("UGV_RECON_TYPE_INVALID");
  return parsed;
}

function scanModeValue(value: unknown): 1 | 2 {
  if (value === 1 || value === "area") return 1;
  if (value === 2 || value === "circular") return 2;
  throw new Error("UGV_RECON_SCAN_MODE_INVALID");
}

function direction(value: unknown): "forward" | "back" | "left" | "right" {
  if (value === "backward") return "back";
  return enumValue(value, ["forward", "back", "left", "right"]);
}

function requiredMissionId(value: number | string | undefined): number {
  if (value === undefined) throw new Error("UGV_PERSISTED_MISSION_ID_REQUIRED");
  return parseUgvMissionId(value);
}

function optionalMissionId(value: unknown): number {
  return value === undefined ? 0 : parseUgvMissionId(value);
}

function boundedDuration(value: unknown): number {
  const parsed = nonnegativeInteger(value);
  if (parsed < 1 || parsed > 60_000) throw new Error("UGV_GIMBAL_DURATION_INVALID");
  return parsed;
}

function defaultDelay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function object(value: unknown, errorCode: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(errorCode);
  return value as Record<string, unknown>;
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

function nonnegativeInteger(value: unknown, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("UGV_NONNEGATIVE_INTEGER_REQUIRED");
  return value;
}

function integerIn(value: unknown, allowed: readonly number[], fallback?: number): number {
  const parsed =
    value === undefined && fallback !== undefined ? fallback : nonnegativeInteger(value);
  if (!allowed.includes(parsed)) throw new Error("UGV_INTEGER_ENUM_INVALID");
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

function stringValue(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new Error("UGV_TEXT_INVALID");
  return value;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T))
    throw new Error("UGV_ENUM_INVALID");
  return value as T;
}

function required<T>(value: T | undefined, errorCode: string): T {
  if (value === undefined) throw new Error(errorCode);
  return value;
}
