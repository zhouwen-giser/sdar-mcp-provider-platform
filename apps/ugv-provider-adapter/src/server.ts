import { jsonToProtoStruct } from "../../../packages/adapter-protocol/src/index.js";
import {
  VehicleProviderGrpcServer,
  type ProviderStore,
} from "../../../packages/provider-adapter-kit/src/index.js";
import type {
  UgvSnapshot,
  VehicleIdentity,
} from "../../../packages/vehicle-provider-core/src/index.js";
import type { UgvBusinessEventHub } from "./business-events.js";
import { ugvManifest } from "./manifest.js";
import type { UgvProviderRuntime } from "./runtime.js";

export class UgvProviderServer extends VehicleProviderGrpcServer {
  constructor(
    options: {
      providerId: string;
      providerVersion: string;
      identity?: VehicleIdentity;
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
        manifest: () =>
          ugvManifest(
            options.providerId,
            options.providerVersion,
            store,
            options.identity?.resourceId ?? "vehicle:ugv1",
            runtime.qualificationContext(),
          ),
        resource: (snapshot) => ugvResource(snapshot as UgvSnapshot, runtime.readiness()),
      },
      runtime,
      store,
      businessEvents,
    );
  }
}

function ugvResource(
  snapshot: UgvSnapshot,
  readiness: ReturnType<UgvProviderRuntime["readiness"]>,
): Record<string, unknown> {
  return {
    resourceId: snapshot.identity.resourceId,
    resourceType: "isr.vehicle.ugv",
    displayName: "UGV-1",
    enabled: true,
    health:
      readiness.state === "NOT_READY" || readiness.state === "UNKNOWN"
        ? "unknown"
        : readiness.state === "DEGRADED" || snapshot.connectivity.deviceAvailable === false
          ? "degraded"
          : Object.values(snapshot.health.components).some((value) => value === "fault")
            ? "degraded"
            : "healthy",
    labels: {},
    metadata: jsonToProtoStruct({
      entityId: snapshot.identity.entityId,
      vehicleRole: snapshot.identity.vehicleType,
      executionModes: [snapshot.identity.executionMode],
      tracks: ["chassis", "eo", "weapon"],
      externalVideo: true,
      refereeDataAvailable: false,
      globalTruthAvailable: false,
      providerReadiness: readiness,
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
