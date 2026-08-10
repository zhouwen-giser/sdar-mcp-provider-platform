import {
  projectReconMotionStatus,
  type ComponentHealth,
  type FreshnessDomain,
  type ReconCommandAck,
  type ReconCoverability,
  type ReconCoverageObservation,
  type ReconExceptionObservation,
  type ReconMotionStatus,
  type SnapshotPatch,
  type VehicleTarget,
  type VehicleTaskState,
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
  return normalizeVehicleMqttObservation(topic, value, object);
}

function normalizeVehicleMqttObservation(
  topic: UgvMqttTopic,
  value: unknown,
  object: Record<string, unknown> | undefined,
): NormalizedMqttObservation {
  const base = observationBase(value, object);
  switch (topic) {
    case "/ugv/gnss": {
      const latitudeValue = latitude(object?.latitude);
      const longitudeValue = longitude(object?.longitude);
      const altitude = optionalNumber(object?.altitude);
      return {
        ...base,
        patch: {
          chassis: {
            position: {
              latitude: latitudeValue,
              longitude: longitudeValue,
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
    case "status/ugv":
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
        patch: { chassis: { mission: track(object, false) } },
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
    case "/ugv/eo/pose":
      return eoPose(value, base);
    case "/ugv/detected_objects":
      return detectedObjects(object, base);
    case "/ugv/target_detected":
      return { ...base, patch: {}, domains: ["target"] };
    case "/ugv/target/gnss":
      return { ...base, patch: {}, domains: ["target"] };
    case "/ugv/area_recon/status":
      return reconStatus(object, base);
    case "/ugv/area_recon/targets":
      return reconTargets(object, base);
    case "/ugv/area_recon/exception":
      return reconException(object, base);
    case "/ugv/area_recon/coverage":
      return reconCoverage(object, base);
  }
}

export function normalizeNpcTankMqttObservation(
  topic: NpcTankMqttTopic,
  value: unknown,
): NormalizedMqttObservation {
  const object = record(value) ? value : undefined;
  validateNpcTankIdentity(object);
  try {
    if (topic === "status/npc_tank1")
      return npcAggregateStatus(object, observationBase(value, object));
    return normalizeVehicleMqttObservation(npcEquivalentUgvTopic(topic), value, object);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("UGV_"))
      throw new Error(error.message.replace(/^UGV_/, "NPC_TANK_"), { cause: error });
    throw error;
  }
}

function npcEquivalentUgvTopic(topic: NpcTankMqttTopic): UgvMqttTopic {
  if (topic === "/npc_tank1/status") return "/ugv/status";
  const mapped = topic.replace("/npc_tank1/", "/ugv/");
  if (mapped === topic) throw new Error("NPC_TANK_MQTT_TOPIC_NOT_ALLOWED");
  return mapped as UgvMqttTopic;
}

export function deduplicateVehicleTargets(targets: readonly VehicleTarget[]): VehicleTarget[] {
  const selected = new Map<string, VehicleTarget>();
  for (const target of targets) {
    const previous = selected.get(target.targetId);
    if (previous === undefined || compareTargetAuthority(target, previous) >= 0)
      selected.set(target.targetId, structuredClone(target));
  }
  return [...selected.values()].sort((left, right) => left.targetId.localeCompare(right.targetId));
}

function composite(
  object: Record<string, unknown> | undefined,
  base: Omit<NormalizedMqttObservation, "patch" | "domains">,
): NormalizedMqttObservation {
  if (object === undefined) throw new Error("UGV_MQTT_STATUS_INVALID");
  if (object.available === false)
    return {
      ...base,
      patch: {
        connectivity: {
          mqttConnected: true,
          deviceAvailable: false,
        },
      },
      domains: [],
    };
  const chassisTask = record(object.chassis_task) ? track(object.chassis_task, true) : undefined;
  const eoTask = record(object.eo_task) ? track(object.eo_task, true) : undefined;
  const weaponTask = record(object.weapon_task) ? track(object.weapon_task, true) : undefined;
  const speedKmh = optionalNumber(object.speed_kmh ?? object.veh_speed);
  const heading = optionalNumber(object.heading);
  const packetLossRate = optionalNumber(object.packet_loss_rate);
  const averageRoundTripTimeMs = optionalNumber(object.average_round_trip_time);
  const gimbal = gimbalObservation(object.gimbal);
  return {
    ...base,
    patch: {
      chassis: {
        ...(speedKmh === undefined ? {} : { speedKmh }),
        ...(heading === undefined ? {} : { compassHeadingDeg: heading }),
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
        ...(gimbal === undefined ? {} : { gimbal }),
        ...(eoTask === undefined ? {} : { eoTask }),
        ...(weaponTask === undefined ? {} : { weapon: weaponTask }),
      },
      connectivity: {
        ...(object.available === true ||
        (chassisTask !== undefined && eoTask !== undefined && weaponTask !== undefined)
          ? { deviceAvailable: true }
          : {}),
        ...(packetLossRate === undefined ? {} : { packetLossRate }),
        ...(averageRoundTripTimeMs === undefined ? {} : { averageRoundTripTimeMs }),
      },
    },
    domains: ["chassis", "mission", "payload"],
  };
}

function npcAggregateStatus(
  object: Record<string, unknown> | undefined,
  base: Omit<NormalizedMqttObservation, "patch" | "domains">,
): NormalizedMqttObservation {
  if (object === undefined) throw new Error("NPC_TANK_MQTT_STATUS_INVALID");
  const positionValue = record(object.position) ? object.position : undefined;
  if (object.position !== undefined && positionValue === undefined)
    throw new Error("NPC_TANK_MQTT_STATUS_POSITION_INVALID");
  const latitudeValue = optionalCoordinate(positionValue?.lat ?? positionValue?.latitude, latitude);
  const longitudeValue = optionalCoordinate(
    positionValue?.lon ?? positionValue?.longitude,
    longitude,
  );
  const altitude = optionalStrictNumber(positionValue?.alt ?? positionValue?.altitude);
  const speedKmh = optionalStrictNumber(object.speed);
  const rangeKmValue = optionalStrictNumber(object.remainder_range);
  if (rangeKmValue !== undefined && rangeKmValue < 0)
    throw new Error("NPC_TANK_MQTT_BATTERY_RANGE_INVALID");
  const rangeKm = rangeKmValue;
  const mode = aggregateMode(object.mode);
  const status = aggregateStatus(object.status);
  const positionObserved = latitudeValue !== undefined && longitudeValue !== undefined;
  const chassisObserved = positionObserved || speedKmh !== undefined || rangeKm !== undefined;
  const healthObserved = mode !== undefined || status !== undefined;
  return {
    ...base,
    patch: {
      ...(chassisObserved
        ? {
            chassis: {
              ...(!positionObserved
                ? {}
                : {
                    position: {
                      latitude: latitudeValue,
                      longitude: longitudeValue,
                      ...(altitude === undefined ? {} : { altitude }),
                    },
                  }),
              ...(speedKmh === undefined ? {} : { speedKmh }),
              ...(rangeKm === undefined ? {} : { energy: { rangeKm } }),
            },
          }
        : {}),
      ...(healthObserved
        ? {
            health: {
              ...(status === undefined ? {} : { runState: status === "moving" ? 1 : 0 }),
              ...(mode === undefined ? {} : { mode: mode === "autonomous" ? 1 : 0 }),
            },
          }
        : {}),
      connectivity: { mqttConnected: true, deviceAvailable: true },
    },
    domains: [
      ...(chassisObserved ? (["chassis"] as const) : []),
      ...(healthObserved ? (["health"] as const) : []),
    ],
  };
}

function eoPose(
  value: unknown,
  base: Omit<NormalizedMqttObservation, "patch" | "domains">,
): NormalizedMqttObservation {
  const data = Array.isArray(value)
    ? value
    : record(value) && Array.isArray(value.data)
      ? value.data
      : [];
  if (data.length < 3) throw new Error("UGV_MQTT_EO_POSE_INVALID");
  return {
    ...base,
    patch: {
      payload: { gimbal: { yaw: number(data[0]), pitch: number(data[1]), zoom: number(data[2]) } },
    },
    domains: ["payload"],
  };
}

function detectedObjects(
  object: Record<string, unknown> | undefined,
  base: Omit<NormalizedMqttObservation, "patch" | "domains">,
): NormalizedMqttObservation {
  if (!Array.isArray(object?.objects)) throw new Error("UGV_MQTT_TARGETS_INVALID");
  const fallbackObservedAt = base.sourceObservedAt ?? new Date().toISOString();
  const targets = object.objects.map((item): VehicleTarget => {
    if (!record(item)) throw new Error("UGV_MQTT_TARGET_INVALID");
    const observedAt = headerTimestamp(item.header) ?? fallbackObservedAt;
    const position = optionalNumbers(item, { x: "x", y: "y", z: "z" });
    const objectType = scalarText(item.object_type);
    return {
      targetId: id(item.id),
      ...(objectType === undefined ? {} : { objectType }),
      ...(Object.keys(position).length === 0 ? {} : { position }),
      coordinateFrame: "carla_world",
      source: "mqtt_detected_objects",
      observedAt,
    };
  });
  return {
    ...base,
    patch: { payload: { targets: deduplicateVehicleTargets(targets) } },
    domains: ["target"],
  };
}

function reconStatus(
  object: Record<string, unknown> | undefined,
  base: Omit<NormalizedMqttObservation, "patch" | "domains">,
): NormalizedMqttObservation {
  if (object === undefined) throw new Error("UGV_MQTT_RECON_STATUS_INVALID");
  const motionStatus = reconMotionStatus(object.status);
  const cameraFault = optionalBoolean(object.camera_fault);
  const progress = optionalPercent(object.progress);
  const coverage = statusCoverage(object);
  const lock = reconLock(object.lock);
  const lastCommandAck = reconCommandAck(object.last_cmd_ack);
  const coverability =
    reconCoverability(object.coverability) ?? lastCommandAck?.coverability ?? undefined;
  const gimbal = gimbalObservation(object.gimbal);
  const online = optionalBoolean(object.online);
  const attackReady = optionalBoolean(object.attack_ready);
  const statusLabel = scalarText(object.status_label);
  const scanModeValue = scanMode(object.scan_mode);
  const scanModeLabel = scalarText(object.scan_mode_label);
  const scanPitchDeg = optionalNumber(object.scan_pitch);
  const outOfRange = optionalBoolean(object.out_of_range);
  const scanCount = optionalInteger(object.scan_num);
  const workMode = optionalInteger(object.work_mode);
  const reconType = optionalInteger(object.recon_type);
  const loadStatus = optionalInteger(object.load_status);
  const loadStatusLabel = scalarText(object.load_status_label);
  return {
    ...base,
    patch: {
      payload: {
        ...(online === undefined ? {} : { online }),
        ...(gimbal === undefined ? {} : { gimbal }),
        ...(attackReady === undefined ? {} : { attackReady }),
        reconnaissance: {
          motionStatus,
          state: projectReconMotionStatus(motionStatus),
          ...(statusLabel === undefined ? {} : { statusLabel }),
          ...(scanModeValue === undefined ? {} : { scanMode: scanModeValue }),
          ...(scanModeLabel === undefined ? {} : { scanModeLabel }),
          ...(scanPitchDeg === undefined ? {} : { scanPitchDeg }),
          ...(outOfRange === undefined ? {} : { outOfRange }),
          ...(cameraFault === undefined
            ? {}
            : {
                cameraFault,
                ...(cameraFault || progress !== undefined || coverage !== undefined
                  ? { progressAuthoritative: !cameraFault }
                  : {}),
              }),
          ...(cameraFault === true || progress === undefined ? {} : { progress }),
          ...(scanCount === undefined ? {} : { scanCount }),
          ...(workMode === undefined ? {} : { workMode }),
          ...(reconType === undefined ? {} : { reconType }),
          ...(loadStatus === undefined ? {} : { loadStatus }),
          ...(loadStatusLabel === undefined ? {} : { loadStatusLabel }),
          ...(online === undefined ? {} : { online }),
          ...(cameraFault === true || coverage === undefined ? {} : { coverage }),
          ...(lock === undefined ? {} : { lock }),
          ...(attackReady === undefined ? {} : { attackReady }),
          ...(lastCommandAck === undefined ? {} : { lastCommandAck }),
          ...(coverability === undefined ? {} : { coverability }),
        },
      },
    },
    domains: ["mission", "payload"],
  };
}

function reconTargets(
  object: Record<string, unknown> | undefined,
  base: Omit<NormalizedMqttObservation, "patch" | "domains">,
): NormalizedMqttObservation {
  if (!Array.isArray(object?.targets)) throw new Error("UGV_MQTT_RECON_TARGETS_INVALID");
  const fallbackObservedAt = base.sourceObservedAt ?? new Date().toISOString();
  const targets = deduplicateVehicleTargets(
    object.targets.map((item) => richTarget(item, fallbackObservedAt)),
  );
  const sourceObservedAt = latestTargetObservedAt(targets) ?? base.sourceObservedAt;
  return {
    ...base,
    ...(sourceObservedAt === undefined
      ? {}
      : { sourceObservedAt, timeAuthority: "source" as const }),
    patch: { payload: { targets } },
    domains: ["target"],
  };
}

function reconException(
  object: Record<string, unknown> | undefined,
  base: Omit<NormalizedMqttObservation, "patch" | "domains">,
): NormalizedMqttObservation {
  if (object === undefined) throw new Error("UGV_MQTT_RECON_EXCEPTION_INVALID");
  const timeUs = optionalSafeInteger(object.time_us);
  const sourceObservedAt =
    timeUs === undefined ? base.sourceObservedAt : microsecondsTimestamp(timeUs);
  const targetInfo = record(object.target_info) ? object.target_info : undefined;
  const kind =
    object.kind === "motion" || object.kind === "equipment" || object.kind === "object_loss"
      ? object.kind
      : "unknown";
  const levelValue = optionalInteger(object.level);
  if (levelValue !== undefined && levelValue !== 1 && levelValue !== 2)
    throw new Error("UGV_MQTT_RECON_EXCEPTION_LEVEL_INVALID");
  const errorCode = optionalInteger(object.error_code);
  const exceptionReason = scalarText(targetInfo?.reason);
  const lastException: ReconExceptionObservation = {
    kind,
    ...(levelValue === undefined ? {} : { level: levelValue }),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(timeUs === undefined ? {} : { timeUs }),
    ...(exceptionReason === undefined ? {} : { reason: exceptionReason }),
    observedAt: sourceObservedAt ?? new Date().toISOString(),
  };
  return {
    ...base,
    ...(sourceObservedAt === undefined
      ? {}
      : { sourceObservedAt, timeAuthority: "source" as const }),
    patch: { payload: { reconnaissance: { lastException } } },
    domains: ["payload"],
  };
}

function reconCoverage(
  object: Record<string, unknown> | undefined,
  base: Omit<NormalizedMqttObservation, "patch" | "domains">,
): NormalizedMqttObservation {
  if (object === undefined) throw new Error("UGV_MQTT_RECON_COVERAGE_INVALID");
  const runId = optionalInteger(object.run_id);
  const scanModeValue = scanMode(object.scan_mode);
  const coveragePercent = optionalPercent(object.coverage);
  const coveredCount = optionalInteger(object.covered_n);
  const totalCount = optionalInteger(object.total);
  const cellSizeM = optionalNumber(object.cell_size);
  const coveredCells = coordinatePairs(object.covered);
  const sectorWidthDeg = optionalNumber(object.sector_width);
  const sectorsTotal = optionalInteger(object.sectors_total);
  const sectorsCovered = optionalInteger(object.sectors_covered);
  const sectors = sectorPairs(object.sectors);
  const coverage: ReconCoverageObservation = {
    ...(runId === undefined ? {} : { runId }),
    ...(scanModeValue === undefined ? {} : { scanMode: scanModeValue }),
    ...(coveragePercent === undefined ? {} : { coveragePercent }),
    ...(coveredCount === undefined ? {} : { coveredCount }),
    ...(totalCount === undefined ? {} : { totalCount }),
    ...(cellSizeM === undefined ? {} : { cellSizeM }),
    ...(coveredCells === undefined ? {} : { coveredCells }),
    ...(sectorWidthDeg === undefined ? {} : { sectorWidthDeg }),
    ...(sectorsTotal === undefined ? {} : { sectorsTotal }),
    ...(sectorsCovered === undefined ? {} : { sectorsCovered }),
    ...(sectors === undefined ? {} : { sectors }),
  };
  return {
    ...base,
    patch: { payload: { reconnaissance: { coverage } } },
    domains: ["payload"],
  };
}

function richTarget(value: unknown, fallbackObservedAt: string): VehicleTarget {
  if (!record(value)) throw new Error("UGV_MQTT_RECON_TARGET_INVALID");
  const captureTimeUs = optionalSafeInteger(value.capture_time_us);
  if (value.capture_time_us !== undefined && captureTimeUs === undefined)
    throw new Error("UGV_MQTT_RECON_TARGET_TIME_INVALID");
  const positionValue = record(value.position) ? value.position : undefined;
  if (positionValue === undefined) throw new Error("UGV_MQTT_RECON_TARGET_POSITION_INVALID");
  const velocityValue = record(value.velocity) ? value.velocity : undefined;
  const pixelValue = record(value.pixel_pos) ? value.pixel_pos : undefined;
  const targetType = optionalInteger(value.type);
  const altitude = optionalNumber(positionValue.altitude);
  const distanceM = optionalNonnegativeNumber(value.distance);
  const confidence = optionalNumber(value.confidence);
  const threat = boundedInteger(value.threat, 0, 10);
  const iff = optionalInteger(value.iff);
  const lockTimeSec = optionalNonnegativeInteger(value.lock_time);
  const roleName = scalarText(value.role_name);
  const observedAt =
    captureTimeUs === undefined ? fallbackObservedAt : microsecondsTimestamp(captureTimeUs);
  return {
    targetId: id(value.target_id),
    ...(targetType === undefined ? {} : { targetType, objectType: String(targetType) }),
    ...(captureTimeUs === undefined ? {} : { captureTimeUs }),
    position: {
      longitude: longitude(positionValue.longitude),
      latitude: latitude(positionValue.latitude),
      ...(altitude === undefined ? {} : { altitude }),
    },
    ...(velocityValue === undefined
      ? {}
      : {
          velocity: optionalNumbers(velocityValue, {
            eastMps: "vel_e",
            northMps: "vel_n",
            upMps: "vel_u",
          }),
        }),
    ...(distanceM === undefined ? {} : { distanceM }),
    ...(confidence === undefined ? {} : { confidence }),
    ...(threat === undefined ? {} : { threat }),
    ...(iff === undefined ? {} : { iff }),
    ...(lockTimeSec === undefined ? {} : { lockTimeSec }),
    ...(pixelValue === undefined
      ? {}
      : {
          pixelPosition: optionalNumbers(pixelValue, {
            x: "x",
            y: "y",
            theta: "theta",
            width: "w",
            height: "h",
          }),
        }),
    ...(roleName === undefined ? {} : { roleName }),
    coordinateFrame: "WGS84",
    source: "mqtt_area_recon",
    observedAt,
  };
}

function statusCoverage(object: Record<string, unknown>): ReconCoverageObservation | undefined {
  const coveragePercent = optionalPercent(object.coverage);
  const coveredCount = optionalInteger(object.coverage_covered);
  const totalCount = optionalInteger(object.coverage_total);
  const incomplete = optionalBoolean(object.coverage_incomplete);
  const reasonValue = scalarText(object.coverage_reason);
  if (
    coveragePercent === undefined &&
    coveredCount === undefined &&
    totalCount === undefined &&
    incomplete === undefined &&
    reasonValue === undefined
  )
    return undefined;
  return {
    ...(coveragePercent === undefined ? {} : { coveragePercent }),
    ...(coveredCount === undefined ? {} : { coveredCount }),
    ...(totalCount === undefined ? {} : { totalCount }),
    ...(incomplete === undefined ? {} : { incomplete }),
    ...(reasonValue === undefined ? {} : { reason: reasonValue }),
  };
}

function reconLock(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (!record(value)) throw new Error("UGV_MQTT_RECON_LOCK_INVALID");
  const stageValue = optionalInteger(value.stage);
  if (stageValue !== undefined && !new Set([1, 2, 3, 4]).has(stageValue))
    throw new Error("UGV_MQTT_RECON_LOCK_STAGE_INVALID");
  const targetId = value.target_id === undefined ? undefined : id(value.target_id);
  const roleName = scalarText(value.role_name);
  const durationSec = optionalNonnegativeNumber(value.duration_sec);
  return {
    ...(stageValue === undefined ? {} : { stage: stageValue as 1 | 2 | 3 | 4 }),
    ...(targetId === undefined || targetId === "0" ? {} : { targetId }),
    ...(roleName === undefined ? {} : { roleName }),
    ...(durationSec === undefined ? {} : { durationSec }),
  };
}

function reconCommandAck(value: unknown): ReconCommandAck | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!record(value) || typeof value.ok !== "boolean")
    throw new Error("UGV_MQTT_RECON_COMMAND_ACK_INVALID");
  const data = record(value.data) ? value.data : undefined;
  const coverability = reconCoverability(data?.coverability);
  const sequence = scalarText(value.seq);
  const message = scalarText(value.message);
  return {
    ...(sequence === undefined ? {} : { sequence }),
    ok: value.ok,
    ...(message === undefined ? {} : { message }),
    ...(coverability === undefined ? {} : { coverability }),
  };
}

function reconCoverability(value: unknown): ReconCoverability | undefined {
  if (value === undefined || value === null) return undefined;
  if (!record(value)) throw new Error("UGV_MQTT_RECON_COVERABILITY_INVALID");
  if (!new Set(["full", "partial", "none", "unknown"]).has(value.coverable as string))
    throw new Error("UGV_MQTT_RECON_COVERABILITY_INVALID");
  const coverableLabel = scalarText(value.coverable_label);
  const regionMinDistanceM = optionalNonnegativeNumber(value.region_min_dist_m);
  const regionMaxDistanceM = optionalNonnegativeNumber(value.region_max_dist_m);
  const detectionRangeM = optionalNonnegativeNumber(value.detection_range_m);
  return {
    coverable: value.coverable as ReconCoverability["coverable"],
    ...(coverableLabel === undefined ? {} : { coverableLabel }),
    ...(regionMinDistanceM === undefined ? {} : { regionMinDistanceM }),
    ...(regionMaxDistanceM === undefined ? {} : { regionMaxDistanceM }),
    ...(detectionRangeM === undefined ? {} : { detectionRangeM }),
  };
}

function gimbalObservation(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (!record(value)) throw new Error("UGV_MQTT_GIMBAL_INVALID");
  const gimbal = optionalNumbers(value, { yaw: "yaw", pitch: "pitch", zoom: "zoom" });
  return Object.keys(gimbal).length === 0 ? undefined : gimbal;
}

function compareTargetAuthority(left: VehicleTarget, right: VehicleTarget): number {
  const leftTime = targetSourceTime(left);
  const rightTime = targetSourceTime(right);
  if (leftTime !== rightTime) return leftTime - rightTime;
  const sourceRank = (target: VehicleTarget) =>
    target.source === "mqtt_area_recon"
      ? 3
      : target.source === "device_mcp"
        ? 2
        : target.source === "mqtt_detected_objects" || target.source === "mqtt"
          ? 1
          : 0;
  const rankDifference = sourceRank(left) - sourceRank(right);
  return rankDifference === 0
    ? Object.keys(left).length - Object.keys(right).length
    : rankDifference;
}

function targetSourceTime(target: VehicleTarget): number {
  if (target.captureTimeUs !== undefined) return target.captureTimeUs;
  const milliseconds = Date.parse(target.observedAt);
  return Number.isFinite(milliseconds) ? milliseconds * 1000 : 0;
}

function latestTargetObservedAt(targets: readonly VehicleTarget[]): string | undefined {
  let latest: VehicleTarget | undefined;
  for (const target of targets)
    if (latest === undefined || targetSourceTime(target) > targetSourceTime(latest))
      latest = target;
  return latest?.observedAt;
}

function observationBase(value: unknown, object: Record<string, unknown> | undefined) {
  const sourceObservedAt = headerTimestamp(object?.header);
  return {
    ...(sourceObservedAt === undefined ? {} : { sourceObservedAt }),
    timeAuthority: sourceObservedAt === undefined ? ("ingest" as const) : ("source" as const),
    canonicalPayload: value,
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
  for (const entity of [object?.entity_id, object?.device_id])
    if (entity !== undefined && entity !== "npc_tank1")
      throw new Error("NPC_TANK_MQTT_ENTITY_MISMATCH");
  for (const role of [object?.role_name, object?.role])
    if (role !== undefined && role !== "npc_tank1") throw new Error("NPC_TANK_MQTT_ROLE_MISMATCH");
  const vehicleId = object?.vehicle_id;
  if (
    vehicleId !== undefined &&
    vehicleId !== "npc_tank1" &&
    !(
      typeof vehicleId === "number" &&
      Number.isSafeInteger(vehicleId) &&
      vehicleId >= 0 &&
      (object?.entity_id === "npc_tank1" || object?.role_name === "npc_tank1")
    )
  )
    throw new Error("NPC_TANK_MQTT_ENTITY_MISMATCH");
}

function aggregateMode(value: unknown): "manual" | "autonomous" | undefined {
  if (value === undefined) return undefined;
  if (value === "manual" || value === 0) return "manual";
  if (value === "autonomous" || value === 1 || value === 2) return "autonomous";
  throw new Error("NPC_TANK_MQTT_STATUS_MODE_INVALID");
}

function aggregateStatus(value: unknown): "idle" | "moving" | "stopped" | "error" | undefined {
  if (value === undefined) return undefined;
  if (value === "idle" || value === "moving" || value === "stopped" || value === "error")
    return value;
  throw new Error("NPC_TANK_MQTT_STATUS_STATE_INVALID");
}

function optionalCoordinate(
  value: unknown,
  parser: (candidate: unknown) => number,
): number | undefined {
  return value === undefined ? undefined : parser(value);
}

function track(object: Record<string, unknown> | undefined, compositeTrack: boolean) {
  if (object === undefined) throw new Error("UGV_MQTT_TASK_TRACK_INVALID");
  const state = integer(object.state) as VehicleTaskState;
  const negativeIdleSentinel =
    compositeTrack &&
    state === -1 &&
    (object.id === undefined || object.id === -1) &&
    (object.type === undefined || object.type === -1);
  if (!new Set([0, 1, 2, 3, 4, 5]).has(state as number) && !negativeIdleSentinel)
    throw new Error("UGV_MQTT_TASK_STATE_INVALID");
  const emptySentinel = object.id === -1 || negativeIdleSentinel;
  // The captured rich NPC status can report an active track with id=-1 while
  // retaining state/type/progress. Treat that composite identifier as absent;
  // Runtime mission correlation then refuses to attribute it to a dispatched
  // task. Dedicated mission-state topics remain strict.
  if (emptySentinel && !compositeTrack && state !== -1 && state !== 0)
    throw new Error("UGV_MQTT_TASK_ID_SENTINEL_INVALID");
  const progress =
    emptySentinel && object.progress === -1 ? undefined : optionalPercent(object.progress);
  const taskId = emptySentinel ? undefined : scalarText(object.id);
  const taskType = object.type === -1 ? undefined : object.type;
  return {
    ...(taskId === undefined ? {} : { id: taskId }),
    ...(taskType === undefined ? {} : { type: taskType as string | number }),
    state,
    ...(progress === undefined ? {} : { progress }),
  };
}

function reconMotionStatus(value: unknown): ReconMotionStatus {
  const parsed = integer(value);
  if (!new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 99]).has(parsed))
    throw new Error("UGV_MQTT_RECON_MOTION_STATUS_INVALID");
  return parsed as ReconMotionStatus;
}

function scanMode(value: unknown): 1 | 2 | undefined {
  if (value === undefined) return undefined;
  const parsed = integer(value);
  if (parsed !== 1 && parsed !== 2) throw new Error("UGV_MQTT_RECON_SCAN_MODE_INVALID");
  return parsed;
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

function microsecondsTimestamp(value: number): string {
  const milliseconds = value / 1000;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.valueOf())) throw new Error("UGV_MQTT_TIMESTAMP_INVALID");
  return date.toISOString();
}

