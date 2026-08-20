import type { CapturedToolContract } from "./fixtures.js";
import {
  allDeviceTools,
  UGV_OPERATION_PROFILES,
  requiredDeviceToolsForVehicleOperation,
  resolveVehicleOperationVariant,
  vehicleOperationProfile,
  type VehicleOperationPhase,
  type VehicleOperationProfile,
} from "./operation-profile.js";
import type { DeviceToolHealthSnapshot, DeviceToolHealthState } from "./client.js";
import { isAllowedUgvDeviceTool, type UgvDeviceToolName } from "./tool-allowlist.js";
import {
  buildUgvCompatibilityProfile,
  isUgvToolCompatibilityUsable,
  type UgvToolCompatibilityFact,
} from "./ugv-compatibility.js";

export type UgvQualificationReasonCode =
  | "UGV_OPERATION_QUALIFIED"
  | "UGV_OPERATION_UNSUPPORTED"
  | "UGV_TOOL_MISSING"
  | "UGV_TOOL_INPUT_SCHEMA_MISMATCH"
  | "UGV_TOOL_OUTPUT_SCHEMA_MISMATCH"
  | "UGV_TOOL_OUTPUT_SCHEMA_UNDECLARED_RUNTIME_VALIDATED"
  | "UGV_TOOL_EXTERNAL_VERIFICATION_REQUIRED"
  | "UGV_TOOL_CIRCUIT_OPEN"
  | "UGV_TOOL_UNAVAILABLE"
  | "UGV_TOOL_RECOVERING"
  | "UGV_TOOL_RESULT_POLICY_UNVERIFIED";

export interface UgvToolQualificationFact {
  toolName: UgvDeviceToolName;
  compatibility: UgvToolCompatibilityFact["status"];
  health: DeviceToolHealthState | "unobserved";
  usable: boolean;
  reasonCodes: readonly UgvQualificationReasonCode[];
  contract: UgvToolCompatibilityFact;
}

export interface UgvOperationQualification {
  operationName: string;
  executionMode: "simulation" | "live";
  phase: VehicleOperationPhase;
  variant?: string;
  resultPolicyId?: string;
  deviceRequirement?: "required" | "optional";
  riskLevel?: "LOW" | "MEDIUM" | "HIGH";
  requiredTools: readonly UgvDeviceToolName[];
  tools: readonly UgvToolQualificationFact[];
  qualified: boolean;
  reasonCodes: readonly UgvQualificationReasonCode[];
}

export interface QualifyUgvOperationInput {
  operationName: string;
  arguments?: Readonly<Record<string, unknown>>;
  phase?: VehicleOperationPhase;
  contracts: readonly CapturedToolContract[];
  toolHealth?: readonly DeviceToolHealthSnapshot<UgvDeviceToolName>[];
  externallyVerified?: boolean;
  executionMode: "simulation" | "live";
}

export interface UgvQualificationMatrixInput {
  contracts: readonly CapturedToolContract[];
  toolHealth?: readonly DeviceToolHealthSnapshot<UgvDeviceToolName>[];
  externallyVerified?: boolean;
  executionMode: "simulation" | "live";
}

export const UGV_OPERATION_QUALIFICATION_CASES = [
  { operationName: "vehicle_get_state", arguments: {} },
  { operationName: "vehicle_get_capabilities", arguments: {} },
  { operationName: "vehicle_get_payload_status", arguments: {} },
  { operationName: "vehicle_get_targets", arguments: {} },
  { operationName: "vehicle_laser_range", arguments: {} },
  { operationName: "vehicle_navigate", arguments: { mission: { type: "point" } } },
  { operationName: "vehicle_navigate", arguments: { mission: { type: "route" } } },
  { operationName: "vehicle_navigate", arguments: { mission: { type: "distance" } } },
  { operationName: "vehicle_navigate", arguments: { mission: { type: "return_home" } } },
  { operationName: "vehicle_area_recon", arguments: { scanMode: "area" } },
  { operationName: "vehicle_area_recon", arguments: { scanMode: "circular" } },
  { operationName: "vehicle_track_target", arguments: {} },
  { operationName: "vehicle_control_gimbal", arguments: {} },
  { operationName: "vehicle_fire_weapon", arguments: {} },
  { operationName: "vehicle_emergency_stop", arguments: {} },
] as const;

export class UgvOperationQualificationService {
  constructor(readonly profiles: readonly VehicleOperationProfile[] = UGV_OPERATION_PROFILES) {}

