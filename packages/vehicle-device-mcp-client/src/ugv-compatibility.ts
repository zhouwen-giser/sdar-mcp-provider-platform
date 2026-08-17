import type { CapturedToolContract } from "./fixtures.js";
import { OPERATION_REQUIRED_TOOLS, type UgvDeviceToolName } from "./tool-allowlist.js";

export type UgvToolCompatibilityStatus =
  | "PRESENT_COMPATIBLE"
  | "PRESENT_SCHEMA_MISMATCH"
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
): readonly UgvOperationCompatibilityFact[] {
  const byName = new Map(contracts.map((contract) => [contract.name, contract]));
  return Object.entries(OPERATION_REQUIRED_TOOLS).map(([operationName, toolNames]) => {
    const tools = toolNames.map((toolName) =>
      toolCompatibility(toolName, byName.get(toolName), externallyVerified),
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

function toolCompatibility(
  toolName: UgvDeviceToolName,
  contract: CapturedToolContract | undefined,
  externallyVerified: boolean,
): UgvToolCompatibilityFact {
  const expectation = EXPECTATIONS[toolName];
  const input = properties(contract?.inputSchema);
  const output = properties(contract?.outputSchema);
  const expectedInputProperties = expectation.input ?? [];
  const expectedOutputProperties = expectation.output ?? [];
  const missingInputProperties = expectedInputProperties.filter((name) => !input.has(name));
  const missingOutputProperties = expectedOutputProperties.filter((name) => !output.has(name));
  let status: UgvToolCompatibilityStatus;
  if (contract === undefined)
    status = expectation.requirement === "required" ? "MISSING_REQUIRED" : "MISSING_OPTIONAL";
  else if (!externallyVerified) status = "UNVERIFIED_EXTERNAL";
  else if (missingInputProperties.length > 0 || missingOutputProperties.length > 0)
    status = "PRESENT_SCHEMA_MISMATCH";
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
    ...(contract?.schemaHash === undefined ? {} : { schemaHash: contract.schemaHash }),
  };
}

function aggregateStatus(tools: readonly UgvToolCompatibilityFact[]): UgvToolCompatibilityStatus {
  if (tools.some((tool) => tool.status === "MISSING_REQUIRED")) return "MISSING_REQUIRED";
  if (tools.some((tool) => tool.status === "PRESENT_SCHEMA_MISMATCH"))
    return "PRESENT_SCHEMA_MISMATCH";
  if (tools.some((tool) => tool.status === "UNVERIFIED_EXTERNAL")) return "UNVERIFIED_EXTERNAL";
  if (tools.length > 0 && tools.every((tool) => tool.status === "MISSING_OPTIONAL"))
    return "MISSING_OPTIONAL";
  return "PRESENT_COMPATIBLE";
}

function properties(schema: unknown): ReadonlySet<string> {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return new Set();
  const value = (schema as Record<string, unknown>).properties;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return new Set();
  return new Set(Object.keys(value));
}
