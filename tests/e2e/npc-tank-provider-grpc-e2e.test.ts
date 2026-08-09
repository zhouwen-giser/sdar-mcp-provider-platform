import type { ClientReadableStream } from "@grpc/grpc-js";
import {
  GrpcAdapterGateway,
  type AdapterBusinessEvent,
} from "../../packages/adapter-protocol/src/index.js";
import { MemoryProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import { MockNpcTankDeviceMcpClient } from "../../packages/vehicle-device-mcp-client/src/index.js";
import {
  npcTankMqttProfile,
  VehicleMqttIngress,
} from "../../packages/vehicle-mqtt-ingress/src/index.js";
import {
  VehicleBusinessEventHub,
  VehicleTelemetry,
  type NpcTankSnapshot,
} from "../../packages/vehicle-provider-core/src/index.js";
import { NpcTankProviderRuntime } from "../../apps/npc-tank-provider-adapter/src/runtime.js";
import { NpcTankProviderServer } from "../../apps/npc-tank-provider-adapter/src/server.js";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.();
});

describe("NPC Tank Adapter gRPC E2E", () => {
  it("publishes one NPC resource, executes navigation and replays durable events", async () => {
    const store = new MemoryProviderStore();
    const ingress = new VehicleMqttIngress<NpcTankSnapshot>(
      "direct_domain_json",
      { maxPayloadBytes: 65536, maxDepth: 16, maxNodes: 4096, maxStringBytes: 16384 },
      npcTankMqttProfile(),
    );
    seed(ingress);
    const device = new MockNpcTankDeviceMcpClient();
    const telemetry = new VehicleTelemetry({
      providerId: "isr.vehicle.npc-tank.npc-tank1",
      resourceId: "vehicle:npc_tank1",
      resourceType: "isr.vehicle.npc_tank",
      enabled: false,
      endpoint: "127.0.0.1:7005",
      tlsMode: "disabled",
    });
    const businessEvents = new VehicleBusinessEventHub(store, {
      reasonPrefix: "NPC_TANK",
      resourceId: "vehicle:npc_tank1",
    });
    const runtime = new NpcTankProviderRuntime(
      {
        providerId: "isr.vehicle.npc-tank.npc-tank1",
        providerVersion: "0.1.0",
        freshness: {
          chassis: 3000,
          mission: 3000,
          health: 5000,
          target: 3000,
          payload: 3000,
        },
        allowNavigationWithRecon: true,
        fireRequiresChassisStopped: true,
        pollIntervalMs: 60_000,
        navigationReportPath: resolve(
          tmpdir(),
          `sdar-npc-tank-${String(process.pid)}-grpc-navigation.json`,
        ),
        eoScanReportPath: resolve(tmpdir(), `sdar-npc-tank-${String(process.pid)}-grpc-eo.json`),
      },
      store,
      ingress,
      device,
      businessEvents,
      telemetry,
    );
    await runtime.initialize();
    cleanup.push(() => runtime.close());
    const server = new NpcTankProviderServer(
      {
        providerId: "isr.vehicle.npc-tank.npc-tank1",
        providerVersion: "0.1.0",
        host: "127.0.0.1",
        port: 0,
        tlsMode: "disabled",
      },
      runtime,
      store,
      businessEvents,
    );
    const port = await server.start();
    cleanup.push(() => server.close());
    const gateway = new GrpcAdapterGateway({
      endpoint: `127.0.0.1:${String(port)}`,
      providerId: "isr.vehicle.npc-tank.npc-tank1",
      timeoutMs: 3000,
    });
    cleanup.push(() => gateway.close());

    const manifest = await gateway.describeProvider();
    expect(manifest).toMatchObject({
      providerId: "isr.vehicle.npc-tank.npc-tank1",
      providerType: "isr.vehicle.npc_tank",
    });
    expect(manifest.operations).toHaveLength(9);
    const args = {
      resourceId: "vehicle:npc_tank1",
      mission: {
        type: "point",
        target: { latitude: 30.2, longitude: 114.2 },
      },
      speedLimitKmh: 20,
      stopOnObstacle: true,
    };
    const options = {
      taskId: "grpc-npc-nav-1",
      authorizationContextHash: "a".repeat(64),
      executionMode: "simulation" as const,
      simulationId: "grpc-npc-sim",
      argumentHash: "b".repeat(64),
    };
    const available = await gateway.checkAvailability(
      [{ requestId: "availability-1", operationName: "vehicle_navigate", arguments: args }],
      options,
    );
    expect(available.checks[0]).toMatchObject({
      availability: "AVAILABLE",
      reasonCode: "NPC_TANK_AVAILABLE",
    });
    const started = await gateway.startOperation("vehicle_navigate", args, options);
    expect(started).toMatchObject({
      result: "accepted",
      accepted: { initialSnapshot: { state: "ACCEPTED" } },
    });
    mission(ingress, 4, 100);
    const terminal = await gateway.getExecution(
      "grpc-npc-nav-1",
      started.accepted?.externalExecutionId,
      options,
    );
    expect(terminal).toMatchObject({
      state: "SUCCEEDED",
      reasonCode: "NPC_TANK_DEVICE_TASK_COMPLETED",
    });

    const source = manifest.businessEventSources?.find(
      (candidate) => candidate.sourceId === "vehicle.execution",
    );
    if (source === undefined) throw new Error("NPC_TANK_EVENT_SOURCE_MISSING");
    const events = await collect(
      gateway.streamBusinessEvents({
        sourceId: source.sourceId,
        sourceStreamId: source.sourceStreamId,
        afterSourceSequence: "0",
      }),
      2,
    );
    expect(events.map((event) => event.eventType)).toEqual([
      "vehicle.mission.started",
      "vehicle.mission.completed",
    ]);
  });
});

