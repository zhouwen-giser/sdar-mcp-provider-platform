import { ADAPTER_PROTOCOL_VERSION, jsonToProtoStruct } from "../../adapter-protocol/src/index.js";
import type { ProviderStore } from "../../provider-adapter-kit/src/index.js";
import {
  vehicleCapabilitiesV1Schema,
  vehicleStateV1Schema,
  vehicleTaskResultV1Schema,
} from "./dto-schemas.js";

export interface VehicleManifestProfile {
  providerId: string;
  providerType: string;
  providerVersion: string;
  resourceId: string;
  displayKind: string;
  supportsScanModes: boolean;
  supportsCircularEoScan: boolean;
  navigationSupport?: {
    point: boolean;
    route: boolean;
    distance: boolean;
    returnHome: boolean;
    pauseResumeCancel: boolean;
  };
  supportsCapabilityQuery?: boolean;
  supportsTargetTracking?: boolean;
  supportsGimbalControl?: boolean;
  supportsNavigationPlanning?: boolean;
  supportsFire?: boolean;
  supportsEmergencyStop?: boolean;
  supportsLaserRange?: boolean;
  supportsFireCancellationBeforeDispatch?: boolean;
  supportsFireCommandRejectedOutput?: boolean;
  supportsReconCoverageOutput?: boolean;
  circularScanOmitsArea?: boolean;
}

