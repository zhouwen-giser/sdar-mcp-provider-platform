const dateTime = { type: "string", format: "date-time" } as const;

export function vehicleStateV1Schema(resourceId: string): Record<string, unknown> {
  return {
    title: "VehicleStateV1",
    type: "object",
    properties: {
      identity: {
        type: "object",
        properties: {
          providerId: { type: "string", minLength: 1 },
          resourceId: { type: "string", const: resourceId },
          entityId: { type: "string", minLength: 1 },
          vehicleType: { type: "string", minLength: 1 },
          executionMode: { type: "string", enum: ["simulation", "live"] },
        },
        required: ["providerId", "resourceId", "entityId", "vehicleType", "executionMode"],
        additionalProperties: false,
      },
      connectivity: {
        type: "object",
        properties: {
          mqttConnected: { type: "boolean" },
          deviceMcpConnected: { type: "boolean" },
          deviceAvailable: { type: "boolean" },
          packetLossRate: { type: "number", minimum: 0 },
          averageRoundTripTimeMs: { type: "number", minimum: 0 },
        },
        required: ["mqttConnected", "deviceMcpConnected"],
        additionalProperties: false,
      },
      freshness: {
        type: "object",
        properties: {
          chassisObservedAt: dateTime,
          healthObservedAt: dateTime,
          missionObservedAt: dateTime,
          targetObservedAt: dateTime,
          payloadObservedAt: dateTime,
        },
        additionalProperties: false,
      },
      chassis: { type: "object", additionalProperties: true },
      payload: { type: "object", additionalProperties: true },
      health: { type: "object", additionalProperties: true },
      targets: { type: "array", items: { type: "object", additionalProperties: true } },
      revision: { type: "string", minLength: 1 },
      observedAt: dateTime,
      mqttIngressSequence: { type: "integer", minimum: 0 },
    },
    required: [
      "identity",
      "connectivity",
      "freshness",
      "revision",
      "observedAt",
      "mqttIngressSequence",
    ],
    additionalProperties: false,
  };
}

export function vehicleCapabilitiesV1Schema(resourceId: string): Record<string, unknown> {
  return {
    title: "VehicleCapabilitiesV1",
    type: "object",
    properties: {
      resourceId: { type: "string", const: resourceId },
      source: { type: "string", const: "device_mcp" },
      available: { type: "boolean" },
      navigation: {
        type: "object",
        properties: {
          point: { type: "boolean" },
          route: { type: "boolean" },
          distance: { type: "boolean" },
          returnHome: { type: "boolean" },
          pauseResumeCancel: { type: "boolean" },
          planningDensities: { type: "array", items: { type: "string" }, uniqueItems: true },
          supportsRoadNetworkPlanning: { type: "boolean" },
          needPlanDefault: { type: "boolean" },
        },
        required: [
          "point",
          "route",
          "distance",
          "returnHome",
          "pauseResumeCancel",
          "planningDensities",
          "supportsRoadNetworkPlanning",
        ],
        additionalProperties: false,
      },
      payload: {
        type: "object",
        properties: {
          reconnaissance: {
            type: "object",
            properties: {
              area: { type: "boolean" },
              circular: { type: "boolean" },
              scanModes: {
                type: "array",
                items: { anyOf: [{ type: "integer" }, { type: "string" }] },
                uniqueItems: true,
              },
              movingWhileRecon: { type: "boolean" },
            },
            required: ["area", "circular", "scanModes", "movingWhileRecon"],
            additionalProperties: false,
          },
          gimbal: {
            type: "object",
            properties: {
              supported: { type: "boolean" },
              modes: { type: "array", items: { type: "string" }, uniqueItems: true },
              manualYawSweep: { type: "boolean" },
              continuousPitchSweep: { type: "boolean" },
            },
            required: ["supported", "modes", "manualYawSweep", "continuousPitchSweep"],
            additionalProperties: false,
          },
          targetTracking: { type: "boolean" },
          laserRange: { type: "boolean" },
        },
        required: ["reconnaissance", "gimbal", "targetTracking", "laserRange"],
        additionalProperties: false,
      },
      deviceReported: { type: "object", additionalProperties: true },
      engineeringProfile: { type: "object", additionalProperties: true },
      observedAt: dateTime,
    },
    required: [
      "resourceId",
      "source",
      "available",
      "navigation",
      "payload",
      "deviceReported",
      "engineeringProfile",
      "observedAt",
    ],
    additionalProperties: false,
  };
}

export function vehicleTaskResultV1Schema(
  resourceId: string,
  statuses: readonly string[],
  optionalProperties: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    title: "VehicleTaskResultV1",
    type: "object",
    properties: {
      resourceId: { type: "string", const: resourceId },
      status: { type: "string", enum: [...statuses] },
      observedAt: dateTime,
      ...optionalProperties,
    },
    required: ["resourceId", "status", "observedAt"],
    additionalProperties: false,
  };
}

export const VEHICLE_EVIDENCE_V1_SCHEMA = {
  title: "VehicleEvidenceV1",
  type: "object",
  properties: {
    evidenceId: { type: "string", minLength: 1 },
    evidenceType: { type: "string", minLength: 1 },
    observedAt: dateTime,
    subjectRef: { type: "string", minLength: 1 },
    payloadRef: {
      type: "object",
      properties: {
        kind: { type: "string", const: "structured_content" },
        jsonPointer: { type: "string", pattern: "^/" },
      },
      required: ["kind", "jsonPointer"],
      additionalProperties: false,
    },
    producer: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 },
    },
  },
  required: ["evidenceId", "evidenceType", "observedAt", "subjectRef", "payloadRef", "producer"],
  additionalProperties: false,
} as const;
