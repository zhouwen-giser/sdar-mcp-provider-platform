export const UGV_MQTT_TOPICS = [
  "/ugv/gnss",
  "/ugv/imu",
  "/ugv/speed",
  "/ugv/status",
  "/ugv/system_state",
  "/ugv/component_status",
  "/ugv/battery_range_km",
  "/ugv/mission_state",
  "/ugv/nav_state",
  "/ugv/detected_objects",
  "/ugv/target_detected",
  "/ugv/target/gnss",
] as const;

export const NPC_TANK_MQTT_TOPICS = [
  "/npc_tank1/gnss",
  "/npc_tank1/imu",
  "/npc_tank1/speed",
  "/npc_tank1/status",
  "/npc_tank1/system_state",
  "/npc_tank1/component_status",
  "/npc_tank1/battery_range_km",
  "/npc_tank1/mission_state",
  "/npc_tank1/nav_state",
  "/npc_tank1/detected_objects",
  "/npc_tank1/target_detected",
  "/npc_tank1/target/gnss",
] as const;

export type UgvMqttTopic = (typeof UGV_MQTT_TOPICS)[number];
export type NpcTankMqttTopic = (typeof NPC_TANK_MQTT_TOPICS)[number];
const TOPICS = new Set<string>(UGV_MQTT_TOPICS);
const NPC_TOPICS = new Set<string>(NPC_TANK_MQTT_TOPICS);

export function exactUgvTopic(value: string): value is UgvMqttTopic {
  return TOPICS.has(value);
}

export function exactNpcTankTopic(value: string): value is NpcTankMqttTopic {
  return NPC_TOPICS.has(value);
}

export function assertExactSubscriptions(topics: readonly string[]): void {
  if (topics.length !== UGV_MQTT_TOPICS.length || topics.some((topic) => !exactUgvTopic(topic)))
    throw new Error("UGV_MQTT_TOPIC_NOT_ALLOWED");
  if (topics.some((topic) => topic.includes("#") || topic.includes("+")))
    throw new Error("UGV_MQTT_WILDCARD_FORBIDDEN");
}

export function assertExactNpcTankSubscriptions(topics: readonly string[]): void {
  if (
    topics.length !== NPC_TANK_MQTT_TOPICS.length ||
    topics.some((topic) => !exactNpcTankTopic(topic))
  )
    throw new Error("NPC_TANK_MQTT_TOPIC_NOT_ALLOWED");
  if (topics.some((topic) => topic.includes("#") || topic.includes("+")))
    throw new Error("NPC_TANK_MQTT_WILDCARD_FORBIDDEN");
}
