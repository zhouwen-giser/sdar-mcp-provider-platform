import { freshnessState } from "./snapshot.js";
import type {
  FreshnessPolicy,
  VehicleReconnaissanceState,
  VehicleSnapshot,
  VehicleTaskState,
} from "./types.js";

export interface PhysicalObservationAuthority {
  topic: string;
  observedAt: string;
  timeAuthority: "source" | "ingest";
  sourceSequence?: string;
  ingestSequence?: number;
  cursor: string;
}

export interface PhysicalDispatchBaseline {
  capturedAt: string;
  snapshotRevision: string;
  position?: VehicleSnapshot["chassis"]["position"];
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
  const speedFresh =
    freshnessState(input.snapshot, "chassis", input.freshness, input.now) === "fresh" &&
    speedKmh !== undefined;
  const stationary = stationaryFromSpeed(speedKmh, speedFresh, input.stationarySpeedThresholdKmh);
  const observationIsNew = input.currentAuthorities.some(
    (authority) =>
      ["/ugv/speed", "/ugv/nav_state", "status/ugv", "/ugv/status"].includes(authority.topic) &&
      isNewAuthority(input.baseline.observationAuthorities, authority),
  );
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
  return {
    capturedAt,
    snapshotRevision: snapshot.revision,
    ...(snapshot.chassis.position === undefined
      ? {}
      : { position: structuredClone(snapshot.chassis.position) }),
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
  const chassisFresh = freshnessState(snapshot, "chassis", input.freshness, input.now) === "fresh";
  const positionFresh = chassisFresh && snapshot.chassis.position !== undefined;
  const speedKmh = snapshot.chassis.speedKmh;
  const speedFresh = chassisFresh && speedKmh !== undefined;
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
  const newTopics = new Set(
    current
      .filter((authority) => isNewAuthority(baseline, authority))
      .map((authority) => authority.topic),
  );
  const hasMission = [...newTopics].some((topic) =>
    ["/ugv/mission_state", "status/ugv", "/ugv/status"].includes(topic),
  );
  const hasPosition = [...newTopics].some((topic) =>
    ["/ugv/gnss", "/ugv/nav_state"].includes(topic),
  );
  const hasSpeed = [...newTopics].some((topic) =>
    ["/ugv/speed", "/ugv/nav_state", "status/ugv", "/ugv/status"].includes(topic),
  );
  return hasMission && hasPosition && hasSpeed;
}

export function navigationTerminalFacts(input: {
  snapshot: VehicleSnapshot;
  baseline: PhysicalDispatchBaseline;
  missionId?: string;
  requestedDistanceM?: number;
  confirmation: PhysicalConfirmation;
}): Record<string, unknown> {
  const { snapshot, baseline, confirmation } = input;
  const endPosition = snapshot.chassis.position;
  return {
    ...(input.requestedDistanceM === undefined
      ? {}
      : { requestedDistanceM: input.requestedDistanceM }),
    ...(baseline.position === undefined ? {} : { startPosition: baseline.position }),
    ...(endPosition === undefined ? {} : { endPosition }),
    ...(baseline.position === undefined || endPosition === undefined
      ? {}
      : { observedDisplacementM: haversineDistanceM(baseline.position, endPosition) }),
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
  const baseline = baselines.find((candidate) => candidate.topic === current.topic);
  if (baseline === undefined) return true;
  if (current.sourceSequence !== undefined && baseline.sourceSequence !== undefined)
    return compareSequence(current.sourceSequence, baseline.sourceSequence) > 0;
  return (
    current.cursor !== baseline.cursor &&
    Date.parse(current.observedAt) >= Date.parse(baseline.observedAt)
  );
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
