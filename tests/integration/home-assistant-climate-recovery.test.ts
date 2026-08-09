import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ClimateExecutionEngine,
  snapshot,
} from "../../apps/home-assistant-climate-provider/src/execution.js";
import { HomeAssistantClimateClient } from "../../apps/home-assistant-climate-provider/src/home-assistant.js";
import { ClimateResourceRegistry } from "../../apps/home-assistant-climate-provider/src/resources.js";
import {
  JsonClimateStore,
  MemoryClimateStore,
} from "../../apps/home-assistant-climate-provider/src/store.js";
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
        dispatchState: "NOT_STARTED",
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
        true,
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

  it("does not repeat a climate service call after a post-call process crash", async () => {
    const fake = new FakeHomeAssistantClimate();
    fake.setState("climate.recovery", "cool", {
      temperature: 24,
      min_temp: 16,
      max_temp: 30,
      hvac_modes: ["cool"],
    });
    await fake.start();
    try {
      const store = new MemoryClimateStore();
      const registry = recoveryRegistry("climate.recovery");
      const client = new HomeAssistantClimateClient({
        baseUrl: fake.url,
        token: fake.token,
        timeoutMs: 1000,
      });
      const crashing = new ClimateExecutionEngine(
        store,
        registry,
        client,
        new NoopClimateTelemetry(),
        2000,
        true,
        {
          hooks: {
            afterHomeAssistantCall: () => {
              throw new Error("SIMULATED_PROCESS_CRASH");
            },
          },
        },
      );
      await expect(
        crashing.start({
          taskId: "post-call-crash",
          operationName: "climate_set_temperature",
          resourceId: "recovery",
          temperature: 21,
          argumentHash: "a".repeat(64),
          executionContext: liveContext(),
        }),
      ).rejects.toThrow("SIMULATED_PROCESS_CRASH");
      expect(fake.serviceCalls).toHaveLength(1);
      expect(store.get("post-call-crash")?.dispatchState).toBe("INTENT_PERSISTED");

      await new Promise((resolve) => setTimeout(resolve, 30));
      const recovered = new ClimateExecutionEngine(
        store,
        registry,
        client,
        new NoopClimateTelemetry(),
        2000,
        true,
      );
      await recovered.recover();
      await recovered.poll("post-call-crash");
      expect(fake.serviceCalls).toHaveLength(1);
      expect(store.get("post-call-crash")?.state).toBe("SUCCEEDED");
    } finally {
      await fake.close();
    }
  });

  it("fails closed when recovery would need a write but the device gate is closed", async () => {
    const fake = new FakeHomeAssistantClimate();
    fake.setState("climate.recovery", "cool", {
      temperature: 24,
      min_temp: 16,
      max_temp: 30,
      hvac_modes: ["cool"],
    });
    await fake.start();
    try {
      const store = new MemoryClimateStore();
      store.set(pendingExecution({ taskId: "gate-closed-recovery" }));
      const engine = new ClimateExecutionEngine(
        store,
        recoveryRegistry("climate.recovery"),
        new HomeAssistantClimateClient({ baseUrl: fake.url, token: fake.token, timeoutMs: 1000 }),
        new NoopClimateTelemetry(),
        2000,
        false,
      );
      await engine.recover();
      expect(fake.serviceCalls).toHaveLength(0);
      expect(store.get("gate-closed-recovery")).toMatchObject({
        state: "TECHNICAL_FAILED",
        failureReasonCode: "REAL_DEVICE_SIDE_EFFECTS_GATE_CLOSED",
      });
    } finally {
      await fake.close();
    }
  });

  it("rejects a remapped persisted entity without reading or writing the old entity", async () => {
    const fake = new FakeHomeAssistantClimate();
    fake.setState("climate.old", "cool", {
      temperature: 24,
      min_temp: 16,
      max_temp: 30,
      hvac_modes: ["cool"],
    });
    fake.setState("climate.new", "cool", {
      temperature: 24,
      min_temp: 16,
      max_temp: 30,
      hvac_modes: ["cool"],
    });
    await fake.start();
    try {
      const store = new MemoryClimateStore();
      store.set(
        pendingExecution({
          taskId: "remapped-recovery",
          entityId: "climate.old",
          dispatchState: "INTENT_PERSISTED",
          sideEffectDispatched: true,
        }),
      );
      const engine = new ClimateExecutionEngine(
        store,
        recoveryRegistry("climate.new"),
        new HomeAssistantClimateClient({ baseUrl: fake.url, token: fake.token, timeoutMs: 1000 }),
        new NoopClimateTelemetry(),
        2000,
        true,
      );
      await engine.recover();
      expect(fake.serviceCalls).toHaveLength(0);
      expect(store.get("remapped-recovery")).toMatchObject({
        state: "TECHNICAL_FAILED",
        failureReasonCode: "RECOVERY_RESOURCE_NOT_ALLOWLISTED",
      });
    } finally {
      await fake.close();
    }
  });

  it("does not replay legacy climate state whose dispatch point is ambiguous", async () => {
    const store = new MemoryClimateStore();
    const legacy = pendingExecution({ taskId: "legacy-ambiguous" });
    delete legacy.dispatchState;
    store.set(legacy);
    const engine = new ClimateExecutionEngine(
      store,
      recoveryRegistry("climate.recovery"),
      new HomeAssistantClimateClient({
        baseUrl: "http://127.0.0.1:1",
        token: "unused",
        timeoutMs: 100,
      }),
      new NoopClimateTelemetry(),
      2000,
      true,
    );
    await engine.recover();
    expect(store.get("legacy-ambiguous")).toMatchObject({
      state: "TECHNICAL_FAILED",
      failureReasonCode: "SIDE_EFFECT_STATE_UNCERTAIN",
    });
  });

  it("rejects semantically corrupt durable execution state", () => {
    const corruptions = [
      { taskId: "corrupt", entityId: "light.not_allowed" },
      pendingExecution({
        taskId: "operation-mismatch",
        operationName: "climate_set_power",
        desiredState: { type: "temperature", temperature: 21 },
      }),
    ];
    for (const execution of corruptions) {
      const path = join(mkdtempSync(join(tmpdir(), "climate-corrupt-")), "state.json");
      writeFileSync(
        path,
        JSON.stringify({
          version: 1,
          executions: { corrupt: execution },
          pendingTelemetryEvents: [],
          nextTelemetrySequence: 1,
        }),
      );
      expect(() => new JsonClimateStore(path)).toThrow("INVALID_PROVIDER_STATE_FILE");
    }
  });
});

