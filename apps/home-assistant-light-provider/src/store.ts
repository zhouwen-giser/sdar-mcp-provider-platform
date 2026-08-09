import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ProviderTelemetryEventInput } from "../../../packages/provider-telemetry/src/index.js";
import type { LightExecution } from "./types.js";

export interface QueuedEvent {
  event: ProviderTelemetryEventInput;
  attempts: number;
  nextAttemptAt: number;
}
export interface StateDocument {
  version: 1;
  executions: Record<string, LightExecution>;
  pendingTelemetryEvents: QueuedEvent[];
  nextTelemetrySequence: number;
}
const empty = (): StateDocument => ({
  version: 1,
  executions: {},
  pendingTelemetryEvents: [],
  nextTelemetrySequence: 1,
});
export interface LightStore {
  get(id: string): LightExecution | undefined;
  list(): LightExecution[];
  set(value: LightExecution): void;
  read(): StateDocument;
  update(fn: (value: StateDocument) => void): void;
}

export class JsonLightStore implements LightStore {
  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) this.#write(empty());
    this.#read();
  }
  get(id: string): LightExecution | undefined {
    return this.#read().executions[id];
  }
  list(): LightExecution[] {
    return Object.values(this.#read().executions);
  }
  set(value: LightExecution): void {
    this.update((document) => {
      document.executions[value.taskId] = value;
    });
  }
  read(): StateDocument {
    return structuredClone(this.#read());
  }
  update(fn: (value: StateDocument) => void): void {
    const document = this.#read();
    fn(document);
    this.#write(document);
  }
  #read(): StateDocument {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(this.path, "utf8"));
    } catch {
      throw new Error("INVALID_PROVIDER_STATE_FILE");
    }
    if (!valid(value)) throw new Error("INVALID_PROVIDER_STATE_FILE");
    return value;
  }
  #write(value: StateDocument): void {
    const temporary = `${this.path}.${String(process.pid)}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.path);
  }
}

export class MemoryLightStore implements LightStore {
  #value = empty();
  get(id: string): LightExecution | undefined {
    return structuredClone(this.#value.executions[id]);
  }
  list(): LightExecution[] {
    return structuredClone(Object.values(this.#value.executions));
  }
  set(value: LightExecution): void {
    this.#value.executions[value.taskId] = structuredClone(value);
  }
  read(): StateDocument {
    return structuredClone(this.#value);
  }
  update(fn: (value: StateDocument) => void): void {
    fn(this.#value);
  }
}
function valid(value: unknown): value is StateDocument {
  if (
    !record(value) ||
    !(
      "version" in value &&
      value.version === 1 &&
      "executions" in value &&
      record(value.executions) &&
      "pendingTelemetryEvents" in value &&
      Array.isArray(value.pendingTelemetryEvents) &&
      "nextTelemetrySequence" in value &&
      typeof value.nextTelemetrySequence === "number"
    )
  )
    return false;
  return Object.values(value.executions).every(validExecution);
}

function validExecution(value: unknown): value is LightExecution {
  if (!record(value) || !record(value.executionContext) || !record(value.desiredState))
    return false;
  const desired = value.desiredState;
  const desiredValid =
    (desired.type === "power" && (desired.power === "on" || desired.power === "off")) ||
    (desired.type === "brightness" &&
      typeof desired.brightnessPercent === "number" &&
      Number.isFinite(desired.brightnessPercent) &&
      desired.brightnessPercent >= 0 &&
      desired.brightnessPercent <= 100);
  const operationMatchesDesired =
    (value.operationName === "light_set_power" && desired.type === "power") ||
    (value.operationName === "light_set_brightness" && desired.type === "brightness");
  const dispatchState = value.dispatchState;
  return (
    typeof value.taskId === "string" &&
    value.taskId.length > 0 &&
    typeof value.externalExecutionId === "string" &&
    (value.operationName === "light_set_power" || value.operationName === "light_set_brightness") &&
    typeof value.resourceId === "string" &&
    /^light\.[a-z0-9_]+$/.test(String(value.entityId)) &&
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
