import { z } from "zod";
import { DashboardContext } from "../../vehicle-zmq-contract/src/dashboard-v2.js";
import { PlannerMapReference } from "../../vehicle-zmq-contract/src/interop-profile.js";
import { PlanRouteResult } from "./site-catalog.js";
export const PlanRouteResultV2 = z
  .object({
    ...PlanRouteResult.shape,
    schemaVersion: z.literal("ugv.zmq-route-preview/2"),
    correlation: z.literal("request_id_epoch_context_and_geometry"),
    planningRequestId: z.uuid(),
    context: DashboardContext,
    contextReceivedAt: z.iso.datetime(),
    contextMessageSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sceneVerificationSha256: z.string().regex(/^[a-f0-9]{64}$/),
    transform: z
      .object({
        policy: z.literal("scene_enu_wgs84_v1"),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        reference: PlannerMapReference,
        heightPolicy: z.literal("scene_reference_plane_not_measured"),
      })
      .strict(),
    sourceFreshness: z.literal("context_and_scene_verified"),
  })
  .strict();
