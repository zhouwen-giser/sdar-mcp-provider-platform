import type { ProviderStore } from "../../../packages/provider-adapter-kit/src/index.js";
import type { UgvQualificationMatrixInput } from "../../../packages/vehicle-device-mcp-client/src/index.js";
import { vehicleProviderManifest } from "../../../packages/vehicle-provider-core/src/index.js";
import { qualifyUgvCapabilities } from "./capabilities.js";

export function ugvManifest(
  providerId: string,
  version: string,
  store: ProviderStore,
  resourceId: string,
  qualificationContext: UgvQualificationMatrixInput,
): Record<string, unknown> {
  const support = qualifyUgvCapabilities({
    contracts: qualificationContext.contracts,
    executionMode: qualificationContext.executionMode,
    ...(qualificationContext.externallyVerified === undefined
      ? {}
      : { externallyVerified: qualificationContext.externallyVerified }),
  }).support;
  return vehicleProviderManifest(
    {
      providerId,
      providerType: "isr.vehicle.ugv",
      providerVersion: version,
      resourceId,
      displayKind: "UGV",
      navigationSupport: support.navigation,
      supportsScanModes: support.reconnaissance.area,
      supportsCircularEoScan: support.reconnaissance.circular,
      supportsCapabilityQuery: support.capabilityQuery,
      supportsTargetTracking: support.targetTracking,
      supportsGimbalControl: support.gimbal,
      supportsNavigationPlanning: support.navigation.point,
      supportsFire: support.fire,
      supportsEmergencyStop: support.emergencyStop,
      supportsLaserRange: support.laserRange,
      supportsFireCancellationBeforeDispatch: support.fire,
      supportsFireCommandRejectedOutput: support.fire,
      supportsReconCoverageOutput: support.reconnaissance.area,
      circularScanOmitsArea: true,
    },
    store,
  );
}
