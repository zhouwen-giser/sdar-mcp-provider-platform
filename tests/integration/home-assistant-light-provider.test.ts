import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GrpcAdapterGateway,
  protoStructToJson,
} from "../../packages/adapter-protocol/src/index.js";
import { LightExecutionEngine } from "../../apps/home-assistant-light-provider/src/execution/execution-engine.js";
import {
  HomeAssistantLightClient,
  HomeAssistantLightWebSocket,
  normalizeLightState,
} from "../../apps/home-assistant-light-provider/src/home-assistant.js";
import { LightResourceRegistry } from "../../apps/home-assistant-light-provider/src/resources.js";
import { LightProviderServer } from "../../apps/home-assistant-light-provider/src/server.js";
import {
  JsonLightStore,
  MemoryLightStore,
} from "../../apps/home-assistant-light-provider/src/store.js";
import { NoopLightTelemetry } from "../../apps/home-assistant-light-provider/src/telemetry.js";
import type { LightExecution } from "../../apps/home-assistant-light-provider/src/types.js";
import { FakeHomeAssistantLight } from "../fixtures/fake-home-assistant-light.js";

const resource = {
  resourceId: "main-light",
  entityId: "light.main_light",
  displayName: "Main light",
  enabled: true,
};
let fake: FakeHomeAssistantLight;
let websocket: HomeAssistantLightWebSocket | undefined;
let server: LightProviderServer | undefined;
let gateway: GrpcAdapterGateway | undefined;

beforeEach(async () => {
  fake = new FakeHomeAssistantLight();
  fake.setState(resource.entityId, "off", {
    brightness: 128,
    supported_color_modes: ["brightness"],
  });
  await fake.start();
});
afterEach(async () => {
  websocket?.stop();
  gateway?.close();
  await server?.close();
  await fake.close();
});

