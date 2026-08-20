import type { FreshnessDomain, VehicleTrack } from "../../vehicle-provider-core/src/index.js";

export const VEHICLE_OPERATION_PHASES = ["start", "read", "pause", "resume", "cancel"] as const;

export type VehicleOperationPhase = (typeof VEHICLE_OPERATION_PHASES)[number];
export type VehicleOperationExecution = "SYNCHRONOUS" | "TASK_REQUIRED";
export type VehicleOperationRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface DevicePhaseProfile<TDeviceTool extends string = string> {
  requiredTools: readonly TDeviceTool[];
}

export interface OperationVariantProfile<TDeviceTool extends string = string> {
  variant: string;
  selector: {
    path: readonly string[];
    values: readonly (string | number | boolean)[];
    default?: boolean;
  };
  phases?: Partial<Record<VehicleOperationPhase, DevicePhaseProfile<TDeviceTool>>>;
}

export interface DeviceResultPolicyReference {
  policyId: string;
  runtimeValidation: boolean;
}

export interface ObservationPolicy {
  requiredFreshnessDomains: readonly FreshnessDomain[];
}

export interface TaskTimeoutPolicy {
  authority: "none" | "runtime_task" | "provider_physical_confirmation";
}

export interface CapabilityPolicy {
  deviceRequirement: "required" | "optional";
  advertisedByDefault: boolean;
}

export interface VehicleOperationProfile<TDeviceTool extends string = string> {
  operationName: string;
  execution: VehicleOperationExecution;
  tracks: readonly VehicleTrack[];
  variants?: readonly OperationVariantProfile<TDeviceTool>[];
  phases: Partial<Record<VehicleOperationPhase, DevicePhaseProfile<TDeviceTool>>>;
  inventoryTools?: readonly TDeviceTool[];
  resultPolicy: DeviceResultPolicyReference;
  observationPolicy?: ObservationPolicy;
  timeoutPolicy?: TaskTimeoutPolicy;
  capabilityPolicy: CapabilityPolicy;
  riskLevel: VehicleOperationRiskLevel;
}

/**
 * Current UGV operation facts, centralized as data before the qualification,
 * result-policy and manifest consumers migrate in later Fix A tasks.
 */
