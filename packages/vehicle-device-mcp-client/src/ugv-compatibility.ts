import type { CapturedToolContract } from "./fixtures.js";
import {
  UGV_OPERATION_PROFILES,
  vehicleOperationProfile,
  type VehicleOperationProfile,
} from "./operation-profile.js";
import { OPERATION_REQUIRED_TOOLS, type UgvDeviceToolName } from "./tool-allowlist.js";

export type UgvToolCompatibilityStatus =
  | "PRESENT_COMPATIBLE"
  | "PRESENT_INPUT_COMPATIBLE_OUTPUT_UNDECLARED"
  | "PRESENT_INPUT_SCHEMA_MISMATCH"
  | "PRESENT_OUTPUT_SCHEMA_MISMATCH"
  | "MISSING_REQUIRED"
  | "MISSING_OPTIONAL"
  | "UNVERIFIED_EXTERNAL";

export interface UgvToolCompatibilityFact {
  toolName: UgvDeviceToolName;
  requirement: "required" | "optional";
  status: UgvToolCompatibilityStatus;
  readOnly: boolean;
  taskControl: boolean;
  missionIdSemantics: "allocates" | "controls" | "observes" | "none";
  expectedInputProperties: readonly string[];
  expectedOutputProperties: readonly string[];
  missingInputProperties: readonly string[];
  missingOutputProperties: readonly string[];
  outputSchemaDeclared: boolean;
  runtimeResultValidation: boolean;
  schemaHash?: string;
}

export interface UgvOperationCompatibilityFact {
  operationName: string;
  status: UgvToolCompatibilityStatus;
  tools: readonly UgvToolCompatibilityFact[];
}

const EXPECTATIONS: Readonly<
  Record<
    UgvDeviceToolName,
    {
      requirement: "required" | "optional";
      input?: readonly string[];
      output?: readonly string[];
      readOnly?: boolean;
      taskControl?: boolean;
      missionIdSemantics?: UgvToolCompatibilityFact["missionIdSemantics"];
    }
  >
> = {
  get_status: { requirement: "required", readOnly: true, missionIdSemantics: "observes" },
  get_capabilities: { requirement: "required", readOnly: true },
  ugv_move_distance: {
    requirement: "required",
    input: ["direction", "distance", "mission_id"],
    output: ["mission_id", "error_code"],
    missionIdSemantics: "allocates",
  },
  ugv_path_follow_mission: {
    requirement: "required",
    input: ["task_points", "mission_id"],
    output: ["mission_id", "error_code"],
    missionIdSemantics: "allocates",
  },
  ugv_return_home: {
    requirement: "required",
    input: ["mission_id"],
    output: ["mission_id", "error_code"],
    missionIdSemantics: "allocates",
  },
  ugv_mission_control: {
    requirement: "required",
    input: ["action", "mission_id"],
    output: ["error_code"],
    taskControl: true,
    missionIdSemantics: "controls",
  },
  ugv_motion_stop: { requirement: "required", output: ["error_code"], taskControl: true },
  ugv_area_recon_configure: {
    requirement: "required",
    input: ["mission_id"],
    output: ["mission_id", "error_code"],
    missionIdSemantics: "allocates",
  },
  ugv_area_recon_control: {
    requirement: "required",
    input: ["cmd_type", "mission_id"],
    output: ["error_code"],
    taskControl: true,
    missionIdSemantics: "controls",
  },
  ugv_area_recon_get_status: {
    requirement: "required",
    readOnly: true,
    missionIdSemantics: "observes",
  },
  ugv_area_recon_get_targets: {
    requirement: "required",
    readOnly: true,
    missionIdSemantics: "observes",
  },
  ugv_area_recon_lock: {
    requirement: "optional",
    input: ["lock", "target_id", "mission_id"],
    taskControl: true,
    missionIdSemantics: "controls",
  },
  ugv_area_recon_reset: { requirement: "optional", input: ["mission_id"], taskControl: true },
  ugv_area_recon_attack_confirm: {
    requirement: "optional",
    input: ["mission_id"],
    missionIdSemantics: "controls",
  },
  ugv_gimbal_move: { requirement: "optional", input: ["mode"] },
  ugv_laser_range: { requirement: "optional", readOnly: true },
};

