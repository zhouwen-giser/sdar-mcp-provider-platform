import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  decodeMqttPayload,
  record,
  type VehicleMqttIngress,
} from "../../vehicle-mqtt-ingress/src/index.js";
import { ReceptionReceiptSchema, type ReceptionReceipt } from "./contract.js";
import { historySha256 } from "./proof.js";

/** This scope is the Provider's position-source entrance, not a device's complete generation stream. */
export const TRAJECTORY_SOURCE_TOPICS = [
  "/ugv/gnss",
  "status/ugv1",
  "status/ugv",
  "/ugv/status",
] as const;

export interface ReceptionEntrance {
  receptionId: string;
  sessionId: string;
  receivedUtc: string;
  monotonicNanoseconds: string;
  clockId: string;
  qos: 0 | 1 | 2;
  packetId: number | null;
  duplicateDeliveryHint: boolean;
  retainedDelivery: boolean;
}

/** Call synchronously at the MQTT callback, before parsing, queuing or inspecting current state. */
export function receptionEntrance(
  sessionId: string,
  clockId: string,
  packet: { qos: 0 | 1 | 2; messageId?: number; dup?: boolean; retain: boolean },
): ReceptionEntrance {
  return {
    receptionId: randomUUID(),
    sessionId,
    receivedUtc: new Date().toISOString(),
    monotonicNanoseconds: process.hrtime.bigint().toString(),
    clockId,
    qos: packet.qos,
    packetId: packet.messageId ?? null,
    duplicateDeliveryHint: packet.dup === true,
    retainedDelivery: packet.retain,
  };
}

/** Inspect only this message. No Snapshot, Context, Event or current Mission is consulted. */
export function captureTrajectoryReceipt(
  ingress: VehicleMqttIngress,
  topic: string,
  payload: Buffer,
  entrance: ReceptionEntrance,
  evidenceClass: ReceptionReceipt["evidenceClass"],
): ReceptionReceipt {
  const digest = historySha256(payload);
  let decoded: unknown;
  let inspected: ReturnType<VehicleMqttIngress["inspectMessage"]> | undefined;
  let rejected: string | undefined;
  try {
    decoded = decodeMqttPayload(payload, ingress.wireMode, ingress.limits);
    inspected = ingress.inspectMessage(topic, payload);
  } catch (error) {
    rejected =
      error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "TRAJECTORY_SOURCE_NORMALIZATION_REJECTED";
  }
  const observation = inspected?.observation;
  const position = observation?.patch.chassis?.position;
  const missionId = observation?.patch.chassis?.mission?.id;
  const reported = originalReportedTime(decoded);
  const fields = record(decoded) ? decoded : undefined;
  const header = record(fields?.header) ? fields.header : undefined;
  const sequence = header?.seq ?? fields?.seq;
  return ReceptionReceiptSchema.parse({
    schemaVersion: "ugv.trajectory-reception/1.0",
    receptionId: entrance.receptionId,
    sessionId: entrance.sessionId,
    sourceTopic: topic,
    originalMessageSha256: digest,
    originalMessageBytes: payload.length,
    originalMessageReference: "mqtt-wire:sha256:" + digest,
    providerReceivedAt: {
      utc: entrance.receivedUtc,
      owner: "PROVIDER_MQTT_MESSAGE_CALLBACK",
      clockId: entrance.clockId,
      resolution: "MILLISECOND",
      synchronization: "UNVERIFIED",
      accuracyBoundMilliseconds: null,
      processMonotonicNanoseconds: entrance.monotonicNanoseconds,
    },
    reportedTime: reported,
    deviceAcquisitionTime: null,
    deviceClockAttribution: "NOT_ATTESTED_BY_PRODUCER_CONTRACT",
    sourceReportedSequence:
      typeof sequence === "string" ||
      (typeof sequence === "number" && Number.isSafeInteger(sequence))
        ? String(sequence)
        : null,
    sourceProducerEpoch: null,
    transport: {
      qos: entrance.qos,
      packetId: entrance.packetId,
      duplicateDeliveryHint: entrance.duplicateDeliveryHint,
      retainedDelivery: entrance.retainedDelivery,
    },
    disposition: rejected ? "REJECTED" : position ? "POSITION_OBSERVATION" : "NO_POSITION",
    reasonCode: rejected ?? (position ? "POSITION_NORMALIZED" : "NO_POSITION_IN_ORIGINAL_MESSAGE"),
    position: position
      ? {
          longitude: position.longitude,
          latitude: position.latitude,
          ...(position.altitude === undefined ? {} : { altitude: position.altitude }),
          crs: "OGC:CRS84",
          derivation: "VERSIONED_PROVIDER_NORMALIZER",
        }
      : null,
    reportedMission:
      typeof missionId === "string" && missionId.length
        ? {
            missionId,
            provenance: "SAME_ORIGINAL_MESSAGE",
            producerEpoch: null,
            executionOwnership: "NOT_ATTESTED",
          }
        : null,
    evidenceClass,
    diagnostics: [
      ...(reported
        ? reported.quality === "INVALID"
          ? ["SOURCE_REPORTED_TIME_INVALID"]
          : []
        : ["SOURCE_REPORTED_TIME_UNAVAILABLE_OR_OVER_LIMIT"]),
      ...(entrance.duplicateDeliveryHint
        ? ["TRANSPORT_DUPLICATE_HINT_NOT_DEVICE_SAMPLE_DEDUPLICATION"]
        : []),
      ...(entrance.retainedDelivery ? ["RETAINED_DELIVERY_NOT_NEW_DEVICE_GENERATION"] : []),
      ...(rejected === "UGV_MQTT_ENTITY_MISMATCH" || rejected === "UGV_MQTT_ROLE_MISMATCH"
        ? ["SOURCE_DEVICE_IDENTITY_REJECTED"]
        : []),
    ],
  });
}

