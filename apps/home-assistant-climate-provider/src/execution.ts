import { randomUUID } from "node:crypto";
import { jsonToProtoStruct } from "../../../packages/adapter-protocol/src/index.js";
import { ClimateProviderError } from "./errors.js";
import { normalizeClimateState } from "./home-assistant.js";
import type { HomeAssistantClimateClient } from "./home-assistant.js";
import type { ClimateResourceRegistry } from "./resources.js";
import type { ClimateStore } from "./store.js";
import type { ClimateTelemetry } from "./telemetry.js";
import type {
  ClimateConfirmationPolicy,
  ClimateExecution,
  ExecutionContextRecord,
  NormalizedClimateState,
} from "./types.js";
export interface StartClimateInput {
  taskId: string;
  operationName: "climate_set_power" | "climate_set_hvac_mode" | "climate_set_temperature";
  resourceId: string;
  power?: "on" | "off";
  hvacMode?: string;
  temperature?: number;
  argumentHash: string;
  executionContext: ExecutionContextRecord;
}

export interface ClimateExecutionEngineOptions {
  powerSideEffectsEnabled?: boolean;
  now?: () => number;
  confirmationPolicy?: ClimateConfirmationPolicy;
  hooks?: {
    afterDispatchIntentPersisted?: (execution: ClimateExecution) => void | Promise<void>;
    afterHomeAssistantCall?: (execution: ClimateExecution) => void | Promise<void>;
  };
}

export const CLIMATE_OPPOSITE_POWER_INTERVAL_MS = 5 * 60 * 1000;

export class ClimateExecutionEngine {
  readonly #taskLocks = new Map<string, Promise<void>>();
  readonly #powerSideEffectsEnabled: boolean;
  readonly #now: () => number;
  readonly #confirmationPolicy: ClimateConfirmationPolicy;

  constructor(
    readonly store: ClimateStore,
    readonly registry: ClimateResourceRegistry,
    readonly rest: HomeAssistantClimateClient,
    readonly telemetry: ClimateTelemetry,
    confirmationTimeoutOrPolicy: number | ClimateConfirmationPolicy,
    readonly sideEffectsEnabled: boolean,
    readonly options: ClimateExecutionEngineOptions = {},
  ) {
    this.#powerSideEffectsEnabled = options.powerSideEffectsEnabled ?? sideEffectsEnabled;
    this.#now = options.now ?? Date.now;
    const confirmationTimeoutMs =
      typeof confirmationTimeoutOrPolicy === "number"
        ? confirmationTimeoutOrPolicy
        : confirmationTimeoutOrPolicy.confirmationTimeoutMs;
    const configuredPolicy =
      typeof confirmationTimeoutOrPolicy === "number"
        ? (options.confirmationPolicy ?? {
            confirmationTimeoutMs,
            minimumStableDurationMs: Math.min(
              5_000,
              Math.max(1, Math.floor(confirmationTimeoutMs / 3)),
            ),
            minimumMatchingObservations: 3,
          })
        : confirmationTimeoutOrPolicy;
    if (configuredPolicy.confirmationTimeoutMs !== confirmationTimeoutMs) {
      throw new Error("HOME_ASSISTANT_CONFIRMATION_POLICY_INVALID");
    }
    this.#confirmationPolicy = validateConfirmationPolicy(configuredPolicy);
  }

  async start(input: StartClimateInput): Promise<ClimateExecution> {
    return this.#withTaskLock(input.taskId, () => this.#start(input));
  }

