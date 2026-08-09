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
  if (!Object.values(v.executions).every(validExecution)) return false;
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
    Number.isInteger(value.revision) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.confirmationDeadlineAt === "string" &&
    record(value.lastSnapshot) &&
    record(value.commandAcks)
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
