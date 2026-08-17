import type { ProviderStore } from "../../../packages/provider-adapter-kit/src/index.js";
import { vehicleProviderManifest } from "../../../packages/vehicle-provider-core/src/index.js";

export function ugvManifest(
  providerId: string,
  version: string,
  store: ProviderStore,
  resourceId = "vehicle:ugv1",
): Record<string, unknown> {
  return vehicleProviderManifest(
    {
      providerId,
      providerType: "isr.vehicle.ugv",
      providerVersion: version,
      resourceId,
      displayKind: "UGV",
      supportsScanModes: true,
      supportsCircularEoScan: true,
      supportsCapabilityQuery: true,
      supportsGimbalControl: true,
      supportsNavigationPlanning: true,
      supportsFireCancellationBeforeDispatch: true,
      supportsFireCommandRejectedOutput: true,
      supportsReconCoverageOutput: true,
      circularScanOmitsArea: true,
    },
    store,
  );
}
