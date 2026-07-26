import * as grpc from "@grpc/grpc-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Pool, PoolClient } from "pg";
import { RUNTIME_VERSION } from "../../domain/src/index.js";
import { createProviderOpsEnvelope, TelemetrySanitizer } from "../../observability/src/index.js";
import type { CanonicalJsonValue } from "../../observability/src/index.js";
import {
  captureProviderOpsDelivery,
  TaskRepository,
} from "../../persistence-postgres/src/index.js";
import { telemetryServiceDefinition } from "./proto.js";
import type {
  EmitProviderEventsRequest,
  EmitProviderEventsResponse,
  ProviderTelemetryEventInput,
  ProviderTelemetryEventResult,
  ProviderTelemetryEventType,
} from "./types.js";

export interface ProviderTelemetryIngressOptions {
  providerId: string;
  runtimeVersion?: string;
  instanceId: string;
  maxBatch?: number;
  maxEventBytes?: number;
  maxDepth?: number;
  maxNodes?: number;
  maxAttributeKeyLength?: number;
  maxResourceIdLength?: number;
  maxTimestampSkewMs?: number;
  rateLimit?: number;
  rateLimitWindowMs?: number;
  traceEvent?: <T>(
    traceContext: {
      providerTraceparent?: string;
      providerTracestate?: string;
      taskTraceparent?: string;
      taskTracestate?: string;
      eventType: string;
    },
    operation: () => Promise<T>,
  ) => Promise<T>;
}

export class ProviderTelemetryIngress {
  readonly #taskRepository: TaskRepository;
  readonly #sanitizer: TelemetrySanitizer;
  readonly #windows = new Map<string, { startedAt: number; count: number }>();

