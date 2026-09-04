import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const connectMock = vi.hoisted(() => vi.fn());

vi.mock("mqtt", () => ({ connect: connectMock }));

import { freshnessState } from "../../packages/vehicle-provider-core/src/index.js";
import {
  assertExactNpcTankSubscriptions,
  assertExactSubscriptions,
  decodeMqttPayload,
  exactNpcTankTopic,
  NpcTankMqttClient,
  normalizeNpcTankMqttObservation,
  npcTankMqttProfile,
  npcTankMqttQos,
  NPC_TANK_MQTT_TOPICS,
  ugvMqttQos,
  UGV_MQTT_TOPICS,
  VehicleMqttIngress,
} from "../../packages/vehicle-mqtt-ingress/src/index.js";

// Shapes mirror the bounded, redacted real capture. Values are synthetic and
// contain no real endpoint, credential, coordinate, or raw-payload evidence.
const limits = {
  maxPayloadBytes: 65_536,
  maxDepth: 16,
  maxNodes: 4_096,
  maxStringBytes: 16_384,
};

afterEach(() => connectMock.mockReset());

describe("Goal 11 NPC Tank real MQTT contract", () => {
  it("uses the captured 18-topic inventory and the declared subscription QoS", () => {
    expect(NPC_TANK_MQTT_TOPICS).toEqual([
      "status/npc_tank1",
      "/npc_tank1/status",
      "/npc_tank1/gnss",
      "/npc_tank1/imu",
      "/npc_tank1/speed",
      "/npc_tank1/battery_range_km",
      "/npc_tank1/mission_state",
      "/npc_tank1/nav_state",
      "/npc_tank1/system_state",
      "/npc_tank1/component_status",
      "/npc_tank1/eo/pose",
      "/npc_tank1/detected_objects",
      "/npc_tank1/target_detected",
      "/npc_tank1/target/gnss",
      "/npc_tank1/area_recon/status",
      "/npc_tank1/area_recon/targets",
      "/npc_tank1/area_recon/exception",
      "/npc_tank1/area_recon/coverage",
    ]);
    expect(() => assertExactNpcTankSubscriptions(NPC_TANK_MQTT_TOPICS)).not.toThrow();
    for (const topic of NPC_TANK_MQTT_TOPICS)
      expect(npcTankMqttQos(topic), topic).toBe(topic === "/npc_tank1/area_recon/coverage" ? 0 : 1);

    // The passive capture observed speed publications at QoS 0. That is
    // publisher drift; the protocol and our SUBSCRIBE maximum remain QoS 1.
    expect(npcTankMqttQos("/npc_tank1/speed")).toBe(1);
    expect(npcTankMqttQos("/npc_tank1/area_recon/coverage")).toBe(0);
    expect(exactNpcTankTopic("status/npc_tank1")).toBe(true);
    expect(exactNpcTankTopic("/npc_tank1/status")).toBe(true);
    for (const forbidden of ["/npc_tank1/#", "/npc_tank1/target/base64", "/ugv/status"])
      expect(exactNpcTankTopic(forbidden)).toBe(false);
  });

  it("requests the declared QoS matrix and accepts a QoS 0 speed publication as drift", async () => {
    const fake = fakeMqttClient();
    connectMock.mockReturnValue(fake);
    const ingress = npcIngress();
    const client = new NpcTankMqttClient(
      {
        url: "mqtt://127.0.0.1:1883",
        clientId: "npc-tank-real-contract-test",
        tlsMode: "disabled",
        sessionMode: "clean",
        reconnectMinMs: 100,
        reconnectMaxMs: 1_000,
      },
      ingress,
    );
    client.start();
    fake.emit("connect", { sessionPresent: false });

    expect(fake.subscriptions()).toMatchObject({
      "/npc_tank1/speed": { qos: 1 },
      "/npc_tank1/area_recon/coverage": { qos: 0 },
    });
    fake.subscriptionCallback()(
      null,
      NPC_TANK_MQTT_TOPICS.map((topic) => ({ topic, qos: npcTankMqttQos(topic) })),
    );
    expect(ingress.snapshot().connectivity.mqttConnected).toBe(false);

    fake.emit("message", "/npc_tank1/speed", json({ data: 5.5 }), {
      retain: false,
      qos: 0,
    });
    expect(ingress.snapshot().connectivity.mqttConnected).toBe(true);
    expect(ingress.snapshot().chassis.speedKmh).toBe(5.5);
    await client.stop();
  });

  it("decodes the captured mixed ROS bridge shapes while strict modes fail closed", () => {
    const direct = {
      device_id: "npc_tank1",
      mode: "autonomous",
      status: "moving",
      speed: 4,
    };
    const envelope = { data: JSON.stringify({ status: 5, camera_fault: false }) };
    expect(decodeMqttPayload(json(direct), "ros_bridge_json", limits)).toEqual(direct);
    expect(decodeMqttPayload(json({ data: 4.5 }), "ros_bridge_json", limits)).toBe(4.5);
    expect(
      decodeMqttPayload(
        json({ layout: { dim: [] }, data: [10, -2, 1.5] }),
        "ros_bridge_json",
        limits,
      ),
    ).toEqual([10, -2, 1.5]);
    expect(decodeMqttPayload(json(envelope), "ros_bridge_json", limits)).toEqual({
      status: 5,
      camera_fault: false,
    });

    expect(() => decodeMqttPayload(json(direct), "ros_message_json", limits)).toThrow(
      "UGV_MQTT_WIRE_SHAPE_MISMATCH",
    );
    expect(() => decodeMqttPayload(json(envelope), "direct_domain_json", limits)).toThrow(
      "UGV_MQTT_WIRE_SHAPE_MISMATCH",
    );
    const hybrid = { data: { status: 5 }, status: 5 };
    expect(() => decodeMqttPayload(json(hybrid), "ros_message_json", limits)).toThrow(
      "UGV_MQTT_WIRE_SHAPE_MISMATCH",
    );
    expect(() => decodeMqttPayload(json(hybrid), "direct_domain_json", limits)).toThrow(
      "UGV_MQTT_WIRE_SHAPE_MISMATCH",
    );
    expect(() => decodeMqttPayload(json(hybrid), "auto", limits)).toThrow(
      "UGV_MQTT_AMBIGUOUS_WIRE_SHAPE",
    );
  });

  it("normalizes the canonical compact status without becoming a task authority", () => {
    const ingress = npcIngress();
    ingress.handle(
      "/npc_tank1/mission_state",
      json({ entity_id: "npc_tank1", id: 81, type: 1, state: 2, progress: 35 }),
      false,
      "2026-08-10T10:00:00.000Z",
    );
    ingress.handle(
      "status/npc_tank1",
      json({
        device_id: "npc_tank1",
        mode: "autonomous",
        status: "moving",
        speed: 7.5,
        position: { lon: 114.1, lat: 30.1 },
        remainder_range: 63,
      }),
      false,
      "2026-08-10T10:00:01.000Z",
    );

    expect(ingress.snapshot()).toMatchObject({
      chassis: {
        mission: { id: "81", state: 2, progress: 35 },
        speedKmh: 7.5,
        position: { longitude: 114.1, latitude: 30.1 },
        energy: { rangeKm: 63 },
      },
      health: { runState: 1, mode: 1 },
      connectivity: { mqttConnected: true, deviceAvailable: true },
    });
    expect(ingress.stateConflict()).toBe(false);

    // Missing compact fields are valid and must not erase richer state.
    expect(() =>
      ingress.handle(
        "status/npc_tank1",
        json({ device_id: "npc_tank1", status: "idle" }),
        false,
        "2026-08-10T10:00:02.000Z",
      ),
    ).not.toThrow();
    expect(ingress.snapshot().chassis.mission).toMatchObject({ id: "81", state: 2 });
    expect(ingress.snapshot().health.runState).toBe(0);
  });

  it("normalizes the rich compatibility status with NPC identity and modern tracks", () => {
    const payload = {
      entity_id: "npc_tank1",
      vehicle_id: 32,
      role_name: "npc_tank1",
      available: true,
      heading: 32.5,
      speed_kmh: 5,
      chassis_task: { id: -1, type: 2, state: 1, progress: 40 },
      eo_task: { id: 92, type: 2, state: 4, progress: 100 },
      weapon_task: { id: -1, type: -1, state: 0, progress: -1 },
      gimbal: { yaw: 12, pitch: -3, zoom: 2 },
    };
    const normalized = normalizeNpcTankMqttObservation("/npc_tank1/status", payload);
    expect(normalized.canonicalPayload).toEqual(payload);
    expect(payload).toMatchObject({
      entity_id: "npc_tank1",
      vehicle_id: 32,
      role_name: "npc_tank1",
    });

    const ingress = npcIngress();
    ingress.handle("/npc_tank1/status", json({ data: JSON.stringify(payload) }));
    expect(ingress.snapshot()).toMatchObject({
      identity: { entityId: "npc_tank1", vehicleType: "npc_tank" },
      chassis: {
        compassHeadingDeg: 32.5,
        speedKmh: 5,
        mission: { type: 2, state: 1, progress: 40 },
      },
      payload: {
        eoTask: { id: "92", state: 4, progress: 100 },
        gimbal: { yaw: 12, pitch: -3, zoom: 2 },
        weapon: { state: 0 },
        reconnaissance: { state: "unknown" },
      },
      connectivity: { deviceAvailable: true },
    });
    expect(ingress.snapshot().chassis.mission).not.toHaveProperty("id");
    expect(ingress.snapshot().payload.reconnaissance).not.toHaveProperty("id", "92");
  });

  it("rejects mismatched identities and the removed legacy MissionState downgrade", () => {
    const ingress = npcIngress();
    expect(() =>
      ingress.handle("status/npc_tank1", json({ device_id: "ugv1", status: "idle" })),
    ).toThrow("NPC_TANK_MQTT_ENTITY_MISMATCH");
    expect(() =>
      ingress.handle(
        "/npc_tank1/status",
        json({
          data: JSON.stringify({
            entity_id: "npc_tank1",
            vehicle_id: "ugv1",
            role_name: "npc_tank1",
          }),
        }),
      ),
    ).toThrow("NPC_TANK_MQTT_ENTITY_MISMATCH");
    expect(() => ingress.handle("status/npc_tank1", json({ vehicle_id: 32 }))).toThrow(
      "NPC_TANK_MQTT_ENTITY_MISMATCH",
    );
    expect(() =>
      ingress.handle(
        "/npc_tank1/mission_state",
        json({ entity_id: "npc_tank1", id: 7, type: 1, state: -1, progress: 0 }),
      ),
    ).toThrow("NPC_TANK_MQTT_TASK_STATE_INVALID");
  });

  it("normalizes mixed direct and ROS envelope observations in one real profile", () => {
    const ingress = npcIngress();
    ingress.handle(
      "/npc_tank1/gnss",
      json({
        header: { stamp: { sec: 1_800_000_000, nanosec: 0 } },
        latitude: 30.2,
        longitude: 114.2,
        altitude: 8,
      }),
    );
    ingress.handle("/npc_tank1/speed", json({ data: 6.5 }));
    ingress.handle("/npc_tank1/battery_range_km", json({ data: 72.5 }));
    ingress.handle("/npc_tank1/eo/pose", json({ layout: { dim: [] }, data: [20, -5, 2.5] }));
    ingress.handle(
      "/npc_tank1/area_recon/status",
      json({ data: JSON.stringify({ status: 5, camera_fault: false, progress: 30 }) }),
    );
    expect(ingress.snapshot()).toMatchObject({
      chassis: {
        position: { latitude: 30.2, longitude: 114.2, altitude: 8 },
        speedKmh: 6.5,
        energy: { rangeKm: 72.5 },
      },
      payload: {
        gimbal: { yaw: 20, pitch: -5, zoom: 2.5 },
        reconnaissance: {
          motionStatus: 5,
          state: 1,
          cameraFault: false,
          progress: 30,
        },
      },
    });
  });

  it("keeps recon MotionStatus, out-of-range and camera authority semantics independent", () => {
    const ingress = npcIngress();
    ingress.handle(
      "/npc_tank1/area_recon/status",
      rosString({
        status: 5,
        status_label: "running",
        scan_mode: 2,
        scan_pitch: -4,
        out_of_range: true,
        camera_fault: false,
        scan_num: 2,
        progress: 40,
        coverage: 40,
        coverage_covered: 4,
        coverage_total: 10,
        coverage_incomplete: true,
        coverage_reason: "partial",
        work_mode: 1,
        recon_type: 2,
        load_status: 1,
        attack_ready: true,
      }),
    );
    expect(ingress.snapshot().payload.reconnaissance).toMatchObject({
      motionStatus: 5,
      state: 1,
      scanMode: 2,
      scanPitchDeg: -4,
      outOfRange: true,
      cameraFault: false,
      progressAuthoritative: true,
      progress: 40,
      coverage: {
        coveragePercent: 40,
        coveredCount: 4,
        totalCount: 10,
        incomplete: true,
        reason: "partial",
      },
    });

    ingress.handle(
      "/npc_tank1/area_recon/coverage",
      rosString({
        run_id: 7,
        scan_mode: 2,
        coverage: 45,
        sectors_total: 8,
        sectors_covered: 4,
        sectors: [[0, 45]],
      }),
    );
    ingress.handle(
      "/npc_tank1/area_recon/exception",
      rosString({
        kind: "equipment",
        level: 1,
        error_code: 7,
        time_us: 1_800_000_000_000_000,
        target_info: { reason: "camera pose invalid", damage: 99 },
      }),
    );
    expect(ingress.snapshot().payload.reconnaissance).toMatchObject({
      coverage: {
        runId: 7,
        coveragePercent: 45,
        sectorsTotal: 8,
        sectorsCovered: 4,
        sectors: [{ startDeg: 0, endDeg: 45 }],
      },
      lastException: {
        kind: "equipment",
        level: 1,
        errorCode: 7,
        reason: "camera pose invalid",
      },
    });
    expect(JSON.stringify(ingress.snapshot())).not.toContain("damage");

    ingress.handle(
      "/npc_tank1/area_recon/status",
      rosString({ status: 5, out_of_range: false, camera_fault: true, progress: 99, coverage: 99 }),
      false,
      "2027-01-15T08:00:02.000Z",
    );
    ingress.handle(
      "/npc_tank1/area_recon/coverage",
      rosString({ run_id: 1, scan_mode: 2, coverage: 100, sectors: [] }),
      false,
      "2027-01-15T08:00:03.000Z",
    );
    expect(ingress.snapshot().payload.reconnaissance).toMatchObject({
      motionStatus: 5,
      state: 1,
      outOfRange: false,
      cameraFault: true,
      progressAuthoritative: false,
      progress: 40,
      coverage: { coveragePercent: 45 },
    });

    ingress.handle(
      "/npc_tank1/area_recon/status",
      rosString({ status: 8, camera_fault: false }),
      false,
      "2027-01-15T08:00:04.000Z",
    );
    expect(ingress.snapshot().payload.reconnaissance).toMatchObject({
      motionStatus: 8,
      state: 2,
      cameraFault: false,
      progressAuthoritative: false,
    });
  });

  it("uses rich recon targets as authority and clears them on an authoritative empty list", () => {
    const ingress = npcIngress();
    ingress.handle(
      "/npc_tank1/detected_objects",
      json({
        header: { stamp: { sec: 1_799_999_999, nanosec: 0 } },
        objects: [{ id: "042", object_type: "2:tank", x: 1, y: 2, z: 0 }],
      }),
    );
    expect(ingress.snapshot().payload.targets[0]).toMatchObject({
      targetId: "42",
      source: "mqtt_detected_objects",
    });

    const richPayload = {
      targets: [
        richTarget(42, 1_800_000_000_000_000, 0.5),
        richTarget(42, 1_800_000_001_000_000, 0.95),
      ],
    };
    ingress.handle("/npc_tank1/area_recon/targets", rosString(richPayload));
    expect(ingress.snapshot().payload.targets).toHaveLength(1);
    expect(ingress.snapshot().payload.targets[0]).toMatchObject({
      targetId: "42",
      source: "mqtt_area_recon",
      captureTimeUs: 1_800_000_001_000_000,
      targetType: 2,
      roleName: "local-target",
      position: { longitude: 114.1, latitude: 30.1, altitude: 4 },
      velocity: { eastMps: 1, northMps: 2, upMps: 0 },
      distanceM: 88,
      confidence: 0.95,
      threat: 7,
      iff: 1,
      lockTimeSec: 3,
      pixelPosition: { x: 10, y: 20, width: 30, height: 40 },
    });
    expect(JSON.stringify(ingress.snapshot().payload.targets)).not.toContain("damage");

    ingress.handle(
      "/npc_tank1/detected_objects",
      json({ objects: [{ id: 99, object_type: "secondary", x: 9, y: 9, z: 0 }] }),
    );
    expect(ingress.snapshot().payload.targets.map(({ targetId }) => targetId)).toEqual(["42"]);

    ingress.handle(
      "/npc_tank1/area_recon/targets",
      rosString({ targets: [] }),
      false,
      "2027-01-15T08:00:02.000Z",
    );
    expect(ingress.snapshot().payload.targets).toEqual([]);
    const replay = ingress.handle("/npc_tank1/area_recon/targets", rosString(richPayload));
    expect(replay).toMatchObject({
      reasonCode: "NPC_TANK_MQTT_DUPLICATE_IGNORED",
      duplicate: true,
    });
    expect(ingress.snapshot().payload.targets).toEqual([]);
    ingress.handle(
      "/npc_tank1/detected_objects",
      json({ objects: [{ id: 100, object_type: "secondary", x: 9, y: 9, z: 0 }] }),
    );
    expect(ingress.snapshot().payload.targets).toEqual([]);
  });

  it("ignores duplicate and older source observations and exposes stale freshness", () => {
    const ingress = npcIngress();
    const newest = {
      header: { stamp: { sec: 1_700_000_100, nanosec: 0 } },
      latitude: 30.1,
      longitude: 114.1,
    };
    const first = ingress.handle("/npc_tank1/gnss", json(newest));
    const duplicate = ingress.handle("/npc_tank1/gnss", json(newest));
    const older = ingress.handle(
      "/npc_tank1/gnss",
      json({
        header: { stamp: { sec: 1_700_000_000, nanosec: 0 } },
        latitude: 31,
        longitude: 115,
      }),
    );
    expect(first.reasonCode).toBe("NPC_TANK_MQTT_MESSAGE_ACCEPTED");
    expect(duplicate).toMatchObject({
      reasonCode: "NPC_TANK_MQTT_DUPLICATE_IGNORED",
      duplicate: true,
    });
    expect(older).toMatchObject({
      reasonCode: "NPC_TANK_MQTT_OLDER_OBSERVATION_IGNORED",
      olderObservation: true,
    });
    expect(ingress.snapshot().chassis.position).toMatchObject({ latitude: 30.1, longitude: 114.1 });
    expect(
      freshnessState(
        ingress.snapshot(),
        "chassis",
        { chassis: 3_000, health: 5_000, mission: 3_000, target: 3_000, payload: 3_000 },
        Date.parse("2026-08-10T10:00:00.000Z"),
      ),
    ).toBe("stale");
  });

  it("emits NPC connection readiness transitions through the shared profile", () => {
    const ingress = npcIngress();
    const events: string[] = [];
    ingress.onSnapshot((_snapshot, topic) => events.push(topic));
    const initialRevision = ingress.snapshot().revision;
    ingress.setConnected(false, "2026-08-10T10:00:00.000Z");
    expect(ingress.snapshot().revision).toBe(initialRevision);
    ingress.setConnected(true, "2026-08-10T10:00:01.000Z");
    ingress.setConnected(true, "2026-08-10T10:00:02.000Z");
    expect(events).toEqual(["mqtt_connection"]);
  });
});

