import { describe, expect, it } from "vitest";
import { ClimateExecutionEngine } from "../../apps/home-assistant-climate-provider/src/execution.js";
import { HomeAssistantClimateClient } from "../../apps/home-assistant-climate-provider/src/home-assistant.js";
import { ClimateResourceRegistry } from "../../apps/home-assistant-climate-provider/src/resources.js";
import { MemoryClimateStore } from "../../apps/home-assistant-climate-provider/src/store.js";
import { NoopClimateTelemetry } from "../../apps/home-assistant-climate-provider/src/telemetry.js";
import type { ClimateExecution } from "../../apps/home-assistant-climate-provider/src/types.js";
import { FakeHomeAssistantClimate } from "../fixtures/fake-home-assistant-climate.js";
describe("Home Assistant climate security", () => {
  it("redacts token-shaped material from errors and rejects unconfigured resources before side effects", async () => {
    const fake = new FakeHomeAssistantClimate();
    fake.setState("climate.allowed", "off", { hvac_modes: ["cool"], min_temp: 16, max_temp: 30 });
    await fake.start();
    try {
      fake.statusOverride = 401;
      const rest = new HomeAssistantClimateClient({
        baseUrl: fake.url,
        token: fake.token,
        timeoutMs: 1000,
      });
      let message = "";
      try {
        await rest.getState("climate.allowed");
      } catch (e) {
        message = String(e);
      }
      expect(message).toContain("HOME_ASSISTANT_UNAUTHORIZED");
      expect(message).not.toContain(fake.token);
      fake.statusOverride = undefined;
      const engine = new ClimateExecutionEngine(
        new MemoryClimateStore(),
        new ClimateResourceRegistry([
          {
            resourceId: "allowed",
            entityId: "climate.allowed",
            displayName: "Allowed",
            enabled: true,
            temperatureRange: { minimum: 16, maximum: 30 },
            allowedHvacModes: ["cool"],
          },
        ]),
        rest,
        new NoopClimateTelemetry(),
        1000,
        true,
      );
      await expect(
        engine.start({
          taskId: "bad",
          operationName: "climate_set_power",
          resourceId: "other",
          power: "on",
          argumentHash: "e".repeat(64),
          executionContext: {
            authorizationContextHash: "auth",
            executionMode: "LIVE",
            simulationId: "",
            correlationId: "c",
          },
        }),
      ).rejects.toMatchObject({ reasonCode: "RESOURCE_NOT_CONFIGURED" });
      expect(fake.serviceCalls).toHaveLength(0);
    } finally {
      await fake.close();
    }
  });

  it("fails closed for real writes when the side-effect gate is closed", async () => {
    const fake = new FakeHomeAssistantClimate();
    fake.setState("climate.allowed", "off", { hvac_modes: ["cool"], min_temp: 16, max_temp: 30 });
    await fake.start();
    try {
      const engine = new ClimateExecutionEngine(
        new MemoryClimateStore(),
        new ClimateResourceRegistry([
          {
            resourceId: "allowed",
            entityId: "climate.allowed",
            displayName: "Allowed",
            enabled: true,
            temperatureRange: { minimum: 16, maximum: 30 },
            allowedHvacModes: ["cool"],
          },
        ]),
        new HomeAssistantClimateClient({ baseUrl: fake.url, token: fake.token, timeoutMs: 1000 }),
        new NoopClimateTelemetry(),
        1000,
        false,
      );
      await expect(
        engine.start({
          taskId: "gate-closed",
          operationName: "climate_set_power",
          resourceId: "allowed",
          power: "on",
          argumentHash: "f".repeat(64),
          executionContext: {
            authorizationContextHash: "auth",
            executionMode: "LIVE",
            simulationId: "",
            correlationId: "c",
          },
        }),
      ).rejects.toMatchObject({ reasonCode: "REAL_DEVICE_SIDE_EFFECTS_GATE_CLOSED" });
      expect(fake.serviceCalls).toHaveLength(0);
    } finally {
      await fake.close();
    }
  });

  it("rejects non-live execution modes before any Home Assistant call", async () => {
    const fake = await climateFake("off");
    try {
      const engine = climateEngine(fake, new MemoryClimateStore(), true);
      await expect(
        engine.start({
          taskId: "simulation-write",
          operationName: "climate_set_power",
          resourceId: "allowed",
          power: "on",
          argumentHash: "a".repeat(64),
          executionContext: { ...liveContext(), executionMode: "SIMULATION" },
        }),
      ).rejects.toMatchObject({ reasonCode: "EXECUTION_MODE_NOT_LIVE" });
      expect(fake.serviceCalls).toHaveLength(0);
    } finally {
      await fake.close();
    }
  });

  it("requires the dedicated climate power gate", async () => {
    const fake = await climateFake("off");
    try {
      const engine = climateEngine(fake, new MemoryClimateStore(), true, {
        powerSideEffectsEnabled: false,
      });
      await expect(
        engine.start({
          taskId: "power-gate-closed",
          operationName: "climate_set_power",
          resourceId: "allowed",
          power: "on",
          argumentHash: "b".repeat(64),
          executionContext: liveContext(),
        }),
      ).rejects.toMatchObject({ reasonCode: "CLIMATE_POWER_SIDE_EFFECTS_GATE_CLOSED" });
      expect(fake.serviceCalls).toHaveLength(0);
    } finally {
      await fake.close();
    }
  });

  it("treats HVAC mode from off as a gated climate power-on side effect", async () => {
    const fake = await climateFake("off");
    try {
      const engine = climateEngine(fake, new MemoryClimateStore(), true, {
        powerSideEffectsEnabled: false,
      });
      await expect(
        engine.start({
          taskId: "implicit-power-gate-closed",
          operationName: "climate_set_hvac_mode",
          resourceId: "allowed",
          hvacMode: "cool",
          argumentHash: "1".repeat(64),
          executionContext: liveContext(),
        }),
      ).rejects.toMatchObject({ reasonCode: "CLIMATE_POWER_SIDE_EFFECTS_GATE_CLOSED" });
      expect(fake.serviceCalls).toHaveLength(0);
    } finally {
      await fake.close();
    }
  });

  it("records implicit HVAC power-on in the durable opposite-power guard", async () => {
    const fake = await climateFake("off");
    const store = new MemoryClimateStore();
    let now = Date.parse("2026-08-10T00:00:00.000Z");
    try {
      const engine = climateEngine(fake, store, true, {
        powerSideEffectsEnabled: true,
        now: () => now,
      });
      await engine.start({
        taskId: "implicit-power-on",
        operationName: "climate_set_hvac_mode",
        resourceId: "allowed",
        hvacMode: "cool",
        argumentHash: "2".repeat(64),
        executionContext: liveContext(),
      });
      expect(fake.serviceCalls).toHaveLength(1);

      now += 60_000;
      await engine.start({
        taskId: "opposite-power-off",
        operationName: "climate_set_power",
        resourceId: "allowed",
        power: "off",
        argumentHash: "3".repeat(64),
        executionContext: liveContext(),
      });
      expect(fake.serviceCalls).toHaveLength(1);
      expect(store.get("opposite-power-off")).toMatchObject({
        state: "TECHNICAL_FAILED",
        failureReasonCode: "CLIMATE_OPPOSITE_POWER_INTERVAL_ACTIVE",
      });
    } finally {
      await fake.close();
    }
  });

  it("rejects unreachable climate state before a side effect", async () => {
    const fake = await climateFake("unavailable");
    try {
      const engine = climateEngine(fake, new MemoryClimateStore(), true);
      await expect(
        engine.start({
          taskId: "unavailable",
          operationName: "climate_set_hvac_mode",
          resourceId: "allowed",
          hvacMode: "cool",
          argumentHash: "c".repeat(64),
          executionContext: liveContext(),
        }),
      ).rejects.toMatchObject({ reasonCode: "RESOURCE_UNAVAILABLE" });
      expect(fake.serviceCalls).toHaveLength(0);
    } finally {
      await fake.close();
    }
  });

  it("durably blocks opposite climate power actions within five minutes", async () => {
    const fake = await climateFake("off");
    const store = new MemoryClimateStore();
    let now = Date.parse("2026-08-10T00:00:00.000Z");
    try {
      const first = climateEngine(fake, store, true, {
        powerSideEffectsEnabled: true,
        now: () => now,
      });
      await first.start({
        taskId: "power-on",
        operationName: "climate_set_power",
        resourceId: "allowed",
        power: "on",
        argumentHash: "d".repeat(64),
        executionContext: liveContext(),
      });
      expect(fake.serviceCalls).toHaveLength(1);
      await new Promise((resolve) => setTimeout(resolve, 30));

      now += 60_000;
      const restarted = climateEngine(fake, store, true, {
        powerSideEffectsEnabled: true,
        now: () => now,
      });
      await restarted.start({
        taskId: "power-off",
        operationName: "climate_set_power",
        resourceId: "allowed",
        power: "off",
        argumentHash: "e".repeat(64),
        executionContext: liveContext(),
      });
      expect(fake.serviceCalls).toHaveLength(1);
      expect(store.get("power-off")).toMatchObject({
        state: "TECHNICAL_FAILED",
        failureReasonCode: "CLIMATE_OPPOSITE_POWER_INTERVAL_ACTIVE",
      });
    } finally {
      await fake.close();
    }
  });

  it("serializes concurrent admission of the same task identity", async () => {
    const fake = await climateFake("cool");
    fake.suppressChanges = true;
    try {
      const engine = climateEngine(fake, new MemoryClimateStore(), true);
      const input = {
        taskId: "concurrent",
        operationName: "climate_set_temperature" as const,
        resourceId: "allowed",
        temperature: 21,
        argumentHash: "f".repeat(64),
        executionContext: liveContext(),
      };
      await Promise.all([engine.start(input), engine.start(input)]);
      expect(fake.serviceCalls).toHaveLength(1);
    } finally {
      await fake.close();
    }
  });
});

