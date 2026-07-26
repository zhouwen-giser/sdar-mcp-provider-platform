import { jsonToProtoStruct } from "../../../packages/adapter-protocol/src/index.js";
import {
  VehicleProviderGrpcServer,
  type ProviderStore,
} from "../../../packages/provider-adapter-kit/src/index.js";
import type {
  NpcTankSnapshot,
  VehicleBusinessEventHub,
} from "../../../packages/vehicle-provider-core/src/index.js";
import { npcTankManifest } from "./manifest.js";
import type { NpcTankProviderRuntime } from "./runtime.js";

export class NpcTankProviderServer extends VehicleProviderGrpcServer {
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
    runtime: NpcTankProviderRuntime,
    store: ProviderStore,
    businessEvents: VehicleBusinessEventHub,
  ) {
    super(
      {
        host: options.host,
        port: options.port,
        tlsMode: options.tlsMode,
        ...(options.tlsCaPath === undefined ? {} : { tlsCaPath: options.tlsCaPath }),
        ...(options.tlsCertPath === undefined ? {} : { tlsCertPath: options.tlsCertPath }),
        ...(options.tlsKeyPath === undefined ? {} : { tlsKeyPath: options.tlsKeyPath }),
        internalErrorCode: "NPC_TANK_ADAPTER_INTERNAL_ERROR",
        manifest: () =>
          npcTankManifest(
            options.providerId,
            options.providerVersion,
            store,
            runtime.circularScanSupported(),
          ),
        resource: (snapshot) => npcTankResource(snapshot as NpcTankSnapshot, runtime),
      },
      runtime,
      store,
      businessEvents,
    );
  }
}

export function npcTankResource(
  snapshot: NpcTankSnapshot,
  runtime: NpcTankProviderRuntime,
): Record<string, unknown> {
  return {
    resourceId: "vehicle:npc_tank1",
    resourceType: "isr.vehicle.npc_tank",
    displayName: "NPC Tank 1",
    enabled: true,
    health:
      !snapshot.connectivity.mqttConnected || !snapshot.connectivity.deviceMcpConnected
        ? "unknown"
        : Object.values(snapshot.health.components).some((value) => value === "fault")
          ? "degraded"
          : "healthy",
    labels: { vehicleRole: "npc_tank1", executionMode: "simulation" },
    metadata: jsonToProtoStruct({
      entityId: "npc_tank1",
      vehicleRole: "npc_tank1",
      executionModes: ["simulation"],
      tracks: ["chassis", "eo", "weapon"],
      supportsCircularEoScan: runtime.circularScanSupported(),
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
