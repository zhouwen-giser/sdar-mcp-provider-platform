import { createHash } from "node:crypto";
import type { ProviderStore } from "../../provider-adapter-kit/src/index.js";
import {
  MockVehicleDeviceMcpClient,
  StreamableHttpVehicleDeviceMcpClient,
  type DeviceMcpProfile,
  type VehicleDeviceMcpClient,
} from "./client.js";
import type { CapturedToolContract } from "./fixtures.js";

export const NPC_TANK_DEVICE_TOOL_ALLOWLIST = [
  "npc_tank_send_waypoints",
  "npc_tank_path_follow_mission",
  "npc_tank_move_distance",
  "npc_tank_return_home",
  "npc_tank_mission_control",
  "npc_tank_stop",
  "npc_tank_cancel_mission",
  "npc_tank_attack_target",
  "npc_tank_area_recon_configure",
  "npc_tank_area_recon_lock",
  "npc_tank_area_recon_unlock",
  "npc_tank_gimbal_move",
  "npc_tank_area_recon_attack_confirm",
  "npc_tank_area_recon_control",
  "npc_tank_area_recon_reset",
  "npc_tank_area_recon_get_status",
  "npc_tank_area_recon_get_targets",
  "npc_tank_area_recon_get_exceptions",
  "npc_tank_laser_range",
  "npc_tank_eo_scan_start",
  "npc_tank_eo_scan_stop",
  "npc_tank_eo_set_angle",
  "npc_tank_get_capabilities",
] as const;

export type NpcTankDeviceToolName = (typeof NPC_TANK_DEVICE_TOOL_ALLOWLIST)[number];
const ALLOWED = new Set<string>(NPC_TANK_DEVICE_TOOL_ALLOWLIST);

export function isAllowedNpcTankDeviceTool(name: string): name is NpcTankDeviceToolName {
  return ALLOWED.has(name);
}

export function mockNpcTankToolContracts(
  capturedAt = new Date().toISOString(),
): CapturedToolContract[] {
  return NPC_TANK_DEVICE_TOOL_ALLOWLIST.map((name) => {
    const inputSchema = npcFixtureSchema(name);
    return {
      name,
      description: `Mock-only NPC Tank contract fixture for ${name}.`,
      inputSchema,
      capturedAt,
      schemaHash: createHash("sha256").update(canonical(inputSchema)).digest("hex"),
    };
  });
}

export const NPC_TANK_DEVICE_PROFILE: DeviceMcpProfile<NpcTankDeviceToolName> = {
  clientName: "sdar-npc-tank-adapter",
  errorPrefix: "NPC_TANK",
  mockServerName: "mock-npc-tank-device-mcp",
  isAllowed: isAllowedNpcTankDeviceTool,
  mockContracts: mockNpcTankToolContracts,
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
  constructor(
    available = new Set<NpcTankDeviceToolName>(
      mockNpcTankToolContracts().map((contract) => contract.name as NpcTankDeviceToolName),
    ),
  ) {
    super(NPC_TANK_DEVICE_PROFILE, available);
  }
}

export interface NpcNavigationToolSelection {
  selected?: "npc_tank_path_follow_mission" | "npc_tank_send_waypoints";
  primaryValid: boolean;
  fallbackValid: boolean;
  reasonCode: string;
  contractHash: string;
}

export function selectNpcNavigationTool(
  contracts: readonly CapturedToolContract[],
): NpcNavigationToolSelection {
  const primary = validObjectTool(contracts, "npc_tank_path_follow_mission");
  const fallback = validObjectTool(contracts, "npc_tank_send_waypoints");
  const selected = primary
    ? ("npc_tank_path_follow_mission" as const)
    : fallback
      ? ("npc_tank_send_waypoints" as const)
      : undefined;
  return {
    ...(selected === undefined ? {} : { selected }),
    primaryValid: primary,
    fallbackValid: fallback,
    reasonCode:
      selected === "npc_tank_path_follow_mission"
        ? "NPC_TANK_NAVIGATION_PRIMARY_SELECTED"
        : selected === "npc_tank_send_waypoints"
          ? "NPC_TANK_NAVIGATION_FALLBACK_SELECTED"
          : "NPC_TANK_NAVIGATION_TOOL_UNAVAILABLE",
    contractHash: createHash("sha256")
      .update(
        canonical(
          contracts
            .filter((contract) =>
              ["npc_tank_path_follow_mission", "npc_tank_send_waypoints"].includes(contract.name),
            )
            .map(({ name, schemaHash }) => ({ name, schemaHash })),
        ),
      )
      .digest("hex"),
  };
}