describe("Goal 11 shared MQTT changes preserve UGV behavior", () => {
  it("keeps the Goal 10 UGV topic/QoS contract and modern normalization", () => {
    expect(UGV_MQTT_TOPICS).toHaveLength(19);
    expect(() => assertExactSubscriptions(UGV_MQTT_TOPICS)).not.toThrow();
    for (const topic of UGV_MQTT_TOPICS)
      expect(ugvMqttQos(topic), topic).toBe(topic === "/ugv/area_recon/coverage" ? 0 : 1);

    const ingress = new VehicleMqttIngress("ros_bridge_json", limits);
    ingress.handle(
      "/ugv/status",
      rosString({
        vehicle_id: "ugv1",
        role_name: "ugv",
        available: true,
        heading: 18,
        chassis_task: { id: 1, type: 1, state: 1, progress: 20 },
        eo_task: { id: 2, type: 2, state: 4, progress: 100 },
        weapon_task: { id: -1, type: -1, state: 0, progress: -1 },
      }),
    );
    expect(ingress.snapshot()).toMatchObject({
      chassis: { compassHeadingDeg: 18, mission: { id: "1", state: 1 } },
      payload: { eoTask: { id: "2", state: 4 } },
      connectivity: { deviceAvailable: true },
    });
  });
});

