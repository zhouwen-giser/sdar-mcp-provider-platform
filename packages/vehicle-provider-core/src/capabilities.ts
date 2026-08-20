import { sanitizeFireResult } from "./fire-result-sanitizer.js";

export interface VehicleToolContract {
  name: string;
  inputSchema: Record<string, unknown>;
}

export interface VehicleCapabilityProfile {
  resourceId: string;
  pathFollowTool: string;
  moveDistanceTool: string;
  returnHomeTool: string;
  missionControlTool: string;
  reconConfigureTool: string;
  targetLockTool: string;
  gimbalTool: string;
  laserRangeTool?: string;
  planningDensities?: readonly string[];
  reconScanModes?: readonly number[];
  gimbalModes?: readonly string[];
  needPlanDefault?: boolean;
  movingWhileRecon?: boolean;
  continuousPitchSweep?: boolean;
  engineeringProfile?: VehicleEngineeringProfile;
}

export interface VehicleEngineeringProfile {
  provenance: {
    authority: "device_reported" | "managed_configuration" | "unconfigured";
    source: string;
    observedAt?: string;
  };
  minimumTurningRadiusM?: number | null;
  maximumGradePercent?: number | null;
  obstacleCrossingHeightM?: number | null;
  nominalDetectionRangeM?: number | null;
  physicalDimensionsM?: { length: number; width: number; height: number } | null;
}

export type VehicleCapabilityProvenance =
  "device_reported" | "contract_inferred" | "managed_configuration" | "unverified";

/**
 * Normalize simulator-reported capabilities against the captured tool
 * contract. Static claims are limited to schema properties and explicit
 * profile semantics; physical limits are never invented.
 */
export function normalizeVehicleCapabilities(
  result: Record<string, unknown>,
  contracts: readonly VehicleToolContract[],
  profile: VehicleCapabilityProfile,
  observedAt = new Date().toISOString(),
): Record<string, unknown> {
  const tools = new Set(contracts.map((contract) => contract.name));
  const pathSchema = schemaFor(contracts, profile.pathFollowTool);
  const reconSchema = schemaFor(contracts, profile.reconConfigureTool);
  const gimbalSchema = schemaFor(contracts, profile.gimbalTool);
  const reported = reportedCapabilities(result);
  const reportedAvailable =
    result.available === true ||
    (result.available !== false && Object.keys(reported).some((key) => key !== "available"));
  const planningDensities = enumValues(pathSchema, "density");
  const reconScanModes = enumValues(reconSchema, "scan_mode");
  const gimbalModes = enumValues(gimbalSchema, "mode");
  const managedOrUnverified = (configured: boolean): VehicleCapabilityProvenance =>
    configured ? "managed_configuration" : "unverified";
  return {
    resourceId: profile.resourceId,
    source: "device_mcp",
    available: reportedAvailable,
    navigation: {
      point: tools.has(profile.pathFollowTool),
      route: tools.has(profile.pathFollowTool),
      distance: tools.has(profile.moveDistanceTool),
      returnHome: tools.has(profile.returnHomeTool),
      pauseResumeCancel: tools.has(profile.missionControlTool),
      planningDensities:
        planningDensities.length > 0
          ? planningDensities
          : hasProperty(pathSchema, "density")
            ? [...(profile.planningDensities ?? [])]
            : [],
      supportsRoadNetworkPlanning: hasProperty(pathSchema, "need_plan"),
      ...(profile.needPlanDefault === undefined
        ? {}
        : { needPlanDefault: profile.needPlanDefault }),
    },
    payload: {
      reconnaissance: {
        area: tools.has(profile.reconConfigureTool),
        circular:
          tools.has(profile.reconConfigureTool) &&
          (reconScanModes.includes(2) ||
            (hasProperty(reconSchema, "scan_mode") && (profile.reconScanModes ?? []).includes(2))),
        scanModes:
          reconScanModes.length > 0
            ? reconScanModes
            : hasProperty(reconSchema, "scan_mode")
              ? [...(profile.reconScanModes ?? [])]
              : [],
        movingWhileRecon: profile.movingWhileRecon === true,
      },
      gimbal: {
        supported: tools.has(profile.gimbalTool),
        modes:
          gimbalModes.length > 0
            ? gimbalModes
            : hasProperty(gimbalSchema, "mode")
              ? [...(profile.gimbalModes ?? [])]
              : [],
        manualYawSweep: tools.has(profile.gimbalTool),
        continuousPitchSweep: profile.continuousPitchSweep === true,
      },
      targetTracking: tools.has(profile.targetLockTool),
      laserRange: profile.laserRangeTool !== undefined && tools.has(profile.laserRangeTool),
    },
    provenance: {
      available: "device_reported",
      navigation: {
        point: "contract_inferred",
        route: "contract_inferred",
        distance: "contract_inferred",
        returnHome: "contract_inferred",
        pauseResumeCancel: "contract_inferred",
        planningDensities: "contract_inferred",
        supportsRoadNetworkPlanning: "contract_inferred",
        needPlanDefault: managedOrUnverified(profile.needPlanDefault !== undefined),
      },
      payload: {
        reconnaissance: {
          area: "contract_inferred",
          circular: "contract_inferred",
          scanModes: "contract_inferred",
          movingWhileRecon: managedOrUnverified(profile.movingWhileRecon !== undefined),
        },
        gimbal: {
          supported: "contract_inferred",
          modes: "contract_inferred",
          manualYawSweep: "contract_inferred",
          continuousPitchSweep: managedOrUnverified(profile.continuousPitchSweep !== undefined),
        },
        targetTracking: "contract_inferred",
        laserRange: "contract_inferred",
      },
      deviceReported: "device_reported",
      engineeringProfile: managedOrUnverified(profile.engineeringProfile !== undefined),
    },
    deviceReported: reported,
    engineeringProfile: profile.engineeringProfile ?? {
      provenance: { authority: "unconfigured", source: "not_supplied" },
      minimumTurningRadiusM: null,
      maximumGradePercent: null,
      obstacleCrossingHeightM: null,
      nominalDetectionRangeM: null,
      physicalDimensionsM: null,
    },
    observedAt,
  };
}

function reportedCapabilities(result: Record<string, unknown>): Record<string, unknown> {
  const candidate = record(result.capabilities) ? result.capabilities : result;
  return sanitizeFireResult(
    Object.fromEntries(
      Object.entries(candidate).filter(
        ([key]) => !["error_code", "message", "mission_id", "state", "state_label"].includes(key),
      ),
    ),
  ).value as Record<string, unknown>;
}

function schemaFor(
  contracts: readonly VehicleToolContract[],
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
