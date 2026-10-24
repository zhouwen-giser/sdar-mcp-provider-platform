import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { COMPONENTS, canonical, sha256 } from "./config.js";

export const decimal = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,18})$/)
  .refine((s) => BigInt(s) <= 9223372036854775807n);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const NormalizedObservation = z
  .object({
    key: z.string().min(1).max(128),
    protocolVersion: z.string().max(16),
    versionEvidence: z.enum(["in_band", "selected_contract_not_in_band"]),
    deviceId: z.string().min(1).max(256),
    nativeTaskId: z.string().max(256).nullable(),
    nativeRequestId: z.string().max(256).nullable(),
    runtimeTaskId: z.null(),
    sourceProducerEpoch: z.null(),
    sourceTime: z
      .object({
        unit: z.enum(["utc_ms", "unconfirmed_us", "not_supplied"]),
        value: z.string().max(32).nullable(),
      })
      .strict(),
    acquisitionUtcMs: z.number().int().nonnegative().nullable(),
    reportedOrigin: z.enum(["measured", "simulated", "replay", "unattested"]),
    position: z
      .object({
        longitude: z.number().min(-180).max(180),
        latitude: z.number().min(-90).max(90),
        altitude: z.number().nullable(),
        altitudeDatum: z.literal("unconfirmed"),
        crs: z.literal("OGC:CRS84"),
      })
      .strict()
      .nullable(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();
export type NormalizedObservation = z.infer<typeof NormalizedObservation>;

const base = {
  schemaVersion: z.literal("ugv.zmq-observation-event/2.0"),
  eventId: z.uuid(),
  receivedAt: z.iso.datetime(),
  monotonicNs: z.string().regex(/^[0-9]{1,30}$/),
  clockId: z.string().min(1).max(256),
};
export const Reception = z
  .object({
    ...base,
    type: z.literal("reception"),
    receiveSequence: decimal,
    component: z.enum(COMPONENTS),
    endpoint: z.url(),
    frameCount: z.number().int().min(0),
    wireBytes: z.number().int().nonnegative(),
    rawComplete: z.boolean(),
    multipartSha256: digest.nullable(),
    frames: z
      .array(
        z
          .object({
            bytes: z.number().int().min(0).max(70000),
            base64: z.string().max(94000),
            sha256: digest,
          })
          .strict(),
      )
      .max(16),
    valid: z.boolean(),
    validationCode: z.string().max(128).nullable(),
    observation: NormalizedObservation.nullable(),
    projectable: z.boolean(),
    diagnostics: z.array(z.string().max(128)).max(32),
  })
  .strict();
export type Reception = z.infer<typeof Reception>;
export const Gap = z
  .object({
    ...base,
    type: z.literal("gap"),
    component: z.enum(COMPONENTS).nullable(),
    code: z.string().min(1).max(128),
    locallyDiscardedMessages: z.number().int().nonnegative().nullable(),
    sourceLossCount: z.null(),
  })
  .strict();
export const TransportEvent = z
  .object({
    ...base,
    type: z.literal("transport"),
    component: z.enum(COMPONENTS),
    state: z.enum(["connecting", "connected", "disconnected", "closed"]),
  })
  .strict();
export const ObservationEvent = z.discriminatedUnion("type", [Reception, Gap, TransportEvent]);
export type ObservationEvent = z.infer<typeof ObservationEvent>;
export type ClockStamp = Pick<ObservationEvent, "receivedAt" | "monotonicNs" | "clockId">;
export const stamp = (clockId: string): ClockStamp => ({
  receivedAt: new Date().toISOString(),
  monotonicNs: process.hrtime.bigint().toString(),
  clockId,
});
export function gap(
  clock: ClockStamp,
  code: string,
  component: GapComponent = null,
  locallyDiscardedMessages: number | null = null,
): ObservationEvent {
  return {
    ...clock,
    schemaVersion: "ugv.zmq-observation-event/2.0",
    eventId: randomUUID(),
    type: "gap",
    code,
    component,
    locallyDiscardedMessages,
    sourceLossCount: null,
  };
}
type GapComponent = z.infer<typeof Gap>["component"];

/** Domain, count and each frame length bind the multipart boundary as well as bytes. */
export function multipartHash(frames: readonly Buffer[]): string {
  const hash = createHash("sha256").update("SMPP_ZMQ_MULTIPART_V2\0");
  const count = Buffer.alloc(4);
  count.writeUInt32LE(frames.length);
  hash.update(count);
  for (const bytes of frames) {
    const length = Buffer.alloc(4);
    length.writeUInt32LE(bytes.length);
    hash.update(length).update(bytes);
  }
  return hash.digest("hex");
}
export const archiveEntryHash = (
  previousHash: string,
  ordinal: string,
  payload: ObservationEvent,
) => sha256(`SMPP_ZMQ_ARCHIVE_V2\0${previousHash}\0${ordinal}\0${canonical(payload)}`);

export function reconstructFrames(input: unknown): Buffer[] {
  const receipt = Reception.parse(input);
  if (!receipt.rawComplete) throw Error("ZMQ_RAW_CAPTURE_INCOMPLETE");
  const frames = receipt.frames.map((f) => {
    const bytes = Buffer.from(f.base64, "base64");
    if (
      bytes.toString("base64") !== f.base64 ||
      bytes.length !== f.bytes ||
      sha256(bytes) !== f.sha256
    )
      throw Error("ZMQ_RAW_FRAME_INTEGRITY_FAILED");
    return bytes;
  });
  if (
    frames.length !== receipt.frameCount ||
    frames.reduce((sum, b) => sum + b.length, 0) !== receipt.wireBytes ||
    multipartHash(frames) !== receipt.multipartSha256
  )
    throw Error("ZMQ_RAW_MULTIPART_INTEGRITY_FAILED");
  return frames;
}

export interface ArchiveEntry {
  ordinal: string;
  previousHash: string;
  entryHash: string;
  payload: ObservationEvent;
}
export interface ArchiveSession {
  sessionId: string;
  partitionHash: string;
  startedAt: string;
  genesisHash: string;
}
export interface ObservationArchive {
  setFailureHandler?(handler: (code: string) => void): void;
  start(): Promise<ArchiveSession>;
  append(events: readonly ObservationEvent[]): Promise<ArchiveEntry[]>;
  fail(code: string, locallyDiscardedMessages: number): Promise<void>;
  close(): Promise<void>;
}
