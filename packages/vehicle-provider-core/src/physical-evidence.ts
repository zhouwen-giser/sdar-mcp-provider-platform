import type {
  FreshnessPolicy,
  VehicleReconnaissanceState,
  VehicleSnapshot,
  VehicleTaskState,
} from "./types.js";

export interface PhysicalObservationAuthority {
  field?: VehicleObservationField;
  topic: string;
  observedAt: string;
  timeAuthority: "source" | "ingest";
  sourceSequence?: string;
  ingestSequence?: number;
  payloadHash?: string;
  cursor: string;
}

export type VehicleObservationField =
  | "chassis.position.geodetic"
  | "chassis.position.local"
  | "chassis.speed"
  | "chassis.heading"
  | "chassis.mission"
  | "payload.recon"
  | "payload.targets"
  | "payload.gimbal";

export interface FieldObservationAuthority extends PhysicalObservationAuthority {
  field: VehicleObservationField;
  ingestSequence: number;
  payloadHash: string;
}

export type VehiclePositionObservation =
  | {
      type: "geodetic";
      latitude: number;
      longitude: number;
      altitude?: number;
      crs: "EPSG:4326";
    }
  | {
      type: "local";
      x: number;
      y: number;
      z?: number;
      frame: string;
      unit: "m";
    };

export interface AuthoritativeVehiclePosition {
  observation: VehiclePositionObservation;
  authority: PhysicalObservationAuthority;
}

export interface PhysicalDispatchBaseline {
  capturedAt: string;
  snapshotRevision: string;
  position?: VehiclePositionObservation;
  headingDeg?: number;
  speedKmh?: number;
  mission: {
    id?: string;
    state: VehicleTaskState;
    observedAt?: string;
  };
  observationAuthorities: readonly PhysicalObservationAuthority[];
}

export type CorrelationStrength =
  "STRICT_CORRELATED" | "WEAK_UNCORRELATED" | "MISMATCH" | "UNKNOWN";

export interface PhysicalConfirmation {
  confirmed: boolean;
  reasonCode: string;
  correlation: CorrelationStrength;
  observationIsNew: boolean;
  positionFresh: boolean;
  speedFresh: boolean;
  stationary: boolean | null;
}

export function stationaryPhysicalConfirmation(input: {
  snapshot: VehicleSnapshot;
  baseline: PhysicalDispatchBaseline;
  currentAuthorities: readonly PhysicalObservationAuthority[];
  freshness: FreshnessPolicy;
  stationarySpeedThresholdKmh: number;
  now?: number;
}): PhysicalConfirmation {
  const speedKmh = input.snapshot.chassis.speedKmh;
  const speedAuthority = authorityForField(input.currentAuthorities, "chassis.speed");
  const speedFresh =
    authorityFreshness(speedAuthority, input.freshness.chassis, input.now) === "fresh" &&
    speedKmh !== undefined;
  const stationary = stationaryFromSpeed(speedKmh, speedFresh, input.stationarySpeedThresholdKmh);
  const observationIsNew = isNewAuthority(input.baseline.observationAuthorities, speedAuthority);
  const confirmed = observationIsNew && speedFresh && stationary === true;
  return {
    confirmed,
    reasonCode: confirmed
      ? "UGV_STATIONARY_CONFIRMED"
      : !observationIsNew
        ? "UGV_STOP_OBSERVATION_NOT_NEW"
        : !speedFresh
          ? "UGV_STOP_SPEED_UNCONFIRMED"
          : "UGV_STOP_STATIONARY_UNCONFIRMED",
    correlation: "UNKNOWN",
    observationIsNew,
    positionFresh: false,
    speedFresh,
    stationary,
  };
}

export function capturePhysicalDispatchBaseline(
  snapshot: VehicleSnapshot,
  authorities: readonly PhysicalObservationAuthority[],
  capturedAt = new Date().toISOString(),
): PhysicalDispatchBaseline {
  const position = authoritativeVehiclePosition(snapshot, authorities);
  return {
    capturedAt,
    snapshotRevision: snapshot.revision,
    ...(position === undefined ? {} : { position: structuredClone(position.observation) }),
    ...(snapshot.chassis.compassHeadingDeg === undefined
      ? {}
      : { headingDeg: snapshot.chassis.compassHeadingDeg }),
    ...(snapshot.chassis.speedKmh === undefined ? {} : { speedKmh: snapshot.chassis.speedKmh }),
    mission: {
      ...(snapshot.chassis.mission.id === undefined ? {} : { id: snapshot.chassis.mission.id }),
      state: snapshot.chassis.mission.state,
      ...(snapshot.chassis.mission.observedAt === undefined
        ? {}
        : { observedAt: snapshot.chassis.mission.observedAt }),
    },
    observationAuthorities: structuredClone(authorities),
  };
}

