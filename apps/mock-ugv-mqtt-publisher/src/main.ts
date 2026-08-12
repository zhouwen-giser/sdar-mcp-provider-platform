import { connect } from "mqtt";
import { UGV_MQTT_TOPICS, ugvMqttQos } from "../../../packages/vehicle-mqtt-ingress/src/index.js";

const url = process.env.UGV_MQTT_URL ?? "mqtt://127.0.0.1:1883";
const wireMode = process.env.UGV_MQTT_WIRE_MODE ?? "ros_bridge_json";
if (!new Set(["direct_domain_json", "ros_message_json", "ros_bridge_json"]).has(wireMode))
  throw new Error("MOCK_UGV_MQTT_WIRE_MODE_INVALID");
const client = connect(url, { clientId: "mock-ugv-publisher", clean: true, reconnectPeriod: 500 });
let progress = 0;
client.on("connect", () => publish());
const timer = setInterval(publish, 1000);

function publish(): void {
  if (!client.connected) return;
  progress = Math.min(100, progress + 10);
  const messages: Record<string, unknown> = {
    "/ugv/gnss": { entity_id: "ugv1", latitude: 30.123, longitude: 114.456, altitude: 42 },
    "/ugv/imu": { entity_id: "ugv1", yaw: 0, pitch: 0, roll: 0 },
    "/ugv/speed": { speed_kmh: 0 },
    "status/ugv": {
      vehicle_id: "ugv1",
      role_name: "ugv",
      veh_speed: 0,
      heading: 0,
      chassis_task: { id: 1001, state: progress < 100 ? 1 : 4, progress },
      eo_task: { id: 3001, state: 4, progress: 100 },
      weapon_task: { id: 4001, state: 0, progress: 0 },
      gimbal: { yaw: 0, pitch: 0, zoom: 1 },
      available: true,
    },
    "/ugv/system_state": {
      entity_id: "ugv1",
      run_state: 1,
      mode: 1,
      speed_limit: 20,
      err_list: [],
    },
    "/ugv/component_status": {
      entity_id: "ugv1",
      power_battery: 0,
      lvbattery: 0,
      fuel: 0,
      water_temp: 0,
      motor: 0,
      sensor: 0,
      gnss: 0,
      comms: 0,
      weapon: 0,
      navigation: 0,
    },
    "/ugv/battery_range_km": { range_km: 35.2 },
    "/ugv/mission_state": {
      entity_id: "ugv1",
      id: 1001,
      type: 1,
      state: -1,
      progress: 0,
    },
    "/ugv/nav_state": {
      entity_id: "ugv1",
      position_x: 0,
      position_y: 0,
      position_z: 0,
      speed_kmh: 0,
      battery_range_km: 35.2,
    },
    "/ugv/detected_objects": {
      entity_id: "ugv1",
      objects: [{ id: 101, object_type: "3:target-vehicle", x: 1, y: 2, z: 0 }],
    },
    "/ugv/target_detected": { message: "target detected" },
    "/ugv/target/gnss": { entity_id: "ugv1", latitude: 30.124, longitude: 114.457 },
    "/ugv/eo/pose": { entity_id: "ugv1", data: [0, 0, 1] },
    "/ugv/area_recon/status": {
      status: progress < 100 ? 5 : 11,
      status_label: progress < 100 ? "running" : "finished",
      scan_mode: 1,
      scan_mode_label: "area",
      scan_pitch: 0,
      out_of_range: false,
      camera_fault: false,
      scan_num: 1,
      progress,
      coverage: progress,
      coverage_covered: progress,
      coverage_total: 100,
      coverage_incomplete: false,
      coverage_reason: "",
      work_mode: 1,
      recon_type: 1,
      load_status: 1,
      load_status_label: "normal",
      lock: { stage: 1, target_id: 0, role_name: "", duration_sec: 0 },
      attack_ready: false,
      last_cmd_ack: { seq: 1, ok: true, message: "mock" },
    },
    "/ugv/area_recon/targets": {
      targets: [
        {
          capture_time_us: Date.now() * 1000,
          target_id: 101,
          type: 3,
          position: { longitude: 114.457, latitude: 30.124, altitude: 0 },
          velocity: { vel_e: 0, vel_n: 0, vel_u: 0 },
          distance: 20,
          confidence: 0.9,
          threat: 1,
          iff: 0,
          lock_time: 0,
          pixel_pos: { x: 100, y: 100, theta: 0, w: 20, h: 20 },
          role_name: "target-vehicle",
        },
      ],
    },
    "/ugv/area_recon/exception": undefined,
    "/ugv/area_recon/coverage": {
      run_id: 2001,
      scan_mode: 1,
      cell_size: 1,
      coverage: progress,
      covered_n: progress,
      total: 100,
      covered: [],
    },
  };
  for (const topic of UGV_MQTT_TOPICS) {
    const message = messages[topic];
    if (message === undefined) continue;
    client.publish(topic, JSON.stringify(encode(topic, message)), {
      qos: ugvMqttQos(topic),
      retain: false,
    });
  }
}

function encode(topic: string, message: unknown): unknown {
  if (wireMode === "ros_message_json") return { data: JSON.stringify(message) };
  if (wireMode !== "ros_bridge_json") return message;
  if (topic === "/ugv/eo/pose") return { data: (message as { data: unknown }).data };
  if (topic.startsWith("/ugv/area_recon/")) return { data: JSON.stringify(message) };
  return message;
}
const stop = () => {
  clearInterval(timer);
  client.end();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
