import { describe, expect, it } from "vitest";
import { ClimateExecutionEngine } from "../../apps/home-assistant-climate-provider/src/execution.js";
import { HomeAssistantClimateClient } from "../../apps/home-assistant-climate-provider/src/home-assistant.js";
import { climateManifest } from "../../apps/home-assistant-climate-provider/src/manifest.js";
import { ClimateResourceRegistry } from "../../apps/home-assistant-climate-provider/src/resources.js";
import { ClimateProviderServer } from "../../apps/home-assistant-climate-provider/src/server.js";
import { MemoryClimateStore } from "../../apps/home-assistant-climate-provider/src/store.js";
import { NoopClimateTelemetry } from "../../apps/home-assistant-climate-provider/src/telemetry.js";
import type {
  ClimateExecution,
  HomeAssistantState,
} from "../../apps/home-assistant-climate-provider/src/types.js";
import { LightExecutionEngine } from "../../apps/home-assistant-light-provider/src/execution/execution-engine.js";
import { HomeAssistantLightClient } from "../../apps/home-assistant-light-provider/src/home-assistant.js";
import { lightManifest } from "../../apps/home-assistant-light-provider/src/manifest.js";
import { LightResourceRegistry } from "../../apps/home-assistant-light-provider/src/resources.js";
import { LightProviderServer } from "../../apps/home-assistant-light-provider/src/server.js";
import { MemoryLightStore } from "../../apps/home-assistant-light-provider/src/store.js";
import { NoopLightTelemetry } from "../../apps/home-assistant-light-provider/src/telemetry.js";
import type { LightExecution } from "../../apps/home-assistant-light-provider/src/types.js";
import { GrpcAdapterGateway, type CommandAck } from "../../packages/adapter-protocol/src/index.js";

interface AdvertisedOperation {
  name: string;
  execution: string;
  capabilities: {
    cancel: boolean;
    pauseResume: boolean;
    scheduling: boolean;
    observations: boolean;
  };
}

interface ControlHarness {
  gateway: GrpcAdapterGateway;
  taskId: string;
  operationName: string;
  argumentHash: string;
  externalExecutionId: string;
  homeAssistantCalls: () => number;
  persistedAckCount: () => number;
  close: () => Promise<void>;
}

describe("Home Assistant Provider task-control advertisement", () => {
  it("advertises synchronous reads and non-controllable write Tasks for Climate and Light", () => {
    const cases = [
      {
        operations: climateManifest("home-assistant-climate", "0.1.0")
          .operations as AdvertisedOperation[],
        read: "climate_get_state",
        writes: ["climate_set_power", "climate_set_hvac_mode", "climate_set_temperature"],
      },
      {
        operations: lightManifest("home-assistant-light", "0.1.0")
          .operations as AdvertisedOperation[],
        read: "light_get_state",
        writes: ["light_set_power", "light_set_brightness"],
      },
    ];

    for (const provider of cases) {
      expect(
        provider.operations.find((operation) => operation.name === provider.read),
      ).toMatchObject({
        execution: "SYNCHRONOUS",
        capabilities: {
          cancel: false,
          pauseResume: false,
          scheduling: false,
          observations: false,
        },
      });
      for (const operationName of provider.writes) {
        expect(
          provider.operations.find((operation) => operation.name === operationName),
        ).toMatchObject({
          execution: "TASK_REQUIRED",
          capabilities: {
            cancel: false,
            pauseResume: false,
            scheduling: true,
            observations: true,
          },
        });
      }
    }
  });

  it("returns durable negative cancel, pause and resume Acks without a Home Assistant call", async () => {
    const harnesses = await Promise.all([climateHarness(), lightHarness()]);
    try {
      for (const harness of harnesses) {
        const controls: {
          reasonCode: string;
          commandSequence: number;
          invoke: () => Promise<CommandAck>;
        }[] = [
          {
            reasonCode: "CANCEL_NOT_SUPPORTED",
            commandSequence: 11,
            invoke: () =>
              harness.gateway.requestCancel(
                harness.taskId,
                harness.operationName,
                harness.argumentHash,
                "USER_REQUESTED",
                11,
                { externalExecutionId: harness.externalExecutionId },
              ),
          },
          {
            reasonCode: "PAUSE_NOT_SUPPORTED",
            commandSequence: 12,
            invoke: () =>
              harness.gateway.pauseExecution(
                {
                  taskId: harness.taskId,
                  operationName: harness.operationName,
                  argumentHash: harness.argumentHash,
                  commandSequence: 12,
                },
                { externalExecutionId: harness.externalExecutionId },
              ),
          },
          {
            reasonCode: "RESUME_NOT_SUPPORTED",
            commandSequence: 13,
            invoke: () =>
              harness.gateway.resumeExecution(
                {
                  taskId: harness.taskId,
                  operationName: harness.operationName,
                  argumentHash: harness.argumentHash,
                  commandSequence: 13,
                },
                { externalExecutionId: harness.externalExecutionId },
              ),
          },
        ];

        for (const control of controls) {
          const first = await control.invoke();
          const replay = await control.invoke();
          expect(first).toMatchObject({
            accepted: false,
            reasonCode: control.reasonCode,
            message: control.reasonCode,
          });
          expect(String(first.commandSequence)).toBe(String(control.commandSequence));
          expect(replay).toEqual(first);
        }

        expect(harness.persistedAckCount()).toBe(3);
        expect(harness.homeAssistantCalls()).toBe(0);
      }
    } finally {
      await Promise.all(harnesses.map((harness) => harness.close()));
    }
  });
});

