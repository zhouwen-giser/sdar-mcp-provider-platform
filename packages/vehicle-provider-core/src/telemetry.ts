import * as grpc from "@grpc/grpc-js";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  telemetryClientConstructor,
  type EmitProviderEventsRequest,
  type ProviderTelemetryEventInput,
  type ProviderTelemetryEventResult,
} from "../../provider-telemetry/src/index.js";

interface Client extends grpc.Client {
  emitProviderEvents(
    request: EmitProviderEventsRequest,
    options: grpc.CallOptions,
    callback: (error: grpc.ServiceError | null, response: unknown) => void,
  ): grpc.ClientUnaryCall;
}

export type VehicleTelemetryEventType =
  "RESOURCE_STATE" | "RESOURCE_HEALTH" | "RESOURCE_METRIC" | "EXECUTION_PROGRESS";
export type VehicleTelemetryInputEventType = VehicleTelemetryEventType | "PROVIDER_DIAGNOSTIC";

export interface VehicleTelemetryContext {
  taskId?: string;
  externalExecutionId?: string;
  operationName?: string;
  /** Provider-authoritative observation time; defaults to emission time. */
  observedAt?: string;
  attributes?: Record<string, unknown>;
}

export interface VehicleTelemetrySnapshot {
  enqueued: number;
  sent: number;
  accepted: number;
  duplicate: number;
  rejected: number;
  transportFailed: number;
  retry: number;
  dropped: number;
  queueDepth: number;
  queueCapacity: number;
  reasonCodes: Record<string, number>;
}

export interface VehicleTelemetryOutcome {
  kind: "accepted" | "duplicate" | "rejected" | "transport_failed" | "retry" | "dropped";
  amount: number;
  reasonCode: string;
  snapshot: VehicleTelemetrySnapshot;
}

export interface VehicleTelemetryTransport {
  emit(request: EmitProviderEventsRequest, timeoutMs: number): Promise<unknown>;
  close(): void;
}

export interface VehicleTelemetryOptions {
  providerId: string;
  resourceId: string;
  resourceType: string;
  enabled: boolean;
  endpoint: string;
  tlsMode: "disabled" | "required";
  caPath?: string;
  certPath?: string;
  keyPath?: string;
  maxQueueSize?: number;
  criticalQueueReserve?: number;
  maxBatchSize?: number;
  maximumAttempts?: number;
  retryBaseDelayMs?: number;
  retryMaximumDelayMs?: number;
  flushIntervalMs?: number;
  requestTimeoutMs?: number;
  closeDrainTimeoutMs?: number;
  historySize?: number;
  sessionId?: string;
  now?: () => Date;
  transport?: VehicleTelemetryTransport;
  onOutcome?: (outcome: VehicleTelemetryOutcome) => void;
}

interface QueuedEvent {
  event: ProviderTelemetryEventInput;
  attempts: number;
  nextAttemptAt: number;
  inFlight: boolean;
}

const EVENT_TYPES = new Set<VehicleTelemetryInputEventType>([
  "RESOURCE_STATE",
  "RESOURCE_HEALTH",
  "RESOURCE_METRIC",
  "EXECUTION_PROGRESS",
  "PROVIDER_DIAGNOSTIC",
]);
const RETRYABLE_REJECTIONS = new Set([
  "PROVIDER_EVENT_RATE_LIMITED",
  "PROVIDER_EVENT_PERSISTENCE_FAILED",
  // Provider start/progress can race the Runtime transaction that binds the
  // external execution identity. Retrying the same event ID is safe once that
  // authoritative Task identity becomes visible.
  "PROVIDER_EVENT_TASK_NOT_FOUND",
  "PROVIDER_EVENT_EXECUTION_ID_MISMATCH",
]);
const DEFAULT_MAX_QUEUE_SIZE = 1_000;
const DEFAULT_CRITICAL_QUEUE_RESERVE = 100;
const DEFAULT_MAX_BATCH_SIZE = 100;
const DEFAULT_MAXIMUM_ATTEMPTS = 4;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_RETRY_MAXIMUM_DELAY_MS = 5_000;
const DEFAULT_FLUSH_INTERVAL_MS = 100;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_CLOSE_DRAIN_TIMEOUT_MS = 5_000;
const DEFAULT_HISTORY_SIZE = 1_000;
const MINIMUM_DRAIN_ATTEMPT_MS = 10;