  constructor(
    readonly pool: Pool,
    readonly options: ProviderTelemetryIngressOptions,
  ) {
    this.#taskRepository = new TaskRepository(pool);
    const maxEventBytes = options.maxEventBytes ?? 65_536;
    this.#sanitizer = new TelemetrySanitizer({
      maxDepth: options.maxDepth ?? 16,
      maxNodes: options.maxNodes ?? 4_096,
      maxStringBytes: Math.min(4_096, maxEventBytes),
      maxTotalBytes: maxEventBytes,
    });
  }

  async emit(
    authenticatedProviderId: string,
    request: EmitProviderEventsRequest,
  ): Promise<EmitProviderEventsResponse> {
    if (request.events.length > (this.options.maxBatch ?? 100)) {
      return {
        results: request.events.map((event) => rejected(event, "PROVIDER_EVENT_BATCH_TOO_LARGE")),
      };
    }
    if (!this.#consume(authenticatedProviderId, request.events.length)) {
      return {
        results: request.events.map((event) => rejected(event, "PROVIDER_EVENT_RATE_LIMITED")),
      };
    }
    if (
      authenticatedProviderId !== this.options.providerId ||
      request.providerId !== this.options.providerId
    ) {
      return {
        results: request.events.map((event) => rejected(event, "PROVIDER_IDENTITY_MISMATCH")),
      };
    }
    const results: ProviderTelemetryEventResult[] = [];
    for (const event of request.events) results.push(await this.#accept(event));
    return { results };
  }

  async #accept(event: ProviderTelemetryEventInput): Promise<ProviderTelemetryEventResult> {
    const invalid = this.#validate(event);
    if (invalid !== null) return rejected(event, invalid);
    const occurredAt = timestampToDate(event.occurredAt);
    const task =
      event.taskId.length === 0 ? null : await this.#taskRepository.getById(event.taskId);
    if (event.taskId.length > 0 && task === null) {
      return rejected(event, "PROVIDER_EVENT_TASK_NOT_FOUND");
    }
    if (task !== null) {
      if (task.providerId !== this.options.providerId) {
        return rejected(event, "PROVIDER_IDENTITY_MISMATCH");
      }
      if (event.externalExecutionId !== task.externalExecutionId) {
        return rejected(event, "PROVIDER_EVENT_EXECUTION_ID_MISMATCH");
      }
      if (event.operationName !== task.operationName) {
        return rejected(event, "PROVIDER_EVENT_OPERATION_MISMATCH");
      }
    }
    const eventCategory = eventCategoryFor(event.eventType as ProviderTelemetryEventType);
    const sanitizedAttributes = this.#sanitizer.sanitize(event.attributes) as CanonicalJsonValue;
    const sanitizedPayload = sanitizeProviderPayload(
      event.eventType as ProviderTelemetryEventType,
      event.payload,
      this.#sanitizer,
    ) as CanonicalJsonValue;
    const authoritativeExternalExecutionId = task?.externalExecutionId;
    const authoritativeSimulationId = task?.simulationId;
    const providerTrace = contextFromTraceparent(event.traceparent);
    const traceId = providerTrace?.traceId ?? task?.traceId ?? undefined;
    const envelope = createProviderOpsEnvelope({
      recordType: `provider.${eventCategory}`,
      eventCategory,
      deliveryClass: "audit",
      providerId: this.options.providerId,
      runtimeVersion: this.options.runtimeVersion ?? RUNTIME_VERSION,
      instanceId: this.options.instanceId,
      ...(event.taskId.length === 0 ? {} : { taskId: event.taskId }),
      resourceId: event.resourceId,
      resourceType: event.resourceType,
      ...(authoritativeExternalExecutionId === undefined ||
      authoritativeExternalExecutionId === null
        ? {}
        : { externalExecutionId: authoritativeExternalExecutionId }),
      ...(task === null ? {} : { operationName: task.operationName }),
      ...(task === null ? {} : { executionMode: task.executionMode }),
      ...(authoritativeSimulationId === undefined || authoritativeSimulationId === null
        ? {}
        : { simulationId: authoritativeSimulationId }),
      ...(task === null ? {} : { argumentHash: task.argumentHash }),
      ...(task === null ? {} : { authorizationContextHash: task.authorizationContextHash }),
      ...(task === null ? {} : { adapterRevision: String(task.adapterRevision) }),
      ...(task === null ? {} : { observationRevision: task.observationRevision }),
      providerEventId: event.providerEventId,
      providerEventSequence: Number(event.providerEventSequence),
      eventType: eventCategory,
      ...(traceId === undefined ? {} : { traceId }),
      ...(providerTrace === undefined ? {} : { spanId: providerTrace.spanId }),
      stableAggregateIdentity: task?.taskId ?? event.resourceId,
      eventIdentity: `${this.options.providerId}:${event.providerEventId}`,
      revision: event.providerEventSequence,
      occurredAt,
      attributes: {
        ...(sanitizedAttributes as Record<string, CanonicalJsonValue>),
        ...(event.traceparent.length === 0 ? {} : { traceparent: event.traceparent }),
        ...(event.tracestate.length === 0 ? {} : { tracestate: event.tracestate }),
        ...(task?.traceId === undefined || task.traceId === null
          ? {}
          : { linkedTaskTraceId: task.traceId }),
      },
      payload: sanitizedPayload,
    });
    const eventKey = `provider:${this.options.providerId}:${event.providerEventId}`;
    const persist = async (): Promise<ProviderTelemetryEventResult> => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const duplicate = await existingRecord(client, eventKey);
        if (duplicate !== undefined) {
          await client.query("ROLLBACK");
          if (duplicate.recordHash !== envelope.recordHash) {
            return rejected(event, "PROVIDER_EVENT_ID_CONFLICT");
          }
          return accepted(event, duplicate.recordId, true);
        }
        const inserted = await captureProviderOpsDelivery(client, {
          envelope,
          eventKey,
          aggregateType: task === null ? "provider" : "task",
          aggregateId: task?.taskId ?? event.resourceId,
        });
        if (!inserted) {
          const concurrent = await existingRecord(client, eventKey);
          await client.query("ROLLBACK");
          if (concurrent?.recordHash !== envelope.recordHash) {
            return rejected(event, "PROVIDER_EVENT_ID_CONFLICT");
          }
          return accepted(event, concurrent.recordId, true);
        }
        await client.query("COMMIT");
        return accepted(event, envelope.recordId, false);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        return rejected(event, "PROVIDER_EVENT_PERSISTENCE_FAILED", safeErrorName(error));
      } finally {
        client.release();
      }
    };
    const traceContext = {
      ...(event.traceparent.length === 0 ? {} : { providerTraceparent: event.traceparent }),
      ...(event.tracestate.length === 0 ? {} : { providerTracestate: event.tracestate }),
      ...(task?.rootTraceparent === undefined || task.rootTraceparent === null
        ? {}
        : { taskTraceparent: task.rootTraceparent }),
      ...(task?.rootTracestate === undefined || task.rootTracestate === null
        ? {}
        : { taskTracestate: task.rootTracestate }),
      eventType: eventCategory,
    };
    return this.options.traceEvent?.(traceContext, persist) ?? persist();
  }

  #validate(event: ProviderTelemetryEventInput): string | null {
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(event.providerEventId)) return "PROVIDER_EVENT_ID_INVALID";
    const sequence = Number(event.providerEventSequence);
    if (!Number.isSafeInteger(sequence) || sequence < 0) return "PROVIDER_EVENT_SEQUENCE_INVALID";
    if (!allowedEventTypes.has(event.eventType)) return "PROVIDER_EVENT_TYPE_INVALID";
    if (event.traceparent.length > 0 && contextFromTraceparent(event.traceparent) === undefined) {
      return "PROVIDER_EVENT_TRACEPARENT_INVALID";
    }
    if (event.tracestate.length > 512 || /[\r\n]/.test(event.tracestate)) {
      return "PROVIDER_EVENT_TRACESTATE_INVALID";
    }
    if (event.eventType === "EXECUTION_PROGRESS" && event.taskId.length === 0) {
      return "PROVIDER_EVENT_TASK_REQUIRED";
    }
    if (event.taskId.length === 0 && event.resourceId.length === 0) {
      return "PROVIDER_EVENT_RESOURCE_REQUIRED";
    }
    if (event.resourceId.length > (this.options.maxResourceIdLength ?? 512)) {
      return "PROVIDER_EVENT_RESOURCE_ID_TOO_LONG";
    }
    if (
      Object.keys(event.attributes).some(
        (key) => key.length > (this.options.maxAttributeKeyLength ?? 128),
      )
    ) {
      return "PROVIDER_EVENT_ATTRIBUTE_KEY_TOO_LONG";
    }
    if (Buffer.byteLength(JSON.stringify(event), "utf8") > (this.options.maxEventBytes ?? 65_536)) {
      return "PROVIDER_EVENT_TOO_LARGE";
    }
    const shape = jsonShape([event.attributes, event.payload]);
    if (shape.depth > (this.options.maxDepth ?? 16)) return "PROVIDER_EVENT_TOO_DEEP";
    if (shape.nodes > (this.options.maxNodes ?? 4_096)) return "PROVIDER_EVENT_TOO_COMPLEX";
    const occurredAt = timestampToDate(event.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) return "PROVIDER_EVENT_TIMESTAMP_INVALID";
    if (
      Math.abs(Date.now() - occurredAt.getTime()) > (this.options.maxTimestampSkewMs ?? 86_400_000)
    ) {
      return "PROVIDER_EVENT_TIMESTAMP_OUT_OF_RANGE";
    }
    return null;
  }

  #consume(providerId: string, amount: number): boolean {
    const now = Date.now();
    const windowMs = this.options.rateLimitWindowMs ?? 60_000;
    let window = this.#windows.get(providerId);
    if (window === undefined || now - window.startedAt >= windowMs) {
      window = { startedAt: now, count: 0 };
      this.#windows.set(providerId, window);
    }
    window.count += amount;
    return window.count <= (this.options.rateLimit ?? 600);
  }
}

