import type {
  ComponentHealth,
  FreshnessDomain,
  SnapshotPatch,
  VehicleTarget,
  VehicleTaskState,
} from "../../vehicle-provider-core/src/index.js";
import { record } from "./guard.js";
import type { NpcTankMqttTopic, UgvMqttTopic } from "./topics.js";

export interface NormalizedMqttObservation {
  patch: SnapshotPatch;
  domains: FreshnessDomain[];
  sourceObservedAt?: string;
  timeAuthority: "source" | "ingest";
  canonicalPayload: unknown;
}

export function normalizeMqttObservation(
  topic: UgvMqttTopic,
  value: unknown,
): NormalizedMqttObservation {
  const object = record(value) ? value : undefined;
  validateIdentity(object);
  const sourceObservedAt = headerTimestamp(object?.header);
  const base = {
    ...(sourceObservedAt === undefined ? {} : { sourceObservedAt }),
    timeAuthority: sourceObservedAt === undefined ? ("ingest" as const) : ("source" as const),
    canonicalPayload: value,
  };
  switch (topic) {
    case "/ugv/gnss": {
      const latitude = number(object?.latitude);
      const longitude = number(object?.longitude);
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)
        throw new Error("UGV_MQTT_GNSS_INVALID");
      const altitude = optionalNumber(object?.altitude);
      return {
        ...base,
        patch: {
          chassis: {
            position: {
              latitude,
              longitude,
              ...(altitude === undefined ? {} : { altitude }),
            },
          },
        },
        domains: ["chassis"],
      };
    }
    case "/ugv/imu":
      return {
        ...base,
        patch: {
          chassis: {
            attitude: {
              yaw: number(object?.yaw),
              pitch: number(object?.pitch),
              roll: number(object?.roll),
            },
          },
        },
        domains: ["chassis"],
      };
    case "/ugv/speed":
      return {
        ...base,
        patch: { chassis: { speedKmh: number(record(value) ? value.speed_kmh : value) } },
        domains: ["chassis"],
      };
    case "/ugv/status":
      return composite(object, base);
    case "/ugv/system_state":
      return {
        ...base,
        patch: {
          health: {
            runState: integer(object?.run_state),
            mode: integer(object?.mode),
            speedLimitKmh: number(object?.speed_limit),
            chassisErrorCodes: integers(object?.err_list),
          },
        },
        domains: ["health"],
      };
    case "/ugv/component_status":
      return {
        ...base,
        patch: {
          health: {
            components: {
              powerBattery: component(object?.power_battery),
              lowVoltageBattery: component(object?.lvbattery),
              fuel: component(object?.fuel),
              waterTemperature: component(object?.water_temp),
              motor: component(object?.motor),
              sensor: component(object?.sensor),
              gnss: component(object?.gnss),
              communications: component(object?.comms),
              weapon: component(object?.weapon),
              navigation: component(object?.navigation),
            },
          },
        },
        domains: ["health"],
      };
    case "/ugv/battery_range_km": {
      const rangeKm = number(record(value) ? (value.range_km ?? value.data) : value);
      if (rangeKm < 0) throw new Error("UGV_MQTT_BATTERY_RANGE_INVALID");
      return {
        ...base,
        patch: { chassis: { energy: { rangeKm } } },
        domains: ["chassis"],
      };
    }
    case "/ugv/mission_state":
      return {
        ...base,
        patch: { chassis: { mission: track(object) } },
        domains: ["mission"],
      };
    case "/ugv/nav_state":
      return {
        ...base,
        patch: {
          chassis: {
            navigation: optionalNumbers(object, {
              positionX: "position_x",
              positionY: "position_y",
              positionZ: "position_z",
              speedKmh: "speed_kmh",
              batteryRangeKm: "battery_range_km",
            }),
          },
        },
        domains: ["chassis"],
      };
    case "/ugv/detected_objects": {
      if (!Array.isArray(object?.objects)) throw new Error("UGV_MQTT_TARGETS_INVALID");
      const observedAt = sourceObservedAt ?? new Date().toISOString();
      const targets = object.objects.map((item): VehicleTarget => {
        if (!record(item)) throw new Error("UGV_MQTT_TARGET_INVALID");
        const targetId = id(item.id);
        const position = optionalNumbers(item, { x: "x", y: "y", z: "z" });
        const objectType = scalarText(item.object_type);
        return {
          targetId,
          ...(objectType === undefined ? {} : { objectType }),
          ...(Object.keys(position).length === 0 ? {} : { position }),
          coordinateFrame: "carla_world",
          source: "mqtt",
          observedAt,
        };
      });
      return {
        ...base,
        patch: { payload: { targets } },
        domains: ["target"],
      };
    }
    case "/ugv/target_detected":
      return { ...base, patch: {}, domains: ["target"] };
    case "/ugv/target/gnss":
      return { ...base, patch: {}, domains: ["target"] };
  }
}

export function normalizeNpcTankMqttObservation(
  topic: NpcTankMqttTopic,
  value: unknown,
): NormalizedMqttObservation {
  const object = record(value) ? value : undefined;
  validateNpcTankIdentity(object);
  const rewritten = structuredClone(value);
  if (record(rewritten)) {
    if (Object.hasOwn(rewritten, "entity_id")) rewritten.entity_id = "ugv1";
    if (Object.hasOwn(rewritten, "vehicle_id")) rewritten.vehicle_id = "ugv1";
    if (Object.hasOwn(rewritten, "role_name")) rewritten.role_name = "ugv";
    if (Object.hasOwn(rewritten, "role")) rewritten.role = "ugv";
  }
  try {
    const normalized = normalizeMqttObservation(
      topic.replace("/npc_tank1/", "/ugv/") as UgvMqttTopic,
      rewritten,
    );
    return { ...normalized, canonicalPayload: value };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("UGV_"))
      throw new Error(error.message.replace(/^UGV_/, "NPC_TANK_"), { cause: error });
    throw error;
  }
}