export function npcCircularScanSupported(contracts: readonly CapturedToolContract[]): boolean {
  return ["npc_tank_eo_scan_start", "npc_tank_eo_scan_stop", "npc_tank_eo_set_angle"].every(
    (name) => validObjectTool(contracts, name),
  );
}

export const NPC_OPERATION_REQUIRED_TOOLS: Record<string, NpcTankDeviceToolName[]> = {
  vehicle_get_state: [],
  vehicle_get_payload_status: [
    "npc_tank_area_recon_get_status",
    "npc_tank_area_recon_get_exceptions",
  ],
  vehicle_get_targets: ["npc_tank_area_recon_get_targets"],
  vehicle_laser_range: ["npc_tank_laser_range"],
  vehicle_navigate: [
    "npc_tank_move_distance",
    "npc_tank_return_home",
    "npc_tank_mission_control",
    "npc_tank_stop",
    "npc_tank_cancel_mission",
  ],
  vehicle_area_recon: [
    "npc_tank_area_recon_configure",
    "npc_tank_area_recon_control",
    "npc_tank_area_recon_get_status",
    "npc_tank_area_recon_get_targets",
    "npc_tank_area_recon_get_exceptions",
  ],
  vehicle_track_target: [
    "npc_tank_gimbal_move",
    "npc_tank_area_recon_lock",
    "npc_tank_area_recon_unlock",
    "npc_tank_area_recon_get_status",
  ],
  vehicle_fire_weapon: ["npc_tank_attack_target", "npc_tank_area_recon_attack_confirm"],
  vehicle_emergency_stop: [
    "npc_tank_stop",
    "npc_tank_cancel_mission",
    "npc_tank_mission_control",
    "npc_tank_area_recon_control",
    "npc_tank_area_recon_unlock",
  ],
};

export interface NpcTankDeviceToolCall {
  name: NpcTankDeviceToolName;
  arguments: Record<string, unknown>;
}

export function npcStartDeviceCalls(
  operationName: string,
  argumentsValue: Record<string, unknown>,
  navigation: NpcNavigationToolSelection,
  circularScanSupported: boolean,
): NpcTankDeviceToolCall[] {
  if (operationName === "vehicle_navigate") return npcNavigate(argumentsValue, navigation);
  if (operationName === "vehicle_area_recon") {
    if (argumentsValue.scanMode === "circular") {
      if (!circularScanSupported) throw new Error("NPC_TANK_CIRCULAR_SCAN_UNSUPPORTED");
      return [
        {
          name: "npc_tank_eo_set_angle",
          arguments: {
            angle: finite(argumentsValue.angle, 0),
            angle_unit: enumValue(argumentsValue.angleUnit ?? "deg", ["rad", "deg"]),
          },
        },
        {
          name: "npc_tank_eo_scan_start",
          arguments: { mode: "circular", zoom: positive(argumentsValue.zoom, 1) },
        },
      ];
    }
    return [
      {
        name: "npc_tank_area_recon_configure",
        arguments: {
          area: area(argumentsValue.area),
          scan_mode: enumValue(argumentsValue.scanMode ?? "area", ["area", "sector"]),
          scan_count: integer(argumentsValue.scanCount, 1),
          zoom: positive(argumentsValue.zoom, 1),
          stop_on_target: argumentsValue.stopOnTarget === true,
          target_types: strings(argumentsValue.targetTypes),
        },
      },
      { name: "npc_tank_area_recon_control", arguments: { command: 1 } },
    ];
  }
  if (operationName === "vehicle_track_target")
    return [
      {
        name: "npc_tank_gimbal_move",
        arguments: {
          mode: "absolute",
          yaw: 0,
          pitch: 0,
          angle_unit: "deg",
          ...(typeof argumentsValue.desiredZoom === "number"
            ? { zoom: argumentsValue.desiredZoom }
            : {}),
        },
      },
      {
        name: "npc_tank_area_recon_lock",
        arguments: { target_id: text(argumentsValue.targetId) },
      },
    ];
  if (operationName === "vehicle_emergency_stop")
    return [
      { name: "npc_tank_stop", arguments: {} },
      { name: "npc_tank_cancel_mission", arguments: {} },
      { name: "npc_tank_mission_control", arguments: { action: "terminate" } },
      { name: "npc_tank_area_recon_control", arguments: { command: 4 } },
      { name: "npc_tank_area_recon_unlock", arguments: {} },
    ];
  return [];
}