export function navigationPhysicalConfirmation(input: {
  snapshot: VehicleSnapshot;
  baseline: PhysicalDispatchBaseline;
  missionId?: string;
  currentAuthority?: PhysicalObservationAuthority;
  currentAuthorities?: readonly PhysicalObservationAuthority[];
  freshness: FreshnessPolicy;
  stationarySpeedThresholdKmh: number;
  now?: number;
}): PhysicalConfirmation {
  const { snapshot, baseline, missionId } = input;
  const authorities =
    input.currentAuthorities ??
    (input.currentAuthority === undefined ? [] : [input.currentAuthority]);
  const observedMission = snapshot.chassis.mission.id;
  const correlation: CorrelationStrength =
    missionId === undefined || observedMission === undefined
      ? "UNKNOWN"
      : missionId === observedMission
        ? "STRICT_CORRELATED"
        : "MISMATCH";
  const observationIsNew = requiredNavigationAuthoritiesAreNew(
    baseline.observationAuthorities,
    authorities,
  );
  const position = authoritativeVehiclePosition(snapshot, authorities);
  const positionAuthority = position?.authority;
  const speedAuthority = authorityForField(authorities, "chassis.speed");
  const positionFresh =
    authorityFreshness(positionAuthority, input.freshness.chassis, input.now) === "fresh" &&
    position !== undefined;
  const speedKmh = snapshot.chassis.speedKmh;
  const speedFresh =
    authorityFreshness(speedAuthority, input.freshness.chassis, input.now) === "fresh" &&
    speedKmh !== undefined;
  const stationary = stationaryFromSpeed(speedKmh, speedFresh, input.stationarySpeedThresholdKmh);
  const confirmed =
    correlation === "STRICT_CORRELATED" &&
    observationIsNew &&
    positionFresh &&
    speedFresh &&
    stationary === true;
  return {
    confirmed,
    reasonCode: confirmed
      ? "UGV_PHYSICAL_TERMINAL_CONFIRMED"
      : correlation === "MISMATCH"
        ? "UGV_DOWNSTREAM_MISSION_ID_MISMATCH"
        : !observationIsNew
          ? "UGV_PHYSICAL_OBSERVATION_NOT_NEW"
          : !positionFresh
            ? "UGV_TERMINAL_POSITION_UNCONFIRMED"
            : !speedFresh
              ? "UGV_TERMINAL_SPEED_UNCONFIRMED"
              : stationary !== true
                ? "UGV_TERMINAL_STATIONARY_UNCONFIRMED"
                : "UGV_MISSION_CORRELATION_UNCONFIRMED",
    correlation,
    observationIsNew,
    positionFresh,
    speedFresh,
    stationary,
  };
}

function requiredNavigationAuthoritiesAreNew(
  baseline: readonly PhysicalObservationAuthority[],
  current: readonly PhysicalObservationAuthority[],
): boolean {
  const mission = authorityForField(current, "chassis.mission");
  const position = latestAuthority(
    authorityForField(current, "chassis.position.geodetic"),
    authorityForField(current, "chassis.position.local"),
  );
  const speed = authorityForField(current, "chassis.speed");
  return (
    isNewAuthority(baseline, mission) &&
    isNewAuthority(baseline, position) &&
    isNewAuthority(baseline, speed)
  );
}

