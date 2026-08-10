export const UGV_MQTT_SUBSCRIPTIONS = [
  { topic: "/ugv/gnss", qos: 1 },
  { topic: "/ugv/imu", qos: 1 },
  { topic: "/ugv/speed", qos: 1 },
  { topic: "status/ugv", qos: 1 },
  // Live ROS bridge compatibility alias. Keep this exact; wildcards remain forbidden.
  { topic: "/ugv/status", qos: 1 },
  { topic: "/ugv/system_state", qos: 1 },
  { topic: "/ugv/component_status", qos: 1 },
  { topic: "/ugv/battery_range_km", qos: 1 },
  { topic: "/ugv/mission_state", qos: 1 },
  { topic: "/ugv/nav_state", qos: 1 },
  { topic: "/ugv/eo/pose", qos: 1 },
  { topic: "/ugv/detected_objects", qos: 1 },
  { topic: "/ugv/target_detected", qos: 1 },
  { topic: "/ugv/target/gnss", qos: 1 },
  { topic: "/ugv/area_recon/status", qos: 1 },
  { topic: "/ugv/area_recon/targets", qos: 1 },
  { topic: "/ugv/area_recon/exception", qos: 1 },
  { topic: "/ugv/area_recon/coverage", qos: 0 },
] as const;

export type UgvMqttTopic = (typeof UGV_MQTT_SUBSCRIPTIONS)[number]["topic"];
// Deliberately expose a readonly string list so legacy mock publishers do not
// become the type authority for the expanded real-interface topic inventory.
export const UGV_MQTT_TOPICS: readonly string[] = UGV_MQTT_SUBSCRIPTIONS.map(({ topic }) => topic);

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
  if (
    topics.length !== UGV_MQTT_TOPICS.length ||
    new Set(topics).size !== UGV_MQTT_TOPICS.length ||
    topics.some((topic) => !exactUgvTopic(topic))
  )
    throw new Error("UGV_MQTT_TOPIC_NOT_ALLOWED");
  if (topics.some((topic) => topic.includes("#") || topic.includes("+")))
    throw new Error("UGV_MQTT_WILDCARD_FORBIDDEN");
}

export function assertExactNpcTankSubscriptions(topics: readonly string[]): void {
  if (
    topics.length !== NPC_TANK_MQTT_TOPICS.length ||
    new Set(topics).size !== NPC_TANK_MQTT_TOPICS.length ||
    topics.some((topic) => !exactNpcTankTopic(topic))
  )
    throw new Error("NPC_TANK_MQTT_TOPIC_NOT_ALLOWED");
  if (topics.some((topic) => topic.includes("#") || topic.includes("+")))
    throw new Error("NPC_TANK_MQTT_WILDCARD_FORBIDDEN");
}

export function ugvMqttQos(topic: string): 0 | 1 {
  const subscription = UGV_MQTT_SUBSCRIPTIONS.find((candidate) => candidate.topic === topic);
  if (subscription === undefined) throw new Error("UGV_MQTT_TOPIC_NOT_ALLOWED");
  return subscription.qos;
}

export function npcTankMqttQos(topic: string): 0 | 1 {
  if (!exactNpcTankTopic(topic)) throw new Error("NPC_TANK_MQTT_TOPIC_NOT_ALLOWED");
  // Preserve the existing NPC contract. Goal 10 changes only the UGV real boundary.
  return topic.endsWith("/speed") ? 0 : 1;
}
