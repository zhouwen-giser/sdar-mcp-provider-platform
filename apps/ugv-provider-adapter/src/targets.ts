import {
  deduplicateNormalizedVehicleTargets,
  normalizeVehicleDeviceTargets,
} from "../../../packages/vehicle-provider-core/src/index.js";

export function normalizeDeviceTargets(
  values: readonly unknown[],
  fallbackObservedAt = new Date().toISOString(),
): Record<string, unknown>[] {
  return normalizeVehicleDeviceTargets(values, "UGV", fallbackObservedAt);
}

export const deduplicateTargets = deduplicateNormalizedVehicleTargets;