export const UGV_OPERATION_PROFILES = [
  synchronousRead("vehicle_get_state", "get_status", ["chassis", "health"]),
  synchronousRead("vehicle_get_capabilities", "get_capabilities", [], "required"),
  synchronousRead("vehicle_get_payload_status", "ugv_area_recon_get_status", ["payload"]),
  synchronousRead("vehicle_get_targets", "ugv_area_recon_get_targets", ["target"]),
  synchronousRead("vehicle_laser_range", "ugv_laser_range", ["payload"], "optional"),
  {
    operationName: "vehicle_navigate",
    execution: "TASK_REQUIRED",
    tracks: ["chassis"],
    variants: [
      deviceVariant("point", ["mission", "type"], ["point"], "ugv_path_follow_mission", true),
      deviceVariant("route", ["mission", "type"], ["route"], "ugv_path_follow_mission"),
      deviceVariant("return_home", ["mission", "type"], ["return_home"], "ugv_return_home"),
      deviceVariant("distance", ["mission", "type"], ["distance"], "ugv_move_distance"),
    ],
    phases: {
      start: requiredTools("ugv_mission_control"),
      pause: requiredTools("ugv_mission_control"),
      resume: requiredTools("ugv_mission_control"),
      cancel: requiredTools("ugv_mission_control"),
      read: requiredTools("ugv_mission_control"),
    },
    resultPolicy: resultPolicy("ugv.navigation.legacy"),
    observationPolicy: { requiredFreshnessDomains: ["chassis", "health"] },
    timeoutPolicy: { authority: "provider_physical_confirmation" },
    capabilityPolicy: { deviceRequirement: "required", advertisedByDefault: true },
    riskLevel: "MEDIUM",
  },
  {
    operationName: "vehicle_area_recon",
    execution: "TASK_REQUIRED",
    tracks: ["eo"],
    variants: [
      selectorOnlyVariant("area", ["scanMode"], ["area", 1], true),
      selectorOnlyVariant("circular", ["scanMode"], ["circular", 2]),
    ],
    phases: {
      start: requiredTools(
        "ugv_area_recon_configure",
        "ugv_area_recon_control",
        "ugv_area_recon_get_status",
      ),
      pause: requiredTools("ugv_area_recon_control"),
      resume: requiredTools("ugv_area_recon_control"),
      cancel: requiredTools("ugv_area_recon_control"),
      read: requiredTools("ugv_area_recon_control"),
    },
    resultPolicy: resultPolicy("ugv.area_recon.legacy"),
    observationPolicy: { requiredFreshnessDomains: ["payload"] },
    timeoutPolicy: { authority: "runtime_task" },
    capabilityPolicy: { deviceRequirement: "required", advertisedByDefault: true },
    riskLevel: "MEDIUM",
  },
  taskOperation({
    operationName: "vehicle_track_target",
    tracks: ["eo"],
    requiredTools: ["ugv_area_recon_lock", "ugv_area_recon_get_status"],
    startTools: ["ugv_area_recon_lock"],
    resultPolicyId: "ugv.track_target.legacy",
    requiredFreshnessDomains: ["payload"],
    deviceRequirement: "optional",
  }),
  taskOperation({
    operationName: "vehicle_control_gimbal",
    tracks: ["eo"],
    requiredTools: ["ugv_gimbal_move"],
    resultPolicyId: "ugv.gimbal.legacy",
    requiredFreshnessDomains: ["payload"],
    deviceRequirement: "optional",
  }),
  taskOperation({
    operationName: "vehicle_fire_weapon",
    tracks: ["eo", "weapon"],
    requiredTools: ["ugv_area_recon_attack_confirm"],
    resultPolicyId: "ugv.fire.legacy",
    requiredFreshnessDomains: ["mission", "target", "payload"],
    deviceRequirement: "optional",
    riskLevel: "HIGH",
  }),
  taskOperation({
    operationName: "vehicle_emergency_stop",
    tracks: ["chassis", "eo", "weapon"],
    requiredTools: [
      "ugv_motion_stop",
      "ugv_mission_control",
      "ugv_area_recon_control",
      "ugv_area_recon_lock",
    ],
    resultPolicyId: "ugv.emergency_stop.legacy",
    requiredFreshnessDomains: ["chassis", "health"],
    riskLevel: "HIGH",
  }),
] as const satisfies readonly VehicleOperationProfile[];

export function vehicleOperationProfile(
  operationName: string,
  profiles: readonly VehicleOperationProfile[] = UGV_OPERATION_PROFILES,
): VehicleOperationProfile | undefined {
  return profiles.find((profile) => profile.operationName === operationName);
}

export function resolveVehicleOperationVariant(
  profile: VehicleOperationProfile,
  argumentsValue: Readonly<Record<string, unknown>>,
): OperationVariantProfile | undefined {
  const variants = profile.variants ?? [];
  const selected = variants.find((variant) => {
    const selectedValue = valueAt(argumentsValue, variant.selector.path);
    return variant.selector.values.some((value) => value === selectedValue);
  });
  return selected ?? variants.find((variant) => variant.selector.default === true);
}

export function requiredDeviceToolsForVehicleOperation(
  operationName: string,
  argumentsValue: Readonly<Record<string, unknown>> = {},
  phase: VehicleOperationPhase = "start",
  profiles: readonly VehicleOperationProfile[] = UGV_OPERATION_PROFILES,
): string[] {
  const profile = vehicleOperationProfile(operationName, profiles);
  if (profile === undefined) return [];
  const variant = resolveVehicleOperationVariant(profile, argumentsValue);
  const variantTools = variant?.phases?.[phase]?.requiredTools ?? [];
  const phaseTools = profile.phases[phase]?.requiredTools;
  if (phaseTools === undefined && variantTools.length === 0) return allDeviceTools(profile);
  return unique([...variantTools, ...(phaseTools ?? [])]);
}

