import { createHash } from "node:crypto";
import type { ProviderStore } from "../../provider-adapter-kit/src/index.js";
import {
  MockVehicleDeviceMcpClient,
  StreamableHttpVehicleDeviceMcpClient,
  type DeviceMcpProfile,
  type VehicleDeviceMcpClient,
} from "./client.js";
import { capturedToolSchemaHash, type CapturedToolContract } from "./fixtures.js";
import {
  canonicalNpcTankMissionId,
  missionIdFromNpcTankResult,
  parseNpcTankMissionId,
  validateNpcTankToolResult,
} from "./npc-tank-result.js";
import {
  buildUgvAttackConfirmationCall,
  buildUgvEmergencyStopCalls,
  buildUgvGimbalStopCall,
  buildUgvStartFollowupCall,
  buildUgvTargetLockCall,
  controlDeviceCalls as ugvControlDeviceCalls,
  startDeviceCalls as ugvStartDeviceCalls,
  type DeviceToolCall as UgvDeviceToolCall,
} from "./tool-mapping.js";
import type { UgvDeviceToolName } from "./tool-allowlist.js";

/** Exact tool inventory captured from the real NPC Tank Device MCP server. */
export const NPC_TANK_DEVICE_TOOL_ALLOWLIST = [
  "npc_tank_path_follow_mission",
  "npc_tank_return_home",
  "npc_tank_move_distance",
  "npc_tank_mission_control",
  "npc_tank_motion_stop",
  "get_status",
  "npc_tank_get_capabilities",
  "npc_tank_area_recon_configure",
  "npc_tank_area_recon_control",
  "npc_tank_area_recon_lock",
  "npc_tank_area_recon_get_status",
  "npc_tank_area_recon_get_targets",
  "npc_tank_area_recon_reset",
  "npc_tank_area_recon_attack_confirm",
  "npc_tank_gimbal_move",
] as const;

export type NpcTankDeviceToolName = (typeof NPC_TANK_DEVICE_TOOL_ALLOWLIST)[number];
const ALLOWED = new Set<string>(NPC_TANK_DEVICE_TOOL_ALLOWLIST);

export const NPC_TANK_READ_ONLY_DEVICE_TOOLS = new Set<NpcTankDeviceToolName>([
  "get_status",
  "npc_tank_get_capabilities",
  "npc_tank_area_recon_get_status",
  "npc_tank_area_recon_get_targets",
]);

export function isAllowedNpcTankDeviceTool(name: string): name is NpcTankDeviceToolName {
  return ALLOWED.has(name);
}

export function isMutatingNpcTankDeviceTool(name: NpcTankDeviceToolName): boolean {
  return !NPC_TANK_READ_ONLY_DEVICE_TOOLS.has(name);
}

/**
 * Deterministic regression fixture derived from the captured 15-tool contract.
 * It is not an alternative tool inventory and cannot introduce legacy tools.
 */
export function npcTankCapturedToolContractsFixture(
  capturedAt = new Date().toISOString(),
): CapturedToolContract[] {
  return NPC_TANK_DEVICE_TOOL_ALLOWLIST.map((name) => {
    const inputSchema = npcFixtureInputSchema(name);
    const contract = { name, inputSchema };
    return {
      name,
      description: `Captured-contract regression fixture for ${name}.`,
      inputSchema,
      capturedAt,
      schemaHash: capturedToolSchemaHash(contract),
    };
  });
}

/** Backward-compatible test-fixture name; its inventory is the real captured inventory. */
export const mockNpcTankToolContracts = npcTankCapturedToolContractsFixture;

export const NPC_TANK_DEVICE_PROFILE: DeviceMcpProfile<NpcTankDeviceToolName> = {
  clientName: "sdar-npc-tank-adapter",
  errorPrefix: "NPC_TANK",
  mockServerName: "captured-npc-tank-contract-fixture",
  isAllowed: isAllowedNpcTankDeviceTool,
  mockContracts: npcTankCapturedToolContractsFixture,
  resilientCalls: true,
  isMutating: isMutatingNpcTankDeviceTool,
  validateResult: validateNpcTankToolResult,
  mockResult: mockNpcTankResult,
  contractSchemaHash: capturedToolSchemaHash,
};