export function npcControlDeviceCalls(
  operationName: string,
  command: "pause" | "resume" | "cancel",
  circular = false,
): NpcTankDeviceToolCall[] {
  if (operationName === "vehicle_navigate")
    return [
      {
        name: "npc_tank_mission_control",
        arguments: { action: command === "cancel" ? "terminate" : command },
      },
      ...(command === "cancel"
        ? [
            { name: "npc_tank_cancel_mission" as const, arguments: {} },
            { name: "npc_tank_stop" as const, arguments: {} },
          ]
        : []),
    ];
  if (operationName === "vehicle_area_recon") {
    if (circular)
      return [
        {
          name:
            command === "resume"
              ? ("npc_tank_eo_scan_start" as const)
              : ("npc_tank_eo_scan_stop" as const),
          arguments: command === "resume" ? { mode: "circular" } : {},
        },
      ];
    return [
      {
        name: "npc_tank_area_recon_control",
        arguments: { command: command === "pause" ? 2 : command === "resume" ? 3 : 4 },
      },
    ];
  }
  if (
    (operationName === "vehicle_track_target" || operationName === "vehicle_fire_weapon") &&
    command === "cancel"
  )
    return [{ name: "npc_tank_area_recon_unlock", arguments: {} }];
  return [];
}

export function npcFireConfirmationCalls(targetId: string): NpcTankDeviceToolCall[] {
  return [
    { name: "npc_tank_attack_target", arguments: { target_id: targetId } },
    {
      name: "npc_tank_area_recon_attack_confirm",
      arguments: { target_id: targetId, confirmed: true },
    },
  ];
}

function npcNavigate(
  argumentsValue: Record<string, unknown>,
  selection: NpcNavigationToolSelection,
): NpcTankDeviceToolCall[] {
  if (!object(argumentsValue.mission)) throw new Error("NPC_TANK_NAVIGATION_MISSION_INVALID");
  const mission = argumentsValue.mission;
  if (mission.type === "return_home") return [{ name: "npc_tank_return_home", arguments: {} }];
  if (mission.type === "distance")
    return [
      {
        name: "npc_tank_move_distance",
        arguments: {
          direction: enumValue(mission.direction, ["forward", "backward", "left", "right"]),
          distance_m: positive(mission.distanceM),
        },
      },
    ];
  if (selection.selected === undefined) throw new Error("NPC_TANK_NAVIGATION_TOOL_UNAVAILABLE");
  const rawWaypoints = mission.type === "point" ? [mission.target] : mission.waypoints;
  if (!Array.isArray(rawWaypoints) || rawWaypoints.length === 0)
    throw new Error("NPC_TANK_NAVIGATION_WAYPOINTS_INVALID");
  const waypoints = rawWaypoints.map((value) => {
    if (!object(value)) throw new Error("NPC_TANK_NAVIGATION_WAYPOINT_INVALID");
    return {
      latitude: latitude(value.latitude),
      longitude: longitude(value.longitude),
      altitude: finite(value.altitude, 0),
    };
  });
  return [
    {
      name: selection.selected,
      arguments: {
        waypoints,
        speed_limit_kmh: positive(argumentsValue.speedLimitKmh, 20),
        stop_on_obstacle: argumentsValue.stopOnObstacle !== false,
      },
    },
  ];
}

