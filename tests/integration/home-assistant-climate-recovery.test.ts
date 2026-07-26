import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ClimateExecutionEngine,
  snapshot,
} from "../../apps/home-assistant-climate-provider/src/execution.js";
import { HomeAssistantClimateClient } from "../../apps/home-assistant-climate-provider/src/home-assistant.js";
import { ClimateResourceRegistry } from "../../apps/home-assistant-climate-provider/src/resources.js";
import { JsonClimateStore } from "../../apps/home-assistant-climate-provider/src/store.js";
import { NoopClimateTelemetry } from "../../apps/home-assistant-climate-provider/src/telemetry.js";
import type { ClimateExecution } from "../../apps/home-assistant-climate-provider/src/types.js";
import { FakeHomeAssistantClimate } from "../fixtures/fake-home-assistant-climate.js";
describe("Home Assistant climate recovery", () => {
  it("loads a persisted pre-side-effect execution and safely resumes it", async () => {
    const fake = new FakeHomeAssistantClimate();
    fake.setState("climate.recovery", "off", {
      temperature: 24,
      min_temp: 16,
      max_temp: 30,
      hvac_modes: ["cool"],
    });
    await fake.start();
    try {
      const path = join(mkdtempSync(join(tmpdir(), "climate-recovery-")), "state.json");
      const store = new JsonClimateStore(path);
      const now = new Date();
      const x: ClimateExecution = {
        taskId: "recover",
        externalExecutionId: "external",
        operationName: "climate_set_temperature",
        resourceId: "recovery",
        entityId: "climate.recovery",
        argumentHash: "f".repeat(64),
        executionContext: {
          authorizationContextHash: "auth",
          executionMode: "LIVE",
          simulationId: "",
          correlationId: "c",
        },
        desiredState: { type: "temperature", temperature: 21 },
        state: "PENDING_SIDE_EFFECT",
        sideEffectDispatched: false,
        revision: 1,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        confirmationDeadlineAt: new Date(now.getTime() + 2000).toISOString(),
        lastSnapshot: {},
        commandAcks: {},
      };
      x.lastSnapshot = snapshot(x);
      store.set(x);
      const restarted = new JsonClimateStore(path);
      const engine = new ClimateExecutionEngine(
        restarted,
        new ClimateResourceRegistry([
          {
            resourceId: "recovery",
            entityId: "climate.recovery",
            displayName: "Recovery",
            enabled: true,
            temperatureRange: { minimum: 16, maximum: 30 },
            allowedHvacModes: ["cool"],
          },
        ]),
        new HomeAssistantClimateClient({ baseUrl: fake.url, token: fake.token, timeoutMs: 1000 }),
        new NoopClimateTelemetry(),
        2000,
      );
      await engine.recover();
      expect(fake.serviceCalls).toHaveLength(1);
      await new Promise((resolve) => setTimeout(resolve, 30));
      await engine.poll("recover");
      expect(restarted.get("recover")?.state).toBe("SUCCEEDED");
    } finally {
      await fake.close();
    }
  });
});