async function climateFake(state: string): Promise<FakeHomeAssistantClimate> {
  const fake = new FakeHomeAssistantClimate();
  fake.setState("climate.allowed", state, {
    temperature: 24,
    hvac_modes: ["cool"],
    min_temp: 16,
    max_temp: 30,
  });
  await fake.start();
  return fake;
}

function climateEngine(
  fake: FakeHomeAssistantClimate,
  store: MemoryClimateStore,
  sideEffectsEnabled: boolean,
  options: ConstructorParameters<typeof ClimateExecutionEngine>[6] = {},
): ClimateExecutionEngine {
  return new ClimateExecutionEngine(
    store,
    new ClimateResourceRegistry([
      {
        resourceId: "allowed",
        entityId: "climate.allowed",
        displayName: "Allowed",
        enabled: true,
        temperatureRange: { minimum: 16, maximum: 30 },
        allowedHvacModes: ["cool"],
      },
    ]),
    new HomeAssistantClimateClient({ baseUrl: fake.url, token: fake.token, timeoutMs: 1000 }),
    new NoopClimateTelemetry(),
    1000,
    sideEffectsEnabled,
    options,
  );
}

function liveContext(): ClimateExecution["executionContext"] {
  return {
    authorizationContextHash: "auth",
    executionMode: "LIVE",
    simulationId: "",
    correlationId: "c",
  };
}
