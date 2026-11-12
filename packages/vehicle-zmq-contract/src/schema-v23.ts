import { z } from "zod";
import { EoRequest, EoResponse, EoPublication, WireId } from "./schema.js";
const trackList = EoPublication.options[3].shape.data;
const tracked = trackList.shape.targets.element;
const image = tracked.shape.image;
const bbox = EoPublication.options[2].shape.data.shape.targets.element.shape.bbox.unwrap();
const utc = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const eventBase = { kind: z.literal("event"), device_id: WireId };
const responseBase = {
  kind: z.literal("response"),
  device_id: WireId,
  response_id: WireId.nullable(),
  ok: z.boolean(),
  error: EoResponse.shape.error,
};
// Native versions are selected by the deployment; never widen the frozen 2.2 contract.
export const EoRequestV23 = z.discriminatedUnion("method", [
  z.object({ ...EoRequest.options[0].shape, protocol: z.literal("2.3") }).strict(),
  z.object({ ...EoRequest.options[1].shape, protocol: z.literal("2.3") }).strict(),
  z.object({ ...EoRequest.options[2].shape, protocol: z.literal("2.3") }).strict(),
  z.object({ ...EoRequest.options[3].shape, protocol: z.literal("2.3") }).strict(),
]);
export const EoResponseV23 = z
  .object({ ...EoResponse.shape, protocol: z.literal("2.3") })
  .strict()
  .refine(
    (r) => EoResponse.safeParse({ ...r, protocol: "2.2" }).success,
    "ZMQ_RESPONSE_INCONSISTENT",
  );
const trackedV23 = tracked
  .safeExtend({
    bbox: bbox.nullable(),
    observed_at_utc_ms: utc.nullable(),
  })
  .refine(
    (t) =>
      t.bbox === null ||
      (t.bbox.x_px + t.bbox.width_px <= t.image.width_px &&
        t.bbox.y_px + t.bbox.height_px <= t.image.height_px &&
        t.pixel.x_px >= t.bbox.x_px &&
        t.pixel.x_px < t.bbox.x_px + t.bbox.width_px &&
        t.pixel.y_px >= t.bbox.y_px &&
        t.pixel.y_px < t.bbox.y_px + t.bbox.height_px),
    "ZMQ_TRACK_GEOMETRY_INVALID",
  );
const trackListV23 = trackList
  .safeExtend({ targets: z.array(trackedV23).max(1) })
  .refine(
    (d) => d.targets.every((t) => t.observed_at_utc_ms === d.observed_at_utc_ms),
    "ZMQ_TRACK_EXPOSURE_MISMATCH",
  );
export const FrameMetadata = z
  .object({
    camera_id: WireId,
    frame_id: WireId,
    exposure_utc_ms: utc.nullable(),
    width_px: image.shape.width_px,
    height_px: image.shape.height_px,
  })
  .strict();
export const EoPublicationV23 = z.discriminatedUnion("topic", [
  z.object({ ...EoPublication.options[0].shape, protocol: z.literal("2.3") }).strict(),
  z.object({ ...EoPublication.options[1].shape, protocol: z.literal("2.3") }).strict(),
  z.object({ ...EoPublication.options[2].shape, protocol: z.literal("2.3") }).strict(),
  z
    .object({ ...EoPublication.options[3].shape, protocol: z.literal("2.3"), data: trackListV23 })
    .strict(),
  z
    .object({
      ...eventBase,
      protocol: z.literal("2.3"),
      topic: z.literal("frame_header"),
      published_at_utc_ms: utc,
      data: FrameMetadata,
    })
    .strict(),
]);
export const FramePullRequest = z
  .object({
    protocol: z.literal("2.3"),
    kind: z.literal("request"),
    device_id: WireId,
    request_id: WireId,
    method: z.literal("FramePull"),
    params: z.object({ camera_id: WireId, frame_id: WireId }).strict(),
  })
  .strict();
export const FramePullResponse = z
  .object({
    ...responseBase,
    protocol: z.literal("2.3"),
    device_id: WireId,
    method: z.literal("FramePull").nullable(),
    result: FrameMetadata.extend({
      encoding: z.literal("jpeg"),
      byte_length: z.number().int().min(1).max(16_777_216),
    }).nullable(),
  })
  .strict()
  .refine(
    (r) =>
      r.ok
        ? r.result !== null && r.error === null && r.method === "FramePull"
        : r.result === null && r.error !== null,
    "ZMQ_FRAME_RESPONSE_INCONSISTENT",
  );
