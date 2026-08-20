import type { ProviderStore } from "../../../packages/provider-adapter-kit/src/index.js";
import { VehicleBusinessEventHub } from "../../../packages/vehicle-provider-core/src/index.js";

export class UgvBusinessEventHub extends VehicleBusinessEventHub {
  constructor(store: ProviderStore, resourceId = "vehicle:ugv1", retentionMs = 604_800_000) {
    super(store, { reasonPrefix: "UGV", resourceId }, retentionMs);
  }
}
