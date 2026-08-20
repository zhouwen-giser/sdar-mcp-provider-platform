import { describe, expect, it } from "vitest";
import {
  mapReconMotionStatus,
  projectReconMotionStatus,
  type ReconMotionStatus,
} from "../../packages/vehicle-provider-core/src/index.js";
import {
  assertExactSubscriptions,
  decodeMqttPayload,
  exactUgvTopic,
  npcTankMqttProfile,
  npcTankMqttQos,
  NPC_TANK_MQTT_TOPICS,
  ugvMqttQos,
  UGV_MQTT_TOPICS,
  VehicleMqttIngress,
} from "../../packages/vehicle-mqtt-ingress/src/index.js";

// These fixtures are derived from UGV_SIMULATION_INTERFACE_PROTOCOL_v2.md and passively
// captured structural fingerprints. They are not evidence of a live endpoint PASS.
const limits = {
  maxPayloadBytes: 65_536,
  maxDepth: 16,
  maxNodes: 4_096,
  maxStringBytes: 16_384,
};

describe("Goal 10 UGV MQTT protocol-derived contract", () => {
  it("keeps the UGV contract while Goal 11 aligns NPC to the real 18-topic policy", () => {
    expect(UGV_MQTT_TOPICS).toEqual([
      "/ugv/gnss",
      "/ugv/imu",
      "/ugv/speed",
      "status/ugv",
      "/ugv/status",
      "/ugv/system_state",
      "/ugv/component_status",
      "/ugv/battery_range_km",
      "/ugv/mission_state",
      "/ugv/nav_state",
      "/ugv/eo/pose",
      "/ugv/detected_objects",
      "/ugv/target_detected",
      "/ugv/target/gnss",
      "/ugv/area_recon/status",
      "/ugv/area_recon/targets",
      "/ugv/area_recon/exception",
      "/ugv/area_recon/coverage",
    ]);
    expect(() => assertExactSubscriptions(UGV_MQTT_TOPICS)).not.toThrow();
    for (const topic of UGV_MQTT_TOPICS)
      expect(ugvMqttQos(topic)).toBe(topic === "/ugv/area_recon/coverage" ? 0 : 1);

    expect(exactUgvTopic("/ugv/status")).toBe(true);
    expect(ugvMqttQos("status/ugv")).toBe(1);
    expect(ugvMqttQos("/ugv/status")).toBe(1);
    expect(exactUgvTopic("/ugv/target/base64")).toBe(false);
    expect(NPC_TANK_MQTT_TOPICS).toHaveLength(18);
    expect(npcTankMqttQos("/npc_tank1/speed")).toBe(1);
    expect(npcTankMqttQos("/npc_tank1/status")).toBe(1);
  });

  it("emits UGV connection lifecycle snapshots only on state transitions", () => {
    const ingress = new VehicleMqttIngress("ros_bridge_json", limits);
    const topics: string[] = [];
    ingress.onSnapshot((_snapshot, topic) => topics.push(topic));
    const initialRevision = ingress.snapshot().revision;

    ingress.setConnected(false, "2026-08-10T06:00:00.000Z");
    expect(ingress.snapshot().revision).toBe(initialRevision);
    ingress.setConnected(true, "2026-08-10T06:00:01.000Z");
    ingress.setDeviceConnected(true, "2026-08-10T06:00:02.000Z");
    ingress.setDeviceConnected(true, "2026-08-10T06:00:03.000Z");

    expect(topics).toEqual(["mqtt_connection", "device_mcp_connection"]);
  });

  it("keeps wire mode explicit for direct and ROS String(JSON) fixtures", () => {
    expect(
      decodeMqttPayload(
        Buffer.from('{"available":true,"heading":17.5}'),
        "direct_domain_json",
        limits,
      ),
    ).toEqual({ available: true, heading: 17.5 });
    expect(
      decodeMqttPayload(
        Buffer.from('{"data":"{\\"status\\":5,\\"camera_fault\\":false}"}'),
        "ros_message_json",
        limits,
      ),
    ).toEqual({ status: 5, camera_fault: false });
    expect(() =>
      decodeMqttPayload(Buffer.from('{"available":true}'), "ros_message_json", limits),
    ).toThrow("UGV_MQTT_WIRE_SHAPE_MISMATCH");
  });

  it("decodes a heterogeneous ROS bridge stream without auto detection", () => {
    const directRosSamples = [
      {
        header: { stamp: { sec: 1_700_000_000, nanosec: 0 } },
        latitude: 30.1,
        longitude: 114.1,
      },
      { entity_id: "ugv1", id: 7, state: 1, progress: 25 },
      { entity_id: "ugv1", position_x: 1, position_y: 2, speed_kmh: 5 },
      { entity_id: "ugv1", run_state: 1, mode: 2, speed_limit: 30, err_list: [] },
      { entity_id: "ugv1", power_battery: { status: 1 } },
    ];
    for (const sample of directRosSamples)
      expect(decodeMqttPayload(json(sample), "ros_bridge_json", limits)).toEqual(sample);

    expect(decodeMqttPayload(json({ data: 12.5 }), "ros_bridge_json", limits)).toBe(12.5);
    expect(
      decodeMqttPayload(
        json({ layout: { dim: [] }, data: [45, -15, 3] }),
        "ros_bridge_json",
        limits,
      ),
    ).toEqual([45, -15, 3]);
    expect(
      decodeMqttPayload(
        json({ data: '{"status":5,"camera_fault":false}' }),
        "ros_bridge_json",
        limits,
      ),
    ).toEqual({ status: 5, camera_fault: false });

    const domainObjectWithData = { data: "{not-an-envelope", status: 5 };
    expect(decodeMqttPayload(json(domainObjectWithData), "ros_bridge_json", limits)).toEqual(
      domainObjectWithData,
    );
    expect(() =>
      decodeMqttPayload(json({ data: "{malformed" }), "ros_bridge_json", limits),
    ).toThrow("UGV_MQTT_INNER_JSON_INVALID");
    expect(() => decodeMqttPayload(json(42), "ros_bridge_json", limits)).toThrow(
      "UGV_MQTT_WIRE_SHAPE_MISMATCH",
    );
  });

  it("normalizes mixed direct ROS objects and ROS envelopes in one ingress", () => {
    const ingress = new VehicleMqttIngress("ros_bridge_json", limits);
    ingress.handle(
      "/ugv/gnss",
      json({
        header: { stamp: { sec: 1_700_000_000, nanosec: 0 } },
        entity_id: "ugv1",
        latitude: 30.1,
        longitude: 114.1,
      }),
    );
    ingress.handle("/ugv/battery_range_km", json({ data: 88.5 }));
    ingress.handle("/ugv/eo/pose", json({ layout: { dim: [] }, data: [45, -15, 3] }));
    ingress.handle(
      "/ugv/area_recon/status",
      json({ data: '{"status":5,"camera_fault":false,"progress":40}' }),
    );

    expect(ingress.snapshot()).toMatchObject({
      chassis: {
        position: { latitude: 30.1, longitude: 114.1 },
        energy: { rangeKm: 88.5 },
      },
      payload: {
        gimbal: { yaw: 45, pitch: -15, zoom: 3 },
        reconnaissance: { motionStatus: 5, cameraFault: false, progress: 40 },
      },
    });
  });

  it("tracks freshness independently for every physical observation field", () => {
    const ingress = directIngress();
    ingress.handle(
      "/ugv/gnss",
      json({ latitude: 30.1, longitude: 114.1 }),
      false,
      "2026-08-20T00:00:00.000Z",
    );
    const geodetic = ingress.fieldObservationAuthority("chassis.position.geodetic");
    expect(geodetic).toMatchObject({
      field: "chassis.position.geodetic",
      topic: "/ugv/gnss",
      observedAt: "2026-08-20T00:00:00.000Z",
      timeAuthority: "ingest",
      ingestSequence: 1,
    });
    expect(geodetic?.payloadHash).toMatch(/^[a-f0-9]{64}$/);

    ingress.handle("/ugv/speed", json({ speed_kmh: 0 }), false, "2026-08-20T00:00:04.000Z");
    expect(ingress.fieldObservationAuthority("chassis.position.geodetic")).toEqual(geodetic);
    expect(ingress.fieldObservationAuthority("chassis.speed")).toMatchObject({
      field: "chassis.speed",
      topic: "/ugv/speed",
      observedAt: "2026-08-20T00:00:04.000Z",
      ingestSequence: 2,
    });
    expect(
      ingress.fieldFreshnessState(
        "chassis.position.geodetic",
        3_000,
        Date.parse("2026-08-20T00:00:04.000Z"),
      ),
    ).toBe("stale");
    expect(
      ingress.fieldFreshnessState("chassis.speed", 3_000, Date.parse("2026-08-20T00:00:04.000Z")),
    ).toBe("fresh");
    const latestSpeed = ingress.fieldObservationAuthority("chassis.speed");
    ingress.handle("status/ugv", json({ veh_speed: 99 }), false, "2026-08-20T00:00:01.000Z");
    expect(ingress.snapshot().chassis.speedKmh).toBe(0);
    expect(ingress.fieldObservationAuthority("chassis.speed")).toEqual(latestSpeed);

    ingress.handle(
      "/ugv/nav_state",
      json({ position_x: 1, position_y: 2, position_z: 3, speed_kmh: 4 }),
      false,
      "2026-08-20T00:00:05.000Z",
    );
    ingress.handle(
      "status/ugv",
      json({
        heading: 90,
        chassis_task: { id: 7, state: 1 },
        gimbal: { yaw: 1, pitch: 2, zoom: 3 },
      }),
      false,
      "2026-08-20T00:00:06.000Z",
    );
    ingress.handle(
      "/ugv/area_recon/status",
      json({ status: 5 }),
      false,
      "2026-08-20T00:00:07.000Z",
    );
    ingress.handle(
      "/ugv/area_recon/targets",
      json({
        targets: [
          {
            target_id: 1,
            target_type: 2,
            capture_time_us: 1_777_000_000_000_000,
            position: { longitude: 114.1, latitude: 30.1 },
          },
        ],
      }),
      false,
      "2026-08-20T00:00:08.000Z",
    );

    expect(
      Object.fromEntries(
        ingress
          .fieldObservationAuthorities()
          .map((authority) => [authority.field, authority.topic]),
      ),
    ).toEqual({
      "chassis.position.geodetic": "/ugv/gnss",
      "chassis.position.local": "/ugv/nav_state",
      "chassis.speed": "/ugv/nav_state",
      "chassis.heading": "status/ugv",
      "chassis.mission": "status/ugv",
      "payload.recon": "/ugv/area_recon/status",
      "payload.targets": "/ugv/area_recon/targets",
      "payload.gimbal": "status/ugv",
    });
    expect(ingress.snapshot()).not.toHaveProperty("observationAuthorities");
  });

  it("uses the modern shared composite shape for NPC without treating EO as recon", () => {
    const ingress = new VehicleMqttIngress("direct_domain_json", limits, npcTankMqttProfile());
    ingress.handle(
      "/npc_tank1/status",
      json({
        available: true,
        heading: 20,
        gimbal: { yaw: 5, pitch: 1, zoom: 2 },
        eo_task: { id: "npc-eo", state: 4, progress: 100 },
      }),
    );
    expect(ingress.snapshot().payload.eoTask).toMatchObject({
      id: "npc-eo",
      state: 4,
      progress: 100,
    });
    expect(ingress.snapshot().payload.reconnaissance).toMatchObject({
      state: "unknown",
      motionStatus: "unknown",
    });
    expect(ingress.snapshot().chassis.compassHeadingDeg).toBe(20);
    expect(ingress.snapshot().connectivity.deviceAvailable).toBe(true);
  });

  it("deduplicates NPC detected objects using the modern target authority", () => {
    const ingress = new VehicleMqttIngress("direct_domain_json", limits, npcTankMqttProfile());
    ingress.handle(
      "/npc_tank1/detected_objects",
      json({
        objects: [
          { id: "010", object_type: "2:first", x: 1, y: 1, z: 0 },
          { id: 2, object_type: "3:second", x: 2, y: 2, z: 0 },
          { id: "010", object_type: "2:latest", x: 3, y: 3, z: 0 },
        ],
      }),
    );

    expect(
      ingress
        .snapshot()
        .payload.targets.map((target) => [target.targetId, target.position?.x, target.source]),
    ).toEqual([
      ["10", 3, "mqtt_detected_objects"],
      ["2", 2, "mqtt_detected_objects"],
    ]);
  });

  it("maps status/ugv availability, compass heading and EO task separately from IMU yaw", () => {
    const ingress = directIngress();
    ingress.handle(
      "status/ugv",
      json({
        available: true,
        heading: 31.25,
        veh_speed: 4.5,
        chassis_task: { id: 21, type: 1, state: 1, progress: 30 },
        eo_task: { id: 22, type: 2, state: 4, progress: 100 },
        weapon_task: { id: 23, type: 3, state: 0, progress: 0 },
        gimbal: { yaw: 12, pitch: -4, zoom: 2 },
      }),
    );
    ingress.handle("/ugv/imu", json({ yaw: 275, pitch: 1, roll: 2 }));
    expect(ingress.snapshot()).toMatchObject({
      chassis: {
        compassHeadingDeg: 31.25,
        attitude: { yaw: 275, pitch: 1, roll: 2 },
        mission: { id: "21", state: 1, progress: 30 },
      },
      payload: {
        eoTask: { id: "22", state: 4, progress: 100 },
        reconnaissance: { motionStatus: "unknown" },
        gimbal: { yaw: 12, pitch: -4, zoom: 2 },
      },
      connectivity: { deviceAvailable: true },
    });

    ingress.handle("status/ugv", json({ available: false }));
    expect(ingress.snapshot().connectivity).toMatchObject({
      mqttConnected: true,
      deviceAvailable: false,
    });

    ingress.handle(
      "status/ugv",
      json({
        heading: 31.5,
        chassis_task: { id: -1, type: -1, state: 0, progress: -1 },
        eo_task: { id: -1, type: -1, state: 0, progress: -1 },
        weapon_task: { id: -1, type: -1, state: 0, progress: -1 },
      }),
    );
    expect(ingress.snapshot().connectivity.deviceAvailable).toBe(true);
  });

  it("maps the live /ugv/status ROS String alias through the same composite normalizer", () => {
    const ingress = new VehicleMqttIngress("ros_bridge_json", limits);
    ingress.handle(
      "/ugv/status",
      json({
        data: JSON.stringify({
          available: true,
          heading: 42.5,
          veh_speed: 6,
          chassis_task: { id: 31, type: 1, state: 1, progress: 45 },
          eo_task: { id: 32, type: 2, state: 4, progress: 100 },
          weapon_task: { id: 33, type: 3, state: 0, progress: 0 },
          gimbal: { yaw: 8, pitch: -3, zoom: 2.5 },
        }),
      }),
    );

    expect(ingress.snapshot()).toMatchObject({
      chassis: {
        compassHeadingDeg: 42.5,
        speedKmh: 6,
        mission: { id: "31", state: 1, progress: 45 },
      },
      payload: {
        eoTask: { id: "32", state: 4, progress: 100 },
        gimbal: { yaw: 8, pitch: -3, zoom: 2.5 },
        weapon: { id: "33", state: 0, progress: 0 },
      },
      connectivity: { deviceAvailable: true },
    });
  });

  it("accepts the live empty chassis task sentinel without accepting active negative progress", () => {
    const ingress = new VehicleMqttIngress("ros_bridge_json", limits);
    ingress.handle(
      "/ugv/status",
      json({
        data: JSON.stringify({
          chassis_task: { id: -1, type: -1, state: 0, progress: -1 },
          eo_task: { id: 1088, type: -1, state: 4, progress: 100 },
          weapon_task: { id: 3, type: -1, state: 4, progress: 100 },
        }),
      }),
    );
    expect(ingress.snapshot().chassis.mission).toEqual({ state: 0 });
    expect(ingress.snapshot().payload.eoTask).toEqual({ id: "1088", state: 4, progress: 100 });
    expect(ingress.snapshot().payload.weapon).toEqual({ id: "3", state: 4, progress: 100 });

    expect(() =>
      ingress.handle(
        "/ugv/status",
        json({
          data: JSON.stringify({
            chassis_task: { id: 44, type: 1, state: 1, progress: -1 },
          }),
        }),
      ),
    ).toThrow("UGV_MQTT_TASK_PROGRESS_INVALID");
  });

  it("accepts MissionState 0..5 and reserves state -1 for explicit composite idle sentinels", () => {
    const ingress = new VehicleMqttIngress("ros_bridge_json", limits);
    for (const state of [0, 1, 2, 3, 4, 5])
      expect(() =>
        ingress.handle(
          "/ugv/mission_state",
          json({ entity_id: "ugv1", id: state + 1, type: 1, state, progress: state * 10 }),
        ),
      ).not.toThrow();

    expect(() =>
      ingress.handle(
        "/ugv/mission_state",
        json({ entity_id: "ugv1", id: 7, type: 1, state: -1, progress: 0 }),
      ),
    ).toThrow("UGV_MQTT_TASK_STATE_INVALID");
    expect(() =>
      ingress.handle(
        "status/ugv",
        json({ available: true, chassis_task: { id: 7, type: 1, state: -1, progress: 0 } }),
      ),
    ).toThrow("UGV_MQTT_TASK_STATE_INVALID");

    ingress.handle(
      "status/ugv",
      json({
        available: true,
        chassis_task: { id: -1, type: -1, state: -1, progress: -1 },
      }),
    );
    expect(ingress.stateConflict()).toBe(true);
    expect(ingress.snapshot().chassis.mission).toMatchObject({ id: "6", state: 5 });
  });

  it("keeps the dedicated mission topic primary and reports composite-state conflicts", () => {
    const ingress = new VehicleMqttIngress("ros_bridge_json", limits);
    ingress.handle(
      "status/ugv",
      json({ available: true, chassis_task: { id: 7, type: 1, state: 1, progress: 10 } }),
    );
    expect(ingress.taskStateAuthority()).toBe("SECONDARY");
    expect(ingress.snapshot().chassis.mission).toMatchObject({ id: "7", state: 1 });

    ingress.handle(
      "/ugv/mission_state",
      json({ entity_id: "ugv1", id: 7, type: 1, state: 1, progress: 20 }),
    );
    expect(ingress.taskStateAuthority()).toBe("PRIMARY");
    expect(ingress.stateConflict()).toBe(false);

    ingress.handle(
      "/ugv/status",
      json({ available: true, chassis_task: { id: 7, type: 1, state: 4, progress: 100 } }),
    );
    expect(ingress.stateConflict()).toBe(true);
    expect(ingress.snapshot().chassis.mission).toMatchObject({ id: "7", state: 1, progress: 20 });
    expect(ingress.fieldObservationAuthority("chassis.mission")?.topic).toBe("/ugv/mission_state");

    ingress.handle(
      "/ugv/mission_state",
      json({ entity_id: "ugv1", id: 7, type: 1, state: 4, progress: 100 }),
    );
    expect(ingress.stateConflict()).toBe(false);
    expect(ingress.snapshot().chassis.mission).toMatchObject({ id: "7", state: 4 });
  });

  it("decodes EO pose from an explicit heterogeneous ROS bridge envelope", () => {
    const ingress = new VehicleMqttIngress("ros_bridge_json", limits);
    ingress.handle("/ugv/eo/pose", json({ data: [45, -15, 3] }));
    expect(ingress.snapshot().payload.gimbal).toEqual({ yaw: 45, pitch: -15, zoom: 3 });
  });

  it("maps every Recon MotionStatus independently from MissionState", () => {
    const expected = new Map<ReconMotionStatus, string>([
      [1, "RECONCILE"],
      [2, "STARTING"],
      [3, "STARTING"],
      [4, "STARTING"],
      [5, "RUNNING"],
      [6, "RESUMING"],
      [7, "RUNNING"],
      [8, "PAUSED"],
      [9, "CANCELLED"],
      [10, "BUSINESS_FAILED"],
      [11, "SUCCEEDED"],
      [12, "STOPPING"],
      [13, "RECONCILE"],
      [99, "RECONCILE"],
    ]);
    expect(expected.size).toBe(14);
    for (const [status, state] of expected)
      expect(mapReconMotionStatus(status, true).state, `MotionStatus ${String(status)}`).toBe(
        state,
      );
    expect(projectReconMotionStatus(11)).toBe(4);
    expect(projectReconMotionStatus(10)).toBe(5);
    expect(projectReconMotionStatus(4)).toBe(0);
  });

  it("normalizes recon state and freezes progress and coverage during camera fault", () => {
    const ingress = directIngress();
    ingress.handle(
      "/ugv/area_recon/status",
      json({
        status: 5,
        status_label: "运行中",
        scan_mode: 1,
        scan_mode_label: "区域侦察",
        scan_pitch: -5,
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
        load_status_label: "正常",
        lock: { stage: 3, target_id: 42, role_name: "target", duration_sec: 8 },
        attack_ready: true,
        online: true,
        gimbal: { yaw: 10, pitch: -2, zoom: 1.5 },
        last_cmd_ack: {
          seq: 7,
          ok: true,
          message: "configured",
          data: {
            coverability: {
              coverable: "partial",
              coverable_label: "部分可覆盖",
              region_min_dist_m: 20,
              region_max_dist_m: 120,
              detection_range_m: 100,
            },
          },
        },
      }),
    );
    expect(ingress.snapshot().payload.reconnaissance).toMatchObject({
      motionStatus: 5,
      state: 1,
      outOfRange: true,
      cameraFault: false,
      progressAuthoritative: true,
      progress: 40,
      coverage: { coveragePercent: 40, coveredCount: 4, totalCount: 10 },
      lock: { stage: 3, targetId: "42" },
      attackReady: true,
      coverability: { coverable: "partial", detectionRangeM: 100 },
    });

    ingress.handle(
      "/ugv/area_recon/status",
      json({ status: 5, camera_fault: true, progress: 99, coverage: 99 }),
    );
    ingress.handle(
      "/ugv/area_recon/coverage",
      json({ run_id: 1, scan_mode: 1, coverage: 100, covered_n: 10, total: 10, covered: [] }),
    );
    expect(ingress.snapshot().payload.reconnaissance).toMatchObject({
      cameraFault: true,
      progressAuthoritative: false,
      progress: 40,
      coverage: { coveragePercent: 40, coveredCount: 4, totalCount: 10 },
    });

    ingress.handle("/ugv/area_recon/status", json({ status: 5, camera_fault: false }));
    expect(ingress.snapshot().payload.reconnaissance).toMatchObject({
      cameraFault: false,
      progressAuthoritative: false,
      progress: 40,
    });

    ingress.handle(
      "/ugv/area_recon/status",
      json({ status: 5, camera_fault: false, progress: 55, coverage: 55 }),
    );
    expect(ingress.snapshot().payload.reconnaissance).toMatchObject({
      cameraFault: false,
      progressAuthoritative: true,
      progress: 55,
      coverage: { coveragePercent: 55 },
    });
  });

  it("normalizes recon exception evidence without carrying target damage", () => {
    const ingress = directIngress();
    ingress.handle(
      "/ugv/area_recon/exception",
      json({
        kind: "equipment",
        level: 1,
        error_code: 1,
        time_us: 1_700_000_000_000_000,
        target_info: { reason: "camera pose invalid", damage: 99 },
      }),
    );
    expect(ingress.snapshot().payload.reconnaissance.lastException).toMatchObject({
      kind: "equipment",
      level: 1,
      errorCode: 1,
      timeUs: 1_700_000_000_000_000,
      reason: "camera pose invalid",
    });
    expect(JSON.stringify(ingress.snapshot())).not.toContain("damage");
  });

  it("uses rich target identity/source time, removes damage and honors authoritative empty lists", () => {
    const ingress = directIngress();
    ingress.handle(
      "/ugv/detected_objects",
      json({
        header: { stamp: { sec: 1_699_999_999, nanosec: 0 } },
        objects: [{ id: 42, object_type: "2:tank", x: 1, y: 2, z: 0 }],
      }),
    );
    expect(ingress.snapshot().payload.targets[0]?.source).toBe("mqtt_detected_objects");

    ingress.handle(
      "/ugv/area_recon/targets",
      json({
        targets: [
          richTarget(42, 1_700_000_000_000_000, 0.5),
          richTarget(42, 1_700_000_001_000_000, 0.95),
        ],
      }),
    );
    expect(ingress.snapshot().payload.targets).toHaveLength(1);
    expect(ingress.snapshot().payload.targets[0]).toMatchObject({
      targetId: "42",
      source: "mqtt_area_recon",
      captureTimeUs: 1_700_000_001_000_000,
      targetType: 2,
      position: { longitude: 114.1, latitude: 30.1, altitude: 4 },
      velocity: { eastMps: 1, northMps: 2, upMps: 0 },
      distanceM: 88,
      confidence: 0.95,
      threat: 7,
      iff: 1,
      pixelPosition: { x: 10, y: 20, width: 30, height: 40 },
    });
    expect(JSON.stringify(ingress.snapshot().payload.targets)).not.toContain("damage");

    ingress.handle(
      "/ugv/detected_objects",
      json({ objects: [{ id: 99, object_type: "3:new", x: 9, y: 9, z: 0 }] }),
      false,
      "2025-01-01T00:00:00.000Z",
    );
    expect(ingress.snapshot().payload.targets.map(({ targetId }) => targetId)).toEqual(["42"]);

    ingress.handle(
      "/ugv/area_recon/targets",
      json({ targets: [] }),
      false,
      "2025-01-01T00:00:01.000Z",
    );
    expect(ingress.snapshot().payload.targets).toEqual([]);
    ingress.handle(
      "/ugv/detected_objects",
      json({ objects: [{ id: 100, object_type: "3:new", x: 9, y: 9, z: 0 }] }),
      false,
      "2025-01-01T00:00:02.000Z",
    );
    expect(ingress.snapshot().payload.targets).toEqual([]);
  });

  it("rejects screenshots before payload decoding", () => {
    const ingress = directIngress();
    expect(() => ingress.handle("/ugv/target/base64", Buffer.from("not-json"))).toThrow(
      "UGV_MQTT_TOPIC_NOT_ALLOWED",
    );
  });
});

function directIngress(): VehicleMqttIngress {
  return new VehicleMqttIngress("direct_domain_json", limits);
}

function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
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
    role_name: "tank",
  };
}
