import { canonicalizeJson, sha256CanonicalJson, uuidV5 } from "./hash.js";
import type { CanonicalJsonValue } from "./hash.js";

export const PROVIDER_OPS_SCHEMA_NAME = "sdar.provider.ops.event";
export const PROVIDER_OPS_SCHEMA_VERSION = "1.1.0";

// Stable, project-owned namespace. UUIDv5 uses SHA-1 only as its standardized name mapping.
const PROVIDER_OPS_RECORD_NAMESPACE = "670c4482-8e75-58ae-a0d9-60c923de6432";

export interface ProviderOpsEnvelope {
  schemaName: string;
  schemaVersion: string;
  recordId: string;
  recordHash: string;
  recordType: string;
  eventCategory: string;
  deliveryClass: string;
  providerId: string;
  runtimeVersion: string;
  instanceId: string;
  taskId?: string;
  resourceId?: string;
  resourceType?: string;
  externalExecutionId?: string;
  operationName?: string;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
  providerEventId?: string;
  providerEventSequence?: number;
  eventType?: string;
  executionMode?: string;
  simulationId?: string;
  argumentHash?: string;
  authorizationContextHash?: string;
  adapterRevision?: string;
  observationRevision?: number;
  commandSequence?: number;
  occurredAt: string;
  emittedAt: string;
  attributes: Record<string, CanonicalJsonValue>;
  payload: CanonicalJsonValue;
}

export interface CreateProviderOpsEnvelopeInput extends Omit<
  ProviderOpsEnvelope,
  "schemaName" | "schemaVersion" | "recordId" | "recordHash" | "occurredAt" | "emittedAt"
> {
  stableAggregateIdentity: string;
  eventIdentity: string;
  revision?: string | number;
  occurredAt: string | Date;
  emittedAt?: string | Date;
}

export function createProviderOpsEnvelope(
  input: CreateProviderOpsEnvelopeInput,
): ProviderOpsEnvelope {
  const { stableAggregateIdentity, eventIdentity, revision, occurredAt, emittedAt, ...fields } =
    input;
  const recordId = uuidV5(
    canonicalizeJson([fields.recordType, stableAggregateIdentity, eventIdentity, revision ?? null]),
    PROVIDER_OPS_RECORD_NAMESPACE,
  );
  const envelopeWithoutHash: Omit<ProviderOpsEnvelope, "recordHash"> = {
    schemaName: PROVIDER_OPS_SCHEMA_NAME,
    schemaVersion: PROVIDER_OPS_SCHEMA_VERSION,
    recordId,
    ...fields,
    occurredAt: normalizeTimestamp(occurredAt),
    emittedAt: normalizeTimestamp(emittedAt ?? new Date()),
  };
  return {
    ...envelopeWithoutHash,
    recordHash: calculateProviderOpsRecordHash(envelopeWithoutHash),
  };
}

export function calculateProviderOpsRecordHash(
  envelope: Omit<ProviderOpsEnvelope, "recordHash"> | ProviderOpsEnvelope,
): string {
  const deliveryMetadata = new Set([
    "recordHash",
    "emittedAt",
    "instanceId",
    "exportRetryCount",
    "collectorTimestamp",
    "exporterHost",
  ]);
  const hashMaterial = Object.fromEntries(
    Object.entries(envelope).filter(([key]) => !deliveryMetadata.has(key)),
  ) as CanonicalJsonValue;
  return sha256CanonicalJson(hashMaterial);
}

function normalizeTimestamp(value: string | Date): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new TypeError("Telemetry timestamp is invalid");
  return timestamp.toISOString();
}
