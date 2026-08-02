import { randomUUID } from "node:crypto";
import { LightProviderError } from "../errors.js";
import { normalizeLightState } from "../home-assistant.js";
import type { HomeAssistantLightClient } from "../home-assistant.js";
import type { LightResourceRegistry } from "../resources.js";
import type { LightStore } from "../store.js";
import type { LightTelemetry } from "../telemetry.js";
import type { ExecutionContextRecord, LightExecution, NormalizedLightState } from "../types.js";
import { snapshot } from "./snapshots.js";

export interface StartLightInput {
  taskId: string;
  operationName: "light_set_power" | "light_set_brightness";
  resourceId: string;
  power?: "on" | "off";
  brightnessPercent?: number;
  argumentHash: string;
  executionContext: ExecutionContextRecord;
}

export class LightExecutionEngine {
  constructor(
    readonly store: LightStore,
    readonly registry: LightResourceRegistry,
    readonly rest: HomeAssistantLightClient,
    readonly telemetry: LightTelemetry,
    readonly confirmMs: number,
    readonly sideEffectsEnabled = true,
  ) {}

  async start(input: StartLightInput): Promise<LightExecution> {
    const existing = this.store.get(input.taskId);
    if (existing !== undefined) {
      if (!same(existing, input)) throw new LightProviderError("TASK_IDENTITY_CONFLICT", false);
      return existing;
    }
    if (!this.sideEffectsEnabled)
      throw new LightProviderError("REAL_DEVICE_SIDE_EFFECTS_GATE_CLOSED", false);
    const resource = this.registry.require(input.resourceId);
    const observed = normalizeLightState(
      resource.resourceId,
      await this.rest.getState(resource.entityId),
    );
    if (!observed.reachable) throw new LightProviderError("RESOURCE_UNAVAILABLE", true);
    let desired: LightExecution["desiredState"];
    if (input.operationName === "light_set_power")
      desired = { type: "power", power: input.power ?? "off" };
    else {
      const brightness = input.brightnessPercent ?? Number.NaN;
      if (!observed.supportsBrightness)
        throw new LightProviderError("BRIGHTNESS_NOT_SUPPORTED", false);
      if (!Number.isFinite(brightness) || brightness < 0 || brightness > 100)
        throw new LightProviderError("BRIGHTNESS_OUT_OF_RANGE", false);
      desired = { type: "brightness", brightnessPercent: brightness };
    }
    const now = new Date();
    const execution: LightExecution = {
      taskId: input.taskId,
      externalExecutionId: randomUUID(),
      operationName: input.operationName,
      resourceId: resource.resourceId,
      entityId: resource.entityId,
      argumentHash: input.argumentHash,
      executionContext: input.executionContext,
      desiredState: desired,
      state: "PENDING_SIDE_EFFECT",
      sideEffectDispatched: false,
      revision: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      confirmationDeadlineAt: new Date(now.getTime() + this.confirmMs).toISOString(),
      lastSnapshot: {},
      commandAcks: {},
    };
    execution.lastSnapshot = snapshot(execution);
    this.store.set(execution);
    await this.#dispatch(execution);
    return this.store.get(execution.taskId) ?? execution;
  }

  async recover(): Promise<void> {
    for (const execution of this.store.list()) {
      if (execution.state === "PENDING_SIDE_EFFECT" && execution.sideEffectDispatched) {
        const confirming = advance(execution, "CONFIRMING");
        this.store.set(confirming);
        await this.poll(execution.taskId);
      } else if (execution.state === "PENDING_SIDE_EFFECT") await this.#dispatch(execution);
      else if (execution.state === "CONFIRMING") await this.poll(execution.taskId);
    }
  }

  async poll(taskId: string): Promise<void> {
    const execution = this.store.get(taskId);
    if (execution?.state !== "CONFIRMING") return;
    try {
      await this.observe(
        normalizeLightState(execution.resourceId, await this.rest.getState(execution.entityId)),
      );
    } catch {
      // REST polling is a confirmation fallback; the persisted deadline remains authoritative.
    }
    const current = this.store.get(taskId);
    if (
      current?.state === "CONFIRMING" &&
      Date.now() >= Date.parse(current.confirmationDeadlineAt)
    ) {
      const failed = advance(current, "TECHNICAL_FAILED");
      this.store.set(failed);
      await this.telemetry.progress(failed);
    }
  }

  async observe(state: NormalizedLightState): Promise<void> {
    await this.telemetry.observed(state);
    for (const execution of this.store.list()) {
      if (
        execution.resourceId === state.resourceId &&
        execution.state === "CONFIRMING" &&
        confirmed(execution, state)
      ) {
        const done = advance({ ...execution, confirmedState: state }, "SUCCEEDED");
        this.store.set(done);
        await this.telemetry.progress(done);
      }
    }
  }

  async #dispatch(execution: LightExecution): Promise<void> {
    if (execution.sideEffectDispatched) return;
    if (!this.sideEffectsEnabled)
      throw new LightProviderError("REAL_DEVICE_SIDE_EFFECTS_GATE_CLOSED", false);
    const marked = advance({ ...execution, sideEffectDispatched: true }, "PENDING_SIDE_EFFECT");
    this.store.set(marked);
    if (execution.desiredState.type === "power") {
      try {
        if (execution.desiredState.power === "on") await this.rest.turnOn(execution.entityId);
        else await this.rest.turnOff(execution.entityId);
      } catch (error) {
        const confirming = advance(marked, "CONFIRMING");
        this.store.set(confirming);
        await this.telemetry.progress(confirming);
        throw error;
      }
    } else
      try {
        await this.rest.setBrightness(execution.entityId, execution.desiredState.brightnessPercent);
      } catch (error) {
        const confirming = advance(marked, "CONFIRMING");
        this.store.set(confirming);
        await this.telemetry.progress(confirming);
        throw error;
      }
    const confirming = advance(marked, "CONFIRMING");
    this.store.set(confirming);
    await this.telemetry.progress(confirming);
  }
}

function advance(execution: LightExecution, state: LightExecution["state"]): LightExecution {
  if (execution.state === "SUCCEEDED" || execution.state === "TECHNICAL_FAILED") return execution;
  const next = {
    ...execution,
    state,
    revision: execution.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  next.lastSnapshot = snapshot(next);
  return next;
}
function confirmed(execution: LightExecution, state: NormalizedLightState): boolean {
  if (execution.desiredState.type === "power") return state.power === execution.desiredState.power;
  return (
    state.brightnessPercent !== null &&
    Math.abs(state.brightnessPercent - execution.desiredState.brightnessPercent) <= 1
  );
}
function same(execution: LightExecution, input: StartLightInput): boolean {
  return (
    execution.operationName === input.operationName &&
    execution.argumentHash === input.argumentHash &&
    execution.executionContext.authorizationContextHash ===
      input.executionContext.authorizationContextHash &&
    execution.executionContext.executionMode === input.executionContext.executionMode &&
    execution.executionContext.simulationId === input.executionContext.simulationId
  );
}

export class LightConfirmationWorker {
  #timer: NodeJS.Timeout | undefined;
  constructor(
    readonly store: LightStore,
    readonly engine: LightExecutionEngine,
    readonly interval: number,
  ) {}
  start(): void {
    if (this.#timer === undefined)
      this.#timer = setInterval(() => {
        for (const execution of this.store.list())
          if (execution.state === "CONFIRMING") void this.engine.poll(execution.taskId);
      }, this.interval);
  }
  stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