export interface ProviderTelemetryGrpcServerOptions {
  host: string;
  port: number;
  tlsMode: "disabled" | "required";
  tlsCaPath?: string;
  tlsCertPath?: string;
  tlsKeyPath?: string;
}

export class ProviderTelemetryGrpcServer {
  readonly #server = new grpc.Server();
  #started = false;

  constructor(
    readonly ingress: ProviderTelemetryIngress,
    readonly options: ProviderTelemetryGrpcServerOptions,
  ) {
    this.#server.addService(telemetryServiceDefinition(), {
      emitProviderEvents: (
        call: grpc.ServerUnaryCall<EmitProviderEventsRequest, EmitProviderEventsResponse>,
        callback: grpc.sendUnaryData<EmitProviderEventsResponse>,
      ) => {
        const identity = providerIdentity(call, options.tlsMode);
        void ingress
          .emit(identity, call.request)
          .then((response) => callback(null, response))
          .catch((error: unknown) => callback(serviceError(error)));
      },
    });
  }

  start(): Promise<number> {
    if (this.#started) return Promise.reject(new Error("PROVIDER_TELEMETRY_ALREADY_STARTED"));
    return new Promise((resolve, reject) => {
      this.#server.bindAsync(
        `${this.options.host}:${String(this.options.port)}`,
        serverCredentials(this.options),
        (error, port) => {
          if (error !== null) reject(error);
          else {
            this.#started = true;
            resolve(port);
          }
        },
      );
    });
  }

  close(): Promise<void> {
    if (!this.#started) return Promise.resolve();
    return new Promise((resolve) => this.#server.tryShutdown(() => resolve()));
  }
}

const allowedEventTypes = new Set([
  "RESOURCE_STATE",
  "RESOURCE_METRIC",
  "RESOURCE_HEALTH",
  "EXECUTION_PROGRESS",
]);

function eventCategoryFor(type: ProviderTelemetryEventType): string {
  return type.toLowerCase().replaceAll("_", ".");
}

function sanitizeProviderPayload(
  eventType: ProviderTelemetryEventType,
  payload: Record<string, unknown>,
  sanitizer: TelemetrySanitizer,
): Record<string, unknown> {
  const allowedFields: Record<ProviderTelemetryEventType, readonly string[]> = {
    RESOURCE_STATE: ["state", "reasonCode", "attributes"],
    RESOURCE_METRIC: ["metricName", "value", "unit", "quality"],
    RESOURCE_HEALTH: ["health", "reasonCode"],
    EXECUTION_PROGRESS: ["current", "total", "percentage", "unit"],
  };
  const selected = Object.fromEntries(
    allowedFields[eventType]
      .filter((key) => Object.hasOwn(payload, key))
      .map((key) => [key, payload[key]]),
  );
  const sanitized = sanitizer.sanitize(selected);
  return isRecord(sanitized) ? sanitized : {};
}

function timestampToDate(timestamp: ProviderTelemetryEventInput["occurredAt"]): Date {
  if (timestamp === undefined || timestamp === null) return new Date(Number.NaN);
  return new Date(Number(timestamp.seconds) * 1_000 + Math.floor(timestamp.nanos / 1_000_000));
}

function contextFromTraceparent(
  traceparent: string,
): { traceId: string; spanId: string } | undefined {
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(traceparent);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  if (/^0+$/.test(match[1]) || /^0+$/.test(match[2])) return undefined;
  return { traceId: match[1], spanId: match[2] };
}

function jsonShape(value: unknown, depth = 1): { depth: number; nodes: number } {
  if (value === null || typeof value !== "object") return { depth, nodes: 1 };
  const children = Array.isArray(value) ? value : Object.values(value);
  let maximumDepth = depth;
  let nodes = 1;
  for (const child of children) {
    const shape = jsonShape(child, depth + 1);
    maximumDepth = Math.max(maximumDepth, shape.depth);
    nodes += shape.nodes;
  }
  return { depth: maximumDepth, nodes };
}

async function existingRecord(
  client: PoolClient,
  eventKey: string,
): Promise<{ recordId: string; recordHash: string } | undefined> {
  const result = await client.query<{ record_id: string; record_body: { recordHash: string } }>(
    "SELECT record_id,record_body FROM provider_ops_delivery WHERE event_key=$1 FOR UPDATE",
    [eventKey],
  );
  const row = result.rows[0];
  return row === undefined
    ? undefined
    : { recordId: row.record_id, recordHash: row.record_body.recordHash };
}

function accepted(
  event: ProviderTelemetryEventInput,
  recordId: string,
  duplicate: boolean,
): ProviderTelemetryEventResult {
  return {
    providerEventId: event.providerEventId,
    accepted: true,
    duplicate,
    recordId,
    reasonCode: "",
    message: "",
  };
}

function rejected(
  event: ProviderTelemetryEventInput,
  reasonCode: string,
  message = "",
): ProviderTelemetryEventResult {
  return {
    providerEventId: event.providerEventId,
    accepted: false,
    duplicate: false,
    recordId: "",
    reasonCode,
    message,
  };
}

function providerIdentity(
  call: grpc.ServerUnaryCall<EmitProviderEventsRequest, EmitProviderEventsResponse>,
  tlsMode: "disabled" | "required",
): string {
  if (tlsMode === "disabled") return call.request.providerId;
  const auth = call.getAuthContext() as unknown as { x509_common_name?: unknown };
  const commonName = auth.x509_common_name;
  if (Array.isArray(commonName)) return String(commonName[0] ?? "");
  return typeof commonName === "string" ? commonName : "";
}

function serverCredentials(options: ProviderTelemetryGrpcServerOptions): grpc.ServerCredentials {
  if (options.tlsMode === "disabled") return grpc.ServerCredentials.createInsecure();
  if (
    options.tlsCaPath === undefined ||
    options.tlsCertPath === undefined ||
    options.tlsKeyPath === undefined
  ) {
    throw new Error("PROVIDER_TELEMETRY_MTLS_FILES_REQUIRED");
  }
  return grpc.ServerCredentials.createSsl(
    readFileSync(options.tlsCaPath),
    [
      {
        private_key: readFileSync(options.tlsKeyPath),
        cert_chain: readFileSync(options.tlsCertPath),
      },
    ],
    true,
  );
}

function serviceError(error: unknown): grpc.ServiceError {
  const message = safeErrorName(error);
  return Object.assign(new Error(message), {
    code: grpc.status.INTERNAL,
    details: message,
    metadata: new grpc.Metadata(),
  });
}

function safeErrorName(error: unknown): string {
  const name = error instanceof Error ? error.name : "unknown";
  return createHash("sha256").update(name).digest("hex").slice(0, 16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
