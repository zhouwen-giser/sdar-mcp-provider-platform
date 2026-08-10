import type { CapturedToolContract } from "../../../packages/vehicle-device-mcp-client/src/index.js";

export function normalizeUgvCapabilities(
  result: Record<string, unknown>,
  contracts: readonly CapturedToolContract[],
  observedAt = new Date().toISOString(),
): Record<string, unknown> {
  const tools = new Set(contracts.map((contract) => contract.name));
  const pathSchema = schemaFor(contracts, "ugv_path_follow_mission");
  const reconSchema = schemaFor(contracts, "ugv_area_recon_configure");
  const gimbalSchema = schemaFor(contracts, "ugv_gimbal_move");
  const reported = reportedCapabilities(result);
  const reportedAvailable =
    result.available === true ||
    (result.available !== false && Object.keys(reported).some((key) => key !== "available"));
  return {
    resourceId: "vehicle:ugv1",
    source: "device_mcp",
    available: reportedAvailable,
    navigation: {
      point: tools.has("ugv_path_follow_mission"),
      route: tools.has("ugv_path_follow_mission"),
      distance: tools.has("ugv_move_distance"),
      returnHome: tools.has("ugv_return_home"),
      pauseResumeCancel: tools.has("ugv_mission_control"),
      planningDensities: enumValues(pathSchema, "density"),
      supportsRoadNetworkPlanning: hasProperty(pathSchema, "need_plan"),
    },
    payload: {
      reconnaissance: {
        area: tools.has("ugv_area_recon_configure"),
        circular: enumValues(reconSchema, "scan_mode").includes(2),
        scanModes: enumValues(reconSchema, "scan_mode"),
      },
      gimbal: {
        supported: tools.has("ugv_gimbal_move"),
        modes: enumValues(gimbalSchema, "mode"),
      },
      targetTracking: tools.has("ugv_area_recon_lock"),
      laserRange: tools.has("ugv_laser_range"),
    },
    deviceReported: reported,
    observedAt,
  };
}

function reportedCapabilities(result: Record<string, unknown>): Record<string, unknown> {
  const candidate = record(result.capabilities) ? result.capabilities : result;
  return Object.fromEntries(
    Object.entries(candidate).filter(
      ([key]) => !["error_code", "message", "mission_id", "state", "state_label"].includes(key),
    ),
  );
}

function schemaFor(
  contracts: readonly CapturedToolContract[],
  name: string,
): Record<string, unknown> | undefined {
  return contracts.find((contract) => contract.name === name)?.inputSchema;
}

function hasProperty(schema: Record<string, unknown> | undefined, name: string): boolean {
  return record(schema?.properties) && Object.hasOwn(schema.properties, name);
}

function enumValues(schema: Record<string, unknown> | undefined, name: string): unknown[] {
  if (!record(schema?.properties)) return [];
  const property = schema.properties[name];
  return record(property) && Array.isArray(property.enum) ? structuredClone(property.enum) : [];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
