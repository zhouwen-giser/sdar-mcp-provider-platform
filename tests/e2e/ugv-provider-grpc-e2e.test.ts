import { afterEach, describe, expect, it } from "vitest";
import type { ClientReadableStream } from "@grpc/grpc-js";
import {
  GrpcAdapterGateway,
  type AdapterBusinessEvent,
  type ExecutionSnapshot,
} from "../../packages/adapter-protocol/src/index.js";
import { MemoryProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import { MockUgvDeviceMcpClient } from "../../packages/vehicle-device-mcp-client/src/index.js";
import { VehicleMqttIngress } from "../../packages/vehicle-mqtt-ingress/src/index.js";
import { UgvBusinessEventHub } from "../../apps/ugv-provider-adapter/src/business-events.js";
import { UgvProviderRuntime } from "../../apps/ugv-provider-adapter/src/runtime.js";
import { UgvProviderServer } from "../../apps/ugv-provider-adapter/src/server.js";
import { UgvTelemetry } from "../../apps/ugv-provider-adapter/src/telemetry.js";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.();
});

describe("UGV Adapter gRPC E2E", () => {
  it("serves NOT_READY surfaces while Device MCP is offline and becomes READY later", async () => {
    const store = new MemoryProviderStore();
    const ingress = new VehicleMqttIngress("direct_domain_json", {
      maxPayloadBytes: 65536,
      maxDepth: 16,
      maxNodes: 4096,
      maxStringBytes: 16384,
    });
    seed(ingress);
    const device = new OfflineThenOnlineUgvDevice();
    const telemetry = new UgvTelemetry({
      providerId: "isr.vehicle.ugv.ugv1",
      enabled: false,
      endpoint: "127.0.0.1:7002",
      tlsMode: "disabled",
    });
    const businessEvents = new UgvBusinessEventHub(store);
    const runtime = new UgvProviderRuntime(
      {
        providerId: "isr.vehicle.ugv.ugv1",
        freshness: {
          chassis: 3000,
          mission: 3000,
          health: 5000,
          target: 3000,
          payload: 3000,
        },
        allowNavigationWithRecon: true,
        fireRequiresChassisStopped: true,
        initialObservationWaitMs: 10,
        pollIntervalMs: 60_000,
      },
      store,
      ingress,
      device,
      businessEvents,
      telemetry,
    );
    await runtime.initializeLocal();
    cleanup.push(() => runtime.close());
    expect(runtime.readiness()).toMatchObject({
      state: "NOT_READY",
      recoveryComplete: false,
    });

    const server = new UgvProviderServer(
      {
        providerId: "isr.vehicle.ugv.ugv1",
        providerVersion: "1.0.0",
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
      providerId: "isr.vehicle.ugv.ugv1",
      timeoutMs: 3000,
    });
    cleanup.push(() => gateway.close());
    await expect(gateway.describeProvider()).resolves.toMatchObject({
      providerId: "isr.vehicle.ugv.ugv1",
    });
    await expect(
      gateway.checkAvailability(
        [
          {
            requestId: "not-ready",
            operationName: "vehicle_navigate",
            arguments: {
              resourceId: "vehicle:ugv1",
              mission: { type: "distance", direction: "forward", distanceM: 1 },
            },
          },
        ],
        {
          taskId: "not-ready",
          authorizationContextHash: "a".repeat(64),
          executionMode: "simulation",
          simulationId: "grpc-sim",
          argumentHash: "b".repeat(64),
        },
      ),
    ).resolves.toMatchObject({
      checks: [{ availability: "UNKNOWN", reasonCode: "UGV_PROVIDER_NOT_READY" }],
    });

    await runtime.initializeDependencies();
    expect(runtime.readiness()).toMatchObject({
      state: "DEGRADED",
      deviceMcpConnected: false,
      mqttConnected: true,
      recoveryComplete: true,
    });
    device.restore();
    await runtime.pollActive();
    expect(runtime.readiness()).toMatchObject({
      state: "READY",
      deviceMcpConnected: true,
      mqttConnected: true,
      initialObservationReceived: true,
    });
    const recoveredManifest = await gateway.describeProvider();
    expect(recoveredManifest.operations.map(({ name }) => name)).toContain("vehicle_navigate");
  });

  it("publishes the manifest, accepts navigation, confirms terminal state and replays events", async () => {
    const store = new MemoryProviderStore();
    const ingress = new VehicleMqttIngress("direct_domain_json", {
      maxPayloadBytes: 65536,
      maxDepth: 16,
      maxNodes: 4096,
      maxStringBytes: 16384,
    });
    seed(ingress);
    const device = new MockUgvDeviceMcpClient();
    const telemetry = new UgvTelemetry({
      providerId: "isr.vehicle.ugv.ugv1",
      enabled: false,
      endpoint: "127.0.0.1:7002",
      tlsMode: "disabled",
    });
    const businessEvents = new UgvBusinessEventHub(store);
    const runtime = new UgvProviderRuntime(
      {
        providerId: "isr.vehicle.ugv.ugv1",
        freshness: { chassis: 3000, mission: 3000, health: 5000, target: 3000, payload: 3000 },
        allowNavigationWithRecon: true,
        fireRequiresChassisStopped: true,
        stationaryStabilityMs: 0,
        pollIntervalMs: 60_000,
      },
      store,
      ingress,
      device,
      businessEvents,
      telemetry,
    );
    await runtime.initialize();
    cleanup.push(() => runtime.close());
    const server = new UgvProviderServer(
      {
        providerId: "isr.vehicle.ugv.ugv1",
        providerVersion: "1.0.0",
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
      providerId: "isr.vehicle.ugv.ugv1",
      timeoutMs: 3000,
    });
    cleanup.push(() => gateway.close());

    const manifest = await gateway.describeProvider();
    expect(manifest.operations).toHaveLength(11);
    expect(manifest.businessEventSources?.map((source) => source.sourceId)).toEqual([
      "vehicle.execution",
      "vehicle.health",
      "vehicle.target",
    ]);
    const args = {
      resourceId: "vehicle:ugv1",
      mission: { type: "point", target: { latitude: 30.2, longitude: 114.2 } },
      speedLimitKmh: 20,
      stopOnObstacle: true,
    };
    const options = {
      taskId: "grpc-nav-1",
      authorizationContextHash: "a".repeat(64),
      executionMode: "simulation" as const,
      simulationId: "grpc-sim",
      argumentHash: "b".repeat(64),
    };
    const available = await gateway.checkAvailability(
      [{ requestId: "availability-1", operationName: "vehicle_navigate", arguments: args }],
      options,
    );
    expect(available.checks[0]).toMatchObject({
      availability: "AVAILABLE",
      reasonCode: "UGV_AVAILABLE",
    });
    const started = await gateway.startOperation("vehicle_navigate", args, options);
    expect(started).toMatchObject({
      result: "accepted",
      accepted: { initialSnapshot: { state: "ACCEPTED" } },
    });

    ingress.handle(
      "/ugv/mission_state",
      Buffer.from('{"entity_id":"ugv1","id":1,"type":1,"state":1,"progress":50}'),
    );
    await expectExecutionState(
      gateway,
      "grpc-nav-1",
      started.accepted?.externalExecutionId,
      options,
      "RUNNING",
    );
    ingress.handle(
      "/ugv/mission_state",
      Buffer.from('{"entity_id":"ugv1","id":1,"type":1,"state":4,"progress":100}'),
    );
    ingress.handle(
      "/ugv/gnss",
      Buffer.from('{"entity_id":"ugv1","latitude":30.1001,"longitude":114.1001}'),
    );
    const stationaryObservedAt = Date.now();
    ingress.handle(
      "/ugv/speed",
      Buffer.from('{"entity_id":"ugv1","speed_kmh":0.05}'),
      false,
      new Date(stationaryObservedAt).toISOString(),
    );
    await runtime.pollActive();
    ingress.handle(
      "/ugv/speed",
      Buffer.from('{"entity_id":"ugv1","speed_kmh":0}'),
      false,
      new Date(stationaryObservedAt + 1).toISOString(),
    );
    await runtime.pollActive();
    const terminal = await expectExecutionState(
      gateway,
      "grpc-nav-1",
      started.accepted?.externalExecutionId,
      options,
      "SUCCEEDED",
    );
    expect(terminal).toMatchObject({ state: "SUCCEEDED", reasonCode: "UGV_DEVICE_TASK_COMPLETED" });

    const source = manifest.businessEventSources?.find(
      (candidate) => candidate.sourceId === "vehicle.execution",
    );
    expect(source).toBeDefined();
    if (source === undefined) throw new Error("UGV_EVENT_SOURCE_MISSING");
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

class OfflineThenOnlineUgvDevice extends MockUgvDeviceMcpClient {
  #offline = true;

  override connect(): Promise<void> {
    return this.#offline
      ? Promise.reject(new Error("UGV_DEVICE_MCP_UNAVAILABLE"))
      : super.connect();
  }

  override contracts() {
    return this.connected() ? super.contracts() : [];
  }

  restore(): void {
    this.#offline = false;
  }
}

function seed(ingress: VehicleMqttIngress): void {
  ingress.setConnected(true);
  ingress.handle(
    "/ugv/gnss",
    Buffer.from('{"entity_id":"ugv1","latitude":30.1,"longitude":114.1}'),
  );
  ingress.handle(
    "/ugv/component_status",
    Buffer.from(
      '{"entity_id":"ugv1","power_battery":0,"lvbattery":0,"fuel":0,"water_temp":0,"motor":0,"sensor":0,"gnss":0,"comms":0,"weapon":0,"navigation":0}',
    ),
  );
}

function collect(
  stream: ClientReadableStream<AdapterBusinessEvent>,
  count: number,
): Promise<AdapterBusinessEvent[]> {
  return new Promise((resolve, reject) => {
    const events: AdapterBusinessEvent[] = [];
    const timer = setTimeout(() => reject(new Error("UGV_EVENT_REPLAY_TIMEOUT")), 3000);
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

async function expectExecutionState(
  gateway: GrpcAdapterGateway,
  taskId: string,
  externalExecutionId: string | undefined,
  options: {
    taskId: string;
    authorizationContextHash: string;
    executionMode: "simulation";
    simulationId: string;
    argumentHash: string;
  },
  expectedState: string,
): Promise<ExecutionSnapshot> {
  const deadline = Date.now() + 3_000;
  for (;;) {
    const execution = await gateway.getExecution(taskId, externalExecutionId, options);
    if (execution.state === expectedState) return execution;
    if (Date.now() >= deadline) throw new Error(`UGV_EXECUTION_STATE_TIMEOUT:${execution.state}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