async function climateHarness(): Promise<ControlHarness> {
  const taskId = "climate-control-contract";
  const operationName = "climate_set_hvac_mode";
  const argumentHash = "c".repeat(64);
  const externalExecutionId = "ha-climate-control-contract";
  const store = new MemoryClimateStore();
  store.set(climateExecution({ taskId, operationName, argumentHash, externalExecutionId }));
  const client = new CountingClimateClient();
  const registry = new ClimateResourceRegistry([
    {
      resourceId: "living-ac",
      entityId: "climate.living_ac",
      displayName: "Living AC",
      enabled: true,
      temperatureRange: { minimum: 16, maximum: 30 },
      allowedHvacModes: ["cool", "heat"],
    },
  ]);
  const engine = new ClimateExecutionEngine(
    store,
    registry,
    client,
    new NoopClimateTelemetry(),
    1_000,
    true,
  );
  const server = new ClimateProviderServer(
    {
      providerId: "home-assistant-climate",
      providerVersion: "0.1.0",
      host: "127.0.0.1",
      port: 0,
      tlsMode: "disabled",
    },
    registry,
    client,
    store,
    engine,
  );
  const port = await server.start();
  const gateway = new GrpcAdapterGateway({
    endpoint: `127.0.0.1:${String(port)}`,
    providerId: "home-assistant-climate",
  });
  return {
    gateway,
    taskId,
    operationName,
    argumentHash,
    externalExecutionId,
    homeAssistantCalls: () => client.calls,
    persistedAckCount: () => Object.keys(store.get(taskId)?.commandAcks ?? {}).length,
    close: async () => {
      gateway.close();
      await server.close();
    },
  };
}

