import { createHash } from "node:crypto";
import { z } from "zod";

export const VIEW_TOOL = "simulation_adjust_view";
export const VIEW_PROFILE = "zmq_v1_4_0_site_control_14";
export const VIEW_PROTOCOL = "smpp.simulation-view/1";
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
const worldId = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,19})$/)
  .refine((v) => BigInt(v) <= 18446744073709551615n);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const ViewParameters = z
  .object({
    viewId: id,
    horizontalFovDeg: z.number().min(5).max(160),
    acknowledgeCameraRecreation: z.literal(true),
  })
  .strict();
export const ViewBackendSettings = z
  .object({
    endpoint: z.url().refine((s) => {
      const u = new URL(s);
      return (
        u.protocol === "http:" &&
        u.hostname === "127.0.0.1" &&
        u.pathname === "/" &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash
      );
    }, "ZMQ_VIEW_LOOPBACK_ENDPOINT_REQUIRED"),
    tokenFile: z.string().min(1),
    viewId: id,
    ownershipId: z.uuid(),
    apiVersion: z.string().min(1).max(128),
    worldId,
    parentActorId: z.number().int().positive(),
    parentRoleName: z.string().min(1).max(128),
    minFovDeg: z.number().min(5).max(160),
    maxFovDeg: z.number().min(5).max(160),
    exchangeTimeoutMs: z.number().int().min(1000).max(10000).default(8000),
  })
  .strict()
  .refine((c) => c.minFovDeg <= c.maxFovDeg);
export type ViewBackendSettings = z.infer<typeof ViewBackendSettings>;
export const ViewRequest = z
  .object({
    protocol: z.literal(VIEW_PROTOCOL),
    requestId: id,
    resourceId: id,
    ownershipId: z.uuid(),
    expectedApiVersion: z.string().min(1).max(128),
    expectedWorldId: worldId,
    parentActorId: z.number().int().positive(),
    parentRoleName: z.string().min(1).max(128),
    deadlineAt: z.iso.datetime(),
    parameters: ViewParameters,
  })
  .strict();
export type ViewRequest = z.infer<typeof ViewRequest>;
export function decodeViewRequest(frames: readonly string[]) {
  const first = frames[0];
  if (frames.length !== 1 || !first) throw Error("ZMQ_VIEW_COMMAND_INVALID");
  try {
    return ViewRequest.parse(JSON.parse(Buffer.from(first, "base64").toString("utf8")));
  } catch {
    throw Error("ZMQ_VIEW_REQUEST_INVALID");
  }
}
export const ViewEvidence = z
  .object({
    schemaVersion: z.literal("smpp.simulation-view-evidence/1"),
    ownership: z.literal("project_owned"),
    eoRecognitionAffected: z.literal(false),
    viewId: id,
    ownershipId: z.uuid(),
    worldId,
    apiVersion: z.string().min(1).max(128),
    parentActorId: z.number().int().positive(),
    parentRoleName: z.string().min(1).max(128),
    cameraActorId: z.number().int().positive(),
    replacedCameraActorId: z.number().int().positive().nullable(),
    cameraRevision: id,
    actualHorizontalFovDeg: z.number().min(5).max(160),
    imageFovDeg: z.number().min(5).max(160),
    imageWidth: z.number().int().min(128).max(1920),
    imageHeight: z.number().int().min(72).max(1080),
    baselineFrame: z.number().int().nonnegative(),
    frame: z
      .object({
        frameId: z.number().int().nonnegative(),
        simulationTimeSeconds: z.number().nonnegative(),
        receivedAt: z.iso.datetime(),
        rawSha256: digest,
        thumbnail: z
          .object({
            mediaType: z.literal("image/png"),
            width: z.literal(128),
            height: z.literal(72),
            sha256: digest,
            base64: z.string().min(1).max(65536),
          })
          .strict(),
      })
      .strict(),
    intrinsics: z
      .object({
        fx: z.number().positive(),
        fy: z.number().positive(),
        cx: z.number().positive(),
        cy: z.number().positive(),
        source: z.literal("derived_from_simulator_attributes"),
        geolocation: z.literal("not_provided"),
      })
      .strict(),
    previousCameraReleased: z.boolean(),
  })
  .strict();