function recoveryRegistry(entityId: string): ClimateResourceRegistry {
  return new ClimateResourceRegistry([
    {
      resourceId: "recovery",
      entityId,
      displayName: "Recovery",
      enabled: true,
      temperatureRange: { minimum: 16, maximum: 30 },
      allowedHvacModes: ["cool"],
    },
  ]);
}

function liveContext(): ClimateExecution["executionContext"] {
  return {
    authorizationContextHash: "auth",
    executionMode: "LIVE",
    simulationId: "",
    correlationId: "c",
  };
}

function pendingExecution(overrides: Partial<ClimateExecution> = {}): ClimateExecution {
  const now = new Date();
  const execution: ClimateExecution = {
    taskId: "recover",
    externalExecutionId: "external",
    operationName: "climate_set_temperature",
    resourceId: "recovery",
    entityId: "climate.recovery",
    argumentHash: "f".repeat(64),
    executionContext: liveContext(),
    desiredState: { type: "temperature", temperature: 21 },
    state: "PENDING_SIDE_EFFECT",
    sideEffectDispatched: false,
    dispatchState: "NOT_STARTED",
    revision: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    confirmationDeadlineAt: new Date(now.getTime() + 2000).toISOString(),
    lastSnapshot: {},
    commandAcks: {},
    ...overrides,
  };
  execution.lastSnapshot = snapshot(execution);
  return execution;
}
