import { jsonToProtoStruct } from "../../../packages/adapter-protocol/src/index.js";
import {
  VehicleProviderGrpcServer,
  type ProviderStore,
} from "../../../packages/provider-adapter-kit/src/index.js";
import type { UgvSnapshot } from "../../../packages/vehicle-provider-core/src/index.js";
import type { UgvBusinessEventHub } from "./business-events.js";
import { ugvManifest } from "./manifest.js";
import type { UgvProviderRuntime } from "./runtime.js";

export class UgvProviderServer extends VehicleProviderGrpcServer {
  constructor(
    options: {
      providerId: string;
      providerVersion: string;
      host: string;
      port: number;
      tlsMode: "disabled" | "required";
      tlsCaPath?: string;
      tlsCertPath?: string;
      tlsKeyPath?: string;
    },
    runtime: UgvProviderRuntime,
    store: ProviderStore,
    businessEvents: UgvBusinessEventHub,
  ) {
    super(
      {
        host: options.host,
        port: options.port,
        tlsMode: options.tlsMode,
        ...(options.tlsCaPath === undefined ? {} : { tlsCaPath: options.tlsCaPath }),
        ...(options.tlsCertPath === undefined ? {} : { tlsCertPath: options.tlsCertPath }),
        ...(options.tlsKeyPath === undefined ? {} : { tlsKeyPath: options.tlsKeyPath }),
        internalErrorCode: "UGV_ADAPTER_INTERNAL_ERROR",
        manifest: () => ugvManifest(options.providerId, options.providerVersion, store),
        resource: (snapshot) => ugvResource(snapshot as UgvSnapshot),
      },
      runtime,
      store,
      businessEvents,
    );
  }
}

function ugvResource(snapshot: UgvSnapshot): Record<string, unknown> {
  return {
    resourceId: "vehicle:ugv1",
    resourceType: "isr.vehicle.ugv",
    displayName: "UGV-1",
    enabled: true,
    health:
      !snapshot.connectivity.mqttConnected || !snapshot.connectivity.deviceMcpConnected
        ? "unknown"
        : snapshot.connectivity.deviceAvailable === false
          ? "degraded"
          : Object.values(snapshot.health.components).some((value) => value === "fault")
            ? "degraded"
            : "healthy",
    labels: {},
    metadata: jsonToProtoStruct({
      entityId: "ugv1",
      vehicleRole: "ugv",
      executionModes: ["simulation"],
      tracks: ["chassis", "eo", "weapon"],
      externalVideo: true,
      refereeDataAvailable: false,
      globalTruthAvailable: false,
    }),
    lastSeenAt: timestamp(snapshot.observedAt),
  };
}
function timestamp(value: string): { seconds: string; nanos: number } {
  const milliseconds = Date.parse(value);
  return {
    seconds: String(Math.floor(milliseconds / 1000)),
    nanos: (milliseconds % 1000) * 1_000_000,
  };
}
