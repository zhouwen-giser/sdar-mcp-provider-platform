import { z } from "zod";
import { WireId } from "../../vehicle-zmq-contract/src/schema.js";
import { FrameMetadata } from "../../vehicle-zmq-contract/src/schema-v23.js";
export const FRAME_TOOL = "vehicle_zmq_get_frame";
export const FRAME_CHUNK_BYTES = 262144;
export const FRAME_MAX_BYTES = 16777216;
export const FrameInput = z
  .object({
    resourceId: z.string().min(1).max(256),
    cameraId: WireId.optional(),
    frameId: WireId.optional(),
    retrievalId: z.uuid().optional(),
    offset: z.number().int().nonnegative().max(FRAME_MAX_BYTES).optional(),
    maxBytes: z.number().int().min(1).max(FRAME_CHUNK_BYTES).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.retrievalId !== undefined
        ? v.offset !== undefined && v.cameraId === undefined && v.frameId === undefined
        : v.cameraId !== undefined && v.frameId !== undefined && v.offset === undefined,
    "ZMQ_FRAME_READ_PARAMETERS_INVALID",
  );
export const FrameResult = z
  .object({
    schemaVersion: z.literal("ugv.zmq-frame/1"),
    resourceId: z.string(),
    deviceId: WireId,
    metadata: FrameMetadata,
    encoding: z.literal("jpeg"),
    byteLength: z.number().int().min(1).max(FRAME_MAX_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    retrievalId: z.uuid(),
    expiresAt: z.iso.datetime(),
    offset: z.number().int().nonnegative(),
    chunkBytes: z.number().int().min(1).max(FRAME_CHUNK_BYTES),
    chunkSha256: z.string().regex(/^[a-f0-9]{64}$/),
    dataBase64: z.string().max(349528),
    nextOffset: z.number().int().positive().nullable(),
    reference: z
      .object({ receptionId: z.uuid(), sessionId: z.uuid(), receivedAt: z.iso.datetime() })
      .strict(),
    overlays: z.array(z.record(z.string(), z.unknown())).max(256),
    overlaysTruncated: z.boolean(),
    diagnostics: z.array(z.string()).max(16),
  })
  .strict();
export const FrameSettings = z
  .object({
    cacheTtlMs: z.number().int().min(1000).max(300000).default(300000),
    cacheMaxBytes: z.number().int().min(FRAME_MAX_BYTES).max(268435456).default(268435456),
    maxCacheEntries: z.number().int().min(1).max(4096).default(512),
    sendTimeoutMs: z.number().int().min(100).max(1000).default(1000),
    receiveTimeoutMs: z.number().int().min(100).max(2000).default(2000),
  })
  .strict();
export type FrameSettings = z.infer<typeof FrameSettings>;
export type FrameResult = z.infer<typeof FrameResult>;
export type FrameReference = Pick<
  FrameResult,
  "metadata" | "reference" | "overlays" | "overlaysTruncated"
>;
