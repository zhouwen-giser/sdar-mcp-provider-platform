export type VehicleTaskState = -1 | 0 | 1 | 2 | 3 | 4 | 5 | "unknown";
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
  position?: {
    x?: number;
    y?: number;
    z?: number;
    latitude?: number;
    longitude?: number;
  };
  coordinateFrame?: "carla_world" | "WGS84";
  source?: "mqtt" | "device_mcp";
  observedAt: string;
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
    reconnaissance: VehicleTaskTrack;
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
}

export interface NpcTankSnapshot extends VehicleSnapshot {
  identity: {
    providerId: "isr.vehicle.npc-tank.npc-tank1";
    resourceId: "vehicle:npc_tank1";
    entityId: "npc_tank1";
    vehicleType: "npc_tank";
    executionMode: "simulation";
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
  payload?: Partial<Omit<VehicleSnapshot["payload"], "reconnaissance" | "weapon" | "targets">> & {
    reconnaissance?: VehicleTaskTrack;
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