export function vehicleProviderManifest(
  profile: VehicleManifestProfile,
  store: ProviderStore,
): Record<string, unknown> {
  const resourceId = { type: "string", const: profile.resourceId };
  const binding = { mode: "ARGUMENT_REFERENCE", resourceIdJsonPointer: "/resourceId" };
  const caps = (
    scheduling: boolean,
    maxElapsed: boolean,
    cancel: boolean,
    pauseResume: boolean,
    inputRequired: boolean,
    observations: boolean,
  ) => ({
    availability: true,
    scheduling,
    maxElapsed,
    cancel,
    pauseResume,
    inputRequired,
    idempotency: true,
    observations,
  });
  const schema = (properties: Record<string, unknown>, required: string[]) =>
    jsonToProtoStruct({ type: "object", properties, required, additionalProperties: false });
  const taskOutput = (statuses: string[], optionalProperties: Record<string, unknown> = {}) =>
    jsonToProtoStruct(vehicleTaskResultV1Schema(profile.resourceId, statuses, optionalProperties));
  const nullable = (value: Record<string, unknown>) => ({
    anyOf: [value, { type: "null" }],
  });
  const navigationSupport = profile.navigationSupport ?? {
    point: true,
    route: true,
    distance: true,
    returnHome: true,
    pauseResumeCancel: true,
  };
  const supportsNavigation = Object.entries(navigationSupport)
    .filter(([name]) => name !== "pauseResumeCancel")
    .some(([, supported]) => supported);
  const supportsReconnaissance = profile.supportsScanModes || profile.supportsCircularEoScan;
  return {
    adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
    providerId: profile.providerId,
    providerType: profile.providerType,
    providerVersion: profile.providerVersion,
    inventoryMode: "RUNTIME_VISIBLE",
    businessEventSources: store.businessEventSources(),
    operations: [
      {
        name: "vehicle_get_state",
        description: `Read the normalized local ${profile.displayKind} state without referee or global-truth data.`,
        execution: "SYNCHRONOUS",
        inputSchema: schema(
          {
            resourceId,
            include: {
              type: "array",
              uniqueItems: true,
              items: { type: "string", enum: ["chassis", "payload", "health", "targets"] },
            },
          },
          ["resourceId"],
        ),
        outputSchema: jsonToProtoStruct(vehicleStateV1Schema(profile.resourceId)),
        capabilities: caps(false, false, false, false, false, false),
        resourceBinding: binding,
      },
      ...(profile.supportsCapabilityQuery === true
        ? [
            {
              name: "vehicle_get_capabilities",
              description: `Read device-reported ${profile.displayKind} capability facts without inventing unsupported limits.`,
              execution: "SYNCHRONOUS",
              inputSchema: schema({ resourceId }, ["resourceId"]),
              outputSchema: jsonToProtoStruct(vehicleCapabilitiesV1Schema(profile.resourceId)),
              capabilities: caps(false, false, false, false, false, false),
              resourceBinding: binding,
            },
          ]
        : []),
      {
        name: "vehicle_get_payload_status",
        description: `Read local ${profile.displayKind} payload, gimbal, laser and task status.`,
        execution: "SYNCHRONOUS",
        inputSchema: schema({ resourceId }, ["resourceId"]),
        outputSchema: jsonToProtoStruct({ type: "object", additionalProperties: true }),
        capabilities: caps(false, false, false, false, false, false),
        resourceBinding: binding,
      },
      {
        name: "vehicle_get_targets",
        description: `Read targets observed by local ${profile.displayKind} sensors only.`,
        execution: "SYNCHRONOUS",
        inputSchema: schema({ resourceId }, ["resourceId"]),
        outputSchema: schema(
          {
            resourceId,
            targets: { type: "array", items: { type: "object" } },
            freshness: { type: "object" },
            observedAt: { type: "string" },
          },
          ["resourceId", "targets", "freshness", "observedAt"],
        ),
        capabilities: caps(false, false, false, false, false, false),
        resourceBinding: binding,
      },
      ...(profile.supportsLaserRange !== false
        ? [
            {
              name: "vehicle_laser_range",
              description: "Perform a synchronous local laser-range query.",
              execution: "SYNCHRONOUS",
              inputSchema: schema({ resourceId }, ["resourceId"]),
              outputSchema: schema(
                {
                  resourceId,
                  distanceM: { type: "number", minimum: 0 },
                  valid: { type: "boolean" },
                  observedAt: { type: "string" },
                },
                ["resourceId", "distanceM", "valid", "observedAt"],
              ),
              capabilities: caps(false, false, false, false, false, false),
              resourceBinding: binding,
            },
          ]
        : []),
      ...(supportsNavigation
        ? [
            {
              name: "vehicle_navigate",
              description: "Run a point, route, distance or return-home chassis mission.",
              execution: "TASK_REQUIRED",
              inputSchema: navigationSchema(
                resourceId,
                navigationSupport,
                profile.supportsNavigationPlanning === true,
              ),
              outputSchema: taskOutput(["completed", "failed", "cancelled", "timeout"], {
                requestedDistanceM: { type: "number", minimum: 0 },
                startPosition: { type: "object", additionalProperties: true },
                endPosition: { type: "object", additionalProperties: true },
                observedDisplacementM: { type: "number", minimum: 0 },
                finalHeadingDeg: { type: "number" },
                finalSpeedKmh: { type: "number", minimum: 0 },
                missionId: nullable({ type: "string" }),
                missionState: { anyOf: [{ type: "integer" }, { type: "string" }] },
                snapshotRevision: { type: "string" },
                stationaryAtCompletion: nullable({ type: "boolean" }),
                correlationStrength: {
                  type: "string",
                  enum: ["STRICT_CORRELATED", "WEAK_UNCORRELATED", "MISMATCH", "UNKNOWN"],
                },
                observationAuthority: { type: "string" },
              }),
              capabilities: caps(
                true,
                true,
                navigationSupport.pauseResumeCancel,
                navigationSupport.pauseResumeCancel,
                false,
                true,
              ),
              resourceBinding: binding,
            },
          ]
        : []),
      ...(supportsReconnaissance
        ? [
            {
              name: "vehicle_area_recon",
              description: "Run local electro-optical reconnaissance.",
              execution: "TASK_REQUIRED",
              inputSchema: reconSchema(
                resourceId,
                profile.supportsScanModes,
                profile.supportsCircularEoScan,
                profile.circularScanOmitsArea === true,
              ),
              outputSchema: taskOutput(
                ["completed", "failed", "cancelled", "timeout"],
                profile.supportsReconCoverageOutput === true
                  ? {
                      coverability: nullable({ type: "object", additionalProperties: true }),
                      outOfRange: nullable({ type: "boolean" }),
                      missionId: nullable({ type: "string" }),
                      scanMode: nullable({ type: "number" }),
                      progress: nullable({ type: "number" }),
                      coverage: nullable({ type: "object", additionalProperties: true }),
                      observedTargetCount: { type: "integer", minimum: 0 },
                      terminalMotionStatus: {
                        anyOf: [{ type: "number" }, { type: "string" }],
                      },
                      cameraFault: nullable({ type: "boolean" }),
                      exception: nullable({ type: "object", additionalProperties: true }),
                      snapshotRevision: { type: "string" },
                      correlationStrength: {
                        type: "string",
                        enum: ["STRICT_CORRELATED", "WEAK_UNCORRELATED", "MISMATCH", "UNKNOWN"],
                      },
                      observationIsNew: { type: "boolean" },
                      timeAuthority: { type: "string" },
                    }
                  : {},
              ),
              capabilities: caps(true, true, true, true, false, true),
              resourceBinding: binding,
            },
          ]
        : []),
      ...(profile.supportsTargetTracking !== false
        ? [
            {
              name: "vehicle_track_target",
              description: "Track a locally observed target and fail locally when lock is lost.",
              execution: "TASK_REQUIRED",
              inputSchema: schema(
                {
                  resourceId,
                  targetId: { type: "string", minLength: 1, maxLength: 128 },
                },
                ["resourceId", "targetId"],
              ),
              outputSchema: taskOutput(["target_locked", "target_lost", "cancelled", "timeout"]),
              capabilities: caps(false, true, true, false, false, true),
              resourceBinding: binding,
            },
          ]
        : []),
      ...(profile.supportsGimbalControl === true
        ? [
            {
              name: "vehicle_control_gimbal",
              description:
                "Run a finite absolute, relative, or reset electro-optical gimbal adjustment.",
              execution: "TASK_REQUIRED",
              inputSchema: gimbalSchema(resourceId),
              outputSchema: taskOutput(["completed", "failed", "cancelled", "timeout"]),
              capabilities: caps(false, true, true, false, false, true),
              resourceBinding: binding,
            },
          ]
        : []),
      ...(profile.supportsFire !== false
        ? [
            {
              name: "vehicle_fire_weapon",
              description:
                "Execute one confirmed local fire-control cycle without hit, damage or destruction semantics.",
              execution: "TASK_REQUIRED",
              inputSchema: schema(
                {
                  resourceId,
                  targetId: { type: "string", minLength: 1, maxLength: 128 },
                  engagementMode: { const: "single" },
                  requireConfirmation: { const: true },
                  approvalRef: { type: "string", maxLength: 256 },
                },
                ["resourceId", "targetId", "engagementMode", "requireConfirmation"],
              ),
              outputSchema: taskOutput([
                "fire_command_accepted",
                ...(profile.supportsFireCommandRejectedOutput === true
                  ? ["fire_command_rejected"]
                  : []),
                "fire_cycle_completed",
                "target_not_found",
                "target_not_locked",
                "out_of_range",
                "out_of_fov",
                "no_ammo_reported_by_weapon",
                "weapon_fault",
                "friendly_target_rejected",
                "timeout",
                "cancelled",
              ]),
              capabilities: caps(
                false,
                true,
                profile.supportsFireCancellationBeforeDispatch !== false,
                false,
                true,
                true,
              ),
              resourceBinding: binding,
            },
          ]
        : []),
      ...(profile.supportsEmergencyStop !== false
        ? [
            {
              name: "vehicle_emergency_stop",
              description: `Preempt and stop only this ${profile.displayKind}'s local tracks.`,
              execution: "TASK_REQUIRED",
              inputSchema: schema({ resourceId }, ["resourceId"]),
              outputSchema: taskOutput(["stopped", "timeout", "failed"], {
                finalSpeedKmh: { type: "number", minimum: 0 },
                missionState: { anyOf: [{ type: "integer" }, { type: "string" }] },
                reconMotionStatus: { anyOf: [{ type: "integer" }, { type: "string" }] },
                eoTaskState: { anyOf: [{ type: "integer" }, { type: "string" }] },
                weaponTaskState: { anyOf: [{ type: "integer" }, { type: "string" }] },
                targetUnlocked: { type: "boolean" },
                observationAuthority: { type: "string" },
                snapshotRevision: { type: "string" },
              }),
              capabilities: caps(false, true, false, false, false, true),
              resourceBinding: binding,
            },
          ]
        : []),
    ],
  };
}

