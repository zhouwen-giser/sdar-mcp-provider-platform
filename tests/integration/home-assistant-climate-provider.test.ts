import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GrpcAdapterGateway,
  protoStructToJson,
} from "../../packages/adapter-protocol/src/index.js";
import { ClimateExecutionEngine } from "../../apps/home-assistant-climate-provider/src/execution.js";
import {
  HomeAssistantClimateClient,
  HomeAssistantClimateWebSocket,
  normalizeClimateState,
} from "../../apps/home-assistant-climate-provider/src/home-assistant.js";
import { ClimateResourceRegistry } from "../../apps/home-assistant-climate-provider/src/resources.js";
import { ClimateProviderServer } from "../../apps/home-assistant-climate-provider/src/server.js";
import { MemoryClimateStore } from "../../apps/home-assistant-climate-provider/src/store.js";
import { NoopClimateTelemetry } from "../../apps/home-assistant-climate-provider/src/telemetry.js";
import { FakeHomeAssistantClimate } from "../fixtures/fake-home-assistant-climate.js";
const resource = {
  resourceId: "living-ac",
  entityId: "climate.living_ac",
  displayName: "Living AC",
  enabled: true,
  temperatureRange: { minimum: 16, maximum: 30 },
  allowedHvacModes: ["cool", "heat", "dry", "fan_only", "auto"],
};
let fake: FakeHomeAssistantClimate;
let ws: HomeAssistantClimateWebSocket | undefined;
let server: ClimateProviderServer | undefined;
let gateway: GrpcAdapterGateway | undefined;
beforeEach(async () => {
  fake = new FakeHomeAssistantClimate();
  fake.setState(resource.entityId, "off", {
    current_temperature: 28,
    temperature: 24,
    min_temp: 16,
    max_temp: 30,
    hvac_modes: ["cool", "heat", "dry", "fan_only", "auto"],
    temperature_unit: "°C",
  });
  await fake.start();
});
afterEach(async () => {
  ws?.stop();
  gateway?.close();
  if (server !== undefined) await server.close();
  await fake.close();
});
describe("Home Assistant climate Provider", () => {
  it("exposes four operations and executes idempotent mode and temperature controls", async () => {
    const { store } = await setup();
    expect((await gateway?.describeProvider())?.operations.map((o) => o.name)).toEqual([
      "climate_get_state",
      "climate_set_power",
      "climate_set_hvac_mode",
      "climate_set_temperature",
    ]);
    const options = { taskId: "mode-task", argumentHash: "a".repeat(64) };
    await gateway?.startOperation(
      "climate_set_hvac_mode",
      { resourceId: resource.resourceId, hvacMode: "cool" },
      options,
    );
    await wait(() => store.get("mode-task")?.state === "SUCCEEDED");
    await gateway?.startOperation(
      "climate_set_hvac_mode",
      { resourceId: resource.resourceId, hvacMode: "cool" },
      options,
    );
    expect(fake.serviceCalls).toHaveLength(1);
    await gateway?.startOperation(
      "climate_set_temperature",
      { resourceId: resource.resourceId, targetTemperature: 22.5 },
      { taskId: "temperature-task", argumentHash: "b".repeat(64) },
    );
    await wait(() => store.get("temperature-task")?.state === "SUCCEEDED");
    expect(fake.serviceCalls[1]).toMatchObject({
      service: "set_temperature",
      data: { entity_id: resource.entityId, temperature: 22.5 },
    });
    expect(store.get("temperature-task")?.confirmedState).toMatchObject({
      targetTemperature: 22.5,
      reachable: true,
    });
    const snapshot = await gateway?.getExecution("temperature-task");
    expect(protoStructToJson(snapshot?.result)).toMatchObject({ targetTemperature: 22.5 });
    expect(snapshot?.evidence?.[0]?.evidenceType).toBe("climate.target_temperature.observation");
    expect(snapshot?.evidence?.[0]?.payloadRef).toMatchObject({
      kind: "structured_content",
      jsonPointer: "/targetTemperature",
    });
    expect(JSON.stringify(snapshot?.evidence)).not.toContain("requirementId");
  });
  it("uses REST polling when WebSocket is stopped and rejects disallowed modes", async () => {
    const { store, engine } = await setup();
    ws?.stop();
    await gateway?.startOperation(
      "climate_set_power",
      { resourceId: resource.resourceId, power: "on" },
      { taskId: "power-task", argumentHash: "c".repeat(64) },
    );
    await wait(async () => {
      await engine.poll("power-task");
      return store.get("power-task")?.state === "SUCCEEDED";
    });
    const rejected = await gateway?.startOperation(
      "climate_set_hvac_mode",
      { resourceId: resource.resourceId, hvacMode: "eco" },
      { taskId: "bad-mode", argumentHash: "d".repeat(64) },
    );
    expect(rejected?.rejected?.reasonCode).toBe("HVAC_MODE_NOT_ALLOWED");
  });
  async function setup(): Promise<{ store: MemoryClimateStore; engine: ClimateExecutionEngine }> {
    const registry = new ClimateResourceRegistry([resource]);
    const store = new MemoryClimateStore();
    const rest = new HomeAssistantClimateClient({
      baseUrl: fake.url,
      token: fake.token,
      timeoutMs: 1000,
    });
    const engine = new ClimateExecutionEngine(
      store,
      registry,
      rest,
      new NoopClimateTelemetry(),
      2000,
    );
    ws = new HomeAssistantClimateWebSocket({
      baseUrl: fake.url,
      token: fake.token,
      entityIds: registry.entityIds(),
      reconnectMinMs: 20,
      reconnectMaxMs: 100,
    });
    ws.onState((state) => void engine.observe(normalizeClimateState(resource.resourceId, state)));
    ws.start();
    server = new ClimateProviderServer(
      {
        providerId: "home-assistant-climate",
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
      providerId: "home-assistant-climate",
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { store, engine };
  }
});
async function wait(predicate: () => boolean | Promise<boolean>, timeout = 3000): Promise<void> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("WAIT_TIMEOUT");
}
