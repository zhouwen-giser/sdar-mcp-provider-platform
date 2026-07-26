import * as grpc from "@grpc/grpc-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  telemetryClientConstructor,
  type ProviderTelemetryEventInput,
} from "../../../packages/provider-telemetry/src/index.js";
import type { ClimateResourceRegistry } from "./resources.js";
import type { ClimateStore } from "./store.js";
import type { ClimateExecution, NormalizedClimateState } from "./types.js";
interface Client extends grpc.Client {
  emitProviderEvents(
    request: unknown,
    callback: (error: grpc.ServiceError | null, response: unknown) => void,
  ): grpc.ClientUnaryCall;
}
export interface ClimateTelemetry {
  observed(state: NormalizedClimateState): Promise<void>;
  progress(execution: ClimateExecution): Promise<void>;
}
export class ProviderClimateTelemetry implements ClimateTelemetry {
  readonly #client: Client | undefined;
  #timer: NodeJS.Timeout | undefined;
  constructor(
    readonly options: {
      providerId: string;
      endpoint: string;
      enabled: boolean;
      tlsMode: "disabled" | "required";
      caPath?: string;
      certPath?: string;
      keyPath?: string;
    },
    readonly registry: ClimateResourceRegistry,
    readonly store: ClimateStore,
  ) {
    if (options.enabled) {
      const C = telemetryClientConstructor();
      this.#client = new C(options.endpoint, credentials(options)) as unknown as Client;
    }
  }
  start(): void {
    if (this.#client !== undefined && this.#timer === undefined)
      this.#timer = setInterval(() => void this.flush(), 1000);
  }
  stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#client?.close();
  }
  async observed(state: NormalizedClimateState): Promise<void> {
    const entity = this.registry.require(state.resourceId).entityId;
    this.#enqueue(
      event(
        this.options.providerId,
        entity,
        state,
        "RESOURCE_STATE",
        { state: state.hvacMode ?? state.power, reasonCode: "HOME_ASSISTANT_STATE_CHANGED" },
        { reachable: state.reachable },
      ),
    );
    this.#enqueue(
      event(
        this.options.providerId,
        entity,
        state,
        "RESOURCE_HEALTH",
        {
          health:
            state.power === "unavailable"
              ? "offline"
              : state.power === "unknown"
                ? "degraded"
                : "healthy",
          reasonCode: state.reachable ? "HOME_ASSISTANT_REACHABLE" : "HOME_ASSISTANT_UNREACHABLE",
        },
        {},
      ),
    );
    for (const [name, value] of [
      ["current_temperature", state.currentTemperature],
      ["target_temperature", state.targetTemperature],
    ] as const)
      if (value !== null)
        this.#enqueue(
          event(
            this.options.providerId,
            entity,
            state,
            "RESOURCE_METRIC",
            { metricName: name, value, unit: state.temperatureUnit, quality: "observed" },
            {},
          ),
        );
    await this.flush();
  }
  async progress(x: ClimateExecution): Promise<void> {
    const payload = {
      current: x.state === "SUCCEEDED" ? 1 : 0,
      total: 1,
      percentage: x.state === "SUCCEEDED" ? 100 : 0,
      unit: "confirmation",
    };
    this.#enqueue({
      providerEventId: id(
        this.options.providerId,
        x.entityId,
        `${x.taskId}:${String(x.revision)}`,
        "EXECUTION_PROGRESS",
        payload,
      ),
      eventType: "EXECUTION_PROGRESS",
      resourceId: x.resourceId,
      resourceType: "home_assistant.climate",
      taskId: x.taskId,
      externalExecutionId: x.externalExecutionId,
      operationName: x.operationName,
      occurredAt: timestamp(x.updatedAt),
      attributes: {},
      payload,
      traceparent: "",
      tracestate: "",
    });
    await this.flush();
  }
  #enqueue(input: Omit<ProviderTelemetryEventInput, "providerEventSequence">): void {
    this.store.update((d) => {
      const complete = { ...input, providerEventSequence: String(d.nextTelemetrySequence++) };
      if (complete.eventType === "RESOURCE_METRIC")
        d.pendingTelemetryEvents = d.pendingTelemetryEvents.filter(
          (q) =>
            !(
              q.event.eventType === "RESOURCE_METRIC" &&
              q.event.resourceId === complete.resourceId &&
              q.event.payload.metricName === complete.payload.metricName
            ),
        );
      d.pendingTelemetryEvents.push({ event: complete, attempts: 0, nextAttemptAt: 0 });
      while (d.pendingTelemetryEvents.length > 1000)
        d.pendingTelemetryEvents.splice(
          d.pendingTelemetryEvents.findIndex((q) => q.event.eventType === "RESOURCE_METRIC") >= 0
            ? d.pendingTelemetryEvents.findIndex((q) => q.event.eventType === "RESOURCE_METRIC")
            : 0,
          1,
        );
    });
  }
  async flush(): Promise<void> {
    if (this.#client === undefined) return;
    const pending = this.store
      .read()
      .pendingTelemetryEvents.filter((q) => q.nextAttemptAt <= Date.now())
      .slice(0, 100);
    if (!pending.length) return;
    try {
      const response = await new Promise<unknown>((resolve, reject) =>
        this.#client?.emitProviderEvents(
          { providerId: this.options.providerId, events: pending.map((q) => q.event) },
          (e, v) => (e === null ? resolve(v) : reject(e)),
        ),
      );
      const accepted = ids(response);
      this.store.update((d) => {
        d.pendingTelemetryEvents = d.pendingTelemetryEvents.filter(
          (q) => !accepted.has(q.event.providerEventId),
        );
      });
    } catch {
      this.store.update((d) => {
        for (const q of d.pendingTelemetryEvents) {
          if (pending.some((p) => p.event.providerEventId === q.event.providerEventId)) {
            q.attempts++;
            q.nextAttemptAt = Date.now() + Math.min(30000, 500 * 2 ** Math.min(q.attempts, 6));
          }
        }
      });
    }
  }
}
export class NoopClimateTelemetry implements ClimateTelemetry {
  observed(): Promise<void> {
    return Promise.resolve();
  }
  progress(): Promise<void> {
    return Promise.resolve();
  }
}
function event(
  provider: string,
  entity: string,
  state: NormalizedClimateState,
  type: "RESOURCE_STATE" | "RESOURCE_METRIC" | "RESOURCE_HEALTH",
  payload: Record<string, unknown>,
  attributes: Record<string, unknown>,
): Omit<ProviderTelemetryEventInput, "providerEventSequence"> {
  return {
    providerEventId: id(provider, entity, state.observedAt, type, payload),
    eventType: type,
    resourceId: state.resourceId,
    resourceType: "home_assistant.climate",
    taskId: "",
    externalExecutionId: "",
    operationName: "",
    occurredAt: timestamp(state.observedAt),
    attributes,
    payload,
    traceparent: "",
    tracestate: "",
  };
}
export function stableClimateEventId(
  provider: string,
  entity: string,
  observed: string,
  type: string,
  payload: Record<string, unknown>,
): string {
  return id(provider, entity, observed, type, payload);
}
function id(p: string, e: string, o: string, t: string, v: unknown): string {
  return createHash("sha256")
    .update(`${p}\n${e}\n${o}\n${t}\n${canonical(v)}`)
    .digest("hex");
}
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object" && v !== null)
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
function timestamp(value: string): { seconds: string; nanos: number } {
  const ms = Date.parse(value);
  return { seconds: String(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1e6 };
}
function ids(v: unknown): Set<string> {
  if (typeof v !== "object" || v === null || !("results" in v) || !Array.isArray(v.results))
    return new Set();
  return new Set(
    (v.results as unknown[])
      .filter((x): x is { providerEventId: string } => {
        if (typeof x !== "object" || x === null) return false;
        const r = x as Record<string, unknown>;
        return (
          (r.accepted === true || r.duplicate === true) && typeof r.providerEventId === "string"
        );
      })
      .map((x) => x.providerEventId),
  );
}
function credentials(o: {
  tlsMode: "disabled" | "required";
  caPath?: string;
  certPath?: string;
  keyPath?: string;
}): grpc.ChannelCredentials {
  if (o.tlsMode === "disabled") return grpc.credentials.createInsecure();
  if (!o.caPath || !o.certPath || !o.keyPath)
    throw new Error("PROVIDER_TELEMETRY_MTLS_FILES_REQUIRED");
  return grpc.credentials.createSsl(
    readFileSync(o.caPath),
    readFileSync(o.keyPath),
    readFileSync(o.certPath),
  );
}
