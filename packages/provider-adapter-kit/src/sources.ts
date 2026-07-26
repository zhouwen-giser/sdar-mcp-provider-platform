import type { BusinessEventSourceCapability } from "../../adapter-protocol/src/index.js";

const RETENTION_MS = "604800000";
const LIMITS = {
  maxEventBytes: "65536",
  maxPayloadDepth: 16,
  maxPayloadNodes: 4096,
  maxPayloadStringBytes: "16384",
};

export const BUSINESS_EVENT_SOURCE_STREAMS = {
  "vehicle.execution": "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1001",
  "vehicle.health": "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1002",
  "vehicle.target": "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1003",
} as const;

export function businessEventSourceCapabilities(): BusinessEventSourceCapability[] {
  return [
    {
      sourceId: "vehicle.execution",
      sourceStreamId: BUSINESS_EVENT_SOURCE_STREAMS["vehicle.execution"],
      deliverySemantics: "durable_at_least_once",
      replaySupported: true,
      sourceRetentionMs: RETENTION_MS,
      ...LIMITS,
    },
    {
      sourceId: "vehicle.health",
      sourceStreamId: BUSINESS_EVENT_SOURCE_STREAMS["vehicle.health"],
      deliverySemantics: "durable_at_least_once",
      replaySupported: true,
      sourceRetentionMs: RETENTION_MS,
      ...LIMITS,
    },
    {
      sourceId: "vehicle.target",
      sourceStreamId: BUSINESS_EVENT_SOURCE_STREAMS["vehicle.target"],
      deliverySemantics: "best_effort_live",
      replaySupported: false,
      sourceRetentionMs: "0",
      ...LIMITS,
    },
  ];
}