  qualify(input: QualifyUgvOperationInput): UgvOperationQualification {
    const profile = vehicleOperationProfile(input.operationName, this.profiles);
    const phase = input.phase ?? (profile?.execution === "SYNCHRONOUS" ? "read" : "start");
    if (profile === undefined)
      return {
        operationName: input.operationName,
        executionMode: input.executionMode,
        phase,
        requiredTools: [],
        tools: [],
        qualified: false,
        reasonCodes: ["UGV_OPERATION_UNSUPPORTED"],
      };

    const argumentsValue = input.arguments ?? {};
    const variant = resolveVehicleOperationVariant(profile, argumentsValue)?.variant;
    const requiredTools = requiredDeviceToolsForVehicleOperation(
      input.operationName,
      argumentsValue,
      phase,
      this.profiles,
    ).map(requiredUgvToolName);
    const compatibility = buildUgvCompatibilityProfile(
      input.contracts,
      input.externallyVerified ?? true,
      this.profiles,
    ).find((candidate) => candidate.operationName === input.operationName);
    const compatibilityByTool = new Map(
      (compatibility?.tools ?? []).map((fact) => [fact.toolName, fact]),
    );
    const healthByTool = new Map(
      (input.toolHealth ?? []).map((health) => [health.toolName, health]),
    );
    const tools = requiredTools.map((toolName) =>
      qualifyTool(toolName, compatibilityByTool.get(toolName), healthByTool.get(toolName)),
    );
    const qualified = tools.length === requiredTools.length && tools.every((tool) => tool.usable);
    return {
      operationName: input.operationName,
      executionMode: input.executionMode,
      phase,
      ...(variant === undefined ? {} : { variant }),
      resultPolicyId: profile.resultPolicy.policyId,
      deviceRequirement: profile.capabilityPolicy.deviceRequirement,
      riskLevel: profile.riskLevel,
      requiredTools,
      tools,
      qualified,
      reasonCodes: qualified
        ? uniqueReasons(["UGV_OPERATION_QUALIFIED", ...tools.flatMap((tool) => tool.reasonCodes)])
        : uniqueReasons(tools.flatMap((tool) => tool.reasonCodes)),
    };
  }

  matrix(input: UgvQualificationMatrixInput): readonly UgvOperationQualification[] {
    return UGV_OPERATION_QUALIFICATION_CASES.map((scenario) =>
      this.qualify({
        ...input,
        operationName: scenario.operationName,
        arguments: scenario.arguments,
      }),
    );
  }

  inventoryTools(operationName: string): readonly UgvDeviceToolName[] {
    const profile = vehicleOperationProfile(operationName, this.profiles);
    if (profile === undefined) return [];
    return allDeviceTools(profile).map(requiredUgvToolName);
  }
}

function qualifyTool(
  toolName: UgvDeviceToolName,
  compatibility: UgvToolCompatibilityFact | undefined,
  health: DeviceToolHealthSnapshot<UgvDeviceToolName> | undefined,
): UgvToolQualificationFact {
  const compatibilityStatus = compatibility?.status ?? "MISSING_REQUIRED";
  const healthState = health?.state ?? "unobserved";
  const compatibilityUsable = isUgvToolCompatibilityUsable(compatibilityStatus);
  const healthUsable = healthState !== "open" && healthState !== "unavailable";
  const reasonCodes = uniqueReasons([
    ...compatibilityReasons(compatibility),
    ...(healthState === "open" ? (["UGV_TOOL_CIRCUIT_OPEN"] as const) : []),
    ...(healthState === "unavailable" ? (["UGV_TOOL_UNAVAILABLE"] as const) : []),
  ]);
  return {
    toolName,
    compatibility: compatibilityStatus,
    health: healthState,
    usable: compatibilityUsable && healthUsable,
    reasonCodes,
    contract:
      compatibility ??
      ({
        toolName,
        requirement: "required",
        status: "MISSING_REQUIRED",
        readOnly: false,
        taskControl: false,
        missionIdSemantics: "none",
        expectedInputProperties: [],
        expectedOutputProperties: [],
        missingInputProperties: [],
        missingOutputProperties: [],
        outputSchemaDeclared: false,
        runtimeResultValidation: false,
      } satisfies UgvToolCompatibilityFact),
  };
}

function compatibilityReasons(
  compatibility: UgvToolCompatibilityFact | undefined,
): readonly UgvQualificationReasonCode[] {
  if (compatibility === undefined) return ["UGV_TOOL_MISSING"];
  const status = compatibility.status;
  if (status === "PRESENT_COMPATIBLE") return [];
  if (status === "PRESENT_INPUT_COMPATIBLE_OUTPUT_UNDECLARED")
    return ["UGV_TOOL_OUTPUT_SCHEMA_UNDECLARED_RUNTIME_VALIDATED"];
  if (status === "PRESENT_INPUT_SCHEMA_MISMATCH") return ["UGV_TOOL_INPUT_SCHEMA_MISMATCH"];
  if (status === "PRESENT_OUTPUT_SCHEMA_MISMATCH")
    return compatibility.outputSchemaDeclared || compatibility.runtimeResultValidation
      ? ["UGV_TOOL_OUTPUT_SCHEMA_MISMATCH"]
      : ["UGV_TOOL_RESULT_POLICY_UNVERIFIED"];
  if (status === "UNVERIFIED_EXTERNAL") return ["UGV_TOOL_EXTERNAL_VERIFICATION_REQUIRED"];
  return ["UGV_TOOL_MISSING"];
}

function requiredUgvToolName(toolName: string): UgvDeviceToolName {
  if (!isAllowedUgvDeviceTool(toolName)) throw new Error("UGV_QUALIFICATION_TOOL_NOT_ALLOWED");
  return toolName;
}

function uniqueReasons(
  reasonCodes: readonly UgvQualificationReasonCode[],
): UgvQualificationReasonCode[] {
  return [...new Set(reasonCodes)];
}