export class VehicleTelemetry {
  readonly #transport: VehicleTelemetryTransport | undefined;
  readonly #sessionId: string;
  readonly #queue: QueuedEvent[] = [];
  readonly #reasonCodes = new Map<string, number>();
  #sequence = 1;
  #timer: NodeJS.Timeout | undefined;
  #timerDueAt: number | undefined;
  #flushPromise: Promise<void> | undefined;
  #closePromise: Promise<void> | undefined;
  #closeKeepAlive: NodeJS.Timeout | undefined;
  #closing = false;
  #closed = false;
  readonly #counters = {
    enqueued: 0,
    sent: 0,
    accepted: 0,
    duplicate: 0,
    rejected: 0,
    transportFailed: 0,
    retry: 0,
    dropped: 0,
  };
  readonly records: ProviderTelemetryEventInput[] = [];

  constructor(readonly options: VehicleTelemetryOptions) {
    validateOptions(options);
    this.#sessionId = options.sessionId ?? randomUUID();
    if (options.enabled)
      this.#transport =
        options.transport ?? new GrpcVehicleTelemetryTransport(options.endpoint, options);
  }

  emit(
    eventType: VehicleTelemetryInputEventType,
    payload: Record<string, unknown>,
    context: VehicleTelemetryContext = {},
  ): Promise<void> {
    if (!EVENT_TYPES.has(eventType)) throw new Error("VEHICLE_TELEMETRY_EVENT_TYPE_INVALID");
    const normalized = normalizeTelemetryEvent(eventType, payload);
    const occurredAt = context.observedAt ?? (this.options.now?.() ?? new Date()).toISOString();
    if (Number.isNaN(Date.parse(occurredAt)))
      throw new Error("VEHICLE_TELEMETRY_OBSERVED_AT_INVALID");
    const sequence = this.#sequence++;
    const event: ProviderTelemetryEventInput = {
      providerEventId: createHash("sha256")
        .update(
          `${this.options.providerId}\0${this.options.resourceId}\0${this.#sessionId}\0${normalized.eventType}\0${String(sequence)}`,
        )
        .digest("hex"),
      providerEventSequence: String(sequence),
      eventType: normalized.eventType,
      resourceId: this.options.resourceId,
      resourceType: this.options.resourceType,
      taskId: context.taskId ?? "",
      externalExecutionId: context.externalExecutionId ?? "",
      operationName: context.operationName ?? "",
      occurredAt: timestamp(occurredAt),
      attributes: boundedPayload({ ...normalized.attributes, ...(context.attributes ?? {}) }),
      payload: boundedPayload(normalized.payload),
      traceparent: "",
      tracestate: "",
    };
    this.#record(event);
    if (this.#transport === undefined) return Promise.resolve();
    if (this.#closing || this.#closed) {
      this.#dropped(1, "PROVIDER_TELEMETRY_CLIENT_CLOSED");
      return Promise.resolve();
    }
    if (!this.#enqueue(event)) return Promise.resolve();
    this.#schedule(normalized.eventType === "EXECUTION_PROGRESS" ? 0 : this.#flushIntervalMs());
    return Promise.resolve();
  }

  metric(
    metricName: string,
    value: number,
    unit: string,
    quality: string,
    context: VehicleTelemetryContext = {},
  ): Promise<void> {
    if (!/^[a-z][a-z0-9_]{0,127}$/.test(metricName) || !Number.isFinite(value))
      throw new Error("VEHICLE_TELEMETRY_METRIC_INVALID");
    return this.emit("RESOURCE_METRIC", { metricName, value, unit, quality }, context);
  }

  snapshot(): VehicleTelemetrySnapshot {
    return {
      ...this.#counters,
      queueDepth: this.#queue.length,
      queueCapacity: this.#maxQueueSize() + this.#criticalQueueReserve(),
      reasonCodes: Object.fromEntries(
        [...this.#reasonCodes.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
    };
  }

  flush(): Promise<void> {
    return this.#runFlush(false, this.#requestTimeoutMs());
  }

  async #runFlush(force: boolean, requestTimeoutMs: number): Promise<void> {
    if (this.#transport === undefined || this.#closed) return;
    if (this.#flushPromise !== undefined) return this.#flushPromise;
    const operation = this.#flushBatch(force, requestTimeoutMs);
    this.#flushPromise = operation;
    try {
      await operation;
    } finally {
      if (this.#flushPromise === operation) this.#flushPromise = undefined;
      this.#scheduleNext();
    }
  }

  async drain(timeoutMs = this.#closeDrainTimeoutMs()): Promise<void> {
    if (this.#transport === undefined || this.#closed || this.#queue.length === 0) return;
    const deadline = Date.now() + timeoutMs;
    while (this.#queue.length > 0 && Date.now() < deadline) {
      if (this.#flushPromise !== undefined) {
        if (!(await settleWithin(this.#flushPromise, deadline - Date.now()))) break;
        continue;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs < MINIMUM_DRAIN_ATTEMPT_MS) break;
      await this.#runFlush(true, Math.min(this.#requestTimeoutMs(), remainingMs));
    }
  }

  close(): void {
    void this.closeAndDrain();
  }

  closeAndDrain(): Promise<void> {
    this.#closePromise ??= this.#close();
    return this.#closePromise;
  }

  async #close(): Promise<void> {
    if (this.#closed) return;
    this.#closing = true;
    this.#clearTimer();
    // Some protected legacy consumers call close() without awaiting the returned
    // Promise. Keep the event loop alive through the bounded drain deadline.
    this.#closeKeepAlive = setTimeout(() => undefined, this.#closeDrainTimeoutMs() + 1_000);
    try {
      await this.drain();
      if (this.#queue.length > 0) {
        const remaining = this.#queue.length;
        this.#queue.splice(0, remaining);
        this.#dropped(remaining, "PROVIDER_TELEMETRY_CLOSE_DRAIN_TIMEOUT");
      }
    } finally {
      this.#closed = true;
      try {
        this.#transport?.close();
      } finally {
        clearTimeout(this.#closeKeepAlive);
        this.#closeKeepAlive = undefined;
      }
    }
  }

  #enqueue(event: ProviderTelemetryEventInput): boolean {
    const maximum = this.#maxQueueSize();
    if (this.#queue.length >= maximum) {
      const incomingPriority = eventPriority(event);
      let replaceable = -1;
      let replaceablePriority = incomingPriority;
      for (const [index, queued] of this.#queue.entries()) {
        if (queued.inFlight) continue;
        const priority = eventPriority(queued.event);
        if (priority >= replaceablePriority) continue;
        replaceable = index;
        replaceablePriority = priority;
      }
      if (replaceable < 0) {
        const mayUseCriticalReserve =
          incomingPriority === 3 && this.#queue.length < maximum + this.#criticalQueueReserve();
        if (!mayUseCriticalReserve) {
          this.#dropped(1, "PROVIDER_TELEMETRY_QUEUE_FULL");
          return false;
        }
      } else {
        this.#queue.splice(replaceable, 1);
        this.#dropped(1, "PROVIDER_TELEMETRY_QUEUE_PRIORITY_EVICTION");
      }
    }
    this.#queue.push({ event, attempts: 0, nextAttemptAt: 0, inFlight: false });
    this.#counters.enqueued++;
    return true;
  }

  async #flushBatch(force: boolean, requestTimeoutMs = this.#requestTimeoutMs()): Promise<void> {
    if (this.#transport === undefined || this.#closed) return;
    this.#clearTimer();
    const now = Date.now();
    const pending = this.#queue
      .filter((queued) => !queued.inFlight && (force || queued.nextAttemptAt <= now))
      .slice(0, this.#maxBatchSize());
    if (pending.length === 0) return;
    for (const queued of pending) {
      queued.attempts++;
      queued.inFlight = true;
    }
    this.#counters.sent += pending.length;
    const request = {
      providerId: this.options.providerId,
      events: pending.map(({ event }) => event),
    };
    try {
      const raw = await withTimeout(
        this.#transport.emit(request, requestTimeoutMs),
        requestTimeoutMs,
      );
      const results = validateResults(raw, request.events);
      for (const queued of pending) {
        const result = results.get(queued.event.providerEventId);
        if (result === undefined)
          throw new VehicleTelemetryProtocolError("PROVIDER_TELEMETRY_RESULT_MISSING");
        this.#handleResult(queued, result);
      }
    } catch (error) {
      if (this.#deliveryClosed()) {
        for (const queued of pending) queued.inFlight = false;
        return;
      }
      const reasonCode =
        error instanceof VehicleTelemetryProtocolError
          ? error.reasonCode
          : "PROVIDER_TELEMETRY_TRANSPORT_FAILED";
      this.#counters.transportFailed += pending.length;
      this.#outcome("transport_failed", pending.length, reasonCode);
      for (const queued of pending) {
        queued.inFlight = false;
        this.#retryOrDrop(queued, reasonCode);
      }
    }
  }

  #handleResult(queued: QueuedEvent, result: ProviderTelemetryEventResult): void {
    if (this.#closed) return;
    queued.inFlight = false;
    if (result.accepted) {
      this.#remove(queued);
      if (result.duplicate) {
        this.#counters.duplicate++;
        this.#outcome("duplicate", 1, "PROVIDER_TELEMETRY_DUPLICATE_ACCEPTED");
      } else {
        this.#counters.accepted++;
        this.#outcome("accepted", 1, "PROVIDER_TELEMETRY_ACCEPTED");
      }
      return;
    }
    const reasonCode = stableReasonCode(result.reasonCode, "PROVIDER_TELEMETRY_REJECTED");
    this.#counters.rejected++;
    this.#outcome("rejected", 1, reasonCode);
    if (RETRYABLE_REJECTIONS.has(reasonCode)) this.#retryOrDrop(queued, reasonCode);
    else this.#remove(queued);
  }

  #retryOrDrop(queued: QueuedEvent, reasonCode: string): void {
    if (!this.#queue.includes(queued)) return;
    if (queued.attempts >= this.#maximumAttempts()) {
      this.#remove(queued);
      this.#dropped(1, "PROVIDER_TELEMETRY_RETRY_EXHAUSTED");
      return;
    }
    const exponent = Math.max(0, queued.attempts - 1);
    queued.nextAttemptAt =
      Date.now() + Math.min(this.#retryMaximumDelayMs(), this.#retryBaseDelayMs() * 2 ** exponent);
    this.#counters.retry++;
    this.#outcome("retry", 1, reasonCode);
  }

  #remove(queued: QueuedEvent): void {
    const index = this.#queue.indexOf(queued);
    if (index >= 0) this.#queue.splice(index, 1);
  }

  #dropped(amount: number, reasonCode: string): void {
    this.#counters.dropped += amount;
    this.#outcome("dropped", amount, reasonCode);
  }

  #outcome(kind: VehicleTelemetryOutcome["kind"], amount: number, reasonCode: string): void {
    this.#incrementReason(reasonCode, amount);
    try {
      this.options.onOutcome?.({ kind, amount, reasonCode, snapshot: this.snapshot() });
    } catch {
      // Telemetry client observability must not change Provider execution state.
    }
  }

  #incrementReason(reasonCode: string, amount = 1): void {
    this.#reasonCodes.set(reasonCode, (this.#reasonCodes.get(reasonCode) ?? 0) + amount);
  }

  #record(event: ProviderTelemetryEventInput): void {
    this.records.push(structuredClone(event));
    const overflow = this.records.length - this.#historySize();
    if (overflow > 0) this.records.splice(0, overflow);
  }

  #schedule(delayMs: number): void {
    if (this.#transport === undefined || this.#closing || this.#closed || this.#queue.length === 0)
      return;
    const dueAt = Date.now() + Math.max(0, delayMs);
    if (this.#timer !== undefined && (this.#timerDueAt ?? dueAt) <= dueAt) return;
    this.#clearTimer();
    this.#timerDueAt = dueAt;
    this.#timer = setTimeout(
      () => {
        this.#timer = undefined;
        this.#timerDueAt = undefined;
        void this.flush();
      },
      Math.max(0, dueAt - Date.now()),
    );
    this.#timer.unref();
  }

  #scheduleNext(): void {
    if (this.#queue.length === 0) return;
    const earliest = Math.min(...this.#queue.map(({ nextAttemptAt }) => nextAttemptAt));
    this.#schedule(Math.max(0, earliest - Date.now()));
  }

  #clearTimer(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#timerDueAt = undefined;
  }

  #maxQueueSize(): number {
    return this.options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  }

  #maxBatchSize(): number {
    return this.options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
  }

  #criticalQueueReserve(): number {
    return (
      this.options.criticalQueueReserve ??
      Math.min(DEFAULT_CRITICAL_QUEUE_RESERVE, this.#maxQueueSize())
    );
  }

  #maximumAttempts(): number {
    return this.options.maximumAttempts ?? DEFAULT_MAXIMUM_ATTEMPTS;
  }

  #retryBaseDelayMs(): number {
    return this.options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  }

  #retryMaximumDelayMs(): number {
    return this.options.retryMaximumDelayMs ?? DEFAULT_RETRY_MAXIMUM_DELAY_MS;
  }

  #flushIntervalMs(): number {
    return this.options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  }

  #requestTimeoutMs(): number {
    return this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  #closeDrainTimeoutMs(): number {
    return this.options.closeDrainTimeoutMs ?? DEFAULT_CLOSE_DRAIN_TIMEOUT_MS;
  }

  #historySize(): number {
    return this.options.historySize ?? DEFAULT_HISTORY_SIZE;
  }

  #deliveryClosed(): boolean {
    return this.#closed;
  }
}