function composite(
  object: Record<string, unknown> | undefined,
  base: Omit<NormalizedMqttObservation, "patch" | "domains">,
): NormalizedMqttObservation {
  if (object === undefined) throw new Error("UGV_MQTT_STATUS_INVALID");
  if (object.available === false)
    return { ...base, patch: { connectivity: { mqttConnected: true } }, domains: [] };
  const chassisTask = record(object.chassis_task) ? track(object.chassis_task) : undefined;
  const eoTask = record(object.eo_task) ? track(object.eo_task) : undefined;
  const weaponTask = record(object.weapon_task) ? track(object.weapon_task) : undefined;
  const speedKmh = optionalNumber(object.speed_kmh ?? object.veh_speed);
  const packetLossRate = optionalNumber(object.packet_loss_rate);
  const averageRoundTripTimeMs = optionalNumber(object.average_round_trip_time);
  return {
    ...base,
    patch: {
      chassis: {
        ...(speedKmh === undefined ? {} : { speedKmh }),
        energy: optionalNumbers(object, {
          lowVoltageSoc: "lvbattery_soc",
          highVoltage1Soc: "hvbattery1_soc",
          highVoltage2Soc: "hvbattery2_soc",
          fuel1: "fuel1",
          fuel2: "fuel2",
        }),
        temperature: optionalNumbers(object, {
          motor: "motor_temp",
          engineWater: "engine_water_temp",
        }),
        ...(chassisTask === undefined ? {} : { mission: chassisTask }),
      },
      payload: {
        ...(eoTask === undefined ? {} : { reconnaissance: eoTask }),
        ...(weaponTask === undefined ? {} : { weapon: weaponTask }),
      },
      connectivity: {
        ...(packetLossRate === undefined ? {} : { packetLossRate }),
        ...(averageRoundTripTimeMs === undefined ? {} : { averageRoundTripTimeMs }),
      },
    },
    domains: ["chassis", "mission", "payload"],
  };
}

function validateIdentity(object: Record<string, unknown> | undefined): void {
  const entity = object?.entity_id ?? object?.vehicle_id;
  if (entity !== undefined && entity !== "ugv1" && entity !== "ugv")
    throw new Error("UGV_MQTT_ENTITY_MISMATCH");
  const role = object?.role_name ?? object?.role;
  if (role !== undefined && role !== "ugv") throw new Error("UGV_MQTT_ROLE_MISMATCH");
}
function validateNpcTankIdentity(object: Record<string, unknown> | undefined): void {
  const entity = object?.entity_id ?? object?.vehicle_id;
  if (entity !== undefined && entity !== "npc_tank1")
    throw new Error("NPC_TANK_MQTT_ENTITY_MISMATCH");
  const role = object?.role_name ?? object?.role;
  if (role !== undefined && role !== "npc_tank1") throw new Error("NPC_TANK_MQTT_ROLE_MISMATCH");
}
function track(object: Record<string, unknown> | undefined) {
  if (object === undefined) throw new Error("UGV_MQTT_TASK_TRACK_INVALID");
  const state = integer(object.state) as VehicleTaskState;
  if (!new Set([-1, 0, 1, 2, 3, 4, 5]).has(state as number))
    throw new Error("UGV_MQTT_TASK_STATE_INVALID");
  const progress = optionalNumber(object.progress);
  const taskId = scalarText(object.id);
  if (progress !== undefined && (progress < 0 || progress > 100))
    throw new Error("UGV_MQTT_TASK_PROGRESS_INVALID");
  return {
    ...(taskId === undefined ? {} : { id: taskId }),
    ...(object.type === undefined ? {} : { type: object.type as string | number }),
    state,
    ...(progress === undefined ? {} : { progress }),
  };
}
function component(value: unknown): ComponentHealth {
  return value === 0 ? "normal" : value === 1 ? "fault" : "unknown";
}
function headerTimestamp(value: unknown): string | undefined {
  if (!record(value) || !record(value.stamp)) return undefined;
  const seconds = optionalNumber(value.stamp.sec ?? value.stamp.secs);
  const nanos = optionalNumber(value.stamp.nanosec ?? value.stamp.nsecs) ?? 0;
  if (seconds === undefined || seconds < 0 || nanos < 0 || nanos >= 1_000_000_000) return undefined;
  return new Date(seconds * 1000 + nanos / 1_000_000).toISOString();
}
function optionalNumbers<T extends Record<string, string>>(
  object: Record<string, unknown> | undefined,
  mapping: T,
): { [K in keyof T]?: number } {
  const result: Record<string, number> = {};
  for (const [target, source] of Object.entries(mapping)) {
    const value = optionalNumber(object?.[source]);
    if (value !== undefined) result[target] = value;
  }
  return result;
}
function scalarText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}
function id(value: unknown): string {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).length === 0)
    throw new Error("UGV_MQTT_TARGET_ID_INVALID");
  return String(value);
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("UGV_MQTT_NUMBER_INVALID");
  return value;
}
function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function integer(value: unknown): number {
  const parsed = number(value);
  if (!Number.isInteger(parsed)) throw new Error("UGV_MQTT_INTEGER_INVALID");
  return parsed;
}
function integers(value: unknown): number[] {
  if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item)))
    throw new Error("UGV_MQTT_INTEGER_ARRAY_INVALID");
  return value as number[];
}
