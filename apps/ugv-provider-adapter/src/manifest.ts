import type { ProviderStore } from "../../../packages/provider-adapter-kit/src/index.js";
import type { UgvQualificationMatrixInput } from "../../../packages/vehicle-device-mcp-client/src/index.js";
import { vehicleProviderManifest } from "../../../packages/vehicle-provider-core/src/index.js";
import { qualifyUgvCapabilities } from "./capabilities.js";

export function ugvManifest(
  providerId: string,
  version: string,
  store: ProviderStore,
  resourceId = "vehicle:ugv1",
  qualificationContext?: UgvQualificationMatrixInput,
): Record<string, unknown> {
  const support =
    qualificationContext === undefined
      ? undefined
      : qualifyUgvCapabilities(qualificationContext).support;
  return vehicleProviderManifest(
    {
      providerId,
      providerType: "isr.vehicle.ugv",
      providerVersion: version,
      resourceId,
      displayKind: "UGV",
      supportsScanModes: support?.reconnaissance.area ?? true,
      supportsCircularEoScan: support?.reconnaissance.circular ?? true,
      supportsCapabilityQuery: support?.capabilityQuery ?? true,
      supportsGimbalControl: support?.gimbal ?? true,
      supportsNavigationPlanning: support?.navigation.point ?? true,
      supportsFireCancellationBeforeDispatch: support?.fire ?? true,
      supportsFireCommandRejectedOutput: support?.fire ?? true,
      supportsReconCoverageOutput: support?.reconnaissance.area ?? true,
      circularScanOmitsArea: true,
    },
    store,
  );
}
