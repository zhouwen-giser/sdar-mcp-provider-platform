import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ClimateExecutionEngine,
  snapshot,
  type ClimateExecutionEngineOptions,
} from "../../apps/home-assistant-climate-provider/src/execution.js";
import type { HomeAssistantClimateClient } from "../../apps/home-assistant-climate-provider/src/home-assistant.js";
import { ClimateResourceRegistry } from "../../apps/home-assistant-climate-provider/src/resources.js";
import {
  JsonClimateStore,
  MemoryClimateStore,
  type ClimateStore,
} from "../../apps/home-assistant-climate-provider/src/store.js";
import { NoopClimateTelemetry } from "../../apps/home-assistant-climate-provider/src/telemetry.js";
import type {
  ClimateConfirmationPolicy,
  ClimateExecution,
  HomeAssistantState,
  NormalizedClimateState,
} from "../../apps/home-assistant-climate-provider/src/types.js";

const CONFIRMATION_TIMEOUT_MS = 5_000;
const MINIMUM_STABLE_DURATION_MS = 1_000;
const MINIMUM_MATCHING_OBSERVATIONS = 2;
const TEST_POLICY: ClimateConfirmationPolicy = {
  confirmationTimeoutMs: CONFIRMATION_TIMEOUT_MS,
  minimumStableDurationMs: MINIMUM_STABLE_DURATION_MS,
  minimumMatchingObservations: MINIMUM_MATCHING_OBSERVATIONS,
};
const RESOURCE = {
  resourceId: "stability",
  entityId: "climate.stability",
  displayName: "Stability climate",
  enabled: true,
  temperatureRange: { minimum: 16, maximum: 30 },
  allowedHvacModes: ["cool"],
};

interface PersistedStableConfirmation {
  candidateConfirmedAt?: string;
  matchingObservationCount?: number;
  lastMatchingObservationAt?: string;
  lastObservedState?: NormalizedClimateState;
}

class FakeClock {
  constructor(public value = 0) {}

  readonly now = (): number => this.value;

  advance(milliseconds: number): void {
    this.value += milliseconds;
  }
}

class DeterministicHomeAssistant {
  readonly serviceCalls: { service: string; data: Record<string, unknown> }[] = [];
  getStateAdvanceMs = 0;
  #state = "off";

  constructor(readonly clock: FakeClock) {}

  setState(state: "off" | "cool"): void {
    this.#state = state;
  }