function seed(ingress: VehicleMqttIngress<NpcTankSnapshot>): void {
  ingress.setConnected(true);
  ingress.handle(
    "/npc_tank1/gnss",
    Buffer.from('{"entity_id":"npc_tank1","latitude":30.1,"longitude":114.1}'),
  );
  ingress.handle(
    "/npc_tank1/component_status",
    Buffer.from(
      '{"entity_id":"npc_tank1","power_battery":0,"lvbattery":0,"fuel":0,"water_temp":0,"motor":0,"sensor":0,"gnss":0,"comms":0,"weapon":0,"navigation":0}',
    ),
  );
  status(ingress, -1, 0);
}
function mission(
  ingress: VehicleMqttIngress<NpcTankSnapshot>,
  state: number,
  progress: number,
): void {
  status(ingress, state, progress);
  ingress.handle(
    "/npc_tank1/mission_state",
    Buffer.from(
      JSON.stringify({
        entity_id: "npc_tank1",
        id: "grpc-npc-mission",
        type: 1,
        state,
        progress,
      }),
    ),
  );
}
function status(
  ingress: VehicleMqttIngress<NpcTankSnapshot>,
  state: number,
  progress: number,
): void {
  ingress.handle(
    "/npc_tank1/status",
    Buffer.from(
      JSON.stringify({
        vehicle_id: "npc_tank1",
        role_name: "npc_tank1",
        speed_kmh: 0,
        chassis_task: { state, progress },
        eo_task: { state: -1, progress: 0 },
        weapon_task: { state: -1, progress: 0 },
        available: true,
      }),
    ),
  );
}
function collect(
  stream: ClientReadableStream<AdapterBusinessEvent>,
  count: number,
): Promise<AdapterBusinessEvent[]> {
  return new Promise((resolve, reject) => {
    const events: AdapterBusinessEvent[] = [];
    const timer = setTimeout(() => reject(new Error("NPC_TANK_EVENT_REPLAY_TIMEOUT")), 3000);
    stream.on("data", (event: AdapterBusinessEvent) => {
      events.push(event);
      if (events.length >= count) {
        clearTimeout(timer);
        stream.cancel();
        resolve(events);
      }
    });
    stream.on("error", (error) => {
      if ((error as { code?: number }).code !== 1) reject(error);
    });
  });
}