function navigationSchema(
  resourceId: Record<string, unknown>,
  support: NonNullable<VehicleManifestProfile["navigationSupport"]>,
  supportsPlanning: boolean,
) {
  const point = {
    type: "object",
    properties: {
      latitude: { type: "number", minimum: -90, maximum: 90 },
      longitude: { type: "number", minimum: -180, maximum: 180 },
      altitude: { type: "number" },
    },
    required: ["latitude", "longitude"],
    additionalProperties: false,
  };
  return jsonToProtoStruct({
    type: "object",
    properties: {
      resourceId,
      mission: {
        oneOf: [
          ...(support.point
            ? [
                {
                  type: "object",
                  properties: { type: { const: "point" }, target: point },
                  required: ["type", "target"],
                  additionalProperties: false,
                },
              ]
            : []),
          ...(support.route
            ? [
                {
                  type: "object",
                  properties: {
                    type: { const: "route" },
                    waypoints: { type: "array", minItems: 1, maxItems: 1024, items: point },
                  },
                  required: ["type", "waypoints"],
                  additionalProperties: false,
                },
              ]
            : []),
          ...(support.distance
            ? [
                {
                  type: "object",
                  properties: {
                    type: { const: "distance" },
                    direction: { type: "string", enum: ["forward", "backward", "left", "right"] },
                    distanceM: { type: "number", exclusiveMinimum: 0 },
                  },
                  required: ["type", "direction", "distanceM"],
                  additionalProperties: false,
                },
              ]
            : []),
          ...(support.returnHome
            ? [
                {
                  type: "object",
                  properties: { type: { const: "return_home" } },
                  required: ["type"],
                  additionalProperties: false,
                },
              ]
            : []),
        ],
      },
      speedLimitKmh: { type: "number", exclusiveMinimum: 0 },
      stopOnObstacle: { type: "boolean" },
      ...(supportsPlanning
        ? {
            planningMode: {
              type: "string",
              enum: ["auto", "road_network", "direct"],
            },
            density: {
              type: "string",
              enum: ["adaptive", "dense", "medium", "sparse"],
            },
          }
        : {}),
    },
    required: ["resourceId", "mission"],
    additionalProperties: false,
  });
}

