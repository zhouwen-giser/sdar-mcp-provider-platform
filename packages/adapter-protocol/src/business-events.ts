import { createHash } from "node:crypto";
import type { BusinessEventDeliverySemantics, BusinessEventSourceCapability } from "./types.js";

export const MAX_SIGNED_BIGINT_SEQUENCE = 9_223_372_036_854_775_807n;

export function parseBusinessEventSequence(value: string, allowZero = false): bigint {
  if (!(allowZero ? /^(0|[1-9][0-9]{0,18})$/ : /^[1-9][0-9]{0,18}$/.test(value))) {
    throw new Error("BUSINESS_EVENT_SEQUENCE_INVALID");
  }
  const parsed = BigInt(value);
  if (parsed > MAX_SIGNED_BIGINT_SEQUENCE) throw new Error("BUSINESS_EVENT_SEQUENCE_INVALID");
  return parsed;
}

export function businessEventId(
  providerId: string,
  sourceId: string,
  sourceStreamId: string,
  sourceEventId: string,
): string {
  return createHash("sha256")
    .update([providerId, sourceId, sourceStreamId, sourceEventId].join("\0"), "utf8")
    .digest("base64url");
}

export function canonicalJson(value: unknown): string {
  return serialize(normalizeUnicode(value));
}

export function canonicalSha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export function normalizeRfc3339Nano(input: string): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      input,
    );
  if (match === null) throw new Error("BUSINESS_EVENT_TIMESTAMP_INVALID");
  const [, year, month, day, hour, minute, second, fraction = "", zone] = match;
  if (zone === undefined) throw new Error("BUSINESS_EVENT_TIMESTAMP_INVALID");
  const offsetMinutes =
    zone === "Z"
      ? 0
      : (zone.startsWith("-") ? -1 : 1) *
        (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  const utc = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute) - offsetMinutes,
      Number(second),
    ),
  );
  if (Number.isNaN(utc.valueOf())) throw new Error("BUSINESS_EVENT_TIMESTAMP_INVALID");
  const base = utc.toISOString().slice(0, 19);
  const normalizedFraction = fraction.replace(/0+$/, "");
  return `${base}${normalizedFraction.length === 0 ? "" : `.${normalizedFraction}`}Z`;
}

export function validateBusinessEventSourceCapability(
  capability: BusinessEventSourceCapability,
): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(capability.sourceId)) {
    throw new Error("BUSINESS_EVENT_SOURCE_ID_INVALID");
  }
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(capability.sourceStreamId)) {
    throw new Error("BUSINESS_EVENT_SOURCE_STREAM_ID_INVALID");
  }
  validateSemantics(
    capability.deliverySemantics,
    capability.replaySupported,
    capability.sourceRetentionMs,
  );
  const bounded = [
    [BigInt(capability.maxEventBytes), 1_024n, 1_048_576n],
    [BigInt(capability.maxPayloadStringBytes), 64n, 1_048_576n],
    [BigInt(capability.maxPayloadDepth), 1n, 64n],
    [BigInt(capability.maxPayloadNodes), 16n, 100_000n],
  ] as const;
  if (bounded.some(([value, minimum, maximum]) => value < minimum || value > maximum)) {
    throw new Error("BUSINESS_EVENT_SOURCE_LIMIT_INVALID");
  }
}

function validateSemantics(
  semantics: BusinessEventDeliverySemantics,
  replaySupported: boolean,
  retentionMs: string,
): void {
  if (
    (semantics === "durable_at_least_once" && (!replaySupported || BigInt(retentionMs) <= 0n)) ||
    (semantics === "best_effort_live" && replaySupported)
  ) {
    throw new Error("BUSINESS_EVENT_SOURCE_SEMANTICS_INVALID");
  }
}

function normalizeUnicode(value: unknown): unknown {
  if (typeof value === "string") return value.normalize("NFC");
  if (Array.isArray(value)) return value.map(normalizeUnicode);
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.normalize("NFC");
      if (Object.hasOwn(result, normalizedKey))
        throw new Error("BUSINESS_EVENT_UNICODE_KEY_COLLISION");
      result[normalizedKey] = normalizeUnicode(child);
    }
    return result;
  }
  return value;
}

function serialize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("BUSINESS_EVENT_CANONICAL_NUMBER_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${serialize(child)}`)
      .join(",")}}`;
  }
  throw new Error("BUSINESS_EVENT_CANONICAL_VALUE_INVALID");
}
