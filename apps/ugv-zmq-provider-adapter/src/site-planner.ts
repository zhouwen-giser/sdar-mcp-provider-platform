import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  AirportRoadPlanner,
  AIRPORT_TRANSFORM_SHA256,
} from "../../../packages/provider-adapter-kit/src/navigation-planner.js";
import { canonical, sha256 } from "../../../packages/vehicle-zmq-observer/src/index.js";
import {
  PlanRouteInput,
  PlanRouteResult,
} from "../../../packages/vehicle-zmq-control/src/site-catalog.js";

/** Serialize the request-ID-free planner across this deployment's Provider processes. */
export class SiteRoutePlanner {
  readonly endpoint: string;
  constructor(
    endpoint: string,
    readonly pool: Pool,
  ) {
    new AirportRoadPlanner(endpoint, 3000);
    this.endpoint = new URL(endpoint).href;
  }
  async plan(value: unknown, signal?: AbortSignal) {
    const input = PlanRouteInput.parse(value),
      key = sha256(this.endpoint);
    const client = await this.pool.connect();
    let locked = false;
    let discard = false;
    try {
      const lock = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1,790028)) locked",
        [key],
      );
      locked = lock.rows[0]?.locked === true;
      if (!locked) throw Error("UGV_PLANNER_BUSY");
      let wire: string | undefined;
      const planner = new AirportRoadPlanner(this.endpoint, 3000, (data) => {
        wire = data;
      });
      const selected = await planner.plan(
        { start: input.start, waypoints: input.waypoints, density: input.density },
        signal,
      );
      if (!wire) throw Error("UGV_PLANNER_SOURCE_MISSING");
      if (Buffer.byteLength(wire) > 262144) throw Error("UGV_PLANNER_SOURCE_TOO_LARGE");
      return PlanRouteResult.parse({
        schemaVersion: "ugv.zmq-route-preview/1",
        previewId: randomUUID(),
        resourceId: input.resourceId,
        adoption: "preview_only",
        correlation: "geometry_only_no_request_id",
        createdAt: selected.observedAt,
        requestHash: sha256(canonical(input)),
        routeSource: selected.routeSource,
        sourceRecordId: selected.sourceRecordId,
        sourceMessageSha256: sha256(wire),
        sourceMessage: wire,
        transform: { policy: "airport_south_positive_v1", sha256: AIRPORT_TRANSFORM_SHA256 },
        start: input.start,
        waypoints: selected.waypoints,
        requestedWaypoints: input.waypoints,
        sourceFreshness: "unverified",
        completeSpatialEvidence: false,
      });
    } finally {
      if (locked) {
        try {
          await client.query("SELECT pg_advisory_unlock(hashtextextended($1,790028))", [key]);
        } catch {
          discard = true;
        }
      }
      client.release(discard);
    }
  }
}
