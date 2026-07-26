import * as grpc from "@grpc/grpc-js";
import { randomUUID } from "node:crypto";
import { telemetryClientConstructor } from "../../../packages/provider-telemetry/src/index.js";

export type ProviderTelemetryEventType =
  "RESOURCE_STATE" | "RESOURCE_METRIC" | "RESOURCE_HEALTH" | "EXECUTION_PROGRESS";

export interface ProviderTelemetryExampleEvent {
  providerEventId: string;
  providerEventSequence: string;
  eventType: ProviderTelemetryEventType;
  resourceId: string;
  resourceType: string;
  taskId?: string;
  externalExecutionId?: string;
  operationName?: string;
  occurredAt: { seconds: string; nanos: number };
  attributes: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export interface TaskTelemetryBinding {
  taskId: string;
  externalExecutionId: string;
  operationName: string;
}

export interface ProviderTelemetryClientOptions {
  endpoint: string;
  providerId: string;
  rootCertificate?: Buffer;
  clientCertificate?: Buffer;
  clientKey?: Buffer;
}

interface ProviderTelemetryGrpcClient extends grpc.Client {
  emitProviderEvents(
    request: Record<string, unknown>,
    callback: (error: grpc.ServiceError | null, response: unknown) => void,
  ): grpc.ClientUnaryCall;
}

export class MockProviderTelemetryClient {
  readonly #providerId: string;
  readonly #client: ProviderTelemetryGrpcClient;

  constructor(options: ProviderTelemetryClientOptions) {
    this.#providerId = options.providerId;
    const Client = telemetryClientConstructor();
    const credentials =
      options.rootCertificate === undefined
        ? grpc.credentials.createInsecure()
        : grpc.credentials.createSsl(
            options.rootCertificate,
            options.clientKey,
            options.clientCertificate,
          );
    this.#client = new Client(
      options.endpoint,
      credentials,
    ) as unknown as ProviderTelemetryGrpcClient;
  }

  emit(events: ProviderTelemetryExampleEvent[]): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      this.#client.emitProviderEvents(
        { providerId: this.#providerId, events },
        (error, response) => {
          if (error === null) resolve(response as Record<string, unknown>);
          else reject(error);
        },
      );
    });
  }

  async emitWithDuplicateRetry(
    events: ProviderTelemetryExampleEvent[],
  ): Promise<[Record<string, unknown>, Record<string, unknown>]> {
    const first = await this.emit(events);
    const duplicate = await this.emit(events);
    return [first, duplicate];
  }

  close(): void {
    this.#client.close();
  }
}

export function providerTelemetryExampleEvents(
  binding?: TaskTelemetryBinding,
): ProviderTelemetryExampleEvent[] {
  const occurredAt = timestampNow();
  const resourceId = "mock-resource-1";
  const base = (eventType: ProviderTelemetryEventType, payload: Record<string, unknown>) => ({
    providerEventId: randomUUID(),
    providerEventSequence: "1",
    eventType,
    resourceId,
    resourceType: "mock.resource",
    occurredAt,
    attributes: { source: "typescript-example" },
    payload,
  });
  const events: ProviderTelemetryExampleEvent[] = [
    base("RESOURCE_STATE", { state: "ready", reasonCode: "RESOURCE_READY" }),
    base("RESOURCE_METRIC", { metricName: "utilization", value: 0.42, unit: "ratio" }),
    base("RESOURCE_HEALTH", { health: "healthy", reasonCode: "CHECK_OK" }),
  ];
  if (binding !== undefined) {
    events.push({
      ...base("EXECUTION_PROGRESS", { current: 4, total: 10, percentage: 40, unit: "items" }),
      ...binding,
    });
  }
  return events.map((event, index) => ({ ...event, providerEventSequence: String(index + 1) }));
}

function timestampNow(): { seconds: string; nanos: number } {
  const milliseconds = Date.now();
  return {
    seconds: String(Math.floor(milliseconds / 1_000)),
    nanos: (milliseconds % 1_000) * 1_000_000,
  };
}
