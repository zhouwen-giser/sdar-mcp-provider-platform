import { createProviderOpsEnvelope } from "./event-envelope.js";
import type { ProviderOpsEnvelope } from "./event-envelope.js";
import type { CanonicalJsonValue } from "./hash.js";
import { sanitizeBusinessEventAuditPayload } from "./business-event-sanitizer.js";

export const BUSINESS_EVENT_PROVIDER_OPS_RECORD_TYPES = [
  "provider.business_event.source.lifecycle",
  "provider.business_event.ingest.lifecycle",
  "provider.business_event.publication.lifecycle",
  "provider.business_event.stream.lifecycle",
  "provider.business_event.continuity",
  "provider.business_event.delivery.lifecycle",
  "provider.business_event.relation.lifecycle",
] as const;

export type BusinessEventProviderOpsRecordType =
  (typeof BUSINESS_EVENT_PROVIDER_OPS_RECORD_TYPES)[number];

export interface BusinessEventProviderOpsContext {
  runtimeVersion: string;
  instanceId: string;
}

export interface CreateBusinessEventAuditInput {
  providerId: string;
  recordType: BusinessEventProviderOpsRecordType;
  stableAggregateIdentity: string;
  eventIdentity: string;
  revision?: string | number;
  occurredAt: Date | string;
  payload: Record<string, CanonicalJsonValue>;
}

export function createBusinessEventProviderOpsEnvelope(
  context: BusinessEventProviderOpsContext,
  input: CreateBusinessEventAuditInput,
): ProviderOpsEnvelope {
  return createProviderOpsEnvelope({
    recordType: input.recordType,
    eventCategory: "business_event.lifecycle",
    deliveryClass: "audit",
    providerId: input.providerId,
    runtimeVersion: context.runtimeVersion,
    instanceId: context.instanceId,
    stableAggregateIdentity: input.stableAggregateIdentity,
    eventIdentity: input.eventIdentity,
    ...(input.revision === undefined ? {} : { revision: input.revision }),
    occurredAt: input.occurredAt,
    attributes: {},
    payload: sanitizeBusinessEventAuditPayload(input.recordType, input.payload),
  });
}

export interface BusinessEventSafeError {
  type: string;
  reasonCode: string;
  retryable: boolean;
}

export function businessEventSafeError(error: unknown): BusinessEventSafeError {
  const record =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const knownTypes = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError"]);
  const candidateType = error instanceof Error ? error.name : "Error";
  const reason =
    typeof record.reasonCode === "string"
      ? record.reasonCode
      : error instanceof Error
        ? error.message
        : "UNKNOWN";
  return {
    type: knownTypes.has(candidateType) ? candidateType : "Error",
    reasonCode: /^[A-Z][A-Z0-9_]{0,63}$/.test(reason) ? reason : "UNKNOWN",
    retryable: record.retryable === true,
  };
}