export function navigationTerminalFacts(input: {
  snapshot: VehicleSnapshot;
  baseline: PhysicalDispatchBaseline;
  currentAuthorities?: readonly PhysicalObservationAuthority[];
  missionId?: string;
  requestedDistanceM?: number;
  confirmation: PhysicalConfirmation;
}): Record<string, unknown> {
  const { snapshot, baseline, confirmation } = input;
  const startPosition = normalizeVehiclePositionObservation(baseline.position);
  const currentPosition = authoritativeVehiclePosition(snapshot, input.currentAuthorities ?? []);
  const endPosition = currentPosition?.observation;
  const observedDisplacementM = vehiclePositionDisplacementM(startPosition, endPosition);
  return {
    ...(input.requestedDistanceM === undefined
      ? {}
      : { requestedDistanceM: input.requestedDistanceM }),
    ...(startPosition === undefined ? {} : { startPosition }),
    ...(endPosition === undefined ? {} : { endPosition }),
    ...(observedDisplacementM === undefined ? {} : { observedDisplacementM }),
    ...(startPosition === undefined ||
    endPosition === undefined ||
    observedDisplacementM !== undefined
      ? {}
      : { displacementUnavailableReason: "POSITION_AUTHORITY_MISMATCH" }),
    ...(currentPosition === undefined
      ? {}
      : {
          positionAuthority: {
            field: currentPosition.authority.field ?? null,
            topic: currentPosition.authority.topic,
            observedAt: currentPosition.authority.observedAt,
            timeAuthority: currentPosition.authority.timeAuthority,
            cursor: currentPosition.authority.cursor,
          },
        }),
    ...(snapshot.chassis.compassHeadingDeg === undefined
      ? {}
      : { finalHeadingDeg: snapshot.chassis.compassHeadingDeg }),
    ...(snapshot.chassis.speedKmh === undefined
      ? {}
      : { finalSpeedKmh: snapshot.chassis.speedKmh }),
    missionId: input.missionId ?? snapshot.chassis.mission.id ?? null,
    missionState: snapshot.chassis.mission.state,
    observedAt: snapshot.chassis.mission.observedAt ?? snapshot.observedAt,
    snapshotRevision: snapshot.revision,
    stationaryAtCompletion: confirmation.stationary,
    correlationStrength: confirmation.correlation,
    observationAuthority: confirmation.observationIsNew ? "post_dispatch" : "baseline_or_unknown",
  };
}

export function authoritativeVehiclePosition(
  snapshot: VehicleSnapshot,
  authorities: readonly PhysicalObservationAuthority[],
): AuthoritativeVehiclePosition | undefined {
  const geodeticAuthority = authorityForField(authorities, "chassis.position.geodetic");
  const localAuthority = authorityForField(authorities, "chassis.position.local");
  const geodetic =
    geodeticAuthority === undefined || snapshot.chassis.position === undefined
      ? undefined
      : {
          observation: {
            type: "geodetic" as const,
            latitude: snapshot.chassis.position.latitude,
            longitude: snapshot.chassis.position.longitude,
            ...(snapshot.chassis.position.altitude === undefined
              ? {}
              : { altitude: snapshot.chassis.position.altitude }),
            crs: "EPSG:4326" as const,
          },
          authority: geodeticAuthority,
        };
  const navigation = snapshot.chassis.navigation;
  const local =
    localAuthority === undefined ||
    navigation?.positionX === undefined ||
    navigation.positionY === undefined
      ? undefined
      : {
          observation: {
            type: "local" as const,
            x: navigation.positionX,
            y: navigation.positionY,
            ...(navigation.positionZ === undefined ? {} : { z: navigation.positionZ }),
            frame: "carla_world",
            unit: "m" as const,
          },
          authority: localAuthority,
        };
  if (geodetic === undefined) return local;
  if (local === undefined) return geodetic;
  return latestAuthority(geodetic.authority, local.authority) === local.authority
    ? local
    : geodetic;
}

export function vehiclePositionDisplacementM(
  start: VehiclePositionObservation | undefined,
  end: VehiclePositionObservation | undefined,
): number | undefined {
  if (start === undefined || start.type !== end?.type) return undefined;
  if (start.type === "geodetic" && end.type === "geodetic") return haversineDistanceM(start, end);
  if (start.type === "local" && end.type === "local" && start.frame === end.frame) {
    const zDelta = (end.z ?? 0) - (start.z ?? 0);
    return Math.hypot(end.x - start.x, end.y - start.y, zDelta);
  }
  return undefined;
}

export function reconTerminalFacts(input: {
  snapshot: VehicleSnapshot;
  expectedMissionId?: string;
  currentAuthority?: PhysicalObservationAuthority;
  baseline: PhysicalDispatchBaseline;
}): Record<string, unknown> {
  const recon = input.snapshot.payload.reconnaissance;
  const correlation = correlateRecon(recon, input.expectedMissionId);
  return {
    missionId: recon.id ?? input.expectedMissionId ?? null,
    scanMode: recon.scanMode ?? null,
    progress: recon.progress ?? null,
    coverage: recon.coverage ?? null,
    coverability: recon.coverability ?? null,
    observedTargetCount: input.snapshot.payload.targets.length,
    terminalMotionStatus: recon.motionStatus ?? "unknown",
    cameraFault: recon.cameraFault ?? null,
    outOfRange: recon.outOfRange ?? null,
    exception: recon.lastException ?? null,
    observedAt: input.currentAuthority?.observedAt ?? input.snapshot.observedAt,
    snapshotRevision: input.snapshot.revision,
    correlationStrength: correlation,
    observationIsNew: isNewAuthority(input.baseline.observationAuthorities, input.currentAuthority),
    timeAuthority: input.currentAuthority?.timeAuthority ?? "unknown",
  };
}