async function lightHarness(): Promise<ControlHarness> {
  const taskId = "light-control-contract";
  const operationName = "light_set_power";
  const argumentHash = "l".repeat(64);
  const externalExecutionId = "ha-light-control-contract";
  const store = new MemoryLightStore();
  store.set(lightExecution({ taskId, operationName, argumentHash, externalExecutionId }));
  const client = new CountingLightClient();
  const registry = new LightResourceRegistry([
    {
      resourceId: "main-light",
      entityId: "light.main_light",
      displayName: "Main light",
      enabled: true,
    },
  ]);
  const engine = new LightExecutionEngine(
    store,
    registry,
    client,
    new NoopLightTelemetry(),
    1_000,
    true,
  );
  const server = new LightProviderServer(
    {
      providerId: "home-assistant-light",
      providerVersion: "0.1.0",
      host: "127.0.0.1",
      port: 0,
      tlsMode: "disabled",
    },
    registry,
    client,
    store,
    engine,
  );
  const port = await server.start();
  const gateway = new GrpcAdapterGateway({
    endpoint: `127.0.0.1:${String(port)}`,
    providerId: "home-assistant-light",
  });
  return {
    gateway,
    taskId,
    operationName,
    argumentHash,
    externalExecutionId,
    homeAssistantCalls: () => client.calls,
    persistedAckCount: () => Object.keys(store.get(taskId)?.commandAcks ?? {}).length,
    close: async () => {
      gateway.close();
      await server.close();
    },
  };
}

class CountingClimateClient extends HomeAssistantClimateClient {
  calls = 0;

  constructor() {
    super({ baseUrl: "http://127.0.0.1:1", token: "not-used", timeoutMs: 1 });
  }

  override async getState(entityId: string): Promise<HomeAssistantState> {
    this.calls += 1;
    return state(entityId, "cool");
  }

  override async callService(): Promise<void> {
    this.calls += 1;
  }
}

class CountingLightClient extends HomeAssistantLightClient {
  calls = 0;

  constructor() {
    super({ baseUrl: "http://127.0.0.1:1", token: "not-used", timeoutMs: 1 });
  }

  override async getState(entityId: string): Promise<HomeAssistantState> {
    this.calls += 1;
    return state(entityId, "off");
  }

  override async turnOn(): Promise<void> {
    this.calls += 1;
  }

  override async turnOff(): Promise<void> {
    this.calls += 1;
  }

  override async setBrightness(): Promise<void> {
    this.calls += 1;
  }
}

function climateExecution(input: {
  taskId: string;
  operationName: "climate_set_hvac_mode";
  argumentHash: string;
  externalExecutionId: string;
}): ClimateExecution {
  const now = "2026-08-12T00:00:00.000Z";
  return {
    ...input,
    resourceId: "living-ac",
    entityId: "climate.living_ac",
    executionContext: executionContext(),
    desiredState: { type: "hvac_mode", hvacMode: "cool" },
    state: "CONFIRMING",
    sideEffectDispatched: true,
    dispatchState: "CALL_RETURNED",
    revision: 2,
    createdAt: now,
    updatedAt: now,
    confirmationDeadlineAt: "2026-08-12T00:00:10.000Z",
    lastSnapshot: {},
    commandAcks: {},
  };
}

function lightExecution(input: {
  taskId: string;
  operationName: "light_set_power";
  argumentHash: string;
  externalExecutionId: string;
}): LightExecution {
  const now = "2026-08-12T00:00:00.000Z";
  return {
    ...input,
    resourceId: "main-light",
    entityId: "light.main_light",
    executionContext: executionContext(),
    desiredState: { type: "power", power: "on" },
    state: "CONFIRMING",
    sideEffectDispatched: true,
    dispatchState: "CALL_RETURNED",
    revision: 2,
    createdAt: now,
    updatedAt: now,
    confirmationDeadlineAt: "2026-08-12T00:00:10.000Z",
    lastSnapshot: {},
    commandAcks: {},
  };
}

function executionContext(): {
  authorizationContextHash: string;
  executionMode: string;
  simulationId: string;
  correlationId: string;
} {
  return {
    authorizationContextHash: "a".repeat(64),
    executionMode: "LIVE",
    simulationId: "",
    correlationId: "task-control-contract",
  };
}

function state(entityId: string, value: string): HomeAssistantState {
  return {
    entity_id: entityId,
    state: value,
    attributes: {},
    last_changed: "2026-08-12T00:00:00.000Z",
    last_updated: "2026-08-12T00:00:00.000Z",
  };
}
