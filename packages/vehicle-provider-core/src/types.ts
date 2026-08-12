export type VehicleTaskState = -1 | 0 | 1 | 2 | 3 | 4 | 5 | "unknown";
export type ReconMotionStatus =
  1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 99 | "unknown";
export type ComponentHealth = "normal" | "fault" | "unknown";
export type VehicleTrack = "chassis" | "eo" | "weapon";

export interface VehicleTaskTrack {
  id?: string;
  type?: string | number;
  state: VehicleTaskState;
  progress?: number;
  observedAt?: string;
}

export interface VehicleTarget {
  targetId: string;
  objectType?: string;
  targetType?: number;
  captureTimeUs?: number;
  position?: {
    x?: number;
    y?: number;
    z?: number;
    latitude?: number;
    longitude?: number;
    altitude?: number;
  };
  velocity?: { eastMps?: number; northMps?: number; upMps?: number };
  distanceM?: number;
  confidence?: number;
  threat?: number;
  iff?: number;
  lockTimeSec?: number;
  pixelPosition?: { x?: number; y?: number; theta?: number; width?: number; height?: number };
  roleName?: string;
  coordinateFrame?: "carla_world" | "WGS84";
  source?: "mqtt" | "mqtt_detected_objects" | "mqtt_area_recon" | "device_mcp";
  observedAt: string;
}

export interface ReconCoverability {
  coverable: "full" | "partial" | "none" | "unknown";
  coverableLabel?: string;
  regionMinDistanceM?: number;
  regionMaxDistanceM?: number;
  detectionRangeM?: number;
}

export interface ReconLockObservation {
  stage?: 1 | 2 | 3 | 4;
  targetId?: string;
  roleName?: string;
  durationSec?: number;
}

export interface ReconCommandAck {
  sequence?: string;
  ok: boolean;
  message?: string;
  coverability?: ReconCoverability;
}

export interface ReconCoverageObservation {
  runId?: number;
  scanMode?: 1 | 2;
  coveragePercent?: number;
  coveredCount?: number;
  totalCount?: number;
  cellSizeM?: number;
  coveredCells?: { x: number; y: number }[];
  sectorWidthDeg?: number;
  sectorsTotal?: number;
  sectorsCovered?: number;
  sectors?: { startDeg: number; endDeg: number }[];
  incomplete?: boolean;
  reason?: string;
}

export interface ReconExceptionObservation {
  kind: "motion" | "equipment" | "object_loss" | "unknown";
  level?: 1 | 2;
  errorCode?: number;
  timeUs?: number;
  reason?: string;
  observedAt: string;
}

/**
 * The authoritative reconnaissance state machine is MotionStatus, not chassis
 * MissionState. `state` remains a compatibility projection for existing
 * Provider code while callers migrate to `motionStatus` and
 * `mapReconMotionStatus`.
 */
export interface VehicleReconnaissanceState extends VehicleTaskTrack {
  motionStatus?: ReconMotionStatus;
  statusLabel?: string;
  scanMode?: 1 | 2;
  scanModeLabel?: string;
  scanPitchDeg?: number;
  outOfRange?: boolean;
  cameraFault?: boolean;
  progressAuthoritative?: boolean;
  scanCount?: number;
  workMode?: number;
  reconType?: number;
  loadStatus?: number;
  loadStatusLabel?: string;
  online?: boolean;
  coverage?: ReconCoverageObservation;
  lock?: ReconLockObservation;
  attackReady?: boolean;
  lastCommandAck?: ReconCommandAck | null;
  coverability?: ReconCoverability;
  lastException?: ReconExceptionObservation;
}

export interface VehicleIdentity {
  providerId: string;
  resourceId: string;
  entityId: string;
  vehicleType: string;
  executionMode: "simulation";
}

