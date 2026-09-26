import type { BusinessEventSourceCapability } from "../../adapter-protocol/src/index.js";
import { createHash } from "node:crypto";
import type { GowmStorageConfig } from "../../gowm-shared-storage-adapter/src/config.js";

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
  "vehicle.business": "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1004",
} as const;

export function businessEventSourceCapabilities(
  includeTaskBusiness = false,
): BusinessEventSourceCapability[] {
  const sources: BusinessEventSourceCapability[] = [
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
  if (includeTaskBusiness)
    sources.push({
      sourceId: "vehicle.business",
      sourceStreamId: BUSINESS_EVENT_SOURCE_STREAMS["vehicle.business"],
      deliverySemantics: "durable_at_least_once",
      replaySupported: true,
      sourceRetentionMs: RETENTION_MS,
      ...LIMITS,
    });
  return sources;
}

export function scopedBusinessEventSourceCapability(
  source: BusinessEventSourceCapability,
  config?: GowmStorageConfig,
): BusinessEventSourceCapability {
  if (!config) return source;
  const streamIdentity = [
    source.sourceStreamId,
    config.allowedDeviceIds[0],
    config.sourceSessionKey,
  ];
  if (source.sourceId === "vehicle.business") streamIdentity.push(config.serviceKey);
  const sourceStreamId = createHash("sha256")
    .update(JSON.stringify(streamIdentity))
    .digest("hex")
    .slice(0, 32)
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
  return { ...source, sourceStreamId };
}

/** GOWM source-state PK has device_id and source_id, but no service/session columns. */
export function storedTaskBusinessSourceId(config?: GowmStorageConfig): string {
  if (!config) return "vehicle.business";
  const suffix = createHash("sha256")
    .update(JSON.stringify([config.serviceKey, config.sourceSessionKey]))
    .digest("hex")
    .slice(0, 32);
  return `vehicle.business:${suffix}`;
}

export function taskBusinessSourceCapability(
  config?: GowmStorageConfig,
): BusinessEventSourceCapability {
  const source = businessEventSourceCapabilities(true).find(
    (item) => item.sourceId === "vehicle.business",
  );
  if (!source) throw new Error("TASK_BUSINESS_SOURCE_MISSING");
  return scopedBusinessEventSourceCapability(source, config);
}