export function buildUgvCompatibilityProfile(
  contracts: readonly CapturedToolContract[],
  externallyVerified = true,
  profiles: readonly VehicleOperationProfile[] = UGV_OPERATION_PROFILES,
): readonly UgvOperationCompatibilityFact[] {
  const byName = new Map(contracts.map((contract) => [contract.name, contract]));
  return Object.entries(OPERATION_REQUIRED_TOOLS).map(([operationName, toolNames]) => {
    const runtimeResultValidation =
      vehicleOperationProfile(operationName, profiles)?.resultPolicy.runtimeValidation === true;
    const tools = toolNames.map((toolName) =>
      toolCompatibility(
        toolName,
        byName.get(toolName),
        externallyVerified,
        runtimeResultValidation,
      ),
    );
    return {
      operationName,
      status: aggregateStatus(tools),
      tools,
    };
  });
}

export function ugvOperationCompatibility(
  operationName: string,
  contracts: readonly CapturedToolContract[],
): UgvOperationCompatibilityFact | undefined {
  return buildUgvCompatibilityProfile(contracts).find(
    (operation) => operation.operationName === operationName,
  );
}

export function isUgvToolCompatibilityUsable(status: UgvToolCompatibilityStatus): boolean {
  return status === "PRESENT_COMPATIBLE" || status === "PRESENT_INPUT_COMPATIBLE_OUTPUT_UNDECLARED";
}

function toolCompatibility(
  toolName: UgvDeviceToolName,
  contract: CapturedToolContract | undefined,
  externallyVerified: boolean,
  runtimeResultValidation: boolean,
): UgvToolCompatibilityFact {
  const expectation = EXPECTATIONS[toolName];
  const input = properties(contract?.inputSchema);
  const output = properties(contract?.outputSchema);
  const outputSchemaDeclared = contract?.outputSchema !== undefined;
  const expectedInputProperties = expectation.input ?? [];
  const expectedOutputProperties = expectation.output ?? [];
  const missingInputProperties = expectedInputProperties.filter((name) => !input.has(name));
  const missingOutputProperties = expectedOutputProperties.filter((name) => !output.has(name));
  let status: UgvToolCompatibilityStatus;
  if (contract === undefined)
    status = expectation.requirement === "required" ? "MISSING_REQUIRED" : "MISSING_OPTIONAL";
  else if (!externallyVerified) status = "UNVERIFIED_EXTERNAL";
  else if (missingInputProperties.length > 0) status = "PRESENT_INPUT_SCHEMA_MISMATCH";
  else if (!outputSchemaDeclared)
    status = runtimeResultValidation
      ? "PRESENT_INPUT_COMPATIBLE_OUTPUT_UNDECLARED"
      : "PRESENT_OUTPUT_SCHEMA_MISMATCH";
  else if (missingOutputProperties.length > 0) status = "PRESENT_OUTPUT_SCHEMA_MISMATCH";
  else status = "PRESENT_COMPATIBLE";
  return {
    toolName,
    requirement: expectation.requirement,
    status,
    readOnly: expectation.readOnly === true,
    taskControl: expectation.taskControl === true,
    missionIdSemantics: expectation.missionIdSemantics ?? "none",
    expectedInputProperties,
    expectedOutputProperties,
    missingInputProperties,
    missingOutputProperties,
    outputSchemaDeclared,
    runtimeResultValidation,
    ...(contract?.schemaHash === undefined ? {} : { schemaHash: contract.schemaHash }),
  };
}

function aggregateStatus(tools: readonly UgvToolCompatibilityFact[]): UgvToolCompatibilityStatus {
  if (tools.some((tool) => tool.status === "MISSING_REQUIRED")) return "MISSING_REQUIRED";
  if (tools.some((tool) => tool.status === "PRESENT_INPUT_SCHEMA_MISMATCH"))
    return "PRESENT_INPUT_SCHEMA_MISMATCH";
  if (tools.some((tool) => tool.status === "PRESENT_OUTPUT_SCHEMA_MISMATCH"))
    return "PRESENT_OUTPUT_SCHEMA_MISMATCH";
  if (tools.some((tool) => tool.status === "UNVERIFIED_EXTERNAL")) return "UNVERIFIED_EXTERNAL";
  if (tools.length > 0 && tools.every((tool) => tool.status === "MISSING_OPTIONAL"))
    return "MISSING_OPTIONAL";
  if (tools.some((tool) => tool.status === "PRESENT_INPUT_COMPATIBLE_OUTPUT_UNDECLARED"))
    return "PRESENT_INPUT_COMPATIBLE_OUTPUT_UNDECLARED";
  return "PRESENT_COMPATIBLE";
}

function properties(schema: unknown): ReadonlySet<string> {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return new Set();
  const value = (schema as Record<string, unknown>).properties;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return new Set();
  return new Set(Object.keys(value));
}