export const ViewReply = z
  .object({
    protocol: z.literal(VIEW_PROTOCOL),
    requestId: id,
    requestHash: digest,
    status: z.enum(["applied", "partial", "rejected", "unknown"]),
    reasonCode: z.string().regex(/^ZMQ_VIEW_[A-Z0-9_]{1,100}$/),
    attempted: z.boolean(),
    evidence: ViewEvidence.nullable(),
    missingEvidence: z.array(z.string().min(1).max(128)).max(16),
  })
  .strict();
export type ViewReply = z.infer<typeof ViewReply>;
export const ViewResult = z
  .object({
    schemaVersion: z.literal("ugv.simulation-view-result/1"),
    qualification: z.literal("project_owned_simulation_view"),
    requestId: id.nullable(),
    application: z.enum(["applied", "partial", "rejected", "unknown", "not_attempted"]),
    eoRecognitionAffected: z.literal(false),
    occupancy: z.enum(["held", "released"]),
    evidence: ViewEvidence.nullable(),
    missingEvidence: z.array(z.string()).max(256),
  })
  .strict();
/** Validate observed attributes and an actual post-request image, never requested values alone. */
export function validateViewReply(value: unknown, request: ViewRequest, requestHash: string) {
  const r = ViewReply.parse(value);
  if (r.requestId !== request.requestId || r.requestHash !== requestHash)
    throw Error("ZMQ_VIEW_RESPONSE_CORRELATION_INVALID");
  const e = r.evidence;
  if ((r.status === "applied" || r.status === "partial") && (!r.attempted || !e))
    throw Error("ZMQ_VIEW_APPLICATION_EVIDENCE_MISSING");
  if (r.status === "rejected" && (r.attempted || e))
    throw Error("ZMQ_VIEW_REJECTION_FACTS_INVALID");
  if (e) {
    if (
      e.viewId !== request.parameters.viewId ||
      e.ownershipId !== request.ownershipId ||
      e.worldId !== request.expectedWorldId ||
      e.apiVersion !== request.expectedApiVersion ||
      e.parentActorId !== request.parentActorId ||
      e.parentRoleName !== request.parentRoleName ||
      e.cameraRevision !== request.requestId ||
      e.frame.frameId <= e.baselineFrame ||
      Date.parse(e.frame.receivedAt) > Date.parse(request.deadlineAt) ||
      Math.abs(e.actualHorizontalFovDeg - request.parameters.horizontalFovDeg) > 0.01 ||
      Math.abs(e.imageFovDeg - e.actualHorizontalFovDeg) > 0.01
    )
      throw Error("ZMQ_VIEW_APPLICATION_EVIDENCE_CONFLICT");
    const image = Buffer.from(e.frame.thumbnail.base64, "base64");
    if (
      image.length > 49152 ||
      image.length < 24 ||
      image.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      image.readUInt32BE(16) !== 128 ||
      image.readUInt32BE(20) !== 72 ||
      createHash("sha256").update(image).digest("hex") !== e.frame.thumbnail.sha256
    )
      throw Error("ZMQ_VIEW_IMAGE_EVIDENCE_INVALID");
    const fx = e.imageWidth / (2 * Math.tan((e.actualHorizontalFovDeg * Math.PI) / 360));
    if (
      Math.abs(e.intrinsics.fx - fx) > 0.001 ||
      Math.abs(e.intrinsics.fy - fx) > 0.001 ||
      e.intrinsics.cx !== e.imageWidth / 2 ||
      e.intrinsics.cy !== e.imageHeight / 2
    )
      throw Error("ZMQ_VIEW_INTRINSICS_INVALID");
  }
  if (r.status === "applied" && (!e?.previousCameraReleased || r.missingEvidence.length))
    throw Error("ZMQ_VIEW_COMPLETENESS_INVALID");
  return r;
}
