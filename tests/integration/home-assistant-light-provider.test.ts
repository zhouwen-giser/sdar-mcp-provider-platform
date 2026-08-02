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
import { MemoryLightStore } from "../../apps/home-assistant-light-provider/src/store.js";
import { NoopLightTelemetry } from "../../apps/home-assistant-light-provider/src/telemetry.js";
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