export type NpcTankDeviceMcpClient = VehicleDeviceMcpClient<NpcTankDeviceToolName>;

export class StreamableHttpNpcTankDeviceMcpClient extends StreamableHttpVehicleDeviceMcpClient<NpcTankDeviceToolName> {
  constructor(
    options: ConstructorParameters<
      typeof StreamableHttpVehicleDeviceMcpClient<NpcTankDeviceToolName>
    >[0],
    store: ProviderStore,
  ) {
    super(options, store, NPC_TANK_DEVICE_PROFILE);
  }
}

export class MockNpcTankDeviceMcpClient extends MockVehicleDeviceMcpClient<NpcTankDeviceToolName> {
  constructor(available = new Set<NpcTankDeviceToolName>(NPC_TANK_DEVICE_TOOL_ALLOWLIST)) {
    super(NPC_TANK_DEVICE_PROFILE, available);
  }
}

export interface NpcNavigationToolSelection {
  selected?: "npc_tank_path_follow_mission";
  primaryValid: boolean;
  /** Retained in the report shape to make removal of the old fallback explicit. */
  fallbackValid: false;
  reasonCode: string;
  contractHash: string;
}

export function selectNpcNavigationTool(
  contracts: readonly CapturedToolContract[],
): NpcNavigationToolSelection {
  const primaryValid = validObjectTool(contracts, "npc_tank_path_follow_mission");
  const relevant = contracts
    .filter((contract) => contract.name === "npc_tank_path_follow_mission")
    .map(({ name, schemaHash }) => ({ name, schemaHash }));
  return {
    ...(primaryValid ? { selected: "npc_tank_path_follow_mission" as const } : {}),
    primaryValid,
    fallbackValid: false,
    reasonCode: primaryValid
      ? "NPC_TANK_NAVIGATION_PRIMARY_SELECTED"
      : "NPC_TANK_NAVIGATION_TOOL_UNAVAILABLE",
    contractHash: createHash("sha256").update(canonical(relevant)).digest("hex"),
  };
}

export function npcCircularScanSupported(contracts: readonly CapturedToolContract[]): boolean {
  return (
    hasInputProperty(contracts, "npc_tank_area_recon_configure", "scan_mode") &&
    hasInputProperty(contracts, "npc_tank_area_recon_control", "cmd_type")
  );
}

export const NPC_OPERATION_REQUIRED_TOOLS: Record<string, NpcTankDeviceToolName[]> = {
  vehicle_get_state: ["get_status"],
  vehicle_get_capabilities: ["npc_tank_get_capabilities"],
  vehicle_get_payload_status: ["npc_tank_area_recon_get_status"],
  vehicle_get_targets: ["npc_tank_area_recon_get_targets"],
  vehicle_laser_range: [],
  vehicle_navigate: [
    "npc_tank_path_follow_mission",
    "npc_tank_return_home",
    "npc_tank_move_distance",
    "npc_tank_mission_control",
  ],
  vehicle_area_recon: [
    "npc_tank_area_recon_configure",
    "npc_tank_area_recon_control",
    "npc_tank_area_recon_get_status",
  ],
  vehicle_track_target: ["npc_tank_area_recon_lock", "npc_tank_area_recon_get_status"],
  vehicle_control_gimbal: ["npc_tank_gimbal_move"],
  vehicle_fire_weapon: ["npc_tank_area_recon_attack_confirm"],
  vehicle_emergency_stop: [
    "npc_tank_motion_stop",
    "npc_tank_mission_control",
    "npc_tank_area_recon_control",
    "npc_tank_area_recon_lock",
  ],
};

export type NpcTankOperationPhase = "start" | "pause" | "resume" | "cancel" | "read";

