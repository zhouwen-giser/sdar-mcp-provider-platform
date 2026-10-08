import { createHash } from "node:crypto";
import { z } from "zod";

const point = z
  .object({
    longitude: z.number().min(-180).max(180),
    latitude: z.number().min(-90).max(90),
    altitude: z.number().optional(),
  })
  .strict();
export const NavigationPlanningRequestSchema = z
  .object({
    waypoints: z.array(point).min(1).max(64),
    start: point,
    density: z.enum(["adaptive", "dense", "medium", "sparse"]).default("adaptive"),
  })
  .strict();
export type NavigationPlanningRequest = z.input<typeof NavigationPlanningRequestSchema>;
export const NavigationPlanSchema = z
  .object({
    planId: z.string().min(1).max(256),
    sourceRecordId: z.string().min(1).max(256),
    routeSource: z.string().min(1).max(256),
    observedAt: z.iso.datetime({ offset: true }),
    waypoints: z.array(point).min(2).max(1024),
  })
  .strict();
export type NavigationPlan = z.infer<typeof NavigationPlanSchema>;
export interface NavigationPlanner {
  plan(request: NavigationPlanningRequest): Promise<NavigationPlan>;
}

// This is the existing airport simulator's published planner coordinate policy,
// not a generic WGS84 conversion. A different scene needs a qualified transform.
const airport = { longitude: 106.81485, latitude: 29.7195, xScale: 111320, yScale: 110540 };
export const AIRPORT_ROUTE_SOURCE = "isr.airport.dashboard.road-planner/v1";
const xy = (p: z.infer<typeof point>): [number, number] => [
  (p.longitude - airport.longitude) * airport.xScale,
  (p.latitude - airport.latitude) * airport.yScale,
];
const distance = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot((a[0] ?? NaN) - (b[0] ?? NaN), (a[1] ?? NaN) - (b[1] ?? NaN));
const response = z.object({
  target: z.literal("ugv"),
  ok: z.literal(true),
  candidates: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        points: z
          .array(z.tuple([z.number(), z.number()]))
          .min(2)
          .max(1024),
        num_points: z.number().int().min(2).max(1024),
        length_m: z.number().positive(),
      }),
    )
    .min(1)
    .max(8),
});

/** Select only actual planner output matching the requested path envelope.
 * The legacy source broadcasts without request IDs. We do not claim request
 * correlation: validate endpoints/ordered vias, then bind these exact selected
 * bytes to the newly submitted mission. Never consume dashboard state/truth.
 */
export function selectAirportRoute(
  input: unknown,
  request: NavigationPlanningRequest,
  observedAt: string,
): NavigationPlan {
  const parsed = response.parse(input);
  const wanted = NavigationPlanningRequestSchema.parse(request);
  const last = wanted.waypoints.at(-1);
  if (!last) throw new Error("UGV_PLANNER_DESTINATION_REQUIRED");
  const destination = xy(last);
  const start = xy(wanted.start);
  const candidate = parsed.candidates.find((c) => {
    if (
      c.num_points !== c.points.length ||
      distance(c.points[0] ?? [], start) > 20 ||
      distance(c.points.at(-1) ?? [], destination) > 20
    )
      return false;
    let after = 0;
    for (const via of wanted.waypoints.slice(0, -1)) {
      const index = c.points.findIndex((p, i) => i >= after && distance(p, xy(via)) <= 20);
      if (index < 0) return false;
      after = index;
    }
    return true;
  });
  if (!candidate) throw new Error("UGV_PLANNER_REQUEST_GEOMETRY_MISMATCH");
  const sourceRecordId = createHash("sha256")
    .update(JSON.stringify([AIRPORT_ROUTE_SOURCE, candidate]))
    .digest("hex");
  const waypoints = candidate.points.map(([x, y]) =>
    point.parse({
      longitude: airport.longitude + x / airport.xScale,
      latitude: airport.latitude + y / airport.yScale,
    }),
  );
  return {
    planId: `road-${sourceRecordId}`,
    sourceRecordId,
    routeSource: AIRPORT_ROUTE_SOURCE,
    observedAt,
    waypoints,
  };
}

/** Only the existing plan_route event is sent; mission dispatch uses Device MCP. */
export class AirportRoadPlanner implements NavigationPlanner {
  #busy = false;
  constructor(
    readonly endpoint: string,
    readonly timeoutMs = 30_000,
  ) {
    const url = new URL(endpoint);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error("UGV_PLANNER_ENDPOINT_INVALID");
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
      throw new Error("UGV_PLANNER_TIMEOUT_INVALID");
  }
  async plan(input: NavigationPlanningRequest): Promise<NavigationPlan> {
    const request = NavigationPlanningRequestSchema.parse(input);
    if (this.#busy) throw new Error("UGV_PLANNER_BUSY");
    this.#busy = true;
    try {
      return await new Promise<NavigationPlan>((resolve, reject) => {
        const url = new URL("socket.io/?EIO=4&transport=websocket", this.endpoint);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        const socket = new WebSocket(url);
        let settled = false;
        let requested = false;
        const finish = (error?: Error, plan?: NavigationPlan) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.close();
          if (error) reject(error);
          else if (plan) resolve(plan);
        };
        const timer = setTimeout(() => finish(new Error("UGV_PLANNER_TIMEOUT")), this.timeoutMs);
        socket.addEventListener("error", () => finish(new Error("UGV_PLANNER_TRANSPORT_FAILED")));
        socket.addEventListener("close", () => finish(new Error("UGV_PLANNER_CONNECTION_CLOSED")));
        socket.addEventListener("message", ({ data }) => {
          if (settled || typeof data !== "string") return;
          if (data.length > 1_000_000) return finish(new Error("UGV_PLANNER_FRAME_TOO_LARGE"));
          if (data.startsWith("0")) socket.send("40");
          else if (data === "2") socket.send("3");
          else if (data.startsWith("40") && !requested) {
            requested = true;
            socket.send(
              "42" +
                JSON.stringify([
                  "plan_route",
                  { target: "ugv", points: request.waypoints.map(xy), density: request.density },
                ]),
            );
          } else if (data.startsWith("42") && requested) {
            let packet: unknown;
            try {
              packet = JSON.parse(data.slice(2));
            } catch {
              return;
            }
            if (!Array.isArray(packet) || packet[0] !== "route_candidates") return;
            try {
              finish(undefined, selectAirportRoute(packet[1], request, new Date().toISOString()));
            } catch {
              /* Uncorrelated/invalid broadcasts cannot select a route. */
            }
          }
        });
      });
    } finally {
      this.#busy = false;
    }
  }
}
