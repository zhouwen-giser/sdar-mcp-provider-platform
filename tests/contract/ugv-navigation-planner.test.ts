import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AirportRoadPlanner,
  selectAirportRoute,
} from "../../apps/ugv-provider-adapter/src/navigation-planner.js";

const gps = (x: number, y: number) => ({
  longitude: 106.81485 + x / 111320,
  latitude: 29.7195 + y / 110540,
});
const request = { start: gps(-340, 100), waypoints: [gps(-192, 100)] };
const candidate = {
  id: "straight",
  points: [
    [-340, 100],
    [-300, 100],
    [-192, 100],
  ],
  num_points: 3,
  length_m: 148,
};
const response = { ok: true, target: "ugv", candidates: [candidate] };
const at = "2026-09-29T04:00:00.000Z";
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("existing airport road-planner intake", () => {
  it("preserves the selected planner points and stable source fingerprint", () => {
    const plan = selectAirportRoute(response, request, at);
    expect(plan.waypoints).toEqual(candidate.points.map((p) => gps(p[0] ?? NaN, p[1] ?? NaN)));
    expect(selectAirportRoute(response, request, "2026-09-29T04:00:01.000Z").sourceRecordId).toBe(
      plan.sourceRecordId,
    );
    expect(plan.waypoints).toHaveLength(3);
  });
  it("rejects a broadcast for another destination, stale start, invalid points or wrong unit", () => {
    for (const invalid of [
      { ...response, target: "npc_tank" },
      {
        ...response,
        candidates: [
          {
            ...candidate,
            points: [
              [0, 0],
              [0, 100],
            ],
          },
        ],
      },
      {
        ...response,
        candidates: [
          {
            ...candidate,
            points: [
              [-900, 100],
              [-300, 100],
              [-192, 100],
            ],
          },
        ],
      },
      {
        ...response,
        candidates: [
          {
            ...candidate,
            points: [
              [-340, 100],
              [-300, 100],
              [-400, 100],
            ],
          },
        ],
      },
      { ...response, candidates: [{ ...candidate, num_points: 99 }] },
      {
        ...response,
        candidates: [
          {
            ...candidate,
            points: [
              [NaN, 100],
              [-300, 100],
              [-192, 100],
            ],
          },
        ],
      },
    ])
      expect(() => selectAirportRoute(invalid, request, at)).toThrow();
  });
  it("requires vias in the requested order", () => {
    expect(() =>
      selectAirportRoute(
        response,
        { ...request, waypoints: [gps(-300, 100), gps(-340, 100), gps(-192, 100)] },
        at,
      ),
    ).toThrow("UGV_PLANNER_REQUEST_GEOMETRY_MISMATCH");
    expect(
      selectAirportRoute(response, { ...request, waypoints: [gps(-300, 100), gps(-192, 100)] }, at)
        .waypoints,
    ).toHaveLength(3);
  });
  it("sends only plan_route, discards dashboard state and unrelated broadcasts, and rejects concurrent planning", async () => {
    class FakeSocket extends EventTarget {
      static instance: FakeSocket;
      sent: string[] = [];
      constructor() {
        super();
        FakeSocket.instance = this;
      }
      send(value: string) {
        this.sent.push(value);
      }
      close() {
        this.dispatchEvent(new Event("close"));
      }
      receive(data: string) {
        this.dispatchEvent(new MessageEvent("message", { data }));
      }
    }
    vi.stubGlobal("WebSocket", FakeSocket);
    const planner = new AirportRoadPlanner("http://localhost:7879/");
    const pending = planner.plan(request);
    await expect(planner.plan(request)).rejects.toThrow("UGV_PLANNER_BUSY");
    const socket = FakeSocket.instance;
    socket.receive("0{}");
    socket.receive("40{}");
    socket.receive('42["state",{"entities":{"hidden":"ignored"}}]');
    socket.receive('42["route_candidates",{"ok":true,"target":"npc_tank","candidates":[]}]');
    socket.receive("42" + JSON.stringify(["route_candidates", response]));
    expect((await pending).waypoints).toHaveLength(3);
    expect(socket.sent).toHaveLength(2);
    expect(socket.sent[0]).toBe("40");
    const packet: unknown = JSON.parse((socket.sent[1] ?? "").slice(2));
    expect(Array.isArray(packet) ? packet[0] : undefined).toBe("plan_route");
  });
  it("fails closed on timeout and transport failure without leaving the planner busy", async () => {
    class FakeSocket extends EventTarget {
      static instance: FakeSocket;
      constructor() {
        super();
        FakeSocket.instance = this;
      }
      send() {
        /* no source response */
      }
      close() {
        this.dispatchEvent(new Event("close"));
      }
    }
    vi.stubGlobal("WebSocket", FakeSocket);
    const planner = new AirportRoadPlanner("http://localhost:7879/", 5);
    await expect(planner.plan(request)).rejects.toThrow("UGV_PLANNER_TIMEOUT");
    const pending = planner.plan(request);
    FakeSocket.instance.dispatchEvent(new Event("error"));
    await expect(pending).rejects.toThrow("UGV_PLANNER_TRANSPORT_FAILED");
  });
});
