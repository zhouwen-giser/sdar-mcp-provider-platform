import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocketServer, WebSocket } from "ws";
import { SceneEnu } from "../../packages/provider-adapter-kit/src/scene-enu.js";
import { SiteInteropDeploymentProfile } from "../../packages/vehicle-zmq-contract/src/interop-profile.js";
import { profile } from "../ugv-zmq-observer/helpers.js";

export const mapReference = {
  sceneId: "yuan_qu",
  mapId: "yuan_qu",
  sceneSha256: "0cec5045348e5863475c24a215a2d54933cdff99161f8baaa3eba86cc97cca51",
  latitude: 22.506858333333,
  longitude: 114.048222222222,
  altitude: 500,
};
export const binding = {
  policy: "retain" as const,
  endpoint: "http://127.0.0.1:7879/",
  protocolVersion: "dashboard-v2" as const,
  entityId: "ugv",
  entityType: "ugv" as const,
  systemId: "1",
  mapReference,
  maxContextAgeMs: 1000,
};
export function interopProfile() {
  const p = profile();
  return SiteInteropDeploymentProfile.parse({
    ...p,
    schemaVersion: "ugv.zmq-site-deployment/3",
    executionDomain: { mode: "live", simulationId: null },
    providerBinding: {
      providerId: "SIMULATED-provider",
      resourceId: "vehicle:SIMULATED",
      sourceSessionKey: "SIMULATED-source",
    },
    components: {
      ...p.components,
      chassis: {
        ...p.components.chassis,
        protocolVersion: "2.1",
        systemId: "1",
        controllerSystemId: "0",
        publicationFraming: "prefix_business_length_crc",
        commandFraming: "prefix_wire_length_crc",
      },
      eo: { ...p.components.eo, protocolVersion: "2.3", framePullEndpoint: null },
    },
    planner: binding,
  });
}
export async function dashboardFixture() {
  const frame = new SceneEnu(mapReference);
  const state = {
    scenePhase: "ready",
    sceneOverrides: {} as Record<string, unknown>,
    runtimeOverrides: {} as Record<string, unknown>,
    calls: 0,
    delayMs: 0,
    mismatch: false,
    ackError: "",
    mapMismatch: false,
    transformMismatch: false,
    available: true,
    changeContext: false,
    wrongIdFirst: false,
    stopSnapshots: false,
    wrongEntity: false,
    epoch: "1794473540045213880",
    messages: [] as string[],
    requests: [] as Record<string, unknown>[],
    latestPoints: [] as number[][],
  };
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    let value: unknown;
    if (u.pathname === "/api/simulation/map/assets")
      value = { map: state.mapMismatch ? "other" : mapReference.mapId };
    else if (u.pathname === "/api/simulation/scenarios")
      value = {
        phase: state.scenePhase,
        owner_id: "a".repeat(32),
        profile_run_id: "b".repeat(32),
        error: "",
        active_scenario: mapReference.sceneId,
        current_map: mapReference.mapId,
        simulation_epoch: state.epoch,
        ...state.sceneOverrides,
      };
    else if (u.pathname === "/api/watchdog")
      value = {
        runtime: {
          available: true,
          owner_id: "a".repeat(32),
          profile_run_id: "b".repeat(32),
          simulation_epoch: state.epoch,
          revision: "1",
          phase: "RUNNING",
          accepting_commands: true,
          ready_control_groups: ["scene", "motion:ugv", "eo:ugv"],
          fault_component: "",
          reason: "",
          ...state.runtimeOverrides,
        },
      };
    else if (u.pathname === "/api/simulation/map/gnss") {
      const x = Number(u.searchParams.get("x")),
        y = Number(u.searchParams.get("y")),
        z = Number(u.searchParams.get("z"));
      value = {
        ok: true,
        frame_id: "map",
        gnss: frame.toGnss(x, state.transformMismatch ? -y : y, z),
      };
    } else {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(value));
  });
  const sockets = new WebSocketServer({ server });
  const timers = new Set<ReturnType<typeof setInterval>>();
  sockets.on("connection", (s) => {
    const sendState = () => {
      if (s.readyState === WebSocket.OPEN && !state.stopSnapshots)
        s.send(
          "42" +
            JSON.stringify([
              "state",
              {
                mission_context: {
                  entity_id: state.wrongEntity ? "other" : "ugv",
                  simulation_epoch: state.epoch,
                  controller_instance_id: "SIMULATED-controller",
                  mission_id: -1,
                  mission_request_id: "",
                },
                actors: {
                  ugv: {
                    entity_id: "ugv",
                    entity_type: "ugv",
                    available: state.available,
                    simulation_epoch: state.epoch,
                    position_x: -40,
                    position_y: -100,
                  },
                },
                zmq_chassis: {
                  available: state.available,
                  observation_fresh: true,
                  system_id: "1",
                  simulation_epoch: state.epoch,
                  controller_instance_id: "SIMULATED-controller",
                },
              },
            ]),
        );
    };
    s.send("0{}");
    let timer: ReturnType<typeof setInterval> | undefined;
    s.on("message", (b) => {
      const wire = (
        Buffer.isBuffer(b) ? b : Array.isArray(b) ? Buffer.concat(b) : Buffer.from(b)
      ).toString("utf8");
      state.messages.push(wire);
      if (wire === "40") {
        s.send("40{}");
        sendState();
        timer = setInterval(sendState, 20);
        timers.add(timer);
      } else if (wire.startsWith("421")) {
        const [name, r] = JSON.parse(wire.slice(3)) as [string, Record<string, unknown>];
        if (name !== "plan_route") throw Error("UNEXPECTED_DEVICE_COMMAND");
        state.calls++;
        state.requests.push(r);
        if (state.ackError) {
          s.send("431" + JSON.stringify([{ ok: false, error: state.ackError }]));
          return;
        }
        if (state.changeContext) {
          state.epoch = String(BigInt(state.epoch) + 1n);
          sendState();
          return;
        }
        const points = [state.mismatch ? [9999, 9999] : [-40, -100], ...(r.points as number[][])];
        state.latestPoints = points;
        const respond = (id: unknown) => {
          if (s.readyState === WebSocket.OPEN)
            s.send(
              "42" +
                JSON.stringify([
                  "route_candidates",
                  {
                    ok: true,
                    target: "ugv",
                    simulation_epoch: r.simulation_epoch,
                    planning_request_id: id,
                    candidates: [
                      {
                        id: "SIMULATED-route",
                        frame_id: "map",
                        points,
                        num_points: points.length,
                        length_m: 148,
                      },
                    ],
                  },
                ]),
            );
        };
        if (state.wrongIdFirst) respond("unrelated");
        const t = setTimeout(() => {
          timers.delete(t);
          respond(r.planning_request_id);
        }, state.delayMs);
        timers.add(t);
      }
    });
    s.on("close", () => {
      if (timer) {
        clearInterval(timer);
        timers.delete(timer);
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("FIXTURE_ADDRESS_REQUIRED");
  return {
    state,
    frame,
    sockets,
    endpoint: `http://127.0.0.1:${address.port}/`,
    start: frame.toGnss(-40, -100),
    destination: frame.toGnss(80, -100),
    async close() {
      for (const t of timers) clearInterval(t);
      for (const s of sockets.clients) s.terminate();
      await new Promise<void>((r) => sockets.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
