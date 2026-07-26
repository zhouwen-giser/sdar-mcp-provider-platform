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
  return (
    typeof v === "object" &&
    v !== null &&
    "version" in v &&
    v.version === 1 &&
    "executions" in v &&
    typeof v.executions === "object" &&
    v.executions !== null &&
    "pendingTelemetryEvents" in v &&
    Array.isArray(v.pendingTelemetryEvents) &&
    "nextTelemetrySequence" in v &&
    typeof v.nextTelemetrySequence === "number"
  );
}
