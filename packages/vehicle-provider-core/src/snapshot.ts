import { createHash } from "node:crypto";
import type {
  FreshnessDomain,
  FreshnessPolicy,
  NpcTankSnapshot,
  SnapshotPatch,
  UgvSnapshot,
  VehicleIdentity,
  VehicleSnapshot,
} from "./types.js";

const unknownComponents = () => ({
  powerBattery: "unknown" as const,
  lowVoltageBattery: "unknown" as const,
  fuel: "unknown" as const,
  waterTemperature: "unknown" as const,
  motor: "unknown" as const,
  sensor: "unknown" as const,
  gnss: "unknown" as const,
  communications: "unknown" as const,
  weapon: "unknown" as const,
  navigation: "unknown" as const,
});

export function createUgvSnapshot(
  identity: VehicleIdentity = {
    providerId: "isr.vehicle.ugv.ugv1",
    resourceId: "vehicle:ugv1",
    entityId: "ugv1",
    vehicleType: "ugv",
    executionMode: "simulation",
  },
  now = new Date().toISOString(),
): UgvSnapshot {
  const snapshot = createVehicleSnapshot(identity, now) as UgvSnapshot;
  snapshot.payload.eoTask = { state: "unknown" };
  snapshot.payload.reconnaissance.motionStatus = "unknown";
  snapshot.revision = snapshotRevision(snapshot);
  return snapshot;
}

export function createNpcTankSnapshot(
  supportsCircularEoScan = false,
  now = new Date().toISOString(),
): NpcTankSnapshot {
  const snapshot = createVehicleSnapshot(
    {
      providerId: "isr.vehicle.npc-tank.npc-tank1",
      resourceId: "vehicle:npc_tank1",
      entityId: "npc_tank1",
      vehicleType: "npc_tank",
      executionMode: "simulation",
    },
    now,
  ) as NpcTankSnapshot;
  snapshot.payload.eoTask = { state: "unknown" };
  snapshot.payload.reconnaissance.motionStatus = "unknown";
  snapshot.payload.eoScan = { supported: supportsCircularEoScan };
  snapshot.revision = snapshotRevision(snapshot);
  return snapshot;
}

export function createVehicleSnapshot(
  identity: VehicleIdentity,
  now = new Date().toISOString(),
): VehicleSnapshot {
  const snapshot: VehicleSnapshot = {
    identity: structuredClone(identity),
    chassis: { mission: { state: "unknown" } },
    payload: {
      reconnaissance: { state: "unknown" },
      weapon: { state: "unknown" },
      targets: [],
    },
    health: {
      chassisErrorCodes: [],
      payloadErrorCodes: [],
      components: unknownComponents(),
    },
    connectivity: { mqttConnected: false, deviceMcpConnected: false },
    freshness: {},
    revision: "0",
    observedAt: now,
  };
  snapshot.revision = snapshotRevision(snapshot);
  return snapshot;
}

export function applySnapshotPatch(
  current: VehicleSnapshot,
  patch: SnapshotPatch,
  observedAt: string,
  domains: FreshnessDomain[],
): VehicleSnapshot {
  const next = structuredClone(current);
  if (patch.chassis !== undefined) {
    next.chassis = {
      ...next.chassis,
      ...patch.chassis,
      mission: patch.chassis.mission ?? next.chassis.mission,
      ...(patch.chassis.energy === undefined
        ? {}
        : { energy: { ...next.chassis.energy, ...patch.chassis.energy } }),
      ...(patch.chassis.temperature === undefined
        ? {}
        : { temperature: { ...next.chassis.temperature, ...patch.chassis.temperature } }),
      ...(patch.chassis.navigation === undefined
        ? {}
        : { navigation: { ...next.chassis.navigation, ...patch.chassis.navigation } }),
    };
  }
  if (patch.payload !== undefined) {
    const reconnaissancePatch = structuredClone(patch.payload.reconnaissance);
    const cameraFault =
      reconnaissancePatch?.cameraFault ?? next.payload.reconnaissance.cameraFault ?? false;
    if (cameraFault && reconnaissancePatch !== undefined) {
      delete reconnaissancePatch.progress;
      delete reconnaissancePatch.coverage;
      reconnaissancePatch.progressAuthoritative = false;
    }
    next.payload = {
      ...next.payload,
      ...patch.payload,
      ...(patch.payload.eoTask === undefined ? {} : { eoTask: patch.payload.eoTask }),
      reconnaissance:
        reconnaissancePatch === undefined
          ? next.payload.reconnaissance
          : {
              ...next.payload.reconnaissance,
              ...reconnaissancePatch,
              ...(reconnaissancePatch.coverage === undefined
                ? {}
                : {
                    coverage: {
                      ...next.payload.reconnaissance.coverage,
                      ...reconnaissancePatch.coverage,
                    },
                  }),
              ...(reconnaissancePatch.lock === undefined
                ? {}
                : {
                    lock: {
                      ...next.payload.reconnaissance.lock,
                      ...reconnaissancePatch.lock,
                    },
                  }),
              ...(reconnaissancePatch.coverability === undefined
                ? {}
                : { coverability: reconnaissancePatch.coverability }),
            },
      weapon: patch.payload.weapon ?? next.payload.weapon,
      targets: patch.payload.targets ?? next.payload.targets,
      ...(patch.payload.gimbal === undefined
        ? {}
        : { gimbal: { ...next.payload.gimbal, ...patch.payload.gimbal } }),
      ...(patch.payload.laser === undefined
        ? {}
        : { laser: { ...next.payload.laser, ...patch.payload.laser } }),
    };
  }
  if (patch.health !== undefined) {
    next.health = {
      ...next.health,
      ...patch.health,
      components: { ...next.health.components, ...patch.health.components },
    };
  }
  if (patch.connectivity !== undefined)
    next.connectivity = { ...next.connectivity, ...patch.connectivity };
  for (const domain of domains) next.freshness[`${domain}ObservedAt`] = observedAt;
  next.observedAt = observedAt;
  next.revision = snapshotRevision(next);
  assertNoRefereeData(next);
  return next;
}

export function snapshotRevision(snapshot: VehicleSnapshot): string {
  const value = structuredClone(snapshot);
  value.revision = "";
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function freshnessState(
  snapshot: VehicleSnapshot,
  domain: FreshnessDomain,
  policy: FreshnessPolicy,
  now = Date.now(),
): "fresh" | "stale" | "unknown" {
  const observedAt = snapshot.freshness[`${domain}ObservedAt`];
  if (observedAt === undefined) return "unknown";
  const age = now - Date.parse(observedAt);
  const maximumFutureSkewMs = policy.maximumFutureSkewMs ?? 0;
  return Number.isFinite(age) && age >= -maximumFutureSkewMs && age <= policy[domain]
    ? "fresh"
    : "stale";
}

export function assertNoRefereeData(value: unknown): void {
  const forbidden = new Set([
    "hp",
    "alive",
    "camp",
    "damage",
    "remaininghp",
    "remaining_hp",
    "hit",
    "miss",
    "destroyed",
    "friendly_fire",
    "referee",
    "global_truth",
  ]);
  visit(value, (key) => {
    if (forbidden.has(key.toLowerCase())) throw new Error("UGV_REFEREE_DATA_FORBIDDEN");
  });
}

function visit(value: unknown, keyVisitor: (key: string) => void): void {
  if (Array.isArray(value)) for (const child of value) visit(child, keyVisitor);
  else if (value !== null && typeof value === "object")
    for (const [key, child] of Object.entries(value)) {
      keyVisitor(key);
      visit(child, keyVisitor);
    }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