export function requiredNpcTankDeviceTools(
  operationName: string,
  argumentsValue: Record<string, unknown> = {},
  phase: NpcTankOperationPhase = "start",
): NpcTankDeviceToolName[] {
  if (operationName === "vehicle_navigate") {
    if (phase !== "start") return ["npc_tank_mission_control"];
    const mission = object(argumentsValue.mission);
    const submitTool =
      mission?.type === "distance"
        ? "npc_tank_move_distance"
        : mission?.type === "return_home"
          ? "npc_tank_return_home"
          : "npc_tank_path_follow_mission";
    return [submitTool, "npc_tank_mission_control"];
  }
  if (operationName === "vehicle_area_recon")
    return phase === "start"
      ? [
          "npc_tank_area_recon_configure",
          "npc_tank_area_recon_control",
          "npc_tank_area_recon_get_status",
        ]
      : ["npc_tank_area_recon_control"];
  if (operationName === "vehicle_track_target") return ["npc_tank_area_recon_lock"];
  if (operationName === "vehicle_control_gimbal") return ["npc_tank_gimbal_move"];
  return [...(NPC_OPERATION_REQUIRED_TOOLS[operationName] ?? [])];
}

export interface NpcTankDeviceToolCall {
  name: NpcTankDeviceToolName;
  arguments: Record<string, unknown>;
}

