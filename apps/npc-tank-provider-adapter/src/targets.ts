import {
  deduplicateNormalizedVehicleTargets,
  normalizeVehicleDeviceTargets,
} from "../../../packages/vehicle-provider-core/src/index.js";

export function normalizeNpcTankDeviceTargets(
  values: readonly unknown[],
  fallbackObservedAt = new Date().toISOString(),
): Record<string, unknown>[] {
  return normalizeVehicleDeviceTargets(values, "NPC_TANK", fallbackObservedAt);
}

export const deduplicateNpcTankTargets = deduplicateNormalizedVehicleTargets;
