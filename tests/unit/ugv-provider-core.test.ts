import { describe, expect, it } from "vitest";
import {
  checkVehicleAvailability,
  createUgvSnapshot,
  mapVehicleTaskState,
  sanitizeFireResult,
  TrackArbiter,
} from "../../packages/vehicle-provider-core/src/index.js";
import {
  assertExactSubscriptions,
  decodeMqttPayload,
  exactUgvTopic,
  UGV_MQTT_TOPICS,
  VehicleMqttIngress,
} from "../../packages/vehicle-mqtt-ingress/src/index.js";

const limits = { maxPayloadBytes: 4096, maxDepth: 8, maxNodes: 128, maxStringBytes: 256 };

describe("UGV MQTT exact routing and normalization", () => {
  it("contains only the 12 frozen UGV topics and rejects wildcard or referee topics", () => {
    expect(UGV_MQTT_TOPICS).toHaveLength(12);
    expect(() => assertExactSubscriptions(UGV_MQTT_TOPICS)).not.toThrow();
    expect(exactUgvTopic("/ugv/referee/status")).toBe(false);
    expect(exactUgvTopic("/ugv/target/base64")).toBe(false);
    expect(exactUgvTopic("/npc_tank1/status")).toBe(false);
    expect(() => assertExactSubscriptions(["/ugv/#"])).toThrow("UGV_MQTT_TOPIC_NOT_ALLOWED");
  });

  it("decodes ROS message JSON once and rejects ambiguous auto wire shapes", () => {
    expect(decodeMqttPayload(Buffer.from('{"data":12.5}'), "auto", limits)).toBe(12.5);
    expect(
      decodeMqttPayload(
        Buffer.from('{"data":"{\\"vehicle_id\\":\\"ugv1\\",\\"speed_kmh\\":5}"}'),
        "ros_message_json",
        limits,
      ),
    ).toEqual({ vehicle_id: "ugv1", speed_kmh: 5 });
    expect(() =>
      decodeMqttPayload(Buffer.from('{"data":1,"speed_kmh":1}'), "auto", limits),
    ).toThrow("UGV_MQTT_AMBIGUOUS_WIRE_SHAPE");
  });

  it("enforces payload, depth, node and string limits", () => {
    expect(() => decodeMqttPayload(Buffer.alloc(5000, 97), "auto", limits)).toThrow(
      "UGV_MQTT_PAYLOAD_TOO_LARGE",
    );
    expect(() =>
      decodeMqttPayload(
        Buffer.from(JSON.stringify({ a: { b: { c: { d: 1 } } } })),
        "direct_domain_json",
        {
          ...limits,
          maxDepth: 3,
        },
      ),
    ).toThrow("UGV_MQTT_JSON_DEPTH_EXCEEDED");
    expect(() =>
      decodeMqttPayload(
        Buffer.from(JSON.stringify({ value: "x".repeat(300) })),
        "direct_domain_json",
        limits,
      ),
    ).toThrow("UGV_MQTT_STRING_LIMIT_EXCEEDED");
  });

  it("deduplicates identical observations and refuses older source observations", () => {
    const ingress = new VehicleMqttIngress("direct_domain_json", limits);
    const first = ingress.handle(
      "/ugv/gnss",
      Buffer.from(
        '{"header":{"stamp":{"sec":100,"nanosec":0}},"entity_id":"ugv1","latitude":30,"longitude":114}',
      ),
    );
    const revision = first.revision;
    const duplicate = ingress.handle(
      "/ugv/gnss",
      Buffer.from(
        '{"header":{"stamp":{"sec":100,"nanosec":0}},"entity_id":"ugv1","latitude":30,"longitude":114}',
      ),
    );
    const older = ingress.handle(
      "/ugv/gnss",
      Buffer.from(
        '{"header":{"stamp":{"sec":99,"nanosec":0}},"entity_id":"ugv1","latitude":31,"longitude":115}',
      ),
    );
    expect(duplicate).toMatchObject({ duplicate: true, revision });
    expect(older).toMatchObject({ olderObservation: true, revision });
    expect(ingress.snapshot().chassis.position).toMatchObject({ latitude: 30, longitude: 114 });
  });

  it("isolates malformed identity and invalid mission progress", () => {
    const ingress = new VehicleMqttIngress("direct_domain_json", limits);
    expect(() =>
      ingress.handle(
        "/ugv/mission_state",
        Buffer.from('{"entity_id":"npc_tank1","state":1,"progress":10}'),
      ),
    ).toThrow("UGV_MQTT_ENTITY_MISMATCH");
    expect(() =>
      ingress.handle(
        "/ugv/mission_state",
        Buffer.from('{"entity_id":"ugv1","state":1,"progress":101}'),
      ),
    ).toThrow("UGV_MQTT_TASK_PROGRESS_INVALID");
  });
});

describe("UGV task, track, availability and fire boundaries", () => {
  it("never maps idle -1 to success for an active execution", () => {
    expect(mapVehicleTaskState(-1, true)).toEqual({
      state: "RECONCILE",
      reasonCode: "UNCERTAIN_EXECUTION_STATE",
    });
    expect(mapVehicleTaskState(4, true).state).toBe("SUCCEEDED");
  });

  it("enforces exclusive tracks and emergency-stop preemption", () => {
    const arbiter = new TrackArbiter(true);
    expect(arbiter.acquire("task-1", "vehicle_navigate").accepted).toBe(true);
    expect(arbiter.acquire("task-2", "vehicle_navigate")).toEqual({
      accepted: false,
      reasonCode: "UGV_CHASSIS_TRACK_BUSY",
    });
    expect(arbiter.acquire("stop", "vehicle_emergency_stop").accepted).toBe(true);
    expect(arbiter.owner("chassis")).toBe("stop");
  });

  it("returns UNKNOWN for stale or disconnected state and blocks unknown fire state", () => {
    const snapshot = createUgvSnapshot();
    const freshness = { chassis: 3000, mission: 3000, health: 5000, target: 3000, payload: 3000 };
    expect(
      checkVehicleAvailability({
        operationName: "vehicle_navigate",
        snapshot,
        freshness,
        occupiedTracks: new Set(),
        requiredToolsPresent: true,
        allowNavigationWithRecon: true,
        fireRequiresChassisStopped: true,
      }),
    ).toMatchObject({ availability: "UNKNOWN", reasonCode: "UGV_MQTT_UNAVAILABLE" });
  });

  it("strips every nested referee verdict field from fire responses", () => {
    const sanitized = sanitizeFireResult({
      accepted: true,
      hit: true,
      nested: { destroyed: true, damage: 50, local_cycle: "complete" },
      array: [{ remaining_hp: 0, safe: true }],
    });
    expect(sanitized.strippedFields).toBe(4);
    expect(sanitized.value).toEqual({
      accepted: true,
      nested: { local_cycle: "complete" },
      array: [{ safe: true }],
    });
  });
});