export type NpcTankDeviceInvoker = (
  name: NpcTankDeviceToolName,
  argumentsValue: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export interface ExecuteNpcTankStartFlowOptions {
  /** Called before a dependent start mutation is dispatched. */
  onMissionId?: (canonicalMissionId: string, numericMissionId: number) => void | Promise<void>;
  delay?: (durationMs: number) => Promise<void>;
}

export interface NpcTankStartFlowResult {
  calls: NpcTankDeviceToolCall[];
  results: Record<string, unknown>[];
  missionIds: number[];
  canonicalMissionIds: string[];
}

export async function executeNpcTankStartFlow(
  operationName: string,
  argumentsValue: Record<string, unknown>,
  invoke: NpcTankDeviceInvoker,
  options: ExecuteNpcTankStartFlowOptions = {},
): Promise<NpcTankStartFlowResult> {
  const calls: NpcTankDeviceToolCall[] = [];
  const results: Record<string, unknown>[] = [];
  const missionIds: number[] = [];

  const run = async (
    call: NpcTankDeviceToolCall,
    persistMissionId = true,
  ): Promise<Record<string, unknown>> => {
    calls.push(structuredClone(call));
    const result = validateNpcTankToolResult(
      call.name,
      await invoke(call.name, structuredClone(call.arguments)),
      call.arguments,
    );
    results.push(structuredClone(result));
    const missionId = missionIdFromNpcTankResult(call.name, result);
    if (
      persistMissionId &&
      missionId !== undefined &&
      missionId >= 0 &&
      !missionIds.includes(missionId)
    ) {
      missionIds.push(missionId);
      await options.onMissionId?.(canonicalNpcTankMissionId(missionId), missionId);
    }
    return result;
  };

  const initialCalls = npcStartDeviceCalls(
    operationName,
    argumentsValue,
    authoritativeNavigationSelection(),
    true,
  );
  if (operationName === "vehicle_navigate" || operationName === "vehicle_area_recon") {
    const initial = required(initialCalls[0], "NPC_TANK_INITIAL_DEVICE_CALL_REQUIRED");
    const initialResult = await run(initial);
    const missionId = required(
      missionIdFromNpcTankResult(initial.name, initialResult),
      "NPC_TANK_DEVICE_MISSION_ID_REQUIRED",
    );
    await run(buildNpcTankStartFollowupCall(operationName, missionId), false);
  } else if (operationName === "vehicle_emergency_stop") {
    let firstError: Error | undefined;
    for (const call of initialCalls)
      try {
        await run(call, false);
      } catch (error) {
        firstError ??= error instanceof Error ? error : new Error("NPC_TANK_DEVICE_CALL_FAILED");
      }
    if (firstError !== undefined) throw firstError;
  } else {
    for (const call of initialCalls) await run(call);
  }

  if (operationName === "vehicle_control_gimbal" && argumentsValue.mode === "velocity") {
    const missionId = required(missionIds[0], "NPC_TANK_DEVICE_MISSION_ID_REQUIRED");
    const durationMs = boundedDuration(argumentsValue.durationMs);
    await (options.delay ?? defaultDelay)(durationMs);
    await run(buildNpcTankGimbalStopCall(missionId), false);
  }

  return {
    calls,
    results,
    missionIds,
    canonicalMissionIds: missionIds.map(canonicalNpcTankMissionId),
  };
}

export function npcStartDeviceCalls(
  operationName: string,
  argumentsValue: Record<string, unknown>,
  navigation: NpcNavigationToolSelection = authoritativeNavigationSelection(),
  circularScanSupported = true,
): NpcTankDeviceToolCall[] {
  return withNpcErrors(() => {
    if (
      operationName === "vehicle_navigate" &&
      isPointOrRoute(argumentsValue) &&
      navigation.selected !== "npc_tank_path_follow_mission"
    )
      throw new Error("NPC_TANK_NAVIGATION_TOOL_UNAVAILABLE");
    if (
      operationName === "vehicle_area_recon" &&
      argumentsValue.scanMode === "circular" &&
      !circularScanSupported
    )
      throw new Error("NPC_TANK_CIRCULAR_SCAN_UNSUPPORTED");
    if (
      operationName === "vehicle_control_gimbal" &&
      argumentsValue.mode === "velocity" &&
      argumentsValue.pitchSpeed !== undefined &&
      argumentsValue.pitchSpeed !== 0
    )
      throw new Error("NPC_TANK_GIMBAL_VELOCITY_PITCH_UNSUPPORTED");

    const normalizedArguments = npcTankArguments(operationName, argumentsValue);
    return ugvStartDeviceCalls(operationName, normalizedArguments).map((call) => {
      const mapped = translateUgvCall(call);
      if (mapped.name === "npc_tank_gimbal_move" && normalizedArguments.pitchSpeed === undefined)
        mapped.arguments.pitch_speed = 0;
      return mapped;
    });
  });
}

export function buildNpcTankStartFollowupCall(
  operationName: string,
  missionId: number | string,
): NpcTankDeviceToolCall {
  return withNpcErrors(() =>
    translateUgvCall(buildUgvStartFollowupCall(operationName, parseNpcTankMissionId(missionId))),
  );
}

export function npcControlDeviceCalls(
  operationName: string,
  command: "pause" | "resume" | "cancel",
  persistedMissionId?: number | string | boolean,
): NpcTankDeviceToolCall[] {
  return withNpcErrors(() => {
    if (typeof persistedMissionId === "boolean")
      throw new Error("NPC_TANK_PERSISTED_MISSION_ID_REQUIRED");
    const missionId = required(persistedMissionId, "NPC_TANK_PERSISTED_MISSION_ID_REQUIRED");
    return ugvControlDeviceCalls(operationName, command, parseNpcTankMissionId(missionId)).map(
      translateUgvCall,
    );
  });
}

export function buildNpcTankEmergencyStopCalls(
  input: { chassisMissionId?: number | string; reconMissionId?: number | string } = {},
): NpcTankDeviceToolCall[] {
  return withNpcErrors(() => buildUgvEmergencyStopCalls(input).map(translateUgvCall));
}

export function buildNpcTankTargetLockCall(
  lock: boolean,
  targetId: number | string,
  missionId: number | string = 0,
): NpcTankDeviceToolCall {
  return withNpcErrors(() => translateUgvCall(buildUgvTargetLockCall(lock, targetId, missionId)));
}

export function buildNpcTankGimbalStopCall(missionId: number | string): NpcTankDeviceToolCall {
  const call = withNpcErrors(() => translateUgvCall(buildUgvGimbalStopCall(missionId)));
  call.arguments.pitch_speed = 0;
  return call;
}

export function buildNpcTankAttackConfirmationCall(
  confirm: 1 | 2,
  missionId: number | string,
): NpcTankDeviceToolCall {
  return withNpcErrors(() => translateUgvCall(buildUgvAttackConfirmationCall(confirm, missionId)));
}

/** Target selection belongs to the prior lock call; confirmation carries only mission identity. */
export function npcFireConfirmationCalls(
  _targetId: string,
  persistedMissionId: number | string = 0,
): NpcTankDeviceToolCall[] {
  return [buildNpcTankAttackConfirmationCall(1, persistedMissionId)];
}

function translateUgvCall(call: UgvDeviceToolCall): NpcTankDeviceToolCall {
  const name = UGV_TO_NPC_TOOL[call.name];
  if (name === undefined) throw new Error("NPC_TANK_DEVICE_TOOL_NOT_CAPTURED");
  return { name, arguments: structuredClone(call.arguments) };
}

const UGV_TO_NPC_TOOL: Partial<Record<UgvDeviceToolName, NpcTankDeviceToolName>> = {
  ugv_path_follow_mission: "npc_tank_path_follow_mission",
  ugv_return_home: "npc_tank_return_home",
  ugv_move_distance: "npc_tank_move_distance",
  ugv_mission_control: "npc_tank_mission_control",
  ugv_motion_stop: "npc_tank_motion_stop",
  get_status: "get_status",
  get_capabilities: "npc_tank_get_capabilities",
  ugv_area_recon_configure: "npc_tank_area_recon_configure",
  ugv_area_recon_control: "npc_tank_area_recon_control",
  ugv_area_recon_lock: "npc_tank_area_recon_lock",
  ugv_area_recon_get_status: "npc_tank_area_recon_get_status",
  ugv_area_recon_get_targets: "npc_tank_area_recon_get_targets",
  ugv_area_recon_reset: "npc_tank_area_recon_reset",
  ugv_area_recon_attack_confirm: "npc_tank_area_recon_attack_confirm",
  ugv_gimbal_move: "npc_tank_gimbal_move",
};

function npcTankArguments(
  operationName: string,
  argumentsValue: Record<string, unknown>,
): Record<string, unknown> {
  if (operationName !== "vehicle_navigate" || !isPointOrRoute(argumentsValue))
    return argumentsValue;
  if (argumentsValue.needPlan !== undefined || argumentsValue.planningMode !== undefined)
    return argumentsValue;
  return { ...argumentsValue, needPlan: false };
}

function isPointOrRoute(argumentsValue: Record<string, unknown>): boolean {
  const mission = object(argumentsValue.mission);
  return mission?.type === "point" || mission?.type === "route";
}

function authoritativeNavigationSelection(): NpcNavigationToolSelection {
  return {
    selected: "npc_tank_path_follow_mission",
    primaryValid: true,
    fallbackValid: false,
    reasonCode: "NPC_TANK_NAVIGATION_PRIMARY_SELECTED",
    contractHash: "runtime-contract-authority",
  };
}

function validObjectTool(contracts: readonly CapturedToolContract[], name: string): boolean {
  const contract = contracts.find((candidate) => candidate.name === name);
  return (
    contract !== undefined &&
    isAllowedNpcTankDeviceTool(contract.name) &&
    contract.inputSchema.type === "object"
  );
}

function hasInputProperty(
  contracts: readonly CapturedToolContract[],
  toolName: string,
  propertyName: string,
): boolean {
  const contract = contracts.find((candidate) => candidate.name === toolName);
  const properties = object(contract?.inputSchema.properties);
  return (
    validObjectTool(contracts, toolName) && properties !== undefined && propertyName in properties
  );
}

function npcFixtureInputSchema(name: NpcTankDeviceToolName): Record<string, unknown> {
  const missionId = { type: "integer", minimum: 0, default: 0 };
  if (name === "npc_tank_path_follow_mission")
    return schema({
      task_points: {
        type: ["array", "null"],
        items: {
          type: "object",
          properties: {
            longitude: { type: "number", minimum: -180, maximum: 180 },
            latitude: { type: "number", minimum: -90, maximum: 90 },
            altitude: { type: "number" },
          },
          required: ["longitude", "latitude"],
          additionalProperties: false,
        },
        default: null,
      },
      json_url: { type: "string", default: "" },
      need_plan: { type: "boolean", default: false },
      density: {
        type: "string",
        enum: ["adaptive", "dense", "medium", "sparse"],
        default: "adaptive",
      },
      mission_id: missionId,
    });
  if (name === "npc_tank_return_home") return schema({ mission_id: missionId });
  if (name === "npc_tank_move_distance")
    return schema(
      {
        direction: {
          type: "string",
          enum: ["forward", "back", "left", "right", "前", "后", "左", "右"],
        },
        distance: { type: "number", exclusiveMinimum: 0 },
        mission_id: missionId,
      },
      ["direction", "distance"],
    );
  if (name === "npc_tank_mission_control")
    return schema(
      {
        action: { type: "string", enum: ["start", "pause", "terminate"] },
        mission_id: missionId,
      },
      ["action"],
    );
  if (name === "npc_tank_area_recon_configure")
    return schema({
      region_points: { type: ["array", "null"], items: { type: "object" }, default: null },
      region_type: { type: "integer", enum: [2, 3, 4, 5], default: 5 },
      target_types: { type: ["array", "null"], items: { type: "integer" }, default: null },
      scan_num: { type: "integer", minimum: 0, default: 0 },
      lock_duration_limit: { type: "integer", minimum: 0, default: 0 },
      recon_type: { type: "integer", enum: [1, 2, 3, 4], default: 1 },
      scan_speed: { type: "number", exclusiveMinimum: 0, default: 30 },
      scan_mode: { type: "integer", enum: [1, 2], default: 1 },
      scan_pitch: { type: "number", default: 0 },
      mission_id: missionId,
    });
  if (name === "npc_tank_area_recon_control")
    return schema({ cmd_type: { type: "integer", enum: [1, 2, 3, 4] }, mission_id: missionId }, [
      "cmd_type",
    ]);
  if (name === "npc_tank_area_recon_lock")
    return schema(
      {
        lock: { type: "boolean" },
        target_id: { type: "integer", minimum: 0, default: 0 },
        mission_id: missionId,
      },
      ["lock"],
    );
  if (name === "npc_tank_area_recon_reset") return schema({ mission_id: missionId });
  if (name === "npc_tank_area_recon_attack_confirm")
    return schema({ confirm: { type: "integer", enum: [1, 2] }, mission_id: missionId }, [
      "confirm",
    ]);
  if (name === "npc_tank_gimbal_move")
    return schema(
      {
        mode: { type: "string", enum: ["absolute", "relative", "velocity", "reset"] },
        yaw: { type: "number", default: 0 },
        pitch: { type: "number", default: 0 },
        yaw_speed: { type: "number", default: 30 },
        pitch_speed: { type: "number", default: 0 },
        delta_zoom: { type: "number", default: 0 },
        mission_id: missionId,
      },
      ["mode"],
    );
  return schema({});
}

function mockNpcTankResult(
  name: NpcTankDeviceToolName,
  argumentsValue: Record<string, unknown>,
): Record<string, unknown> {
  if (name === "get_status") return { available: true };
  if (name === "npc_tank_get_capabilities") return {};
  if (name === "npc_tank_area_recon_get_status")
    return {
      status: 1,
      status_label: "idle",
      scan_mode: 1,
      out_of_range: false,
      camera_fault: false,
      progress: 0,
      online: true,
      lock: { stage: 1, target_id: 0 },
      attack_ready: false,
    };
  if (name === "npc_tank_area_recon_get_targets") return { targets: [] };
  const requested = argumentsValue.mission_id;
  const missionId =
    typeof requested === "number" && Number.isSafeInteger(requested) ? requested || 1 : 1;
  const common = {
    mission_id: missionId,
    state: name === "npc_tank_mission_control" && argumentsValue.action === "start" ? 1 : 0,
    state_label: "accepted",
    message: "accepted",
    error_code: 0,
  };
  if (name === "npc_tank_motion_stop")
    return { ...common, mission_id: requested === undefined ? -1 : missionId, state: 3 };
  if (name === "npc_tank_area_recon_configure") return { ...common, res: true, fail_data: "" };
  if (
    name === "npc_tank_area_recon_control" ||
    name === "npc_tank_area_recon_lock" ||
    name === "npc_tank_area_recon_reset" ||
    name === "npc_tank_area_recon_attack_confirm"
  )
    return { ...common, cmd_res: 0, fail_data: "" };
  return common;
}

function schema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

function boundedDuration(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 60_000)
    throw new Error("NPC_TANK_GIMBAL_DURATION_INVALID");
  return value;
}

function defaultDelay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function withNpcErrors<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("UGV_"))
      throw new Error(error.message.replace(/^UGV_/, "NPC_TANK_"), { cause: error });
    throw error;
  }
}

function required<T>(value: T | undefined, errorCode: string): T {
  if (value === undefined) throw new Error(errorCode);
  return value;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
