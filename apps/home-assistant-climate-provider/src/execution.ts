import { randomUUID } from "node:crypto";
import { jsonToProtoStruct } from "../../../packages/adapter-protocol/src/index.js";
import { ClimateProviderError } from "./errors.js";
import { normalizeClimateState } from "./home-assistant.js";
import type { HomeAssistantClimateClient } from "./home-assistant.js";
import type { ClimateResourceRegistry } from "./resources.js";
import type { ClimateStore } from "./store.js";
import type { ClimateTelemetry } from "./telemetry.js";
import type { ClimateExecution, ExecutionContextRecord, NormalizedClimateState } from "./types.js";
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
export class ClimateExecutionEngine {
  constructor(
    readonly store: ClimateStore,
    readonly registry: ClimateResourceRegistry,
    readonly rest: HomeAssistantClimateClient,
    readonly telemetry: ClimateTelemetry,
    readonly confirmMs: number,
  ) {}
  async start(input: StartClimateInput): Promise<ClimateExecution> {
    const existing = this.store.get(input.taskId);
    if (existing !== undefined) {
      if (!same(existing, input)) throw new ClimateProviderError("TASK_IDENTITY_CONFLICT", false);
      return existing;
    }
    const resource = this.registry.require(input.resourceId);
    const observed = normalizeClimateState(
      resource.resourceId,
      await this.rest.getState(resource.entityId),
    );
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
    const now = new Date();
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
      revision: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      confirmationDeadlineAt: new Date(now.getTime() + this.confirmMs).toISOString(),
      lastSnapshot: {},
      commandAcks: {},
    };
    x.lastSnapshot = snapshot(x);
    this.store.set(x);
    await this.#dispatch(x);
    return this.store.get(x.taskId) ?? x;
  }
  async recover(): Promise<void> {
    for (const x of this.store.list())
      if (x.state === "PENDING_SIDE_EFFECT") await this.#dispatch(x);
      else if (x.state === "CONFIRMING") await this.poll(x.taskId);
  }
  async poll(id: string): Promise<void> {
    const x = this.store.get(id);
    if (x?.state !== "CONFIRMING") return;
    try {
      await this.observe(normalizeClimateState(x.resourceId, await this.rest.getState(x.entityId)));
    } catch {
      // Polling remains best effort until the persisted confirmation deadline.
    }
    const current = this.store.get(id);
    if (
      current?.state === "CONFIRMING" &&
      Date.now() >= Date.parse(current.confirmationDeadlineAt)
    ) {
      const failed = advance(current, "TECHNICAL_FAILED");
      this.store.set(failed);
      await this.telemetry.progress(failed);
    }
  }
  async observe(state: NormalizedClimateState): Promise<void> {
    await this.telemetry.observed(state);
    for (const x of this.store.list())
      if (x.resourceId === state.resourceId && x.state === "CONFIRMING" && confirmed(x, state)) {
        const done = advance({ ...x, confirmedState: state }, "SUCCEEDED");
        this.store.set(done);
        await this.telemetry.progress(done);
      }
  }
  async #dispatch(x: ClimateExecution): Promise<void> {
    if (x.sideEffectDispatched) return;
    const data: Record<string, unknown> = { entity_id: x.entityId };
    let service: "turn_on" | "turn_off" | "set_hvac_mode" | "set_temperature";
    if (x.desiredState.type === "power")
      service = x.desiredState.power === "on" ? "turn_on" : "turn_off";
    else if (x.desiredState.type === "hvac_mode") {
      service = "set_hvac_mode";
      data.hvac_mode = x.desiredState.hvacMode;
    } else {
      service = "set_temperature";
      data.temperature = x.desiredState.temperature;
    }
    await this.rest.callService(service, data);
    const confirming = advance({ ...x, sideEffectDispatched: true }, "CONFIRMING");
    this.store.set(confirming);
    await this.telemetry.progress(confirming);
  }
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
          ? "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT"
          : x.state === "CONFIRMING"
            ? "HOME_ASSISTANT_CONFIRMING"
            : "EXECUTION_PERSISTED",
    message:
      x.state === "SUCCEEDED"
        ? "Desired climate state confirmed."
        : x.state === "TECHNICAL_FAILED"
          ? "Climate state confirmation timed out."
          : "Waiting for observed Home Assistant climate state.",
    ...(completedResult === undefined
      ? {}
      : { result: jsonToProtoStruct(completedResult), evidence: [completionEvidence(x)] }),
    retryable: x.state === "TECHNICAL_FAILED",
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
function advance(x: ClimateExecution, state: ClimateExecution["state"]): ClimateExecution {
  if (x.state === "SUCCEEDED" || x.state === "TECHNICAL_FAILED") return x;
  const next = { ...x, state, revision: x.revision + 1, updatedAt: new Date().toISOString() };
  next.lastSnapshot = snapshot(next);
  return next;
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