describe("Home Assistant light Provider", () => {
  it("exposes state and power/brightness operations with observed confirmation", async () => {
    const { store, engine } = await setup();
    expect(
      (await gateway?.describeProvider())?.operations.map((operation) => operation.name),
    ).toEqual(["light_get_state", "light_set_power", "light_set_brightness"]);
    const state = await gateway?.startOperation(
      "light_get_state",
      { resourceId: resource.resourceId },
      { taskId: "read-task", argumentHash: "a".repeat(64) },
    );
    expect(protoStructToJson(state?.accepted?.initialSnapshot?.result)).toMatchObject({
      resourceId: resource.resourceId,
      power: "off",
      brightnessPercent: 50,
    });
    await gateway?.startOperation(
      "light_set_power",
      { resourceId: resource.resourceId, power: "on" },
      { taskId: "power-task", argumentHash: "b".repeat(64) },
    );
    await wait(() => store.get("power-task")?.state === "SUCCEEDED");
    await gateway?.startOperation(
      "light_set_power",
      { resourceId: resource.resourceId, power: "on" },
      { taskId: "power-task", argumentHash: "b".repeat(64) },
    );
    expect(fake.serviceCalls).toHaveLength(1);
    await gateway?.startOperation(
      "light_set_brightness",
      { resourceId: resource.resourceId, brightnessPercent: 25 },
      { taskId: "brightness-task", argumentHash: "c".repeat(64) },
    );
    await wait(() => store.get("brightness-task")?.state === "SUCCEEDED");
    expect(store.get("brightness-task")?.confirmedState).toMatchObject({
      brightnessPercent: 25,
      reachable: true,
    });
    expect(
      (await gateway?.getExecution("brightness-task"))?.evidence?.[0]?.payloadRef,
    ).toMatchObject({ kind: "structured_content", jsonPointer: "/brightnessPercent" });
    expect(JSON.stringify(await gateway?.getExecution("brightness-task"))).not.toContain(
      "requirementId",
    );
    expect(fake.serviceCalls).toEqual([
      { service: "turn_on", data: { entity_id: resource.entityId } },
      { service: "turn_on", data: { entity_id: resource.entityId, brightness_pct: 25 } },
    ]);
    void engine;
  });

  it("uses REST polling after WebSocket loss and fails closed on confirmation timeout", async () => {
    const { store, engine } = await setup();
    websocket?.stop();
    fake.suppressChanges = true;
    await gateway?.startOperation(
      "light_set_power",
      { resourceId: resource.resourceId, power: "on" },
      { taskId: "timeout-task", argumentHash: "d".repeat(64) },
    );
    await wait(async () => {
      await engine.poll("timeout-task");
      return store.get("timeout-task")?.state === "TECHNICAL_FAILED";
    }, 3000);
    expect(store.get("timeout-task")?.confirmedState).toBeUndefined();
  });

  it("reconciles a persisted dispatch marker without repeating the service call", async () => {
    const { store } = await setup();
    await gateway?.startOperation(
      "light_set_power",
      { resourceId: resource.resourceId, power: "on" },
      { taskId: "restart-task", argumentHash: "e".repeat(64) },
    );
    const existing = store.get("restart-task");
    if (existing === undefined) throw new Error("EXPECTED_PERSISTED_EXECUTION");
    store.set({
      ...existing,
      state: "PENDING_SIDE_EFFECT",
      sideEffectDispatched: true,
    });
    const callsBeforeRecovery = fake.serviceCalls.length;
    const recoveredEngine = new LightExecutionEngine(
      store,
      new LightResourceRegistry([resource]),
      new HomeAssistantLightClient({ baseUrl: fake.url, token: fake.token, timeoutMs: 1000 }),
      new NoopLightTelemetry(),
      500,
      true,
    );
    await recoveredEngine.recover();
    expect(fake.serviceCalls.length).toBe(callsBeforeRecovery);
    expect(store.get("restart-task")?.state).toBe("SUCCEEDED");
  });

  it("fails closed without replay when a process stops after persisting dispatch intent", async () => {
    const store = new MemoryLightStore();
    const registry = new LightResourceRegistry([resource]);
    const client = new HomeAssistantLightClient({
      baseUrl: fake.url,
      token: fake.token,
      timeoutMs: 1000,
    });
    const startedAt = Date.parse("2026-08-10T00:00:00.000Z");
    const crashing = new LightExecutionEngine(
      store,
      registry,
      client,
      new NoopLightTelemetry(),
      1000,
      true,
      {
        now: () => startedAt,
        hooks: {
          afterDispatchIntentPersisted: () => {
            throw new Error("SIMULATED_PROCESS_CRASH");
          },
        },
      },
    );
    await expect(
      crashing.start({
        taskId: "pre-call-crash",
        operationName: "light_set_power",
        resourceId: resource.resourceId,
        power: "on",
        argumentHash: "f".repeat(64),
        executionContext: liveLightContext(),
      }),
    ).rejects.toThrow("SIMULATED_PROCESS_CRASH");
    expect(fake.serviceCalls).toHaveLength(0);
    expect(store.get("pre-call-crash")?.dispatchState).toBe("INTENT_PERSISTED");

    const recovered = new LightExecutionEngine(
      store,
      registry,
      client,
      new NoopLightTelemetry(),
      1000,
      true,
      { now: () => startedAt + 2000 },
    );
    await recovered.recover();
    expect(fake.serviceCalls).toHaveLength(0);
    expect(store.get("pre-call-crash")).toMatchObject({
      state: "TECHNICAL_FAILED",
      failureReasonCode: "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT",
    });
  });

  it("rejects expired recovery before a late write or late success", async () => {
    const store = new MemoryLightStore();
    const startedAt = Date.parse("2026-08-10T00:00:00.000Z");
    const deadline = new Date(startedAt + 1000).toISOString();
    const base: LightExecution = {
      taskId: "expired-before-dispatch",
      externalExecutionId: "expired-before-dispatch-execution",
      operationName: "light_set_power",
      resourceId: resource.resourceId,
      entityId: resource.entityId,
      argumentHash: "0".repeat(64),
      executionContext: liveLightContext(),
      desiredState: { type: "power", power: "off" },
      state: "PENDING_SIDE_EFFECT",
      sideEffectDispatched: false,
      dispatchState: "NOT_STARTED",
      revision: 1,
      createdAt: new Date(startedAt).toISOString(),
      updatedAt: new Date(startedAt).toISOString(),
      confirmationDeadlineAt: deadline,
      lastSnapshot: {},
      commandAcks: {},
    };
    store.set(base);
    store.set({
      ...base,
      taskId: "expired-after-intent",
      externalExecutionId: "expired-after-intent-execution",
      argumentHash: "1".repeat(64),
      desiredState: { type: "power", power: "on" },
      sideEffectDispatched: true,
      dispatchState: "INTENT_PERSISTED",
    });
    fake.setState(resource.entityId, "on", {
      brightness: 128,
      supported_color_modes: ["brightness"],
    });
    fake.suppressChanges = true;

    const recovered = new LightExecutionEngine(
      store,
      new LightResourceRegistry([resource]),
      new HomeAssistantLightClient({ baseUrl: fake.url, token: fake.token, timeoutMs: 1000 }),
      new NoopLightTelemetry(),
      1000,
      true,
      { now: () => startedAt + 2000 },
    );
    await recovered.recover();

    expect(fake.serviceCalls).toHaveLength(0);
    for (const taskId of ["expired-before-dispatch", "expired-after-intent"]) {
      expect(store.get(taskId)).toMatchObject({
        state: "TECHNICAL_FAILED",
        failureReasonCode: "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT",
      });
    }
  });

  it("rejects non-live writes and serializes concurrent duplicate admission", async () => {
    const store = new MemoryLightStore();
    const engine = new LightExecutionEngine(
      store,
      new LightResourceRegistry([resource]),
      new HomeAssistantLightClient({ baseUrl: fake.url, token: fake.token, timeoutMs: 1000 }),
      new NoopLightTelemetry(),
      1000,
      true,
    );
    await expect(
      engine.start({
        taskId: "simulation",
        operationName: "light_set_power",
        resourceId: resource.resourceId,
        power: "on",
        argumentHash: "1".repeat(64),
        executionContext: { ...liveLightContext(), executionMode: "SIMULATION" },
      }),
    ).rejects.toMatchObject({ reasonCode: "EXECUTION_MODE_NOT_LIVE" });
    expect(fake.serviceCalls).toHaveLength(0);

    fake.suppressChanges = true;
    const input = {
      taskId: "concurrent-light",
      operationName: "light_set_power" as const,
      resourceId: resource.resourceId,
      power: "on" as const,
      argumentHash: "2".repeat(64),
      executionContext: liveLightContext(),
    };
    await Promise.all([engine.start(input), engine.start(input)]);
    expect(fake.serviceCalls).toHaveLength(1);
  });

  it("fails recovery when a public resource is remapped to another entity", async () => {
    fake.setState("light.remapped", "off", { supported_color_modes: ["brightness"] });
    const store = new MemoryLightStore();
    const client = new HomeAssistantLightClient({
      baseUrl: fake.url,
      token: fake.token,
      timeoutMs: 1000,
    });
    const crashing = new LightExecutionEngine(
      store,
      new LightResourceRegistry([resource]),
      client,
      new NoopLightTelemetry(),
      1000,
      true,
      {
        hooks: {
          afterDispatchIntentPersisted: () => {
            throw new Error("SIMULATED_PROCESS_CRASH");
          },
        },
      },
    );
    await expect(
      crashing.start({
        taskId: "remapped-light",
        operationName: "light_set_power",
        resourceId: resource.resourceId,
        power: "on",
        argumentHash: "3".repeat(64),
        executionContext: liveLightContext(),
      }),
    ).rejects.toThrow("SIMULATED_PROCESS_CRASH");

    const recovered = new LightExecutionEngine(
      store,
      new LightResourceRegistry([{ ...resource, entityId: "light.remapped" }]),
      client,
      new NoopLightTelemetry(),
      1000,
      true,
    );
    await recovered.recover();
    expect(fake.serviceCalls).toHaveLength(0);
    expect(store.get("remapped-light")).toMatchObject({
      state: "TECHNICAL_FAILED",
      failureReasonCode: "RECOVERY_RESOURCE_NOT_ALLOWLISTED",
    });
  });

  it("rejects mismatched operations and out-of-range brightness in durable state", () => {
    const now = new Date().toISOString();
    const base: LightExecution = {
      taskId: "corrupt-light",
      externalExecutionId: "external",
      operationName: "light_set_brightness",
      resourceId: resource.resourceId,
      entityId: resource.entityId,
      argumentHash: "f".repeat(64),
      executionContext: liveLightContext(),
      desiredState: { type: "brightness", brightnessPercent: 50 },
      state: "PENDING_SIDE_EFFECT",
      sideEffectDispatched: false,
      dispatchState: "NOT_STARTED",
      revision: 1,
      createdAt: now,
      updatedAt: now,
      confirmationDeadlineAt: now,
      lastSnapshot: {},
      commandAcks: {},
    };
    const corruptions: LightExecution[] = [
      { ...base, operationName: "light_set_power" },
      { ...base, desiredState: { type: "brightness", brightnessPercent: 101 } },
    ];
    for (const execution of corruptions) {
      const path = join(mkdtempSync(join(tmpdir(), "light-corrupt-")), "state.json");
      writeFileSync(
        path,
        JSON.stringify({
          version: 1,
          executions: { corrupt: execution },
          pendingTelemetryEvents: [],
          nextTelemetrySequence: 1,
        }),
      );
      expect(() => new JsonLightStore(path)).toThrow("INVALID_PROVIDER_STATE_FILE");
    }
  });
});

