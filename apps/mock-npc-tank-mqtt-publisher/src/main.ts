import { connect } from "mqtt";
import { NPC_TANK_MQTT_TOPICS } from "../../../packages/vehicle-mqtt-ingress/src/index.js";

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
  const messages: Record<(typeof NPC_TANK_MQTT_TOPICS)[number], unknown> = {
    "/npc_tank1/gnss": {
      entity_id: "npc_tank1",
      latitude: 30.123,
      longitude: 114.456,
      altitude: 42,
    },
    "/npc_tank1/imu": { entity_id: "npc_tank1", yaw: 0, pitch: 0, roll: 0 },
    "/npc_tank1/speed": { speed_kmh: 0 },
    "/npc_tank1/status": {
      vehicle_id: "npc_tank1",
      role_name: "npc_tank1",
      speed_kmh: 0,
      chassis_task: {
        id: "mock-npc-mission-1",
        state: conflict ? 5 : taskState,
        progress,
      },
      eo_task: { id: "mock-npc-recon-1", state: -1, progress: 0 },
      weapon_task: { id: "mock-npc-fire-1", state: -1, progress: 0 },
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
      id: "mock-npc-mission-1",
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
  };
  for (const topic of NPC_TANK_MQTT_TOPICS)
    client.publish(topic, JSON.stringify(messages[topic]), {
      qos: topic.endsWith("/speed") ? 0 : 1,
      retain: false,
    });
}
const stop = () => {
  clearInterval(timer);
  client.end();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
