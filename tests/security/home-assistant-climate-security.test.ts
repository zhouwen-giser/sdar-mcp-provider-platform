import { describe, expect, it } from "vitest";
import { ClimateExecutionEngine } from "../../apps/home-assistant-climate-provider/src/execution.js";
import { HomeAssistantClimateClient } from "../../apps/home-assistant-climate-provider/src/home-assistant.js";
import { ClimateResourceRegistry } from "../../apps/home-assistant-climate-provider/src/resources.js";
import { MemoryClimateStore } from "../../apps/home-assistant-climate-provider/src/store.js";
import { NoopClimateTelemetry } from "../../apps/home-assistant-climate-provider/src/telemetry.js";
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
});