async function setup(): Promise<{ store: MemoryLightStore; engine: LightExecutionEngine }> {
  const registry = new LightResourceRegistry([resource]);
  const store = new MemoryLightStore();
  const rest = new HomeAssistantLightClient({
    baseUrl: fake.url,
    token: fake.token,
    timeoutMs: 1000,
  });
  const engine = new LightExecutionEngine(
    store,
    registry,
    rest,
    new NoopLightTelemetry(),
    500,
    true,
  );
  websocket = new HomeAssistantLightWebSocket({
    baseUrl: fake.url,
    token: fake.token,
    entityIds: registry.entityIds(),
    reconnectMinMs: 20,
    reconnectMaxMs: 100,
  });
  websocket.onState(
    (state) => void engine.observe(normalizeLightState(resource.resourceId, state)),
  );
  websocket.start();
  server = new LightProviderServer(
    {
      providerId: "home-assistant-light",
      providerVersion: "0.1.0",
      host: "127.0.0.1",
      port: 0,
      tlsMode: "disabled",
    },
    registry,
    rest,
    store,
    engine,
  );
  const port = await server.start();
  gateway = new GrpcAdapterGateway({
    endpoint: `127.0.0.1:${String(port)}`,
    providerId: "home-assistant-light",
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  return { store, engine };
}
async function wait(predicate: () => boolean | Promise<boolean>, timeout = 3000): Promise<void> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("WAIT_TIMEOUT");
}

function liveLightContext(): LightExecution["executionContext"] {
  return {
    authorizationContextHash: "auth",
    executionMode: "LIVE",
    simulationId: "",
    correlationId: "c",
  };
}