export function allDeviceTools(profile: VehicleOperationProfile): string[] {
  if (profile.inventoryTools !== undefined) return unique(profile.inventoryTools);
  const variantTools = (profile.variants ?? []).flatMap((variant) =>
    VEHICLE_OPERATION_PHASES.flatMap((phase) => variant.phases?.[phase]?.requiredTools ?? []),
  );
  const phaseTools = VEHICLE_OPERATION_PHASES.flatMap(
    (phase) => profile.phases[phase]?.requiredTools ?? [],
  );
  return unique([...variantTools, ...phaseTools]);
}

function synchronousRead(
  operationName: string,
  toolName: string,
  requiredFreshnessDomains: readonly FreshnessDomain[],
  deviceRequirement: CapabilityPolicy["deviceRequirement"] = "required",
): VehicleOperationProfile {
  return {
    operationName,
    execution: "SYNCHRONOUS",
    tracks: [],
    phases: { read: requiredTools(toolName) },
    resultPolicy: resultPolicy(`ugv.${operationName}.legacy`),
    observationPolicy: { requiredFreshnessDomains },
    timeoutPolicy: { authority: "none" },
    capabilityPolicy: { deviceRequirement, advertisedByDefault: true },
    riskLevel: "LOW",
  };
}

function taskOperation(input: {
  operationName: string;
  tracks: readonly VehicleTrack[];
  requiredTools: readonly string[];
  startTools?: readonly string[];
  resultPolicyId: string;
  requiredFreshnessDomains: readonly FreshnessDomain[];
  deviceRequirement?: CapabilityPolicy["deviceRequirement"];
  riskLevel?: VehicleOperationRiskLevel;
}): VehicleOperationProfile {
  return {
    operationName: input.operationName,
    execution: "TASK_REQUIRED",
    tracks: input.tracks,
    phases: { start: { requiredTools: input.startTools ?? input.requiredTools } },
    ...(sameTools(input.requiredTools, input.startTools ?? input.requiredTools)
      ? {}
      : { inventoryTools: input.requiredTools }),
    resultPolicy: resultPolicy(input.resultPolicyId),
    observationPolicy: { requiredFreshnessDomains: input.requiredFreshnessDomains },
    timeoutPolicy: { authority: "runtime_task" },
    capabilityPolicy: {
      deviceRequirement: input.deviceRequirement ?? "required",
      advertisedByDefault: true,
    },
    riskLevel: input.riskLevel ?? "MEDIUM",
  };
}

function deviceVariant(
  variant: string,
  path: readonly string[],
  values: readonly (string | number | boolean)[],
  toolName: string,
  defaultVariant = false,
): OperationVariantProfile {
  return {
    variant,
    selector: { path, values, ...(defaultVariant ? { default: true } : {}) },
    phases: { start: requiredTools(toolName) },
  };
}

function selectorOnlyVariant(
  variant: string,
  path: readonly string[],
  values: readonly (string | number | boolean)[],
  defaultVariant = false,
): OperationVariantProfile {
  return {
    variant,
    selector: { path, values, ...(defaultVariant ? { default: true } : {}) },
  };
}

function requiredTools(...toolNames: string[]): DevicePhaseProfile {
  return { requiredTools: toolNames };
}

function resultPolicy(policyId: string): DeviceResultPolicyReference {
  return { policyId, runtimeValidation: true };
}

function valueAt(source: Readonly<Record<string, unknown>>, path: readonly string[]): unknown {
  let current: unknown = source;
  for (const segment of path) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sameTools(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((tool, index) => tool === right[index]);
}
