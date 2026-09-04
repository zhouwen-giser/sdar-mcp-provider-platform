import { describe, expect, it } from "vitest";
import {
  applySnapshotPatch,
  checkVehicleAvailability,
  createUgvSnapshot,
  freshnessState,
  mapVehicleTaskState,
  sanitizeFireResult,
  TrackArbiter,
  UGV_OPERATION_TRACKS,
} from "../../packages/vehicle-provider-core/src/index.js";
import {
  UGV_OPERATION_PROFILES,
  resolveVehicleOperationVariant,
} from "../../packages/vehicle-device-mcp-client/src/index.js";
import {
  assertExactSubscriptions,
  decodeMqttPayload,
  exactUgvTopic,
  UGV_MQTT_TOPICS,
  VehicleMqttIngress,
} from "../../packages/vehicle-mqtt-ingress/src/index.js";

const limits = { maxPayloadBytes: 4096, maxDepth: 8, maxNodes: 128, maxStringBytes: 256 };
const freshness = { chassis: 3000, mission: 3000, health: 5000, target: 3000, payload: 3000 };

describe("UGV MQTT exact routing and normalization", () => {
  it("contains the 19 real-boundary UGV topics and rejects wildcard or referee topics", () => {
    expect(UGV_MQTT_TOPICS).toHaveLength(19);
    expect(() => assertExactSubscriptions(UGV_MQTT_TOPICS)).not.toThrow();
    expect(exactUgvTopic("/ugv/referee/status")).toBe(false);
    expect(exactUgvTopic("/ugv/status")).toBe(true);
    expect(exactUgvTopic("status/ugv")).toBe(true);
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
  it("defines the complete UGV operation inventory, tracks, variants and risk levels", () => {
    expect(UGV_OPERATION_PROFILES.map(({ operationName }) => operationName)).toEqual([
      "vehicle_get_state",
      "vehicle_get_capabilities",
      "vehicle_get_payload_status",
      "vehicle_get_targets",
      "vehicle_laser_range",
      "vehicle_navigate",
      "vehicle_area_recon",
      "vehicle_track_target",
      "vehicle_control_gimbal",
      "vehicle_fire_weapon",
      "vehicle_emergency_stop",
    ]);
    expect(
      Object.fromEntries(
        UGV_OPERATION_PROFILES.map(({ operationName, tracks }) => [operationName, [...tracks]]),
      ),
    ).toEqual(UGV_OPERATION_TRACKS);
    expect(
      UGV_OPERATION_PROFILES.every(
        ({ resultPolicy }) =>
          resultPolicy.runtimeValidation && resultPolicy.policyId.endsWith(".v1"),
      ),
    ).toBe(true);

    const navigate = requiredProfile("vehicle_navigate");
    expect(navigate).toMatchObject({ execution: "TASK_REQUIRED", riskLevel: "MEDIUM" });
    expect(navigate.variants?.map(({ variant }) => variant).sort()).toEqual([
      "distance",
      "point",
      "return_home",
      "route",
    ]);
    expect(resolveVehicleOperationVariant(navigate, { mission: { type: "route" } })?.variant).toBe(
      "route",
    );
    expect(resolveVehicleOperationVariant(navigate, {})?.variant).toBe("point");

    const recon = requiredProfile("vehicle_area_recon");
    expect(recon.variants?.map(({ variant }) => variant)).toEqual(["area", "circular"]);
    expect(resolveVehicleOperationVariant(recon, { scanMode: 2 })?.variant).toBe("circular");
    expect(requiredProfile("vehicle_fire_weapon").riskLevel).toBe("HIGH");
    expect(requiredProfile("vehicle_emergency_stop").riskLevel).toBe("HIGH");
  });

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

    const ugvArbiter = new TrackArbiter(true, "UGV", UGV_OPERATION_TRACKS);
    expect(ugvArbiter.acquire("recon", "vehicle_area_recon").accepted).toBe(true);
    expect(ugvArbiter.acquire("gimbal", "vehicle_control_gimbal")).toEqual({
      accepted: false,
      reasonCode: "UGV_EO_TRACK_BUSY",
    });
  });

  it("returns UNKNOWN for stale or disconnected state and blocks unknown fire state", () => {
    const snapshot = createUgvSnapshot();
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

  it("accepts only bounded future observation skew", () => {
    const now = Date.parse("2026-08-20T12:00:00.000Z");
    const snapshot = createUgvSnapshot();
    snapshot.freshness.chassisObservedAt = "2026-08-20T12:00:00.500Z";

    expect(
      freshnessState(
        snapshot,
        "chassis",
        {
          chassis: 3_000,
          mission: 3_000,
          health: 5_000,
          target: 3_000,
          payload: 3_000,
          maximumFutureSkewMs: 1_000,
        },
        now,
      ),
    ).toBe("fresh");
    expect(freshnessState(snapshot, "chassis", freshness, now)).toBe("stale");

    snapshot.freshness.chassisObservedAt = "2026-08-20T12:00:01.001Z";
    expect(
      freshnessState(snapshot, "chassis", { ...freshness, maximumFutureSkewMs: 1_000 }, now),
    ).toBe("stale");
  });

  it("never regresses coarse freshness when a different source clock lags", () => {
    const aggregateObservedAt = "2026-09-02T03:18:21.196Z";
    const laggingSourceObservedAt = "2026-09-02T03:17:36.185Z";
    const aggregate = applySnapshotPatch(
      createUgvSnapshot(undefined, "2026-09-02T03:18:00.000Z"),
      { chassis: { speedKmh: 0 }, health: { runState: 0 } },
      aggregateObservedAt,
      ["chassis", "health"],
    );
    const afterLaggingSource = applySnapshotPatch(
      aggregate,
      { chassis: { compassHeadingDeg: 90 }, health: { mode: 1 } },
      laggingSourceObservedAt,
      ["chassis", "health"],
    );

    expect(afterLaggingSource).toMatchObject({
      freshness: {
        chassisObservedAt: aggregateObservedAt,
        healthObservedAt: aggregateObservedAt,
      },
      chassis: { compassHeadingDeg: 90 },
      health: { mode: 1 },
    });
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

function requiredProfile(operationName: string) {
  const profile = UGV_OPERATION_PROFILES.find(
    (candidate) => candidate.operationName === operationName,
  );
  if (profile === undefined) throw new Error(`UGV_OPERATION_PROFILE_MISSING:${operationName}`);
  return profile;
}