function npcIngress() {
  return new VehicleMqttIngress("ros_bridge_json", limits, npcTankMqttProfile());
}

function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

function rosString(value: unknown): Buffer {
  return json({ data: JSON.stringify(value) });
}

function richTarget(targetId: number, captureTimeUs: number, confidence: number) {
  return {
    capture_time_us: captureTimeUs,
    target_id: targetId,
    type: 2,
    position: { longitude: 114.1, latitude: 30.1, altitude: 4 },
    velocity: { vel_e: 1, vel_n: 2, vel_u: 0 },
    distance: 88,
    confidence,
    threat: 7,
    damage: 99,
    iff: 1,
    lock_time: 3,
    pixel_pos: { x: 10, y: 20, theta: 0, w: 30, h: 40 },
    role_name: "local-target",
  };
}

function fakeMqttClient() {
  type SubscriptionCallback = (
    error: Error | null,
    grants?: { topic: string; qos: 0 | 1 }[],
  ) => void;
  let requested: Record<string, { qos: 0 | 1 }> | undefined;
  let callback: SubscriptionCallback | undefined;
  const subscribe = vi.fn(
    (subscriptions: Record<string, { qos: 0 | 1 }>, candidate: SubscriptionCallback): void => {
      requested = subscriptions;
      callback = candidate;
    },
  );
  const end = vi.fn(
    (_force: boolean, _options: Record<string, never>, done: (error?: Error) => void): void =>
      done(),
  );
  return Object.assign(new EventEmitter(), {
    subscribe,
    end,
    subscriptions() {
      if (requested === undefined) throw new Error("TEST_SUBSCRIPTIONS_MISSING");
      return requested;
    },
    subscriptionCallback() {
      if (callback === undefined) throw new Error("TEST_SUBSCRIPTION_CALLBACK_MISSING");
      return callback;
    },
  });
}