function originalReportedTime(decoded: unknown): ReceptionReceipt["reportedTime"] {
  if (!record(decoded)) return null;
  const header = record(decoded.header) ? decoded.header : undefined;
  const field =
    header?.stamp !== undefined
      ? "/header/stamp"
      : ["stamp", "time_us", "timestamp_us", "timestamp", "time"].find(
          (key) => decoded[key] !== undefined,
        );
  if (!field) return null;
  const stamp = field === "/header/stamp" ? header?.stamp : decoded[field];
  if (stamp === undefined) return null;
  const rawValueJson = JSON.stringify(stamp);
  if (rawValueJson.length > 4096) return null;
  const iso =
    typeof stamp === "string" &&
    z.iso.datetime({ offset: true }).safeParse(stamp).success &&
    Number.isFinite(Date.parse(stamp));
  const unsafeNumeric =
    typeof stamp === "number" && Number.isInteger(stamp) && !Number.isSafeInteger(stamp);
  const ros =
    record(stamp) &&
    Number.isSafeInteger(stamp.sec ?? stamp.secs) &&
    Number.isSafeInteger(stamp.nanosec ?? stamp.nsecs ?? stamp.nsec) &&
    Number(stamp.nanosec ?? stamp.nsecs ?? stamp.nsec) >= 0 &&
    Number(stamp.nanosec ?? stamp.nsecs ?? stamp.nsec) < 1e9;
  // ROS time may be simulation time or another epoch. Preserve it without asserting UTC.
  return {
    originalField: "decoded-message:" + (field === "/header/stamp" ? field : "/" + field),
    rawValueJson,
    valueProvenance: "DECODED_JSON_VALUE_NOT_ORIGINAL_WIRE_LEXEME",
    unit: iso
      ? "ISO8601"
      : record(stamp)
        ? "ROS_SECONDS_NANOSECONDS"
        : field.endsWith("_us")
          ? "MICROSECONDS_UNSPECIFIED_EPOCH"
          : "UNKNOWN",
    timeBase: iso ? "REPORTED_UNIX_EPOCH" : "UNKNOWN",
    reportedClockOwner: "MESSAGE_PRODUCER_UNVERIFIED",
    normalizedUtc: iso ? new Date(stamp).toISOString() : null,
    conversion: iso ? "LEXICAL_ISO8601_TO_UTC_ONLY; NO_DEVICE_CLOCK_CALIBRATION" : null,
    calibration: null,
    quality: iso
      ? "REPORTED_UNVERIFIED"
      : (record(stamp) && !ros) || stamp === null || unsafeNumeric
        ? "INVALID"
        : "UNKNOWN_TIMEBASE",
  };
}

/** Ordering comparison only within one reported field/unit; it does not establish an epoch. */
export function reportedTimeOrdinal(time: ReceptionReceipt["reportedTime"]): bigint | undefined {
  if (!time || time.quality === "INVALID") return undefined;
  const raw: unknown = JSON.parse(time.rawValueJson);
  if (time.normalizedUtc) return BigInt(Date.parse(time.normalizedUtc)) * 1_000_000n;
  if (time.unit === "ROS_SECONDS_NANOSECONDS" && record(raw))
    return (
      BigInt(Number(raw.sec ?? raw.secs)) * 1_000_000_000n +
      BigInt(Number(raw.nanosec ?? raw.nsecs ?? raw.nsec))
    );
  if (
    time.unit === "MICROSECONDS_UNSPECIFIED_EPOCH" &&
    ((typeof raw === "string" && /^\d+$/.test(raw)) ||
      (typeof raw === "number" && Number.isSafeInteger(raw)))
  )
    return BigInt(raw) * 1000n;
  return undefined;
}
