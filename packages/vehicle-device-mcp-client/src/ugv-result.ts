import { DeviceToolProtocolError, DeviceToolRejectedError } from "./errors.js";
import type { UgvDeviceToolName } from "./tool-allowlist.js";

const CHASSIS_STATES = new Set([0, 1, 2, 3, 4, 5]);
const RECON_STATUSES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 99]);
const COMMON_RESULT_TOOLS = new Set<UgvDeviceToolName>([
  "ugv_path_follow_mission",
  "ugv_return_home",
  "ugv_move_distance",
  "ugv_mission_control",
  "ugv_motion_stop",
  "ugv_area_recon_configure",
  "ugv_area_recon_control",
  "ugv_area_recon_lock",
  "ugv_area_recon_reset",
  "ugv_area_recon_attack_confirm",
  "ugv_gimbal_move",
]);

export function validateUgvToolResult(
  name: UgvDeviceToolName,
  result: Record<string, unknown>,
  argumentsValue?: Record<string, unknown>,
): Record<string, unknown> {
  if (COMMON_RESULT_TOOLS.has(name)) validateCommonResult(name, result);
  if (argumentsValue !== undefined) validateMissionCorrelation(name, result, argumentsValue);
  if (name === "ugv_area_recon_configure") validateReconConfigure(name, result);
  if (
    name === "ugv_area_recon_control" ||
    name === "ugv_area_recon_lock" ||
    name === "ugv_area_recon_reset" ||
    name === "ugv_area_recon_attack_confirm"
  )
    validateReconCommand(name, result);
  if (name === "get_status") validateStatusRead(name, result);
  if (name === "get_capabilities") validateCapabilitiesRead(name, result);
  if (name === "ugv_area_recon_get_status") validateReconStatus(name, result);
  if (name === "ugv_area_recon_get_targets") validateTargets(name, result);
  if (name === "ugv_laser_range") validateLaser(name, result);
  return result;
}

function validateMissionCorrelation(
  name: UgvDeviceToolName,
  result: Record<string, unknown>,
  argumentsValue: Record<string, unknown>,
): void {
  if (!COMMON_RESULT_TOOLS.has(name) || name === "ugv_motion_stop") return;
  const returnedMissionId = missionIdFromUgvResult(name, result);
  if (returnedMissionId === undefined) protocol(name, "DEVICE_MISSION_ID_INVALID");
  const requestedMissionId = parsePersistedInteger(
    argumentsValue.mission_id ?? 0,
    "UGV_MISSION_ID_INVALID",
    0,
  );
  if (requestedMissionId === 0) {
    if (returnedMissionId <= 0) protocol(name, "DEVICE_MISSION_ID_INVALID");
    return;
  }
  if (returnedMissionId !== requestedMissionId) protocol(name, "DEVICE_MISSION_ID_MISMATCH");
}

export function missionIdFromUgvResult(
  name: UgvDeviceToolName,
  result: Record<string, unknown>,
): number | undefined {
  if (!COMMON_RESULT_TOOLS.has(name)) return undefined;
  const value = result.mission_id;
  const allowNoMission = name === "ugv_motion_stop";
  return safeInteger(value, name, "MISSION_ID_INVALID", allowNoMission ? -1 : 0);
}

export function canonicalUgvMissionId(value: unknown): string {
  return String(parsePersistedInteger(value, "UGV_MISSION_ID_INVALID", 0));
}

export function parseUgvMissionId(value: unknown): number {
  return parsePersistedInteger(value, "UGV_MISSION_ID_INVALID", 0);
}

export function parseUgvTargetId(value: unknown, allowZero = false): number {
  return parsePersistedInteger(value, "UGV_TARGET_ID_INVALID", allowZero ? 0 : 1);
}

function validateCommonResult(name: UgvDeviceToolName, result: Record<string, unknown>): void {
  const errorCode = safeInteger(result.error_code, name, "DEVICE_ERROR_CODE_INVALID");
  requireString(result.message, name, "DEVICE_MESSAGE_INVALID");
  if (errorCode !== 0) throw new DeviceToolRejectedError("UGV", name, errorCode, result);
  safeInteger(
    result.mission_id,
    name,
    "DEVICE_MISSION_ID_INVALID",
    name === "ugv_motion_stop" ? -1 : 0,
  );
  const state = safeInteger(result.state, name, "DEVICE_STATE_INVALID");
  if (!CHASSIS_STATES.has(state)) protocol(name, "DEVICE_STATE_INVALID");
  if (state === 5) protocol(name, "DEVICE_RESULT_CONTRADICTORY");
  requireString(result.state_label, name, "DEVICE_STATE_LABEL_INVALID");
}

function validateReconConfigure(name: UgvDeviceToolName, result: Record<string, unknown>): void {
  if (typeof result.res !== "boolean") protocol(name, "DEVICE_RECON_RES_INVALID");
  requireString(result.fail_data, name, "DEVICE_RECON_FAIL_DATA_INVALID");
  if (!result.res) protocol(name, "DEVICE_RECON_RESULT_CONTRADICTORY");
  if (result.coverability !== undefined) validateCoverability(name, result.coverability);
}

function validateReconCommand(name: UgvDeviceToolName, result: Record<string, unknown>): void {
  const commandResult = safeInteger(result.cmd_res, name, "DEVICE_RECON_CMD_RES_INVALID");
  if (commandResult !== 0) protocol(name, "DEVICE_RECON_CMD_RES_CONTRADICTORY");
  if (result.fail_data !== undefined)
    requireString(result.fail_data, name, "DEVICE_RECON_FAIL_DATA_INVALID");
  if (result.res !== undefined && typeof result.res !== "boolean")
    protocol(name, "DEVICE_RECON_RES_INVALID");
}

