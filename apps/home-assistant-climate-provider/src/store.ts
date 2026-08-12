import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ProviderTelemetryEventInput } from "../../../packages/provider-telemetry/src/index.js";
import type { ClimateExecution } from "./types.js";
export interface QueuedEvent {
  event: ProviderTelemetryEventInput;
  attempts: number;
  nextAttemptAt: number;
}
export interface StateDocument {
  version: 1;
  executions: Record<string, ClimateExecution>;
  pendingTelemetryEvents: QueuedEvent[];
  nextTelemetrySequence: number;
  climatePowerGuard?: {
    power: "on" | "off";
    attemptedAt: string;
    taskId: string;
  };
}
export interface ClimateStore {
  get(id: string): ClimateExecution | undefined;
  list(): ClimateExecution[];
  set(value: ClimateExecution): void;
  read(): StateDocument;
  update(fn: (value: StateDocument) => void): void;
}
const empty = (): StateDocument => ({
  version: 1,
  executions: {},
  pendingTelemetryEvents: [],
  nextTelemetrySequence: 1,
});
export class JsonClimateStore implements ClimateStore {
  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) this.#write(empty());
    this.#read();
  }
  get(id: string): ClimateExecution | undefined {
    return this.#read().executions[id];
  }
  list(): ClimateExecution[] {
    return Object.values(this.#read().executions);
  }
  set(value: ClimateExecution): void {
    this.update((d) => {
      d.executions[value.taskId] = value;
    });
  }
  read(): StateDocument {
    return structuredClone(this.#read());
  }
  update(fn: (value: StateDocument) => void): void {
    const d = this.#read();
    fn(d);
    this.#write(d);
  }
  #read(): StateDocument {
    let v: unknown;
    try {
      v = JSON.parse(readFileSync(this.path, "utf8"));
    } catch {
      throw new Error("INVALID_PROVIDER_STATE_FILE");
    }
    if (!valid(v)) throw new Error("INVALID_PROVIDER_STATE_FILE");
    return v;
  }
  #write(value: StateDocument): void {
    const temp = `${this.path}.${String(process.pid)}.${randomUUID()}.tmp`;
    writeFileSync(temp, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temp, this.path);
  }
}
export class MemoryClimateStore implements ClimateStore {
  #value = empty();
  get(id: string): ClimateExecution | undefined {
    return structuredClone(this.#value.executions[id]);
  }
  list(): ClimateExecution[] {
    return structuredClone(Object.values(this.#value.executions));
  }
  set(value: ClimateExecution): void {
    this.#value.executions[value.taskId] = structuredClone(value);
  }
  read(): StateDocument {
    return structuredClone(this.#value);
  }
  update(fn: (value: StateDocument) => void): void {
    fn(this.#value);
  }
}
function valid(v: unknown): v is StateDocument {
  if (
    !record(v) ||
    !(
      "version" in v &&
      v.version === 1 &&
      "executions" in v &&
      record(v.executions) &&
      "pendingTelemetryEvents" in v &&
      Array.isArray(v.pendingTelemetryEvents) &&
      "nextTelemetrySequence" in v &&
      typeof v.nextTelemetrySequence === "number"
    )
  )
    return false;
  if (
    !Object.entries(v.executions).every(
      ([taskId, execution]) => validExecution(execution) && execution.taskId === taskId,
    )
  )
    return false;
  const guard = v.climatePowerGuard;
  return (
    guard === undefined ||
    (record(guard) &&
      (guard.power === "on" || guard.power === "off") &&
      typeof guard.attemptedAt === "string" &&
      Number.isFinite(Date.parse(guard.attemptedAt)) &&
      typeof guard.taskId === "string" &&
      guard.taskId.length > 0)
  );
}

function validExecution(value: unknown): value is ClimateExecution {
  if (!record(value) || !record(value.executionContext) || !record(value.desiredState))
    return false;
  const desired = value.desiredState;
  const desiredValid =
    (desired.type === "power" && (desired.power === "on" || desired.power === "off")) ||
    (desired.type === "hvac_mode" && typeof desired.hvacMode === "string") ||
    (desired.type === "temperature" &&
      typeof desired.temperature === "number" &&
      Number.isFinite(desired.temperature));
  const operationMatchesDesired =
    (value.operationName === "climate_set_power" && desired.type === "power") ||
    (value.operationName === "climate_set_hvac_mode" && desired.type === "hvac_mode") ||
    (value.operationName === "climate_set_temperature" && desired.type === "temperature");
  const dispatchState = value.dispatchState;
  const matchingObservationCount = value.matchingObservationCount;
  const candidateChronologyValid =
    validInstant(value.createdAt) &&
    validInstant(value.updatedAt) &&
    validInstant(value.confirmationDeadlineAt) &&
    validInstant(value.candidateConfirmedAt) &&
    validInstant(value.lastMatchingObservationAt) &&
    Date.parse(value.createdAt) <= Date.parse(value.candidateConfirmedAt) &&
    Date.parse(value.candidateConfirmedAt) <= Date.parse(value.lastMatchingObservationAt) &&
    Date.parse(value.lastMatchingObservationAt) <= Date.parse(value.updatedAt) &&
    Date.parse(value.lastMatchingObservationAt) < Date.parse(value.confirmationDeadlineAt);
  const stableCandidateValid =
    matchingObservationCount === undefined
      ? value.candidateConfirmedAt === undefined && value.lastMatchingObservationAt === undefined
      : typeof matchingObservationCount === "number" &&
        Number.isInteger(matchingObservationCount) &&
        matchingObservationCount >= 0 &&
        (matchingObservationCount === 0
          ? value.candidateConfirmedAt === undefined &&
            value.lastMatchingObservationAt === undefined
          : value.state !== "PENDING_SIDE_EFFECT" && candidateChronologyValid);
  const dispatchInvariantValid =
    dispatchState === undefined ||
    (dispatchState === "NOT_STARTED"
      ? value.sideEffectDispatched === false
      : value.sideEffectDispatched === true);
  const confirmedStateValid =
    value.state === "SUCCEEDED"
      ? validConfirmedState(value, value.confirmedState)
      : value.confirmedState === undefined;
  return (
    typeof value.taskId === "string" &&
    value.taskId.length > 0 &&
    typeof value.externalExecutionId === "string" &&
    (value.operationName === "climate_set_power" ||
      value.operationName === "climate_set_hvac_mode" ||
      value.operationName === "climate_set_temperature") &&
    typeof value.resourceId === "string" &&
    /^climate\.[a-z0-9_]+$/.test(String(value.entityId)) &&
    typeof value.argumentHash === "string" &&
    typeof value.executionContext.authorizationContextHash === "string" &&
    typeof value.executionContext.executionMode === "string" &&
    typeof value.executionContext.simulationId === "string" &&
    typeof value.executionContext.correlationId === "string" &&
    desiredValid &&
    operationMatchesDesired &&
    (value.state === "PENDING_SIDE_EFFECT" ||
      value.state === "CONFIRMING" ||
      value.state === "SUCCEEDED" ||
      value.state === "TECHNICAL_FAILED") &&
    typeof value.sideEffectDispatched === "boolean" &&
    (dispatchState === undefined ||
      dispatchState === "NOT_STARTED" ||
      dispatchState === "INTENT_PERSISTED" ||
      dispatchState === "CALL_RETURNED") &&
    dispatchInvariantValid &&
    Number.isInteger(value.revision) &&
    validInstant(value.createdAt) &&
    validInstant(value.updatedAt) &&
    validInstant(value.confirmationDeadlineAt) &&
    (value.confirmationPolicy === undefined || validConfirmationPolicy(value.confirmationPolicy)) &&
    (value.confirmationBaselineObservedAt === undefined ||
      validInstant(value.confirmationBaselineObservedAt)) &&
    stableCandidateValid &&
    (value.lastObservedState === undefined || validNormalizedState(value.lastObservedState)) &&
    confirmedStateValid &&
    record(value.lastSnapshot) &&
    record(value.commandAcks)
  );
}

function validConfirmationPolicy(value: unknown): boolean {
  if (!record(value)) return false;
  return (
    typeof value.confirmationTimeoutMs === "number" &&
    Number.isInteger(value.confirmationTimeoutMs) &&
    value.confirmationTimeoutMs > 0 &&
    typeof value.minimumStableDurationMs === "number" &&
    Number.isInteger(value.minimumStableDurationMs) &&
    value.minimumStableDurationMs > 0 &&
    value.minimumStableDurationMs < value.confirmationTimeoutMs &&
    typeof value.minimumMatchingObservations === "number" &&
    Number.isInteger(value.minimumMatchingObservations) &&
    value.minimumMatchingObservations >= 2
  );
}

function validConfirmedState(execution: Record<string, unknown>, state: unknown): boolean {
  if (!validNormalizedState(state) || !record(state) || !record(execution.desiredState)) {
    return false;
  }
  if (state.resourceId !== execution.resourceId || state.reachable !== true) {
    return false;
  }
  const desired = execution.desiredState;
  if (desired.type === "power") return state.power === desired.power;
  if (desired.type === "hvac_mode") return state.hvacMode === desired.hvacMode;
  return (
    desired.type === "temperature" &&
    typeof desired.temperature === "number" &&
    typeof state.targetTemperature === "number" &&
    Math.abs(state.targetTemperature - desired.temperature) <= 0.1
  );
}

function validNormalizedState(value: unknown): boolean {
  if (!record(value)) return false;
  return (
    typeof value.resourceId === "string" &&
    (value.power === "on" ||
      value.power === "off" ||
      value.power === "unknown" ||
      value.power === "unavailable") &&
    typeof value.reachable === "boolean" &&
    (value.hvacMode === null || typeof value.hvacMode === "string") &&
    nullableFinite(value.currentTemperature) &&
    nullableFinite(value.targetTemperature) &&
    typeof value.temperatureUnit === "string" &&
    nullableFinite(value.minTemperature) &&
    nullableFinite(value.maxTemperature) &&
    Array.isArray(value.supportedHvacModes) &&
    value.supportedHvacModes.every((mode) => typeof mode === "string") &&
    validInstant(value.observedAt)
  );
}

function nullableFinite(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function validInstant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
