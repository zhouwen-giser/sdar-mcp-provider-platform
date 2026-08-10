import type { ProviderStore } from "../../../packages/provider-adapter-kit/src/index.js";
import { vehicleProviderManifest } from "../../../packages/vehicle-provider-core/src/index.js";

export function ugvManifest(
  providerId: string,
  version: string,
  store: ProviderStore,
): Record<string, unknown> {
  return vehicleProviderManifest(
    {
      providerId,
      providerType: "isr.vehicle.ugv",
      providerVersion: version,
      resourceId: "vehicle:ugv1",
      displayKind: "UGV",
      supportsScanModes: true,
      supportsCircularEoScan: true,
      supportsCapabilityQuery: true,
      supportsGimbalControl: true,
      supportsNavigationPlanning: true,
      supportsFireCancellationBeforeDispatch: true,
      circularScanOmitsArea: true,
    },
    store,
  );
}