  async #start(input: StartClimateInput): Promise<ClimateExecution> {
    const existing = this.store.get(input.taskId);
    if (existing !== undefined) {
      if (!same(existing, input)) throw new ClimateProviderError("TASK_IDENTITY_CONFLICT", false);
      return existing;
    }
    if (input.executionContext.executionMode !== "LIVE")
      throw new ClimateProviderError("EXECUTION_MODE_NOT_LIVE", false);
    if (!this.sideEffectsEnabled)
      throw new ClimateProviderError("REAL_DEVICE_SIDE_EFFECTS_GATE_CLOSED", false);
    if (input.operationName === "climate_set_power" && !this.#powerSideEffectsEnabled)
      throw new ClimateProviderError("CLIMATE_POWER_SIDE_EFFECTS_GATE_CLOSED", false);
    const resource = this.registry.require(input.resourceId);
    const observed = normalizeClimateState(
      resource.resourceId,
      await this.rest.getState(resource.entityId),
    );
    if (!observed.reachable) throw new ClimateProviderError("RESOURCE_UNAVAILABLE", true);
    let desired: ClimateExecution["desiredState"];
    if (input.operationName === "climate_set_power")
      desired = { type: "power", power: input.power ?? "off" };
    else if (input.operationName === "climate_set_hvac_mode") {
      const mode = input.hvacMode ?? "";
      if (!resource.allowedHvacModes.includes(mode))
        throw new ClimateProviderError("HVAC_MODE_NOT_ALLOWED", false);
      if (!observed.supportedHvacModes.includes(mode))
        throw new ClimateProviderError("HVAC_MODE_NOT_SUPPORTED", false);
      desired = { type: "hvac_mode", hvacMode: mode };
    } else {
      const temperature = input.temperature ?? Number.NaN;
      const minimum = Math.max(
        resource.temperatureRange.minimum,
        observed.minTemperature ?? -Infinity,
      );
      const maximum = Math.min(
        resource.temperatureRange.maximum,
        observed.maxTemperature ?? Infinity,
      );
      if (!Number.isFinite(temperature) || temperature < minimum || temperature > maximum)
        throw new ClimateProviderError("TEMPERATURE_OUT_OF_RANGE", false);
      desired = { type: "temperature", temperature };
    }
    if (powerIntent(desired, observed) !== undefined && !this.#powerSideEffectsEnabled)
      throw new ClimateProviderError("CLIMATE_POWER_SIDE_EFFECTS_GATE_CLOSED", false);
    const now = new Date(this.#now());
    const x: ClimateExecution = {
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
      confirmationDeadlineAt: new Date(
        now.getTime() + this.#confirmationPolicy.confirmationTimeoutMs,
      ).toISOString(),
      confirmationPolicy: { ...this.#confirmationPolicy },
      confirmationBaselineObservedAt: observed.observedAt,
      matchingObservationCount: 0,
      lastObservedState: observed,
      lastSnapshot: {},
      commandAcks: {},
    };
    x.lastSnapshot = snapshot(x);
    this.store.set(x);
    await this.#dispatch(x);
    return this.store.get(x.taskId) ?? x;
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
      if (execution.desiredState.type === "power" && !this.#powerSideEffectsEnabled) {
        await this.#fail(execution, "CLIMATE_POWER_SIDE_EFFECTS_GATE_CLOSED", false);
        continue;
      }
      await this.#dispatch(execution);
    }
  }

  async poll(id: string): Promise<void> {
    await this.#withTaskLock(id, () => this.#poll(id));
  }

  async #poll(id: string): Promise<void> {
    const x = this.store.get(id);
    if (x?.state !== "CONFIRMING") return;
    if (this.#deadlineReached(x)) {
      await this.#fail(x, "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT", false);
      return;
    }
    const resource = this.#activeResource(x);
    if (resource === undefined) {
      await this.#fail(x, "RECOVERY_RESOURCE_NOT_ALLOWLISTED", false);
      return;
    }
    try {
      const state = normalizeClimateState(
        x.resourceId,
        await this.rest.getState(resource.entityId),
      );
      await this.telemetry.observed(state);
      await this.#applyObservation(id, state);
    } catch {
      // Polling remains best effort until the persisted confirmation deadline.
    }
    const current = this.store.get(id);
    if (current?.state === "CONFIRMING" && this.#deadlineReached(current)) {
      await this.#fail(current, "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT", false);
    }
  }

  async observe(state: NormalizedClimateState): Promise<void> {
    await this.telemetry.observed(state);
    const taskIds = this.store
      .list()
      .filter((execution) => execution.resourceId === state.resourceId)
      .map(({ taskId }) => taskId);
    for (const taskId of taskIds) {
      await this.#withTaskLock(taskId, () => this.#applyObservation(taskId, state));
    }
  }

  async #dispatch(x: ClimateExecution): Promise<void> {
    if (x.dispatchState !== "NOT_STARTED" || x.sideEffectDispatched) return;
    if (this.#deadlineReached(x)) {
      await this.#fail(x, "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT", false);
      return;
    }
    if (x.executionContext.executionMode !== "LIVE")
      throw new ClimateProviderError("EXECUTION_MODE_NOT_LIVE", false);
    if (!this.sideEffectsEnabled)
      throw new ClimateProviderError("REAL_DEVICE_SIDE_EFFECTS_GATE_CLOSED", false);
    if (x.desiredState.type === "power" && !this.#powerSideEffectsEnabled)
      throw new ClimateProviderError("CLIMATE_POWER_SIDE_EFFECTS_GATE_CLOSED", false);
    const resource = this.#activeResource(x);
    if (resource === undefined)
      throw new ClimateProviderError("RECOVERY_RESOURCE_NOT_ALLOWLISTED", false);
    const observed = normalizeClimateState(
      resource.resourceId,
      await this.rest.getState(resource.entityId),
    );
    if (this.#deadlineReached(x)) {
      await this.#fail(x, "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT", false);
      return;
    }
    if (!observed.reachable) throw new ClimateProviderError("RESOURCE_UNAVAILABLE", true);
    this.#validateDesiredState(x, observed);
    const effectivePowerIntent = powerIntent(x.desiredState, observed);
    if (effectivePowerIntent !== undefined && !this.#powerSideEffectsEnabled)
      throw new ClimateProviderError("CLIMATE_POWER_SIDE_EFFECTS_GATE_CLOSED", false);

    if (confirmed(x, observed)) {
      const confirming = advance(
        {
          ...x,
          confirmationBaselineObservedAt: observed.observedAt,
          lastObservedState: observed,
        },
        "CONFIRMING",
        this.#now(),
      );
      this.store.set(confirming);
      await this.telemetry.progress(confirming);
      await this.#applyObservation(confirming.taskId, observed);
      return;
    }

    let marked: ClimateExecution | undefined;
    let blocked: ClimateExecution | undefined;
    this.store.update((document) => {
      const latest = document.executions[x.taskId];
      if (
        latest?.state !== "PENDING_SIDE_EFFECT" ||
        latest.dispatchState !== "NOT_STARTED" ||
        latest.sideEffectDispatched
      )
        return;
      if (effectivePowerIntent !== undefined) {
        const guard = document.climatePowerGuard;
        if (
          guard !== undefined &&
          guard.power !== effectivePowerIntent &&
          this.#now() - Date.parse(guard.attemptedAt) < CLIMATE_OPPOSITE_POWER_INTERVAL_MS
        ) {
          blocked = failedExecution(
            latest,
            "CLIMATE_OPPOSITE_POWER_INTERVAL_ACTIVE",
            false,
            this.#now(),
          );
          document.executions[x.taskId] = blocked;
          return;
        }
        document.climatePowerGuard = {
          power: effectivePowerIntent,
          attemptedAt: new Date(this.#now()).toISOString(),
          taskId: latest.taskId,
        };
      }
      marked = advance(
        {
          ...latest,
          sideEffectDispatched: true,
          dispatchState: "INTENT_PERSISTED",
          confirmationBaselineObservedAt: observed.observedAt,
          matchingObservationCount: 0,
          lastObservedState: observed,
        },
        "PENDING_SIDE_EFFECT",
        this.#now(),
      );
      document.executions[x.taskId] = marked;
    });
    if (blocked !== undefined) {
      await this.telemetry.progress(blocked);
      return;
    }
    if (marked === undefined) return;
    await this.options.hooks?.afterDispatchIntentPersisted?.(marked);
    if (this.#deadlineReached(marked)) {
      await this.#fail(marked, "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT", false);
      return;
    }

    const data: Record<string, unknown> = { entity_id: resource.entityId };
    let service: "turn_on" | "turn_off" | "set_hvac_mode" | "set_temperature";
    if (marked.desiredState.type === "power")
      service = marked.desiredState.power === "on" ? "turn_on" : "turn_off";
    else if (marked.desiredState.type === "hvac_mode") {
      service = "set_hvac_mode";
      data.hvac_mode = marked.desiredState.hvacMode;
    } else {
      service = "set_temperature";
      data.temperature = marked.desiredState.temperature;
    }
    try {
      await this.rest.callService(service, data);
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

  #validateDesiredState(x: ClimateExecution, observed: NormalizedClimateState): void {
    const resource = this.registry.require(x.resourceId);
    if (x.desiredState.type === "hvac_mode") {
      if (!resource.allowedHvacModes.includes(x.desiredState.hvacMode))
        throw new ClimateProviderError("HVAC_MODE_NOT_ALLOWED", false);
      if (!observed.supportedHvacModes.includes(x.desiredState.hvacMode))
        throw new ClimateProviderError("HVAC_MODE_NOT_SUPPORTED", false);
    } else if (x.desiredState.type === "temperature") {
      const minimum = Math.max(
        resource.temperatureRange.minimum,
        observed.minTemperature ?? -Infinity,
      );
      const maximum = Math.min(
        resource.temperatureRange.maximum,
        observed.maxTemperature ?? Infinity,
      );
      if (x.desiredState.temperature < minimum || x.desiredState.temperature > maximum)
        throw new ClimateProviderError("TEMPERATURE_OUT_OF_RANGE", false);
    }
  }

  async #resumeConfirmation(execution: ClimateExecution): Promise<void> {
    const confirming =
      execution.state === "CONFIRMING" ? execution : advance(execution, "CONFIRMING", this.#now());
    if (confirming !== execution) {
      this.store.set(confirming);
      await this.telemetry.progress(confirming);
    }
    await this.poll(execution.taskId);
  }

  async #applyObservation(taskId: string, state: NormalizedClimateState): Promise<void> {
    const execution = this.store.get(taskId);
    if (execution?.state !== "CONFIRMING") return;
    const now = this.#now();
    const resource = this.#activeResource(execution);
    if (
      resource === undefined ||
      execution.resourceId !== state.resourceId ||
      execution.entityId !== resource.entityId
    ) {
      return;
    }
    if (this.#deadlineReached(execution, now)) {
      await this.#fail(execution, "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT", false, now);
      return;
    }

    const observedAt = Date.parse(state.observedAt);
    const baselineAt = Date.parse(execution.confirmationBaselineObservedAt ?? "");
    const previousObservedAt = Date.parse(execution.lastObservedState?.observedAt ?? "");
    if (
      !Number.isFinite(observedAt) ||
      (Number.isFinite(baselineAt) && observedAt < baselineAt) ||
      (Number.isFinite(previousObservedAt) && observedAt < previousObservedAt)
    ) {
      return;
    }

    if (!state.reachable || !confirmed(execution, state)) {
      const resetCandidate: ClimateExecution = {
        ...execution,
        matchingObservationCount: 0,
        lastObservedState: state,
      };
      delete resetCandidate.candidateConfirmedAt;
      delete resetCandidate.lastMatchingObservationAt;
      const reset = advance(resetCandidate, "CONFIRMING", now);
      this.store.set(reset);
      await this.telemetry.progress(reset);
      return;
    }

    const previousMatchAt = Date.parse(execution.lastMatchingObservationAt ?? "");
    const existingCandidateAt = execution.candidateConfirmedAt;
    const startsCandidate = existingCandidateAt === undefined;
    const candidateConfirmedAt = existingCandidateAt ?? new Date(now).toISOString();
    const matchingObservationCount = startsCandidate
      ? 1
      : now > previousMatchAt
        ? (execution.matchingObservationCount ?? 1) + 1
        : (execution.matchingObservationCount ?? 1);
    const candidate = {
      ...execution,
      candidateConfirmedAt,
      matchingObservationCount,
      lastMatchingObservationAt:
        now > previousMatchAt || execution.lastMatchingObservationAt === undefined
          ? new Date(now).toISOString()
          : execution.lastMatchingObservationAt,
      lastObservedState: state,
    };
    const policy = execution.confirmationPolicy ?? this.#confirmationPolicy;
    const stableFor = now - Date.parse(candidateConfirmedAt);
    if (
      matchingObservationCount >= policy.minimumMatchingObservations &&
      stableFor >= policy.minimumStableDurationMs
    ) {
      const done = advance({ ...candidate, confirmedState: state }, "SUCCEEDED", now);
      this.store.set(done);
      await this.telemetry.progress(done);
      return;
    }
    const confirming = advance(candidate, "CONFIRMING", now);
    this.store.set(confirming);
    await this.telemetry.progress(confirming);
  }

  #deadlineReached(execution: ClimateExecution, now = this.#now()): boolean {
    return now >= Date.parse(execution.confirmationDeadlineAt);
  }

  async #fail(
    execution: ClimateExecution,
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

  #activeResource(execution: ClimateExecution) {
    try {
      const resource = this.registry.require(execution.resourceId);
      return resource.entityId === execution.entityId ? resource : undefined;
    } catch {
      return undefined;
    }
  }

  #resourceStillAllowlisted(execution: ClimateExecution): boolean {
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

function powerIntent(
  desired: ClimateExecution["desiredState"],
  observed: NormalizedClimateState,
): "on" | "off" | undefined {
  if (desired.type === "power") return desired.power;
  if (desired.type === "hvac_mode" && observed.power === "off") return "on";
  return undefined;
}
export function snapshot(x: ClimateExecution): Record<string, unknown> {
  const completedResult = x.state === "SUCCEEDED" ? result(x) : undefined;
  return {
    taskId: x.taskId,
    externalExecutionId: x.externalExecutionId,
    operationName: x.operationName,
    argumentHash: x.argumentHash,
    executionContext: x.executionContext,
    state:
      x.state === "PENDING_SIDE_EFFECT"
        ? "ACCEPTED"
        : x.state === "CONFIRMING"
          ? "RUNNING"
          : x.state,
    revision: String(x.revision),
    reasonCode:
      x.state === "SUCCEEDED"
        ? "HOME_ASSISTANT_STATE_CONFIRMED"
        : x.state === "TECHNICAL_FAILED"
          ? (x.failureReasonCode ?? "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT")
          : x.state === "CONFIRMING"
            ? "HOME_ASSISTANT_CONFIRMING"
            : "EXECUTION_PERSISTED",
    message:
      x.state === "SUCCEEDED"
        ? "Desired climate state confirmed."
        : x.state === "TECHNICAL_FAILED"
          ? (x.failureReasonCode ?? "Climate state confirmation failed.")
          : "Waiting for observed Home Assistant climate state.",
    ...(completedResult === undefined
      ? {}
      : { result: jsonToProtoStruct(completedResult), evidence: [completionEvidence(x)] }),
    retryable: x.state === "TECHNICAL_FAILED" ? (x.failureRetryable ?? false) : false,
    observedAt: timestamp(x.updatedAt),
  };
}
function result(x: ClimateExecution): Record<string, unknown> {
  const confirmedState = x.confirmedState;
  if (confirmedState === undefined) throw new Error("CONFIRMED_CLIMATE_STATE_MISSING");
  if (x.desiredState.type === "power")
    return {
      resourceId: x.resourceId,
      power: confirmedState.power,
      confirmed: true,
      observedAt: confirmedState.observedAt,
    };
  if (x.desiredState.type === "hvac_mode")
    return {
      resourceId: x.resourceId,
      hvacMode: confirmedState.hvacMode,
      confirmed: true,
      observedAt: confirmedState.observedAt,
    };
  return {
    resourceId: x.resourceId,
    targetTemperature: confirmedState.targetTemperature,
    confirmed: true,
    observedAt: confirmedState.observedAt,
  };
}

function completionEvidence(x: ClimateExecution): Record<string, unknown> {
  const confirmedState = x.confirmedState;
  if (confirmedState === undefined) throw new Error("CONFIRMED_CLIMATE_STATE_MISSING");
  const evidence =
    x.desiredState.type === "power"
      ? { evidenceType: "climate.state.observation", jsonPointer: "/power" }
      : x.desiredState.type === "hvac_mode"
        ? { evidenceType: "climate.hvac_mode.observation", jsonPointer: "/hvacMode" }
        : {
            evidenceType: "climate.target_temperature.observation",
            jsonPointer: "/targetTemperature",
          };
  return {
    evidenceId: `home-assistant-climate-${x.taskId}-${String(x.revision)}`,
    evidenceType: evidence.evidenceType,
    observedAt: confirmedState.observedAt,
    subjectRef: `resource:${x.resourceId}`,
    payloadRef: { kind: "structured_content", jsonPointer: evidence.jsonPointer },
    producer: ["home-assistant"],
  };
}
function advance(
  x: ClimateExecution,
  state: ClimateExecution["state"],
  now = Date.now(),
): ClimateExecution {
  if (x.state === "SUCCEEDED" || x.state === "TECHNICAL_FAILED") return x;
  const next = { ...x, state, revision: x.revision + 1, updatedAt: new Date(now).toISOString() };
  next.lastSnapshot = snapshot(next);
  return next;
}

function failedExecution(
  x: ClimateExecution,
  reasonCode: string,
  retryable: boolean,
  now: number,
): ClimateExecution {
  return advance(
    { ...x, failureReasonCode: reasonCode, failureRetryable: retryable },
    "TECHNICAL_FAILED",
    now,
  );
}
function confirmed(x: ClimateExecution, s: NormalizedClimateState): boolean {
  if (x.desiredState.type === "power") return s.power === x.desiredState.power;
  if (x.desiredState.type === "hvac_mode") return s.hvacMode === x.desiredState.hvacMode;
  return (
    s.targetTemperature !== null &&
    Math.abs(s.targetTemperature - x.desiredState.temperature) <= 0.1
  );
}
function same(x: ClimateExecution, i: StartClimateInput): boolean {
  return (
    x.operationName === i.operationName &&
    x.argumentHash === i.argumentHash &&
    x.executionContext.authorizationContextHash === i.executionContext.authorizationContextHash &&
    x.executionContext.executionMode === i.executionContext.executionMode &&
    x.executionContext.simulationId === i.executionContext.simulationId
  );
}
export function timestamp(value: string): { seconds: string; nanos: number } {
  const ms = Date.parse(value);
  return { seconds: String(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1e6 };
}
export class ClimateConfirmationWorker {
  #timer: NodeJS.Timeout | undefined;
  constructor(
    readonly store: ClimateStore,
    readonly engine: ClimateExecutionEngine,
    readonly interval: number,
  ) {}
  start(): void {
    if (this.#timer === undefined)
      this.#timer = setInterval(() => {
        for (const x of this.store.list())
          if (x.state === "CONFIRMING") void this.engine.poll(x.taskId);
      }, this.interval);
  }
  stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }
}

function validateConfirmationPolicy(policy: ClimateConfirmationPolicy): ClimateConfirmationPolicy {
  if (
    !Number.isInteger(policy.confirmationTimeoutMs) ||
    policy.confirmationTimeoutMs <= 0 ||
    !Number.isInteger(policy.minimumStableDurationMs) ||
    policy.minimumStableDurationMs <= 0 ||
    policy.minimumStableDurationMs >= policy.confirmationTimeoutMs ||
    !Number.isInteger(policy.minimumMatchingObservations) ||
    policy.minimumMatchingObservations < 2
  ) {
    throw new Error("HOME_ASSISTANT_CONFIRMATION_POLICY_INVALID");
  }
  return { ...policy };
}