function coordinatePairs(value: unknown): { x: number; y: number }[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("UGV_MQTT_RECON_COORDINATES_INVALID");
  return value.map((pair) => {
    if (!Array.isArray(pair) || pair.length < 2)
      throw new Error("UGV_MQTT_RECON_COORDINATES_INVALID");
    return { x: number(pair[0]), y: number(pair[1]) };
  });
}

function sectorPairs(value: unknown): { startDeg: number; endDeg: number }[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("UGV_MQTT_RECON_SECTORS_INVALID");
  return value.map((pair) => {
    if (!Array.isArray(pair) || pair.length < 2) throw new Error("UGV_MQTT_RECON_SECTORS_INVALID");
    return { startDeg: number(pair[0]), endDeg: number(pair[1]) };
  });
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
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("UGV_MQTT_TARGET_ID_INVALID");
    return String(value);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error("UGV_MQTT_TARGET_ID_INVALID");
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed)) throw new Error("UGV_MQTT_TARGET_ID_INVALID");
    return String(parsed);
  }
  return trimmed;
}

function latitude(value: unknown): number {
  const parsed = number(value);
  if (parsed < -90 || parsed > 90) throw new Error("UGV_MQTT_GNSS_INVALID");
  return parsed;
}

function longitude(value: unknown): number {
  const parsed = number(value);
  if (parsed < -180 || parsed > 180) throw new Error("UGV_MQTT_GNSS_INVALID");
  return parsed;
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("UGV_MQTT_NUMBER_INVALID");
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalStrictNumber(value: unknown): number | undefined {
  return value === undefined ? undefined : number(value);
}

function optionalNonnegativeNumber(value: unknown): number | undefined {
  const parsed = optionalNumber(value);
  if (parsed !== undefined && parsed < 0) throw new Error("UGV_MQTT_NONNEGATIVE_NUMBER_REQUIRED");
  return parsed;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error("UGV_MQTT_BOOLEAN_INVALID");
  return value;
}

function integer(value: unknown): number {
  const parsed = number(value);
  if (!Number.isInteger(parsed)) throw new Error("UGV_MQTT_INTEGER_INVALID");
  return parsed;
}

function optionalInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  return integer(value);
}

function optionalSafeInteger(value: unknown): number | undefined {
  const parsed = optionalInteger(value);
  return parsed !== undefined && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function optionalNonnegativeInteger(value: unknown): number | undefined {
  const parsed = optionalInteger(value);
  if (parsed !== undefined && parsed < 0) throw new Error("UGV_MQTT_NONNEGATIVE_INTEGER_REQUIRED");
  return parsed;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  const parsed = optionalInteger(value);
  if (parsed !== undefined && (parsed < minimum || parsed > maximum))
    throw new Error("UGV_MQTT_INTEGER_RANGE_INVALID");
  return parsed;
}

function optionalPercent(value: unknown): number | undefined {
  const parsed = optionalNumber(value);
  if (parsed !== undefined && (parsed < 0 || parsed > 100))
    throw new Error("UGV_MQTT_TASK_PROGRESS_INVALID");
  return parsed;
}

function integers(value: unknown): number[] {
  if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item)))
    throw new Error("UGV_MQTT_INTEGER_ARRAY_INVALID");
  return value as number[];
}
