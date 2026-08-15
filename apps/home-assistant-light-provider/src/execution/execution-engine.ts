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

export interface LightExecutionEngineOptions {
  now?: () => number;
  hooks?: {
    afterDispatchIntentPersisted?: (execution: LightExecution) => void | Promise<void>;
    afterHomeAssistantCall?: (execution: LightExecution) => void | Promise<void>;
  };
}

export class LightExecutionEngine {
  readonly #taskLocks = new Map<string, Promise<void>>();
  readonly #now: () => number;

  constructor(
    readonly store: LightStore,
    readonly registry: LightResourceRegistry,
    readonly rest: HomeAssistantLightClient,
    readonly telemetry: LightTelemetry,
    readonly confirmMs: number,
    readonly sideEffectsEnabled = true,
    readonly options: LightExecutionEngineOptions = {},
  ) {
    this.#now = options.now ?? Date.now;
  }

  async start(input: StartLightInput): Promise<LightExecution> {
    return this.#withTaskLock(input.taskId, () => this.#start(input));
  }

  async #start(input: StartLightInput): Promise<LightExecution> {
    const existing = this.store.get(input.taskId);
    if (existing !== undefined) {
      if (!same(existing, input)) throw new LightProviderError("TASK_IDENTITY_CONFLICT", false);
      return existing;
    }
    if (input.executionContext.executionMode !== "LIVE")
      throw new LightProviderError("EXECUTION_MODE_NOT_LIVE", false);
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
    const now = new Date(this.#now());
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
      dispatchState: "NOT_STARTED",
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
      if (execution.state === "SUCCEEDED" || execution.state === "TECHNICAL_FAILED") continue;
      if (this.#deadlineReached(execution)) {
        await this.#fail(execution, "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT", false);
        continue;
      }
      if (!this.#resourceStillAllowlisted(execution)) {
        await this.#fail(execution, "RECOVERY_RESOURCE_NOT_ALLOWLISTED", false);
        continue;
      }
      if (execution.executionContext.executionMode !== "LIVE") {
        await this.#fail(execution, "EXECUTION_MODE_NOT_LIVE", false);
        continue;
      }
      if (execution.state === "CONFIRMING") {
        await this.poll(execution.taskId);
        continue;
      }
      if (execution.dispatchState === undefined) {
        if (!execution.sideEffectDispatched) {
          await this.#fail(execution, "SIDE_EFFECT_STATE_UNCERTAIN", false);
          continue;
        }
        await this.#resumeConfirmation(execution);
        continue;
      }
      if (
        execution.dispatchState === "INTENT_PERSISTED" ||
        execution.dispatchState === "CALL_RETURNED"
      ) {
        await this.#resumeConfirmation(execution);
        continue;
      }
      if (!this.sideEffectsEnabled) {
        await this.#fail(execution, "REAL_DEVICE_SIDE_EFFECTS_GATE_CLOSED", false);
        continue;
      }
      await this.#dispatch(execution);
    }
  }

  async poll(taskId: string): Promise<void> {
    const execution = this.store.get(taskId);
    if (execution?.state !== "CONFIRMING") return;
    if (this.#deadlineReached(execution)) {
      await this.#fail(execution, "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT", false);
      return;
    }
    const resource = this.#activeResource(execution);
    if (resource === undefined) {
      await this.#fail(execution, "RECOVERY_RESOURCE_NOT_ALLOWLISTED", false);
      return;
    }
    try {
      await this.observe(
        normalizeLightState(execution.resourceId, await this.rest.getState(resource.entityId)),
      );
    } catch {
      // REST polling is a confirmation fallback; the persisted deadline remains authoritative.
    }
    const current = this.store.get(taskId);
    if (
      current?.state === "CONFIRMING" &&
      this.#now() >= Date.parse(current.confirmationDeadlineAt)
    ) {
      await this.#fail(current, "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT", false);
    }
  }

  async observe(state: NormalizedLightState): Promise<void> {
    await this.telemetry.observed(state);
    for (const execution of this.store.list()) {
      const resource = this.#activeResource(execution);
      if (
        resource !== undefined &&
        execution.resourceId === state.resourceId &&
        execution.entityId === resource.entityId &&
        execution.state === "CONFIRMING"
      ) {
        const now = this.#now();
        if (this.#deadlineReached(execution, now)) {
          await this.#fail(execution, "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT", false, now);
          continue;
        }
        if (!confirmed(execution, state)) continue;
        const done = advance({ ...execution, confirmedState: state }, "SUCCEEDED", now);
        this.store.set(done);
        await this.telemetry.progress(done);
      }
    }
  }

  async #dispatch(execution: LightExecution): Promise<void> {
    if (execution.dispatchState !== "NOT_STARTED" || execution.sideEffectDispatched) return;
    if (this.#deadlineReached(execution)) {
      await this.#fail(execution, "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT", false);
      return;
    }
    if (execution.executionContext.executionMode !== "LIVE")
      throw new LightProviderError("EXECUTION_MODE_NOT_LIVE", false);
    if (!this.sideEffectsEnabled)
      throw new LightProviderError("REAL_DEVICE_SIDE_EFFECTS_GATE_CLOSED", false);
    const resource = this.#activeResource(execution);
    if (resource === undefined)
      throw new LightProviderError("RECOVERY_RESOURCE_NOT_ALLOWLISTED", false);
    const observed = normalizeLightState(
      resource.resourceId,
      await this.rest.getState(resource.entityId),
    );
    if (this.#deadlineReached(execution)) {
      await this.#fail(execution, "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT", false);
      return;
    }
    if (!observed.reachable) throw new LightProviderError("RESOURCE_UNAVAILABLE", true);
    if (execution.desiredState.type === "brightness" && !observed.supportsBrightness)
      throw new LightProviderError("BRIGHTNESS_NOT_SUPPORTED", false);
    if (confirmed(execution, observed)) {
      const done = advance({ ...execution, confirmedState: observed }, "SUCCEEDED", this.#now());
      this.store.set(done);
      await this.telemetry.progress(done);
      return;
    }
    const marked = advance(
      { ...execution, sideEffectDispatched: true, dispatchState: "INTENT_PERSISTED" },
      "PENDING_SIDE_EFFECT",
      this.#now(),
    );
    this.store.set(marked);
    await this.options.hooks?.afterDispatchIntentPersisted?.(marked);
    if (this.#deadlineReached(marked)) {
      await this.#fail(marked, "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT", false);
      return;
    }
    if (marked.desiredState.type === "power") {
      try {
        if (marked.desiredState.power === "on") await this.rest.turnOn(resource.entityId);
        else await this.rest.turnOff(resource.entityId);
      } catch {
        const confirming = advance(marked, "CONFIRMING", this.#now());
        this.store.set(confirming);
        await this.telemetry.progress(confirming);
        return;
      }
    } else
      try {
        await this.rest.setBrightness(resource.entityId, marked.desiredState.brightnessPercent);
      } catch {
        const confirming = advance(marked, "CONFIRMING", this.#now());
        this.store.set(confirming);
        await this.telemetry.progress(confirming);
        return;
      }
    await this.options.hooks?.afterHomeAssistantCall?.(marked);
    const confirming = advance(
      { ...marked, dispatchState: "CALL_RETURNED" },
      "CONFIRMING",
      this.#now(),
    );
    this.store.set(confirming);
    await this.telemetry.progress(confirming);
  }

  async #resumeConfirmation(execution: LightExecution): Promise<void> {
    const confirming =
      execution.state === "CONFIRMING" ? execution : advance(execution, "CONFIRMING", this.#now());
    if (confirming !== execution) {
      this.store.set(confirming);
      await this.telemetry.progress(confirming);
    }
    await this.poll(execution.taskId);
  }

  async #fail(
    execution: LightExecution,
    reasonCode: string,
    retryable: boolean,
    now = this.#now(),
  ): Promise<void> {
    const current = this.store.get(execution.taskId) ?? execution;
    if (current.state === "SUCCEEDED" || current.state === "TECHNICAL_FAILED") return;
    const failed = failedExecution(current, reasonCode, retryable, now);
    this.store.set(failed);
    await this.telemetry.progress(failed);
  }

  #deadlineReached(execution: LightExecution, now = this.#now()): boolean {
    return now >= Date.parse(execution.confirmationDeadlineAt);
  }

  #activeResource(execution: LightExecution) {
    try {
      const resource = this.registry.require(execution.resourceId);
      return resource.entityId === execution.entityId ? resource : undefined;
    } catch {
      return undefined;
    }
  }

  #resourceStillAllowlisted(execution: LightExecution): boolean {
    return this.#activeResource(execution) !== undefined;
  }

  async #withTaskLock<T>(taskId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.#taskLocks.get(taskId) ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.#taskLocks.set(taskId, queued);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.#taskLocks.get(taskId) === queued) this.#taskLocks.delete(taskId);
    }
  }
}

function advance(
  execution: LightExecution,
  state: LightExecution["state"],
  now = Date.now(),
): LightExecution {
  if (execution.state === "SUCCEEDED" || execution.state === "TECHNICAL_FAILED") return execution;
  const next = {
    ...execution,
    state,
    revision: execution.revision + 1,
    updatedAt: new Date(now).toISOString(),
  };
  next.lastSnapshot = snapshot(next);
  return next;
}

function failedExecution(
  execution: LightExecution,
  reasonCode: string,
  retryable: boolean,
  now: number,
): LightExecution {
  return advance(
    { ...execution, failureReasonCode: reasonCode, failureRetryable: retryable },
    "TECHNICAL_FAILED",
    now,
  );
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
