import { VehicleTelemetry } from "../../../packages/vehicle-provider-core/src/index.js";

export class UgvTelemetry extends VehicleTelemetry {
  constructor(options: {
    providerId: string;
    resourceId?: string;
    enabled: boolean;
    endpoint: string;
    tlsMode: "disabled" | "required";
    caPath?: string;
    certPath?: string;
    keyPath?: string;
  }) {
    super({
      ...options,
      resourceId: options.resourceId ?? "vehicle:ugv1",
      resourceType: "isr.vehicle.ugv",
    });
  }
}