class GrpcVehicleTelemetryTransport implements VehicleTelemetryTransport {
  readonly #client: Client;

  constructor(endpoint: string, options: VehicleTelemetryOptions) {
    const Constructor = telemetryClientConstructor();
    this.#client = new Constructor(endpoint, credentials(options)) as unknown as Client;
  }

  emit(request: EmitProviderEventsRequest, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) =>
      this.#client.emitProviderEvents(
        request,
        { deadline: new Date(Date.now() + timeoutMs) },
        (error, response) => (error === null ? resolve(response) : reject(error)),
      ),
    );
  }

  close(): void {
    this.#client.close();
  }
}

class VehicleTelemetryProtocolError extends Error {
  constructor(readonly reasonCode: string) {
    super(reasonCode);
    this.name = "VehicleTelemetryProtocolError";
  }
}

function validateResults(
  value: unknown,
  events: readonly ProviderTelemetryEventInput[],
): Map<string, ProviderTelemetryEventResult> {
  if (!isRecord(value) || !Array.isArray(value.results))
    throw new VehicleTelemetryProtocolError("PROVIDER_TELEMETRY_RESPONSE_INVALID");
  const expected = new Set(events.map(({ providerEventId }) => providerEventId));
  const results = new Map<string, ProviderTelemetryEventResult>();
  for (const item of value.results) {
    if (!validResult(item))
      throw new VehicleTelemetryProtocolError("PROVIDER_TELEMETRY_RESULT_INVALID");
    if (!expected.has(item.providerEventId))
      throw new VehicleTelemetryProtocolError("PROVIDER_TELEMETRY_RESULT_ID_MISMATCH");
    if (results.has(item.providerEventId))
      throw new VehicleTelemetryProtocolError("PROVIDER_TELEMETRY_RESULT_ID_DUPLICATE");
    results.set(item.providerEventId, item);
  }
  if (results.size !== events.length)
    throw new VehicleTelemetryProtocolError("PROVIDER_TELEMETRY_RESULT_MISSING");
  return results;
}

