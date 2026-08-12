import type { ProviderStore } from "../../../packages/provider-adapter-kit/src/index.js";
import { vehicleProviderManifest } from "../../../packages/vehicle-provider-core/src/index.js";

export function npcTankManifest(
  providerId: string,
  version: string,
  store: ProviderStore,
  supportsCircularEoScan: boolean,
): Record<string, unknown> {
  return vehicleProviderManifest(
    {
      providerId,
      providerType: "isr.vehicle.npc_tank",
      providerVersion: version,
      resourceId: "vehicle:npc_tank1",
      displayKind: "NPC Tank",
      supportsScanModes: true,
      supportsCircularEoScan,
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
