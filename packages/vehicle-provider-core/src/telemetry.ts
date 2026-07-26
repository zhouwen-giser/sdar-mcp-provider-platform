import * as grpc from "@grpc/grpc-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  telemetryClientConstructor,
  type ProviderTelemetryEventInput,
} from "../../provider-telemetry/src/index.js";

interface Client extends grpc.Client {
  emitProviderEvents(
    request: unknown,
    callback: (error: grpc.ServiceError | null, response: unknown) => void,
  ): grpc.ClientUnaryCall;
}
const EVENT_TYPES = new Set([
  "RESOURCE_STATE",
  "RESOURCE_HEALTH",
  "EXECUTION_PROGRESS",
  "PROVIDER_DIAGNOSTIC",
]);

export class VehicleTelemetry {
  readonly #client: Client | undefined;
  #sequence = 1;
  readonly records: ProviderTelemetryEventInput[] = [];
  constructor(
    readonly options: {
      providerId: string;
      resourceId: string;
      resourceType: string;
      enabled: boolean;
      endpoint: string;
      tlsMode: "disabled" | "required";
      caPath?: string;
      certPath?: string;
      keyPath?: string;
    },
  ) {
    if (options.enabled) {
      const Constructor = telemetryClientConstructor();
      this.#client = new Constructor(options.endpoint, credentials(options)) as unknown as Client;
    }
  }
  async emit(
    eventType: "RESOURCE_STATE" | "RESOURCE_HEALTH" | "EXECUTION_PROGRESS" | "PROVIDER_DIAGNOSTIC",
    payload: Record<string, unknown>,
    context: { taskId?: string; externalExecutionId?: string; operationName?: string } = {},
  ): Promise<void> {
    if (!EVENT_TYPES.has(eventType)) throw new Error("VEHICLE_TELEMETRY_EVENT_TYPE_INVALID");
    const occurredAt = new Date().toISOString();
    const wireEventType = eventType === "PROVIDER_DIAGNOSTIC" ? "RESOURCE_STATE" : eventType;
    const event: ProviderTelemetryEventInput = {
      providerEventId: createHash("sha256")
        .update(`${eventType}\0${occurredAt}\0${String(this.#sequence)}`)
        .digest("hex"),
      providerEventSequence: String(this.#sequence++),
      eventType: wireEventType,
      resourceId: this.options.resourceId,
      resourceType: this.options.resourceType,
      taskId: context.taskId ?? "",
      externalExecutionId: context.externalExecutionId ?? "",
      operationName: context.operationName ?? "",
      occurredAt: timestamp(occurredAt),
      attributes: {},
      payload: boundedPayload(payload),
      traceparent: "",
      tracestate: "",
    };
    this.records.push(structuredClone(event));
    if (this.#client === undefined) return;
    try {
      await new Promise<void>((resolve, reject) =>
        this.#client?.emitProviderEvents(
          { providerId: this.options.providerId, events: [event] },
          (error) => (error === null ? resolve() : reject(error)),
        ),
      );
    } catch {
      // Telemetry is non-authoritative and cannot change execution state.
    }
  }
  close(): void {
    this.#client?.close();
  }
}

function boundedPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const forbidden = new Set([
    "taskid",
    "targetid",
    "missionid",
    "rawpayload",
    "rawreason",
    "hit",
    "miss",
    "destroyed",
    "damage",
    "referee",
    "verdict",
  ]);
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value))
        if (!forbidden.has(key.toLowerCase().replaceAll("_", ""))) result[key] = visit(child);
      return result;
    }
    return value;
  };
  return visit(payload) as Record<string, unknown>;
}
function timestamp(value: string): { seconds: string; nanos: number } {
  const milliseconds = Date.parse(value);
  return {
    seconds: String(Math.floor(milliseconds / 1000)),
    nanos: (milliseconds % 1000) * 1_000_000,
  };
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