function validResult(value: unknown): value is ProviderTelemetryEventResult {
  if (!isRecord(value)) return false;
  return (
    typeof value.providerEventId === "string" &&
    typeof value.accepted === "boolean" &&
    typeof value.duplicate === "boolean" &&
    typeof value.recordId === "string" &&
    typeof value.reasonCode === "string" &&
    typeof value.message === "string" &&
    (!value.duplicate || value.accepted) &&
    (!value.accepted || value.recordId.length > 0)
  );
}

function validateOptions(options: VehicleTelemetryOptions): void {
  for (const [name, value, minimum] of [
    ["maxQueueSize", options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE, 1],
    [
      "criticalQueueReserve",
      options.criticalQueueReserve ??
        Math.min(DEFAULT_CRITICAL_QUEUE_RESERVE, options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE),
      1,
    ],
    ["maxBatchSize", options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE, 1],
    ["maximumAttempts", options.maximumAttempts ?? DEFAULT_MAXIMUM_ATTEMPTS, 1],
    ["retryBaseDelayMs", options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS, 0],
    ["retryMaximumDelayMs", options.retryMaximumDelayMs ?? DEFAULT_RETRY_MAXIMUM_DELAY_MS, 0],
    ["flushIntervalMs", options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS, 0],
    ["requestTimeoutMs", options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, 1],
    ["closeDrainTimeoutMs", options.closeDrainTimeoutMs ?? DEFAULT_CLOSE_DRAIN_TIMEOUT_MS, 0],
    ["historySize", options.historySize ?? DEFAULT_HISTORY_SIZE, 1],
  ] as const)
    if (!Number.isSafeInteger(value) || value < minimum)
      throw new Error(`VEHICLE_TELEMETRY_${name.toUpperCase()}_INVALID`);
  if (
    (options.retryMaximumDelayMs ?? DEFAULT_RETRY_MAXIMUM_DELAY_MS) <
    (options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS)
  )
    throw new Error("VEHICLE_TELEMETRY_RETRY_DELAY_INVALID");
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

function normalizeTelemetryEvent(
  eventType: VehicleTelemetryInputEventType,
  payload: Record<string, unknown>,
): {
  eventType: VehicleTelemetryEventType;
  payload: Record<string, unknown>;
  attributes: Record<string, unknown>;
} {
  if (eventType === "PROVIDER_DIAGNOSTIC")
    return {
      eventType: "RESOURCE_HEALTH",
      payload: {
        ...payload,
        health: "diagnostic",
        reasonCode: "VEHICLE_PROVIDER_DIAGNOSTIC_REPORTED",
      },
      attributes: payload,
    };
  if (
    eventType === "RESOURCE_STATE" &&
    !Object.hasOwn(payload, "state") &&
    !Object.hasOwn(payload, "reasonCode")
  )
    return {
      eventType,
      payload: {
        ...payload,
        state: "observed",
        reasonCode: "VEHICLE_RESOURCE_OBSERVATION_RECEIVED",
      },
      attributes: payload,
    };
  if (
    eventType === "EXECUTION_PROGRESS" &&
    !["current", "total", "percentage"].some((key) => Object.hasOwn(payload, key))
  )
    return {
      eventType,
      payload: { ...payload, unit: typeof payload.unit === "string" ? payload.unit : "percent" },
      attributes: payload,
    };
  return { eventType, payload, attributes: {} };
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

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("PROVIDER_TELEMETRY_REQUEST_TIMEOUT")), timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function settleWithin(operation: Promise<void>, timeoutMs: number): Promise<boolean> {
  if (timeoutMs <= 0) return false;
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([operation.then(() => true), expired]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function stableReasonCode(value: string, fallback: string): string {
  return /^[A-Z][A-Z0-9_]{0,127}$/.test(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function eventPriority(event: ProviderTelemetryEventInput): number {
  if (event.eventType === "EXECUTION_PROGRESS") {
    const transition = event.attributes.transition;
    const reasonCode = event.attributes.reasonCode;
    if (
      (typeof transition === "string" &&
        ["SUCCEEDED", "BUSINESS_FAILED", "CANCELLED", "TECHNICAL_FAILED"].includes(transition)) ||
      (typeof reasonCode === "string" && /(?:ERROR|FAILED|UNCERTAIN)/.test(reasonCode))
    )
      return 3;
    return 2;
  }
  return event.eventType === "RESOURCE_HEALTH" ? 1 : 0;
}
