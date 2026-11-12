import { createHash, randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { z } from "zod";
import { DashboardContext } from "../../vehicle-zmq-contract/src/dashboard-v2.js";
import type { SiteInteropDeploymentProfile } from "../../vehicle-zmq-contract/src/interop-profile.js";
import {
  NavigationPlanningRequestSchema,
  type NavigationPlanningRequest,
} from "./navigation-planner.js";
import { SceneEnu } from "./scene-enu.js";

type Binding = SiteInteropDeploymentProfile["planner"];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const candidates = z.object({
  ok: z.literal(true),
  target: z.literal("ugv"),
  simulation_epoch: z.string(),
  planning_request_id: z.string(),
  candidates: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        frame_id: z.literal("map"),
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
const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot((a[0] ?? NaN) - (b[0] ?? NaN), (a[1] ?? NaN) - (b[1] ?? NaN));
const rejection = (error: unknown) => {
  const message = typeof error === "string" ? error : "";
  if (message.includes("Fresh") || message.includes("新鲜")) return "UGV_PLANNER_CONTEXT_STALE";
  if (/\bentity\b/i.test(message)) return "UGV_PLANNER_ENTITY_MISMATCH";
  if (message.includes("epoch") || message.includes("世界")) return "UGV_PLANNER_EPOCH_CHANGED";
  if (message.includes("实例")) return "UGV_PLANNER_CONTROLLER_CHANGED";
  if (message.includes("mission") || message.includes("任务")) return "UGV_PLANNER_MISSION_CHANGED";
  if (message.includes("Fresh") || message.includes("新鲜")) return "UGV_PLANNER_CONTEXT_STALE";
  return "UGV_PLANNER_UPSTREAM_REJECTED";
};

/** Receives the context on the same connection and only sends plan_route. */
export class DashboardV2Planner {
  readonly frame: SceneEnu;
  constructor(
    readonly endpoint: string,
    readonly binding: Binding,
    readonly timeoutMs = 3000,
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
      throw Error("UGV_PLANNER_ENDPOINT_INVALID");
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
      throw Error("UGV_PLANNER_TIMEOUT_INVALID");
    this.frame = new SceneEnu(binding.mapReference);
  }
  private snapshot(value: unknown, wire: string) {
    const state = object(value),
      context = DashboardContext.safeParse(state.mission_context);
    if (!context.success) throw Error("UGV_PLANNER_CONTEXT_MISSING");
    const actor = object(object(state.actors)[this.binding.entityType]),
      chassis = object(state.zmq_chassis);
    if (
      context.data.entity_id !== this.binding.entityId ||
      actor.entity_id !== this.binding.entityId ||
      actor.entity_type !== this.binding.entityType ||
      String(chassis.system_id) !== this.binding.systemId
    )
      throw Error("UGV_PLANNER_ENTITY_MISMATCH");
    if (
      actor.available !== true ||
      chassis.available !== true ||
      chassis.observation_fresh !== true
    )
      throw Error("UGV_PLANNER_CONTEXT_STALE");
    if (
      actor.simulation_epoch !== context.data.simulation_epoch ||
      chassis.simulation_epoch !== context.data.simulation_epoch
    )
      throw Error("UGV_PLANNER_EPOCH_CHANGED");
    if (chassis.controller_instance_id !== context.data.controller_instance_id)
      throw Error("UGV_PLANNER_CONTROLLER_CHANGED");
    const x = actor.position_x,
      y = actor.position_y;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    )
      throw Error("UGV_PLANNER_POSITION_UNAVAILABLE");
    return {
      context: context.data,
      position: [x, y],
      received: performance.now(),
      receivedAt: new Date().toISOString(),
      sha256: hash(wire),
    };
  }
  private async json(path: string, signal: AbortSignal) {
    const response = await fetch(new URL(path, this.endpoint), { signal, redirect: "error" });
    if (!response.ok || !response.body) throw Error("UGV_PLANNER_SCENE_UNAVAILABLE");
    const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>,
      chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 16384) throw Error("UGV_PLANNER_SCENE_RESPONSE_TOO_LARGE");
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  }
  private async verifyMap(signal: AbortSignal) {
    const samples = [
      [0, 0],
      [100, 0],
      [0, 100],
    ] as const;
    const [assets, scene, ...points] = await Promise.all([
      this.json("/api/simulation/map/assets", signal),
      this.json("/api/simulation/scenarios", signal),
      ...samples.map(([x, y]) => this.json(`/api/simulation/map/gnss?x=${x}&y=${y}&z=0`, signal)),
    ]);
    if (assets.map !== this.binding.mapReference.mapId) throw Error("UGV_PLANNER_SCENE_MISMATCH");
    if (
      scene.phase !== "ready" ||
      scene.active_scenario !== this.binding.mapReference.sceneId ||
      scene.current_map !== this.binding.mapReference.mapId ||
      typeof scene.simulation_epoch !== "string"
    )
      throw Error("UGV_PLANNER_SCENE_UNAVAILABLE");
    for (const [i, [x, y]] of samples.entries()) {
      const response = points[i],
        p = object(response?.gnss),
        expected = this.frame.toGnss(x, y, 0);
      if (
        response?.ok !== true ||
        response.frame_id !== "map" ||
        typeof p.longitude !== "number" ||
        typeof p.latitude !== "number" ||
        typeof p.altitude !== "number" ||
        Math.abs(p.longitude - expected.longitude) > 1e-8 ||
        Math.abs(p.latitude - expected.latitude) > 1e-8 ||
        Math.abs(p.altitude - expected.altitude) > 0.02
      )
        throw Error("UGV_PLANNER_SCENE_TRANSFORM_MISMATCH");
    }
    return {
      sha256: hash(JSON.stringify([assets, scene, ...points])),
      epoch: scene.simulation_epoch,
    };
  }
  async plan(input: NavigationPlanningRequest, signal?: AbortSignal) {
    const request = NavigationPlanningRequestSchema.parse(input);
    if (signal?.aborted) throw Error("UGV_PLANNER_CANCELLED");
    const id = randomUUID(),
      url = new URL("socket.io/?EIO=4&transport=websocket", this.endpoint);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return new Promise<{
      observedAt: string;
      waypoints: { longitude: number; latitude: number }[];
      sourceRecordId: string;
      routeSource: string;
      sourceMessage: string;
      planningRequestId: string;
      context: DashboardContext;
      contextReceivedAt: string;
      contextMessageSha256: string;
      sceneVerificationSha256: string;
    }>((resolve, reject) => {
      const socket = new WebSocket(url, { maxPayload: 1048576 }),
        abort = new AbortController();
      let settled = false,
        requested = false,
        mapRequested = false,
        mapHash = "",
        mapEpoch = "",
        lastCode = "UGV_PLANNER_CONTEXT_MISSING";
      let snapshot: ReturnType<DashboardV2Planner["snapshot"]> | undefined;
      let sent: ReturnType<DashboardV2Planner["snapshot"]> | undefined;
      let contextReceivedAt = "";
      const finish = (error?: Error, result?: Parameters<typeof resolve>[0]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        abort.abort();
        signal?.removeEventListener("abort", cancelled);
        socket.removeAllListeners();
        socket.on("error", () => undefined);
        socket.terminate();
        if (error) reject(error);
        else if (result) resolve(result);
      };
      const cancelled = () => finish(Error("UGV_PLANNER_CANCELLED"));
      signal?.addEventListener("abort", cancelled, { once: true });
      const timer = setTimeout(
        () => finish(Error(requested ? "UGV_PLANNER_RESPONSE_TIMEOUT" : lastCode)),
        this.timeoutMs,
      );
      const send = () => {
        if (!mapHash || !snapshot || requested || settled) return;
        if (performance.now() - snapshot.received > this.binding.maxContextAgeMs) {
          lastCode = "UGV_PLANNER_CONTEXT_STALE";
          return;
        }
        if (snapshot.context.simulation_epoch !== mapEpoch)
          return finish(Error("UGV_PLANNER_EPOCH_CHANGED"));
        if (distance(snapshot.position, this.frame.toMap(request.start)) > 20)
          return finish(Error("UGV_PLANNER_START_CHANGED"));
        sent = snapshot;
        requested = true;
        contextReceivedAt = sent.receivedAt;
        socket.send(
          "421" +
            JSON.stringify([
              "plan_route",
              {
                ...sent.context,
                target: this.binding.entityType,
                planning_request_id: id,
                density: request.density,
                points: request.waypoints.map((p) => this.frame.toMap(p).slice(0, 2)),
              },
            ]),
        );
      };
      socket.on("error", () => finish(Error("UGV_PLANNER_TRANSPORT_FAILED")));
      socket.on("close", () => finish(Error("UGV_PLANNER_CONNECTION_CLOSED")));
      socket.on("message", (bytes, binary) => {
        if (settled) return;
        if (binary) return finish(Error("UGV_PLANNER_FRAME_INVALID"));
        const wire = (
          Buffer.isBuffer(bytes)
            ? bytes
            : Array.isArray(bytes)
              ? Buffer.concat(bytes)
              : Buffer.from(bytes)
        ).toString("utf8");
        try {
          if (wire.startsWith("0")) socket.send("40");
          else if (wire === "2") socket.send("3");
          else if (wire.startsWith("40") && !mapRequested) {
            mapRequested = true;
            void this.verifyMap(abort.signal)
              .then((h) => {
                mapHash = h.sha256;
                mapEpoch = h.epoch;
                send();
              })
              .catch((e: unknown) =>
                finish(
                  Error(
                    e instanceof Error && e.message.startsWith("UGV_")
                      ? e.message
                      : "UGV_PLANNER_SCENE_UNAVAILABLE",
                  ),
                ),
              );
          } else if (wire.startsWith("431")) {
            const ack = object((JSON.parse(wire.slice(3)) as unknown[])[0]);
            if (ack.ok === false) finish(Error(rejection(ack.error ?? ack.message)));
          } else if (wire.startsWith("42")) {
            const packet: unknown = JSON.parse(wire.slice(2));
            if (!Array.isArray(packet)) return;
            if (packet[0] === "state") {
              try {
                snapshot = this.snapshot(packet[1], wire);
              } catch (e) {
                snapshot = undefined;
                lastCode = e instanceof Error ? e.message : "UGV_PLANNER_CONTEXT_INVALID";
                if (requested) finish(Error(lastCode));
                return;
              }
              if (sent && JSON.stringify(snapshot.context) !== JSON.stringify(sent.context))
                return finish(Error("UGV_PLANNER_CONTEXT_CHANGED"));
              send();
            } else if (packet[0] === "route_candidates" && sent) {
              const raw = object(packet[1]);
              if (
                raw.planning_request_id !== id ||
                raw.simulation_epoch !== sent.context.simulation_epoch
              )
                return;
              if (!snapshot || performance.now() - snapshot.received > this.binding.maxContextAgeMs)
                return finish(Error("UGV_PLANNER_CONTEXT_STALE"));
              if (raw.ok === false) return finish(Error(rejection(raw.error)));
              const parsed = candidates.parse(raw),
                start = this.frame.toMap(request.start),
                vias = request.waypoints.map((p) => this.frame.toMap(p));
              const selected = parsed.candidates.find((c) => {
                if (
                  c.points.length !== c.num_points ||
                  distance(c.points[0] ?? [], start) > 20 ||
                  distance(c.points.at(-1) ?? [], vias.at(-1) ?? []) > 20
                )
                  return false;
                let after = 0;
                for (const via of vias.slice(0, -1)) {
                  const index = c.points.findIndex((p, i) => i >= after && distance(p, via) <= 20);
                  if (index < 0) return false;
                  after = index;
                }
                return true;
              });
              if (!selected) return finish(Error("UGV_PLANNER_REQUEST_GEOMETRY_MISMATCH"));
              finish(undefined, {
                observedAt: new Date().toISOString(),
                waypoints: selected.points.map(([x, y]) => {
                  const p = this.frame.toGnss(x, y);
                  return { longitude: p.longitude, latitude: p.latitude };
                }),
                sourceRecordId: hash(JSON.stringify([sent.context, id, selected])),
                routeSource: "isr.dashboard.road-planner/v2",
                sourceMessage: wire,
                planningRequestId: id,
                context: sent.context,
                contextReceivedAt,
                contextMessageSha256: sent.sha256,
                sceneVerificationSha256: mapHash,
              });
            }
          }
        } catch {
          finish(Error("UGV_PLANNER_RESPONSE_INVALID"));
        }
      });
    });
  }
}
