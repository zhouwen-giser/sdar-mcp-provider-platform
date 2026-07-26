import { connect } from "mqtt";
import { UGV_MQTT_TOPICS } from "../../../packages/vehicle-mqtt-ingress/src/index.js";

const url = process.env.UGV_MQTT_URL ?? "mqtt://127.0.0.1:1883";
const client = connect(url, { clientId: "mock-ugv-publisher", clean: true, reconnectPeriod: 500 });
let progress = 0;
client.on("connect", () => publish());
const timer = setInterval(publish, 1000);

function publish(): void {
  if (!client.connected) return;
  progress = Math.min(100, progress + 10);
  const messages: Record<(typeof UGV_MQTT_TOPICS)[number], unknown> = {
    "/ugv/gnss": { entity_id: "ugv1", latitude: 30.123, longitude: 114.456, altitude: 42 },
    "/ugv/imu": { entity_id: "ugv1", yaw: 0, pitch: 0, roll: 0 },
    "/ugv/speed": { speed_kmh: 0 },
    "/ugv/status": {
      vehicle_id: "ugv1",
      role_name: "ugv",
      speed_kmh: 0,
      chassis_task: { id: "mock-mission-1", state: progress < 100 ? -1 : 4, progress },
      eo_task: { id: "mock-recon-1", state: -1, progress: 0 },
      weapon_task: { id: "mock-fire-1", state: -1, progress: 0 },
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
      id: "mock-mission-1",
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
      objects: [{ id: "target-1", object_type: "tank", x: 1, y: 2, z: 0 }],
    },
    "/ugv/target_detected": { message: "target detected" },
    "/ugv/target/gnss": { entity_id: "ugv1", latitude: 30.124, longitude: 114.457 },
  };
  for (const topic of UGV_MQTT_TOPICS)
    client.publish(topic, JSON.stringify(messages[topic]), {
      qos: topic === "/ugv/speed" ? 0 : 1,
      retain: false,
    });
}
const stop = () => {
  clearInterval(timer);
  client.end();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
