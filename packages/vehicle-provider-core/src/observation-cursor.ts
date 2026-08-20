import type { VehicleObservationField } from "./physical-evidence.js";

const PREFIX = "oc1.";
const MAX_TOKEN_LENGTH = 4096;
const MAX_TOPIC_LENGTH = 2048;
const MAX_SOURCE_SEQUENCE_LENGTH = 1024;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const PAYLOAD_HASH = /^[a-f0-9]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

const VEHICLE_OBSERVATION_FIELDS = new Set<VehicleObservationField>([
  "chassis.position.geodetic",
  "chassis.position.local",
  "chassis.speed",
  "chassis.heading",
  "chassis.mission",
  "payload.recon",
  "payload.targets",
  "payload.gimbal",
]);

export interface TopicObservationCursorV1 {
  version: 1;
  kind: "topic";
  topic: string;
  observedAt: string;
  timeAuthority: "source" | "ingest";
  sourceSequence?: string;
  ingestSequence: number;
  payloadHash: string;
}

export interface FieldObservationCursorV1 {
  version: 1;
  kind: "field";
  field: VehicleObservationField;
  topic: string;
  observedAt: string;
  timeAuthority: "source" | "ingest";
  sourceSequence?: string;
  ingestSequence: number;
  payloadHash: string;
}

export type ObservationCursorV1 = TopicObservationCursorV1 | FieldObservationCursorV1;

export function encodeObservationCursorV1(payload: ObservationCursorV1): string {
  if (!validObservationCursorPayload(payload)) throw new Error("OBSERVATION_CURSOR_V1_INVALID");
  const canonical =
    payload.kind === "topic"
      ? {
          version: 1 as const,
          kind: "topic" as const,
          topic: payload.topic,
          observedAt: payload.observedAt,
          timeAuthority: payload.timeAuthority,
          ...(payload.sourceSequence === undefined
            ? {}
            : { sourceSequence: payload.sourceSequence }),
          ingestSequence: payload.ingestSequence,
          payloadHash: payload.payloadHash,
        }
      : {
          version: 1 as const,
          kind: "field" as const,
          field: payload.field,
          topic: payload.topic,
          observedAt: payload.observedAt,
          timeAuthority: payload.timeAuthority,
          ...(payload.sourceSequence === undefined
            ? {}
            : { sourceSequence: payload.sourceSequence }),
          ingestSequence: payload.ingestSequence,
          payloadHash: payload.payloadHash,
        };
  const token = `${PREFIX}${Buffer.from(JSON.stringify(canonical), "utf8").toString("base64url")}`;
  if (token.length > MAX_TOKEN_LENGTH) throw new Error("OBSERVATION_CURSOR_V1_TOO_LONG");
  return token;
}

export function decodeObservationCursorV1(token: string): ObservationCursorV1 | undefined {
  if (token.length <= PREFIX.length || token.length > MAX_TOKEN_LENGTH || !token.startsWith(PREFIX))
    return undefined;
  const encoded = token.slice(PREFIX.length);
  if (!BASE64URL.test(encoded)) return undefined;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(encoded, "base64url");
  } catch {
    return undefined;
  }
  if (bytes.toString("base64url") !== encoded) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return undefined;
  }
  return validObservationCursorPayload(value) ? value : undefined;
}

function validObservationCursorPayload(value: unknown): value is ObservationCursorV1 {
  if (!record(value) || value.version !== 1) return false;
  if (value.kind !== "topic" && value.kind !== "field") return false;
  const expectedKeys = new Set([
    "version",
    "kind",
    ...(value.kind === "field" ? ["field"] : []),
    "topic",
    "observedAt",
    "timeAuthority",
    ...(value.sourceSequence === undefined ? [] : ["sourceSequence"]),
    "ingestSequence",
    "payloadHash",
  ]);
  if (
    Object.keys(value).length !== expectedKeys.size ||
    Object.keys(value).some((key) => !expectedKeys.has(key))
  )
    return false;
  if (
    typeof value.topic !== "string" ||
    value.topic.length === 0 ||
    value.topic.length > MAX_TOPIC_LENGTH ||
    typeof value.observedAt !== "string" ||
    value.observedAt.length > 64 ||
    !RFC3339.test(value.observedAt) ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    (value.timeAuthority !== "source" && value.timeAuthority !== "ingest") ||
    !Number.isSafeInteger(value.ingestSequence) ||
    (value.ingestSequence as number) < 0 ||
    typeof value.payloadHash !== "string" ||
    !PAYLOAD_HASH.test(value.payloadHash)
  )
    return false;
  if (
    value.sourceSequence !== undefined &&
    (typeof value.sourceSequence !== "string" ||
      value.sourceSequence.length > MAX_SOURCE_SEQUENCE_LENGTH)
  )
    return false;
  return (
    value.kind === "topic" ||
    (typeof value.field === "string" &&
      VEHICLE_OBSERVATION_FIELDS.has(value.field as VehicleObservationField))
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