export function isNewAuthority(
  baselines: readonly PhysicalObservationAuthority[],
  current: PhysicalObservationAuthority | undefined,
): boolean {
  if (current === undefined) return false;
  const baseline = baselines.find(
    (candidate) => observationAuthorityKey(candidate) === observationAuthorityKey(current),
  );
  if (baseline === undefined) return true;
  if (current.sourceSequence !== undefined && baseline.sourceSequence !== undefined)
    return compareSequence(current.sourceSequence, baseline.sourceSequence) > 0;
  return (
    current.cursor !== baseline.cursor &&
    Date.parse(current.observedAt) >= Date.parse(baseline.observedAt)
  );
}

function authorityForField(
  authorities: readonly PhysicalObservationAuthority[],
  field: VehicleObservationField,
): PhysicalObservationAuthority | undefined {
  const exact = authorities.find((authority) => authority.field === field);
  if (exact !== undefined) return exact;
  return authorities.find((authority) => legacyTopicFields(authority.topic).includes(field));
}

function latestAuthority(
  left: PhysicalObservationAuthority | undefined,
  right: PhysicalObservationAuthority | undefined,
): PhysicalObservationAuthority | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  if (left.ingestSequence !== undefined && right.ingestSequence !== undefined)
    return right.ingestSequence > left.ingestSequence ? right : left;
  return Date.parse(right.observedAt) > Date.parse(left.observedAt) ? right : left;
}

function normalizeVehiclePositionObservation(
  value: VehiclePositionObservation | VehicleSnapshot["chassis"]["position"] | undefined,
): VehiclePositionObservation | undefined {
  if (value === undefined) return undefined;
  if ("type" in value) return structuredClone(value);
  return {
    type: "geodetic",
    latitude: value.latitude,
    longitude: value.longitude,
    ...(value.altitude === undefined ? {} : { altitude: value.altitude }),
    crs: "EPSG:4326",
  };
}

function authorityFreshness(
  authority: PhysicalObservationAuthority | undefined,
  maximumAgeMs: number,
  now = Date.now(),
): "fresh" | "stale" | "unknown" {
  if (authority === undefined) return "unknown";
  const age = now - Date.parse(authority.observedAt);
  return Number.isFinite(age) && age >= 0 && age <= maximumAgeMs ? "fresh" : "stale";
}

function observationAuthorityKey(authority: PhysicalObservationAuthority): string {
  return authority.field ?? authority.topic;
}

function legacyTopicFields(topic: string): readonly VehicleObservationField[] {
  if (topic === "/ugv/mission_state") return ["chassis.mission"];
  if (["status/ugv", "/ugv/status"].includes(topic))
    return ["chassis.mission", "chassis.speed", "chassis.heading", "payload.gimbal"];
  if (topic === "/ugv/gnss") return ["chassis.position.geodetic"];
  if (topic === "/ugv/nav_state") return ["chassis.position.local", "chassis.speed"];
  if (["/ugv/speed", "status/ugv", "/ugv/status"].includes(topic)) return ["chassis.speed"];
  if (topic === "/ugv/area_recon/status") return ["payload.recon", "payload.gimbal"];
  if (topic === "/ugv/area_recon/targets") return ["payload.targets"];
  if (topic === "/ugv/eo/pose") return ["payload.gimbal"];
  return [];
}

function stationaryFromSpeed(
  speedKmh: number | undefined,
  speedFresh: boolean,
  thresholdKmh: number,
): boolean | null {
  if (!speedFresh || speedKmh === undefined) return null;
  return speedKmh <= thresholdKmh;
}

function correlateRecon(
  recon: VehicleReconnaissanceState,
  expectedMissionId: string | undefined,
): CorrelationStrength {
  if (expectedMissionId === undefined) return "UNKNOWN";
  if (recon.id === undefined) return "WEAK_UNCORRELATED";
  return recon.id === expectedMissionId ? "STRICT_CORRELATED" : "MISMATCH";
}

function compareSequence(left: string, right: string): number {
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const leftNumber = BigInt(left);
    const rightNumber = BigInt(right);
    return leftNumber === rightNumber ? 0 : leftNumber > rightNumber ? 1 : -1;
  }
  return left.localeCompare(right);
}

function haversineDistanceM(
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number },
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(end.latitude - start.latitude);
  const longitudeDelta = radians(end.longitude - start.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(start.latitude)) *
      Math.cos(radians(end.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
