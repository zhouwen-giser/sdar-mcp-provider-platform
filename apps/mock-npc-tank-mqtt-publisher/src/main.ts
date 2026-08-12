import { connect } from "mqtt";
import {
  NPC_TANK_MQTT_TOPICS,
  npcTankMqttQos,
} from "../../../packages/vehicle-mqtt-ingress/src/index.js";

const url = process.env.NPC_TANK_MQTT_URL ?? "mqtt://127.0.0.1:1886";
const conflict = process.env.MOCK_NPC_TANK_TASK_CONFLICT === "true";
const client = connect(url, {
  clientId: "mock-npc-tank-publisher",
  clean: true,
  reconnectPeriod: 500,
});
let progress = 0;
client.on("connect", () => publish());
const timer = setInterval(publish, 1000);

function publish(): void {
  if (!client.connected) return;
  progress = Math.min(100, progress + 10);
  const taskState = progress < 100 ? 1 : 4;
  const messages: Record<string, unknown> = {
    "/npc_tank1/gnss": {
      entity_id: "npc_tank1",
      latitude: 30.123,
      longitude: 114.456,
      altitude: 42,
    },
    "/npc_tank1/imu": { entity_id: "npc_tank1", yaw: 0, pitch: 0, roll: 0 },
    "/npc_tank1/speed": { speed_kmh: 0 },
    "status/npc_tank1": {
      device_id: "npc_tank1",
      mode: "autonomous",
      status: taskState === 1 ? "moving" : "stopped",
      speed: 0,
      position: { longitude: 114.456, latitude: 30.123, altitude: 42 },
      remainder_range: 40.2,
    },
    "/npc_tank1/status": {
      entity_id: "npc_tank1",
      vehicle_id: "npc_tank1",
      role_name: "npc_tank1",
      speed_kmh: 0,
      chassis_task: {
        id: 1,
        type: 1,
        state: conflict ? 5 : taskState,
        progress,
      },
      eo_task: { id: -1, type: -1, state: -1, progress: -1 },
      weapon_task: { id: -1, type: -1, state: -1, progress: -1 },
      available: true,
    },
    "/npc_tank1/system_state": {
      entity_id: "npc_tank1",
      run_state: conflict ? 4 : 1,
      mode: conflict ? 9 : 1,
      speed_limit: 20,
      err_list: [],
    },
    "/npc_tank1/component_status": {
      entity_id: "npc_tank1",
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
    "/npc_tank1/battery_range_km": { range_km: 40.2 },
    "/npc_tank1/mission_state": {
      entity_id: "npc_tank1",
      id: 1,
      type: 1,
      state: taskState,
      progress,
    },
    "/npc_tank1/nav_state": {
      entity_id: "npc_tank1",
      position_x: 0,
      position_y: 0,
      position_z: 0,
      speed_kmh: 0,
      battery_range_km: 40.2,
    },
    "/npc_tank1/eo/pose": [0, 0, 1],
    "/npc_tank1/detected_objects": {
      entity_id: "npc_tank1",
      objects: [{ id: "target-1", object_type: "tank", x: 1, y: 2, z: 0 }],
    },
    "/npc_tank1/target_detected": { message: "target detected" },
    "/npc_tank1/target/gnss": {
      entity_id: "npc_tank1",
      latitude: 30.124,
      longitude: 114.457,
    },
    "/npc_tank1/area_recon/status": {
      status: 1,
      status_label: "idle",
      scan_mode: 1,
      out_of_range: false,
      camera_fault: false,
      progress: 0,
      coverage: 0,
      lock: { stage: 1, target_id: 0, role_name: "", duration_sec: 0 },
      attack_ready: false,
      online: true,
    },
    "/npc_tank1/area_recon/targets": {
      targets: [
        {
          capture_time_us: 1_786_320_000_000_000,
          target_id: 1,
          type: 3,
          position: { longitude: 114.457, latitude: 30.124, altitude: 0 },
          velocity: { vel_e: 0, vel_n: 0, vel_u: 0 },
          distance: 10,
          confidence: 0.9,
          role_name: "mock-target",
        },
      ],
    },
    "/npc_tank1/area_recon/exception": {
      kind: "unknown",
      level: 1,
      error_code: 0,
      time_us: 1_786_320_000_000_000,
      target_info: { reason: "mock_fixture_heartbeat" },
    },
    "/npc_tank1/area_recon/coverage": {
      run_id: 1,
      scan_mode: 1,
      coverage: 0,
      covered_n: 0,
      total: 1,
      cell_size: 1,
      covered: [],
    },
  };
  for (const topic of NPC_TANK_MQTT_TOPICS) {
    const message = messages[topic];
    if (message === undefined) throw new Error(`MOCK_NPC_TANK_TOPIC_FIXTURE_MISSING:${topic}`);
    client.publish(topic, JSON.stringify(message), {
      qos: npcTankMqttQos(topic),
      retain: false,
    });
  }
}
const stop = () => {
  clearInterval(timer);
  client.end();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
