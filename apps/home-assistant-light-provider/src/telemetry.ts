import * as grpc from "@grpc/grpc-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  telemetryClientConstructor,
  type ProviderTelemetryEventInput,
} from "../../../packages/provider-telemetry/src/index.js";
import type { LightResourceRegistry } from "./resources.js";
import type { LightStore } from "./store.js";
import type { LightExecution, NormalizedLightState } from "./types.js";

interface Client extends grpc.Client {
  emitProviderEvents(
    request: unknown,
    callback: (error: grpc.ServiceError | null, response: unknown) => void,
  ): grpc.ClientUnaryCall;
}
export interface LightTelemetry {
  observed(state: NormalizedLightState): Promise<void>;
  progress(execution: LightExecution): Promise<void>;
}

export class ProviderLightTelemetry implements LightTelemetry {
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
    readonly registry: LightResourceRegistry,
    readonly store: LightStore,
  ) {
    if (options.enabled) {
      const Constructor = telemetryClientConstructor();
      this.#client = new Constructor(options.endpoint, credentials(options)) as unknown as Client;
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
  async observed(state: NormalizedLightState): Promise<void> {
    const entity = this.registry.require(state.resourceId).entityId;
    this.#enqueue(
      event(
        this.options.providerId,
        entity,
        state,
        "RESOURCE_STATE",
        { state: state.power, reasonCode: "HOME_ASSISTANT_STATE_CHANGED" },
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
          health: state.reachable ? "healthy" : "offline",
          reasonCode: state.reachable ? "HOME_ASSISTANT_REACHABLE" : "HOME_ASSISTANT_UNREACHABLE",
        },
        {},
      ),
    );
    if (state.brightnessPercent !== null)
      this.#enqueue(
        event(
          this.options.providerId,
          entity,
          state,
          "RESOURCE_METRIC",
          {
            metricName: "brightness_percent",
            value: state.brightnessPercent,
            unit: "percent",
            quality: "observed",
          },
          {},
        ),
      );
    await this.flush();
  }
  async progress(execution: LightExecution): Promise<void> {
    const payload = {
      current: execution.state === "SUCCEEDED" ? 1 : 0,
      total: 1,
      percentage: execution.state === "SUCCEEDED" ? 100 : 0,
      unit: "confirmation",
    };
    this.#enqueue({
      providerEventId: id(
        this.options.providerId,
        execution.entityId,
        `${execution.taskId}:${String(execution.revision)}`,
        "EXECUTION_PROGRESS",
        payload,
      ),
      eventType: "EXECUTION_PROGRESS",
      resourceId: execution.resourceId,
      resourceType: "home_assistant.light",
      taskId: execution.taskId,
      externalExecutionId: execution.externalExecutionId,
      operationName: execution.operationName,
      occurredAt: timestamp(execution.updatedAt),
      attributes: {},
      payload,
      traceparent: "",
      tracestate: "",
    });
    await this.flush();
  }
  #enqueue(input: Omit<ProviderTelemetryEventInput, "providerEventSequence">): void {
    this.store.update((document) => {
      const complete = {
        ...input,
        providerEventSequence: String(document.nextTelemetrySequence++),
      };
      if (complete.eventType === "RESOURCE_METRIC")
        document.pendingTelemetryEvents = document.pendingTelemetryEvents.filter(
          (q) =>
            !(
              q.event.eventType === "RESOURCE_METRIC" &&
              q.event.resourceId === complete.resourceId &&
              q.event.payload.metricName === complete.payload.metricName
            ),
        );
      document.pendingTelemetryEvents.push({ event: complete, attempts: 0, nextAttemptAt: 0 });
      while (document.pendingTelemetryEvents.length > 1000) document.pendingTelemetryEvents.shift();
    });
  }
  async flush(): Promise<void> {
    if (this.#client === undefined) return;
    const pending = this.store
      .read()
      .pendingTelemetryEvents.filter((item) => item.nextAttemptAt <= Date.now())
      .slice(0, 100);
    if (pending.length === 0) return;
    try {
      const response = await new Promise<unknown>((resolve, reject) =>
        this.#client?.emitProviderEvents(
          { providerId: this.options.providerId, events: pending.map((item) => item.event) },
          (error, value) => (error === null ? resolve(value) : reject(error)),
        ),
      );
      const accepted = ids(response);
      this.store.update((document) => {
        document.pendingTelemetryEvents = document.pendingTelemetryEvents.filter(
          (item) => !accepted.has(item.event.providerEventId),
        );
      });
    } catch {
      this.store.update((document) => {
        for (const item of document.pendingTelemetryEvents)
          if (
            pending.some(
              (candidate) => candidate.event.providerEventId === item.event.providerEventId,
            )
          ) {
            item.attempts += 1;
            item.nextAttemptAt =
              Date.now() + Math.min(30_000, 500 * 2 ** Math.min(item.attempts, 6));
          }
      });
    }
  }
}

export class NoopLightTelemetry implements LightTelemetry {
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
  state: NormalizedLightState,
  type: "RESOURCE_STATE" | "RESOURCE_METRIC" | "RESOURCE_HEALTH",
  payload: Record<string, unknown>,
  attributes: Record<string, unknown>,
): Omit<ProviderTelemetryEventInput, "providerEventSequence"> {
  return {
    providerEventId: id(provider, entity, state.observedAt, type, payload),
    eventType: type,
    resourceId: state.resourceId,
    resourceType: "home_assistant.light",
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
function id(
  provider: string,
  entity: string,
  observed: string,
  type: string,
  value: unknown,
): string {
  return createHash("sha256")
    .update(`${provider}\n${entity}\n${observed}\n${type}\n${JSON.stringify(value)}`)
    .digest("hex");
}
function timestamp(value: string): { seconds: string; nanos: number } {
  const milliseconds = Date.parse(value);
  return { seconds: String(Math.floor(milliseconds / 1000)), nanos: (milliseconds % 1000) * 1e6 };
}
function ids(value: unknown): Set<string> {
  if (
    typeof value !== "object" ||
    value === null ||
    !("results" in value) ||
    !Array.isArray(value.results)
  )
    return new Set();
  return new Set(
    value.results
      .filter(
        (item): item is { accepted?: boolean; duplicate?: boolean; providerEventId: string } =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).providerEventId === "string" &&
          ((item as Record<string, unknown>).accepted === true ||
            (item as Record<string, unknown>).duplicate === true),
      )
      .map((item) => item.providerEventId),
  );
}
function credentials(options: {
  tlsMode: "disabled" | "required";
  caPath?: string;
  certPath?: string;
  keyPath?: string;
}): grpc.ChannelCredentials {
  if (options.tlsMode === "disabled") return grpc.credentials.createInsecure();
  if (!options.caPath || !options.certPath || !options.keyPath)
    throw new Error("PROVIDER_TELEMETRY_MTLS_FILES_REQUIRED");
  return grpc.credentials.createSsl(
    readFileSync(options.caPath),
    readFileSync(options.keyPath),
    readFileSync(options.certPath),
  );
}