export interface VehicleSnapshot {
  identity: VehicleIdentity;
  chassis: {
    position?: { latitude: number; longitude: number; altitude?: number };
    attitude?: { yaw: number; pitch: number; roll: number };
    compassHeadingDeg?: number;
    speedKmh?: number;
    energy?: {
      rangeKm?: number;
      lowVoltageSoc?: number;
      highVoltage1Soc?: number;
      highVoltage2Soc?: number;
      fuel1?: number;
      fuel2?: number;
    };
    temperature?: { motor?: number; engineWater?: number };
    mission: VehicleTaskTrack;
    navigation?: {
      positionX?: number;
      positionY?: number;
      positionZ?: number;
      speedKmh?: number;
      batteryRangeKm?: number;
    };
  };
  payload: {
    online?: boolean;
    gimbal?: { yaw?: number; pitch?: number; zoom?: number };
    laser?: { distanceM?: number; valid?: boolean };
    eoTask?: VehicleTaskTrack;
    reconnaissance: VehicleReconnaissanceState;
    weapon: VehicleTaskTrack;
    lockedTargetId?: string;
    attackReady?: boolean;
    targets: VehicleTarget[];
    eoScan?: {
      supported: boolean;
      active?: boolean;
      mode?: "circular" | "unknown";
      angle?: number;
      zoom?: number;
      angleUnit?: "rad" | "deg" | "unknown";
    };
  };
  health: {
    runState?: number;
    mode?: number;
    speedLimitKmh?: number;
    chassisErrorCodes: number[];
    payloadErrorCodes: string[];
    components: {
      powerBattery: ComponentHealth;
      lowVoltageBattery: ComponentHealth;
      fuel: ComponentHealth;
      waterTemperature: ComponentHealth;
      motor: ComponentHealth;
      sensor: ComponentHealth;
      gnss: ComponentHealth;
      communications: ComponentHealth;
      weapon: ComponentHealth;
      navigation: ComponentHealth;
    };
  };
  connectivity: {
    mqttConnected: boolean;
    deviceMcpConnected: boolean;
    deviceAvailable?: boolean;
    packetLossRate?: number;
    averageRoundTripTimeMs?: number;
  };
  freshness: {
    chassisObservedAt?: string;
    healthObservedAt?: string;
    missionObservedAt?: string;
    targetObservedAt?: string;
    payloadObservedAt?: string;
  };
  revision: string;
  observedAt: string;
}

export interface UgvSnapshot extends VehicleSnapshot {
  identity: {
    providerId: "isr.vehicle.ugv.ugv1";
    resourceId: "vehicle:ugv1";
    entityId: "ugv1";
    vehicleType: "ugv";
    executionMode: "simulation";
  };
  payload: VehicleSnapshot["payload"] & {
    eoTask: VehicleTaskTrack;
    reconnaissance: VehicleReconnaissanceState & { motionStatus: ReconMotionStatus };
  };
}

export interface NpcTankSnapshot extends VehicleSnapshot {
  identity: {
    providerId: "isr.vehicle.npc-tank.npc-tank1";
    resourceId: "vehicle:npc_tank1";
    entityId: "npc_tank1";
    vehicleType: "npc_tank";
    executionMode: "simulation";
  };
  payload: VehicleSnapshot["payload"] & {
    eoTask: VehicleTaskTrack;
    reconnaissance: VehicleReconnaissanceState & { motionStatus: ReconMotionStatus };
  };
}

export type FreshnessDomain = "chassis" | "health" | "mission" | "target" | "payload";
export interface FreshnessPolicy {
  chassis: number;
  health: number;
  mission: number;
  target: number;
  payload: number;
}

export interface SnapshotPatch {
  chassis?: Partial<Omit<VehicleSnapshot["chassis"], "mission">> & {
    mission?: VehicleTaskTrack;
  };
  payload?: Partial<
    Omit<VehicleSnapshot["payload"], "eoTask" | "reconnaissance" | "weapon" | "targets">
  > & {
    eoTask?: VehicleTaskTrack;
    reconnaissance?: Partial<
      Omit<
        VehicleReconnaissanceState,
        "coverage" | "lock" | "lastCommandAck" | "coverability" | "lastException"
      >
    > & {
      coverage?: Partial<ReconCoverageObservation>;
      lock?: Partial<ReconLockObservation>;
      lastCommandAck?: ReconCommandAck | null;
      coverability?: ReconCoverability;
      lastException?: ReconExceptionObservation;
    };
    weapon?: VehicleTaskTrack;
    targets?: VehicleTarget[];
  };
  health?: Partial<Omit<VehicleSnapshot["health"], "components">> & {
    components?: Partial<VehicleSnapshot["health"]["components"]>;
  };
  connectivity?: Partial<VehicleSnapshot["connectivity"]>;
}

export interface AvailabilityContext {
  operationName: string;
  operationTracks?: Readonly<Record<string, readonly VehicleTrack[]>>;
  snapshot: VehicleSnapshot;
  freshness: FreshnessPolicy;
  occupiedTracks: ReadonlySet<VehicleTrack>;
  requiredToolsPresent: boolean;
  targetId?: string;
  allowNavigationWithRecon: boolean;
  fireRequiresChassisStopped: boolean;
  reasonPrefix?: "UGV" | "NPC_TANK";
  circularScanSupported?: boolean;
  scanMode?: string;
  now?: number;
}

export interface AvailabilityDecision {
  availability: "AVAILABLE" | "DISABLED" | "UNKNOWN";
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  reasonCode: string;
  description: string;
}
