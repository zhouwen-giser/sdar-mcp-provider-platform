import type { Attributes } from "@opentelemetry/api";
import type { CanonicalJsonValue } from "./hash.js";

const AUDIT_KEYS: Record<string, ReadonlySet<string>> = {
  "provider.business_event.source.lifecycle": new Set([
    "event",
    "sourceId",
    "sourceStreamId",
    "deliverySemantics",
    "previousStatus",
    "currentStatus",
    "fencingToken",
    "reasonCode",
  ]),
  "provider.business_event.ingest.lifecycle": new Set([
    "event",
    "sourceId",
    "sourceStreamId",
    "sourceEventId",
    "sourceSequence",
    "inboxState",
    "decodeStatus",
    "rawEnvelopeHash",
    "transportPayloadHash",
    "reasonCode",
    "attemptCount",
  ]),
  "provider.business_event.publication.lifecycle": new Set([
    "event",
    "streamId",
    "eventId",
    "runtimeSequence",
    "sourceId",
    "sourceSequence",
    "scope",
    "outcome",
    "reasonCode",
  ]),
  "provider.business_event.stream.lifecycle": new Set([
    "event",
    "previousStreamId",
    "currentStreamId",
    "generationStatus",
    "continuityClass",
    "lastReplayableSequence",
    "lastContinuousSequence",
    "reasonCode",
    "generationVersion",
  ]),
  "provider.business_event.continuity": new Set([
    "event",
    "previousStreamId",
    "newStreamId",
    "affectedSourceCount",
    "reasonCode",
    "lastReplayableSequence",
    "lastContinuousSequence",
  ]),
  "provider.business_event.delivery.lifecycle": new Set([
    "event",
    "scope",
    "outcome",
    "reasonCode",
    "batchSize",
  ]),
  "provider.business_event.relation.lifecycle": new Set([
    "event",
    "streamId",
    "eventId",
    "outcome",
    "relatedTaskCount",
    "relationTruncated",
    "reasonCode",
  ]),
};

const DIAGNOSTIC_KEYS = new Set([
  "sourceId",
  "scope",
  "outcome",
  "reasonCode",
  "payloadHash",
  "payloadBytes",
  "relatedTaskCount",
  "relationTruncated",
  "generationStatus",
  "continuityClass",
  "batchSize",
  "type",
  "retryable",
]);

const TRACE_KEYS = new Set([
  "sourceId",
  "deliverySemantics",
  "scope",
  "outcome",
  "reason",
  "generationStatus",
  "continuityClass",
  "batchSize",
  "relationTruncated",
  "retryable",
]);

export function sanitizeBusinessEventAuditPayload(
  recordType: string,
  payload: Record<string, unknown>,
): Record<string, CanonicalJsonValue> {
  const allowlist = AUDIT_KEYS[recordType];
  if (allowlist === undefined) throw new Error("BUSINESS_EVENT_AUDIT_RECORD_TYPE_INVALID");
  return sanitizeAllowed(payload, allowlist);
}

export function sanitizeBusinessEventDiagnosticBody(
  body: Record<string, unknown>,
): Record<string, CanonicalJsonValue> {
  return sanitizeAllowed(body, DIAGNOSTIC_KEYS);
}

export function sanitizeBusinessEventTraceAttributes(
  attributes: Record<string, unknown>,
): Attributes {
  return sanitizeAllowed(attributes, TRACE_KEYS) as Attributes;
}

function sanitizeAllowed(
  input: Record<string, unknown>,
  allowlist: ReadonlySet<string>,
): Record<string, CanonicalJsonValue> {
  const output: Record<string, CanonicalJsonValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowlist.has(key)) continue;
    const safe = safeScalar(value);
    if (safe !== undefined) output[key] = safe;
  }
  return output;
}

function safeScalar(value: unknown): CanonicalJsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}