  async getState(entityId: string): Promise<HomeAssistantState> {
    this.clock.advance(this.getStateAdvanceMs);
    return rawState(entityId, this.#state, instant(this.clock.value));
  }

  async callService(service: string, data: Record<string, unknown>): Promise<void> {
    this.serviceCalls.push({ service, data });
  }
}

describe("Home Assistant climate stable confirmation breakpoint regressions", () => {
  it("S1: a transient cool match followed by off never commits SUCCEEDED", async () => {
    const fixture = createFixture();
    await startCool(fixture.engine, "transient");

    fixture.clock.advance(1_000);
    await fixture.engine.observe(observation(fixture.clock, "cool"));
    expect(fixture.store.get("transient")?.state).toBe("CONFIRMING");

    fixture.clock.advance(3_000);
    await fixture.engine.observe(observation(fixture.clock, "off"));
    expect(fixture.store.get("transient")?.state).toBe("CONFIRMING");
  });

  it("permanently regresses the historical cool-for-three-seconds-then-off breakpoint", async () => {
    const fixture = createFixture({
      confirmationTimeoutMs: 15_000,
      minimumStableDurationMs: 5_000,
      minimumMatchingObservations: 3,
    });
    await startCool(fixture.engine, "historical-three-second-regression");

    for (const elapsed of [1_000, 1_000, 1_000]) {
      fixture.clock.advance(elapsed);
      await fixture.engine.observe(observation(fixture.clock, "cool"));
    }
    fixture.clock.advance(1_000);
    await fixture.engine.observe(observation(fixture.clock, "off"));
    expect(fixture.store.get("historical-three-second-regression")?.state).toBe("CONFIRMING");

    for (const elapsed of [1_000, 2_000, 3_000]) {
      fixture.clock.advance(elapsed);
      await fixture.engine.observe(observation(fixture.clock, "cool"));
    }
    expect(fixture.store.get("historical-three-second-regression")?.state).toBe("SUCCEEDED");
  });

  it("S2: multiple matching observations and the full stable duration are required", async () => {
    const fixture = createFixture();
    await startCool(fixture.engine, "stable");

    fixture.clock.advance(1_000);
    await fixture.engine.observe(observation(fixture.clock, "cool"));
    expect(fixture.store.get("stable")?.state).toBe("CONFIRMING");

    fixture.clock.advance(500);
    await fixture.engine.observe(observation(fixture.clock, "cool"));
    expect(fixture.store.get("stable")?.state).toBe("CONFIRMING");

    fixture.clock.advance(500);
    await fixture.engine.observe(observation(fixture.clock, "cool"));
    expect(fixture.store.get("stable")?.state).toBe("SUCCEEDED");
  });

  it("S3: a mismatch discards the first candidate window and starts a fresh one", async () => {
    const fixture = createFixture();
    await startCool(fixture.engine, "reset-window");

    fixture.clock.advance(100);
    await fixture.engine.observe(observation(fixture.clock, "cool"));
    fixture.clock.advance(800);
    await fixture.engine.observe(observation(fixture.clock, "cool"));
    expect(fixture.store.get("reset-window")?.state).toBe("CONFIRMING");

    fixture.clock.advance(100);
    await fixture.engine.observe(observation(fixture.clock, "off"));
    expect(stabilityState(fixture.store, "reset-window")?.matchingObservationCount).toBe(0);
    expect(stabilityState(fixture.store, "reset-window")).not.toHaveProperty(
      "candidateConfirmedAt",
    );

    fixture.clock.advance(100);
    await fixture.engine.observe(observation(fixture.clock, "cool"));
    fixture.clock.advance(900);
    await fixture.engine.observe(observation(fixture.clock, "cool"));
    expect(fixture.store.get("reset-window")?.state).toBe("CONFIRMING");

    fixture.clock.advance(100);
    await fixture.engine.observe(observation(fixture.clock, "cool"));
    expect(fixture.store.get("reset-window")?.state).toBe("SUCCEEDED");
  });

  it("S4: one matching observation is insufficient even after time advances", async () => {
    const fixture = createFixture();
    await startCool(fixture.engine, "single-match");

    fixture.clock.advance(100);
    await fixture.engine.observe(observation(fixture.clock, "cool"));
    fixture.clock.advance(MINIMUM_STABLE_DURATION_MS + 1);

    expect(fixture.store.get("single-match")?.state).toBe("CONFIRMING");
    expect(stabilityState(fixture.store, "single-match")?.matchingObservationCount).toBe(1);
  });

  it("ignores unreachable cached matches and out-of-order observations", async () => {
    const fixture = createFixture();
    await startCool(fixture.engine, "authoritative-observations");

    fixture.clock.advance(500);
    await fixture.engine.observe({
      ...observation(fixture.clock, "cool"),
      reachable: false,
    });
    expect(stabilityState(fixture.store, "authoritative-observations")).toMatchObject({
      state: "CONFIRMING",
      matchingObservationCount: 0,
    });

    fixture.clock.advance(500);
    await fixture.engine.observe(observation(fixture.clock, "cool"));
    expect(
      stabilityState(fixture.store, "authoritative-observations")?.matchingObservationCount,
    ).toBe(1);

    fixture.clock.advance(500);
    await fixture.engine.observe({
      ...observation(fixture.clock, "cool"),
      observedAt: instant(750),
    });
    expect(
      stabilityState(fixture.store, "authoritative-observations")?.matchingObservationCount,
    ).toBe(1);
    expect(fixture.store.get("authoritative-observations")?.state).toBe("CONFIRMING");
  });

  it("S5: the persisted deadline wins over a matching observation at the deadline", async () => {
    const fixture = createFixture();
    await startCool(fixture.engine, "deadline");
    fixture.ha.setState("cool");
    fixture.clock.advance(CONFIRMATION_TIMEOUT_MS);

    await fixture.engine.poll("deadline");

    expect(fixture.store.get("deadline")).toMatchObject({
      state: "TECHNICAL_FAILED",
      failureReasonCode: "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT",
    });
  });

  it("S6: restart preserves a candidate window and never repeats the HA side effect", async () => {
    const clock = new FakeClock(500);
    const ha = new DeterministicHomeAssistant(clock);
    ha.setState("cool");
    const path = join(mkdtempSync(join(tmpdir(), "climate-stability-")), "state.json");
    const initialStore = new JsonClimateStore(path);
    initialStore.set(
      pendingExecution({
        taskId: "restart-window",
        state: "CONFIRMING",
        sideEffectDispatched: true,
        dispatchState: "CALL_RETURNED",
        confirmationPolicy: TEST_POLICY,
        updatedAt: instant(100),
        candidateConfirmedAt: instant(100),
        matchingObservationCount: 1,
        lastMatchingObservationAt: instant(100),
        lastObservedState: observation(new FakeClock(100), "cool"),
      }),
    );

    const weakerRestartPolicy: ClimateConfirmationPolicy = {
      confirmationTimeoutMs: CONFIRMATION_TIMEOUT_MS,
      minimumStableDurationMs: 100,
      minimumMatchingObservations: 2,
    };
    const firstRestart = engine(new JsonClimateStore(path), ha, clock, weakerRestartPolicy);
    await firstRestart.recover();
    expect(ha.serviceCalls).toHaveLength(0);
    expect(new JsonClimateStore(path).get("restart-window")?.state).toBe("CONFIRMING");

    clock.advance(600);
    const secondRestart = engine(new JsonClimateStore(path), ha, clock, weakerRestartPolicy);
    await secondRestart.recover();
    expect(ha.serviceCalls).toHaveLength(0);
    expect(new JsonClimateStore(path).get("restart-window")?.state).toBe("SUCCEEDED");
  });

  it("R1: an expired NOT_STARTED execution fails without dispatching a side effect", async () => {
    const clock = new FakeClock(CONFIRMATION_TIMEOUT_MS + 1);
    const ha = new DeterministicHomeAssistant(clock);
    const store = new MemoryClimateStore();
    store.set(pendingExecution({ taskId: "expired-not-started" }));

    await engine(store, ha, clock).recover();

    expect(ha.serviceCalls).toHaveLength(0);
    expect(store.get("expired-not-started")).toMatchObject({
      state: "TECHNICAL_FAILED",
      failureReasonCode: "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT",
    });
  });

  it("R1: a preflight that crosses the deadline cannot dispatch a late side effect", async () => {
    const clock = new FakeClock(CONFIRMATION_TIMEOUT_MS - 100);
    const ha = new DeterministicHomeAssistant(clock);
    ha.getStateAdvanceMs = 200;
    const store = new MemoryClimateStore();
    store.set(pendingExecution({ taskId: "preflight-crosses-deadline" }));

    await engine(store, ha, clock).recover();

    expect(ha.serviceCalls).toHaveLength(0);
    expect(store.get("preflight-crosses-deadline")).toMatchObject({
      state: "TECHNICAL_FAILED",
      failureReasonCode: "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT",
    });
  });

  it("R1: expiry after durable intent persistence still prevents the HA call", async () => {
    const fixture = createFixture(TEST_POLICY, {
      hooks: {
        afterDispatchIntentPersisted: () => {
          fixture.clock.advance(CONFIRMATION_TIMEOUT_MS);
        },
      },
    });

    await startCool(fixture.engine, "intent-deadline");

    expect(fixture.ha.serviceCalls).toHaveLength(0);
    expect(fixture.store.get("intent-deadline")).toMatchObject({
      state: "TECHNICAL_FAILED",
      dispatchState: "INTENT_PERSISTED",
      failureReasonCode: "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT",
    });
  });

  it("R2: INTENT_PERSISTED recovery reconciles by observation and never replays the call", async () => {
    const clock = new FakeClock(1_000);
    const ha = new DeterministicHomeAssistant(clock);
    const store = new MemoryClimateStore();
    store.set(
      pendingExecution({
        taskId: "intent-persisted",
        sideEffectDispatched: true,
        dispatchState: "INTENT_PERSISTED",
      }),
    );

    await engine(store, ha, clock).recover();

    expect(ha.serviceCalls).toHaveLength(0);
    expect(store.get("intent-persisted")?.state).toBe("CONFIRMING");
  });
});

function createFixture(
  confirmationPolicy: ClimateConfirmationPolicy = TEST_POLICY,
  options: Omit<ClimateExecutionEngineOptions, "now" | "confirmationPolicy"> = {},
): {
  clock: FakeClock;
  ha: DeterministicHomeAssistant;
  store: MemoryClimateStore;
  engine: ClimateExecutionEngine;
} {
  const clock = new FakeClock();
  const ha = new DeterministicHomeAssistant(clock);
  const store = new MemoryClimateStore();
  return { clock, ha, store, engine: engine(store, ha, clock, confirmationPolicy, options) };
}

function engine(
  store: ClimateStore,
  ha: DeterministicHomeAssistant,
  clock: FakeClock,
  confirmationPolicy: ClimateConfirmationPolicy = TEST_POLICY,
  options: Omit<ClimateExecutionEngineOptions, "now" | "confirmationPolicy"> = {},
): ClimateExecutionEngine {
  return new ClimateExecutionEngine(
    store,
    new ClimateResourceRegistry([RESOURCE]),
    ha as unknown as HomeAssistantClimateClient,
    new NoopClimateTelemetry(),
    confirmationPolicy,
    true,
    { ...options, now: clock.now },
  );
}

async function startCool(engine: ClimateExecutionEngine, taskId: string): Promise<void> {
  await engine.start({
    taskId,
    operationName: "climate_set_hvac_mode",
    resourceId: RESOURCE.resourceId,
    hvacMode: "cool",
    argumentHash: taskId.padEnd(64, "0"),
    executionContext: {
      authorizationContextHash: "auth",
      executionMode: "LIVE",
      simulationId: "",
      correlationId: taskId,
    },
  });
}

function pendingExecution(
  overrides: Partial<ClimateExecution & PersistedStableConfirmation> = {},
): ClimateExecution & PersistedStableConfirmation {
  const execution: ClimateExecution & PersistedStableConfirmation = {
    taskId: "persisted",
    externalExecutionId: "external",
    operationName: "climate_set_hvac_mode",
    resourceId: RESOURCE.resourceId,
    entityId: RESOURCE.entityId,
    argumentHash: "f".repeat(64),
    executionContext: {
      authorizationContextHash: "auth",
      executionMode: "LIVE",
      simulationId: "",
      correlationId: "persisted",
    },
    desiredState: { type: "hvac_mode", hvacMode: "cool" },
    state: "PENDING_SIDE_EFFECT",
    sideEffectDispatched: false,
    dispatchState: "NOT_STARTED",
    revision: 1,
    createdAt: instant(0),
    updatedAt: instant(0),
    confirmationDeadlineAt: instant(CONFIRMATION_TIMEOUT_MS),
    lastSnapshot: {},
    commandAcks: {},
    ...overrides,
  };
  execution.lastSnapshot = snapshot(execution);
  return execution;
}

function stabilityState(
  store: ClimateStore,
  taskId: string,
): (ClimateExecution & PersistedStableConfirmation) | undefined {
  return store.get(taskId);
}

function observation(clock: FakeClock, state: "off" | "cool"): NormalizedClimateState {
  return {
    resourceId: RESOURCE.resourceId,
    power: state === "off" ? "off" : "on",
    reachable: true,
    hvacMode: state,
    currentTemperature: 28,
    targetTemperature: 24,
    temperatureUnit: "°C",
    minTemperature: 16,
    maxTemperature: 30,
    supportedHvacModes: ["cool"],
    observedAt: instant(clock.value),
  };
}

function rawState(entityId: string, state: string, observedAt: string): HomeAssistantState {
  return {
    entity_id: entityId,
    state,
    attributes: {
      current_temperature: 28,
      temperature: 24,
      min_temp: 16,
      max_temp: 30,
      hvac_modes: ["cool"],
      temperature_unit: "°C",
    },
    last_changed: observedAt,
    last_updated: observedAt,
  };
}

function instant(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}