function reconSchema(
  resourceId: Record<string, unknown>,
  supportsAreaScan: boolean,
  supportsCircularEoScan: boolean,
  circularScanOmitsArea: boolean,
) {
  const required = circularScanOmitsArea
    ? supportsCircularEoScan
      ? ["resourceId", "scanMode"]
      : ["resourceId", "scanMode", "area"]
    : [
        "resourceId",
        ...(supportsAreaScan || supportsCircularEoScan ? ["scanMode"] : []),
        "scanCount",
        "zoom",
        "stopOnTarget",
        "targetTypes",
      ];
  if (!circularScanOmitsArea) required.splice(1, 0, "area");
  return jsonToProtoStruct({
    type: "object",
    properties: {
      resourceId,
      area: {
        type: "object",
        properties: {
          polygon: {
            type: "array",
            minItems: 3,
            items: {
              type: "object",
              properties: {
                latitude: { type: "number", minimum: -90, maximum: 90 },
                longitude: { type: "number", minimum: -180, maximum: 180 },
              },
              required: ["latitude", "longitude"],
              additionalProperties: false,
            },
          },
        },
        required: ["polygon"],
        additionalProperties: false,
      },
      ...(supportsAreaScan || supportsCircularEoScan
        ? {
            scanMode: {
              type: "string",
              enum: circularScanOmitsArea
                ? [
                    ...(supportsAreaScan ? ["area"] : []),
                    ...(supportsCircularEoScan ? ["circular"] : []),
                  ]
                : [
                    ...(supportsAreaScan ? ["area", "sector"] : []),
                    ...(supportsCircularEoScan ? ["circular"] : []),
                  ],
            },
            ...(circularScanOmitsArea
              ? {}
              : {
                  angle: { type: "number" },
                  angleUnit: { type: "string", enum: ["rad", "deg"] },
                }),
          }
        : {}),
      scanCount: { type: "integer", minimum: circularScanOmitsArea ? 0 : 1, maximum: 1000 },
      ...(circularScanOmitsArea
        ? {
            regionType: { type: "integer", enum: [2, 3, 4, 5] },
            targetTypes: {
              type: "array",
              maxItems: 128,
              items: { type: "integer", minimum: 0 },
            },
            lockDurationLimitSec: { type: "integer", minimum: 0 },
            reconType: {
              oneOf: [
                { type: "integer", enum: [1, 2, 3, 4] },
                { type: "string", enum: ["adaptive", "visible", "infrared", "dc"] },
              ],
            },
            scanSpeed: { type: "number", exclusiveMinimum: 0 },
          }
        : {
            zoom: { type: "number", exclusiveMinimum: 0 },
            stopOnTarget: { type: "boolean" },
            targetTypes: {
              type: "array",
              maxItems: 128,
              items: { type: "string", maxLength: 64 },
            },
          }),
      ...(supportsCircularEoScan && circularScanOmitsArea
        ? { scanPitch: { type: "number", minimum: -90, maximum: 90 } }
        : {}),
    },
    required,
    ...(circularScanOmitsArea && supportsCircularEoScan
      ? {
          allOf: [
            {
              if: { properties: { scanMode: { const: "circular" } }, required: ["scanMode"] },
              then: {},
              else: { properties: { area: {} }, required: ["area"] },
            },
          ],
        }
      : {}),
    additionalProperties: false,
  });
}

function gimbalSchema(resourceId: Record<string, unknown>) {
  return jsonToProtoStruct({
    type: "object",
    properties: {
      resourceId,
      mode: { type: "string", enum: ["absolute", "relative", "reset"] },
      yaw: { type: "number", minimum: -180, maximum: 180 },
      pitch: { type: "number", minimum: -90, maximum: 90 },
      yawSpeed: { type: "number", exclusiveMinimum: 0 },
      pitchSpeed: { type: "number", exclusiveMinimum: 0 },
      deltaZoom: { type: "number" },
    },
    required: ["resourceId", "mode"],
    allOf: [
      {
        if: { properties: { mode: { const: "reset" } }, required: ["mode"] },
        then: {},
        else: {
          anyOf: [
            { properties: { yaw: {} }, required: ["yaw"] },
            { properties: { pitch: {} }, required: ["pitch"] },
            { properties: { deltaZoom: {} }, required: ["deltaZoom"] },
          ],
        },
      },
    ],
    additionalProperties: false,
  });
}