function validateCoverability(name: UgvDeviceToolName, value: unknown): void {
  if (!record(value)) protocol(name, "DEVICE_COVERABILITY_INVALID");
  if (!new Set(["full", "partial", "none", "unknown"]).has(value.coverable as string))
    protocol(name, "DEVICE_COVERABILITY_INVALID");
  requireString(value.coverable_label, name, "DEVICE_COVERABILITY_INVALID");
  for (const key of ["region_min_dist_m", "region_max_dist_m", "detection_range_m"])
    if (value[key] !== undefined)
      finiteNonnegative(value[key], name, "DEVICE_COVERABILITY_INVALID");
}

function validateStatusRead(name: UgvDeviceToolName, result: Record<string, unknown>): void {
  if (result.available !== undefined && typeof result.available !== "boolean")
    protocol(name, "DEVICE_STATUS_AVAILABLE_INVALID");
  if (result.available === false && Object.keys(result).some((key) => key !== "available"))
    protocol(name, "DEVICE_STATUS_UNAVAILABLE_CONTRADICTORY");
}

function validateCapabilitiesRead(name: UgvDeviceToolName, result: Record<string, unknown>): void {
  if (Array.isArray(result.capabilities)) protocol(name, "DEVICE_CAPABILITIES_INVALID");
}

function validateReconStatus(name: UgvDeviceToolName, result: Record<string, unknown>): void {
  const status = safeInteger(result.status, name, "DEVICE_RECON_STATUS_INVALID");
  if (!RECON_STATUSES.has(status)) protocol(name, "DEVICE_RECON_STATUS_INVALID");
  if (result.status_label !== undefined)
    requireString(result.status_label, name, "DEVICE_RECON_STATUS_LABEL_INVALID");
  if (typeof result.out_of_range !== "boolean") protocol(name, "DEVICE_RECON_OUT_OF_RANGE_INVALID");
  if (typeof result.camera_fault !== "boolean") protocol(name, "DEVICE_RECON_CAMERA_FAULT_INVALID");
  if (result.scan_mode !== undefined && !new Set([1, 2]).has(result.scan_mode as number))
    protocol(name, "DEVICE_RECON_SCAN_MODE_INVALID");
  if (result.progress !== undefined) percentage(result.progress, name);
  if (result.coverage !== undefined) percentage(result.coverage, name);
  if (result.online !== undefined && typeof result.online !== "boolean")
    protocol(name, "DEVICE_RECON_ONLINE_INVALID");
  if (result.attack_ready !== undefined && typeof result.attack_ready !== "boolean")
    protocol(name, "DEVICE_RECON_ATTACK_READY_INVALID");
  if (result.lock !== undefined) {
    if (!record(result.lock)) protocol(name, "DEVICE_RECON_LOCK_INVALID");
    if (result.lock.stage !== undefined)
      safeInteger(result.lock.stage, name, "DEVICE_RECON_LOCK_INVALID", 1);
    if (result.lock.target_id !== undefined)
      safeInteger(result.lock.target_id, name, "DEVICE_RECON_LOCK_INVALID", 0);
  }
}

function validateTargets(name: UgvDeviceToolName, result: Record<string, unknown>): void {
  if (!Array.isArray(result.targets)) protocol(name, "DEVICE_TARGETS_INVALID");
  for (const target of result.targets) {
    if (!record(target)) protocol(name, "DEVICE_TARGET_INVALID");
    safeInteger(target.target_id, name, "DEVICE_TARGET_ID_INVALID", 0);
    if (target.capture_time_us !== undefined)
      safeInteger(target.capture_time_us, name, "DEVICE_TARGET_CAPTURE_TIME_INVALID", 0);
    if (target.type !== undefined) safeInteger(target.type, name, "DEVICE_TARGET_TYPE_INVALID", 0);
    if (target.distance !== undefined)
      finiteNonnegative(target.distance, name, "DEVICE_TARGET_DISTANCE_INVALID");
    if (target.confidence !== undefined)
      finiteNonnegative(target.confidence, name, "DEVICE_TARGET_CONFIDENCE_INVALID");
  }
}

function validateLaser(name: UgvDeviceToolName, result: Record<string, unknown>): void {
  finiteNonnegative(result.distance_m ?? result.distance, name, "DEVICE_LASER_DISTANCE_INVALID");
}

function parsePersistedInteger(value: unknown, errorCode: string, minimum: number): number {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= minimum) return value;
    throw new Error(errorCode);
  }
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) throw new Error(errorCode);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(errorCode);
  return parsed;
}

function safeInteger(
  value: unknown,
  name: UgvDeviceToolName,
  suffix: string,
  minimum = Number.MIN_SAFE_INTEGER,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum)
    protocol(name, suffix);
  return value;
}

function finiteNonnegative(value: unknown, name: UgvDeviceToolName, suffix: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) protocol(name, suffix);
  return value;
}

function percentage(value: unknown, name: UgvDeviceToolName): void {
  const parsed = finiteNonnegative(value, name, "DEVICE_RECON_PROGRESS_INVALID");
  if (parsed > 100) protocol(name, "DEVICE_RECON_PROGRESS_INVALID");
}

function requireString(value: unknown, name: UgvDeviceToolName, suffix: string): string {
  if (typeof value !== "string") protocol(name, suffix);
  return value;
}

function protocol(name: UgvDeviceToolName, suffix: string): never {
  throw new DeviceToolProtocolError("UGV", name, suffix);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