function npcFixtureSchema(name: NpcTankDeviceToolName): Record<string, unknown> {
  const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false,
  });
  if (name === "npc_tank_path_follow_mission" || name === "npc_tank_send_waypoints")
    return schema(
      {
        waypoints: { type: "array", minItems: 1, items: { type: "object" } },
        speed_limit_kmh: { type: "number", exclusiveMinimum: 0 },
        stop_on_obstacle: { type: "boolean" },
      },
      ["waypoints", "speed_limit_kmh", "stop_on_obstacle"],
    );
  if (name === "npc_tank_move_distance")
    return schema(
      {
        direction: { type: "string", enum: ["forward", "backward", "left", "right"] },
        distance_m: { type: "number", exclusiveMinimum: 0 },
      },
      ["direction", "distance_m"],
    );
  if (name === "npc_tank_mission_control")
    return schema(
      {
        action: {
          type: "string",
          enum: ["start", "pause", "resume", "terminate", "cancel", "stop"],
        },
      },
      ["action"],
    );
  if (name === "npc_tank_area_recon_configure")
    return schema(
      {
        area: { type: "object" },
        scan_mode: { type: "string", enum: ["area", "sector"] },
        scan_count: { type: "integer", minimum: 1 },
        zoom: { type: "number", exclusiveMinimum: 0 },
        stop_on_target: { type: "boolean" },
        target_types: { type: "array", items: { type: "string" } },
      },
      ["area", "scan_mode", "scan_count", "zoom", "stop_on_target", "target_types"],
    );
  if (name === "npc_tank_area_recon_control")
    return schema({ command: { type: "integer", enum: [1, 2, 3, 4] } }, ["command"]);
  if (name === "npc_tank_area_recon_lock" || name === "npc_tank_attack_target")
    return schema({ target_id: { type: "string", minLength: 1 } }, ["target_id"]);
  if (name === "npc_tank_area_recon_attack_confirm")
    return schema({ target_id: { type: "string", minLength: 1 }, confirmed: { const: true } }, [
      "target_id",
      "confirmed",
    ]);
  if (name === "npc_tank_gimbal_move")
    return schema(
      {
        mode: { type: "string", enum: ["absolute", "relative", "velocity", "reset"] },
        yaw: { type: "number" },
        pitch: { type: "number" },
        angle_unit: { type: "string", enum: ["rad", "deg"] },
      },
      ["mode"],
    );
  if (name === "npc_tank_eo_set_angle")
    return schema(
      {
        angle: { type: "number" },
        angle_unit: { type: "string", enum: ["rad", "deg"] },
      },
      ["angle", "angle_unit"],
    );
  if (name === "npc_tank_eo_scan_start")
    return schema({ mode: { const: "circular" }, zoom: { type: "number", exclusiveMinimum: 0 } }, [
      "mode",
    ]);
  return schema({});
}

function validObjectTool(contracts: readonly CapturedToolContract[], name: string): boolean {
  const contract = contracts.find((candidate) => candidate.name === name);
  return (
    contract !== undefined &&
    isAllowedNpcTankDeviceTool(contract.name) &&
    contract.inputSchema.type === "object" &&
    contract.inputSchema.additionalProperties === false
  );
}
function area(value: unknown): Record<string, unknown> {
  if (!object(value) || !Array.isArray(value.polygon) || value.polygon.length < 3)
    throw new Error("NPC_TANK_RECON_AREA_INVALID");
  return {
    coordinate_frame: "WGS84",
    polygon: value.polygon.map((point) => {
      if (!object(point)) throw new Error("NPC_TANK_RECON_POINT_INVALID");
      return { latitude: latitude(point.latitude), longitude: longitude(point.longitude) };
    }),
  };
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("NPC_TANK_TEXT_INVALID");
  return value;
}
function finite(value: unknown, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("NPC_TANK_NUMBER_INVALID");
  return value;
}
function positive(value: unknown, fallback?: number): number {
  const parsed = finite(value, fallback);
  if (parsed <= 0) throw new Error("NPC_TANK_POSITIVE_NUMBER_REQUIRED");
  return parsed;
}
function integer(value: unknown, fallback?: number): number {
  const parsed = positive(value, fallback);
  if (!Number.isInteger(parsed)) throw new Error("NPC_TANK_INTEGER_REQUIRED");
  return parsed;
}
function latitude(value: unknown): number {
  const parsed = finite(value);
  if (parsed < -90 || parsed > 90) throw new Error("NPC_TANK_LATITUDE_INVALID");
  return parsed;
}
function longitude(value: unknown): number {
  const parsed = finite(value);
  if (parsed < -180 || parsed > 180) throw new Error("NPC_TANK_LONGITUDE_INVALID");
  return parsed;
}
function strings(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error("NPC_TANK_STRING_ARRAY_INVALID");
  return value as string[];
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T))
    throw new Error("NPC_TANK_ENUM_INVALID");
  return value as T;
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
