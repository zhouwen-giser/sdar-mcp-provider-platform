import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import type {
  Attributes,
  Context,
  Link,
  Span,
  TextMapGetter,
  TextMapSetter,
} from "@opentelemetry/api";
import { ExportResultCode, W3CTraceContextPropagator } from "@opentelemetry/core";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import * as grpc from "@grpc/grpc-js";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  BatchLogRecordProcessor,
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import type { LogRecordExporter } from "@opentelemetry/sdk-logs";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import type { MetricReader } from "@opentelemetry/sdk-metrics";
import { RUNTIME_VERSION } from "../../domain/src/index.js";
import {
  BatchSpanProcessor,
  InMemorySpanExporter,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";
import type { SpanExporter } from "@opentelemetry/sdk-trace-node";
import { createProviderResource } from "./provider-resource.js";
import type { ProviderResourceInput } from "./provider-resource.js";
import type { ProviderOpsEnvelope } from "./event-envelope.js";
import { TelemetrySanitizer } from "./telemetry-sanitizer.js";
import { sanitizeBusinessEventTraceAttributes } from "./business-event-sanitizer.js";

const INSTRUMENTATION_NAME = "@sdar/provider-ops-telemetry";
const INSTRUMENTATION_VERSION = RUNTIME_VERSION;

export interface ProviderTelemetryBatchOptions {
  maxQueueSize?: number;
  maxExportBatchSize?: number;
  scheduledDelayMillis?: number;
  exportTimeoutMillis?: number;
}

export interface ProviderTelemetryOptions {
  resource: ProviderResourceInput;
  enabled?: boolean;
  otlpEndpoint?: string;
  otlpHeaders?: Record<string, string>;
  otlpTls?: { ca: Buffer; cert: Buffer; key: Buffer };
  otlpTimeoutMillis?: number;
  metricExportIntervalMillis?: number;
  batch?: ProviderTelemetryBatchOptions;
  spanExporter?: SpanExporter;
  eventExporter?: LogRecordExporter;
  auditExporter?: LogRecordExporter;
  metricReader?: MetricReader;
  onSelfMetric?: (
    name: string,
    value: number,
    attributes: Attributes,
    kind: ProviderMetricKind,
  ) => void;
  boundedDynamicMetricValues?: Record<string, ReadonlySet<string>>;
}

export type ProviderMetricKind = "counter" | "histogram" | "gauge";

interface ProviderMetricInstrument {
  add?: (value: number, attributes?: Attributes) => void;
  record?: (value: number, attributes?: Attributes) => void;
  set?: (value: number, attributes?: Attributes) => void;
}

const BOUNDED_METRIC_LABELS = new Set([
  "commandType",
  "decision",
  "event",
  "method",
  "outcome",
  "reasonCode",
  "resultClass",
  "source",
  "state",
  "status",
  "signal",
  "reason",
]);

const METRIC_LABEL_VALUES: Record<string, ReadonlySet<string>> = {
  commandType: new Set(["CANCEL", "UPDATE", "PAUSE", "RESUME", "other"]),
  decision: new Set([
    "scheduled",
    "claimed",
    "started",
    "retry",
    "deadline",
    "start_window_missed",
    "other",
  ]),
  event: new Set([
    "reconcile_start",
    "reconcile_success",
    "reconcile_failed",
    "lease_conflict",
    "delivered",
    "retry",
    "exhausted",
    "other",
  ]),
  method: new Set([
    "StartOperation",
    "startOperation",
    "GetExecution",
    "RequestCancel",
    "UpdateExecution",
    "PauseExecution",
    "ResumeExecution",
    "ReconcileExecution",
    "other",
  ]),
  outcome: new Set([
    "success",
    "error",
    "rejected",
    "received",
    "duplicate",
    "finalized",
    "published",
    "filtered",
    "sent",
    "failed",
    "closed",
    "subscription_capacity",
    "queue_message_overflow",
    "queue_byte_overflow",
    "complete",
    "delivered",
    "timeout",
    "unavailable",
    "scan",
    "renewed",
    "expired",
    "purged",
    "blocked",
    "other",
  ]),
  reasonCode: new Set([
    "ADMISSION_REJECTED",
    "START_WINDOW_MISSED",
    "DEADLINE_REACHED",
    "TASK_TERMINAL",
    "SUPERSEDED_BY_SAFE_STOP",
    "SAFE_STOP_UNCONFIRMED",
    "other",
  ]),
  reason: new Set([
    "queue_full",
    "timeout",
    "exporter_error",
    "serialization",
    "invalid",
    "poison_event",
    "worker_failure",
    "SOURCE_CURSOR_EXPIRED",
    "SOURCE_STREAM_RESET",
    "SOURCE_CURSOR_AHEAD",
    "SOURCE_DATA_LOSS",
    "SOURCE_POISON_EVENT",
    "SOURCE_MAPPING_FAILED",
    "SOURCE_TEMPORARILY_UNAVAILABLE",
    "authorization_filtered",
    "authorization",
    "no_visible_task",
    "projection_stale",
    "retention_authority_invalid",
    "other",
  ]),
  resultClass: new Set([
    "success",
    "business_failure",
    "technical_failure",
    "cancelled",
    "expired",
    "other",
  ]),
  signal: new Set(["trace", "log", "metric", "audit", "other"]),
  source: new Set(["mcp", "scheduler", "dispatcher", "recovery", "ttl", "provider", "other"]),
  state: new Set([
    "SCHEDULED",
    "STARTING",
    "WAITING_START_CONFIRMATION",
    "RUNNING",
    "WAITING_INPUT",
    "PAUSED",
    "RESUMING",
    "STOPPING",
    "TERMINAL_COMPLETED",
    "TERMINAL_FAILED",
    "TERMINAL_CANCELLED",
    "PENDING",
    "CLAIMED",
    "RETRY_WAIT",
    "ACKNOWLEDGED",
    "REJECTED",
    "EXHAUSTED",
    "EXPIRED",
    "other",
  ]),
  status: new Set(["success", "error", "rejected", "timeout", "unavailable", "other"]),
};

export class ProviderTelemetry {
  readonly #options: ProviderTelemetryOptions;
  #tracerProvider?: NodeTracerProvider;
  #loggerProvider?: LoggerProvider;
  #auditLoggerProvider?: LoggerProvider;
  #meterProvider?: MeterProvider;
  #started = false;
  #shutdown = false;
  #queuedEvents = 0;
  readonly #metricInstruments = new Map<string, ProviderMetricInstrument>();
  readonly #sanitizer = new TelemetrySanitizer();
  readonly #propagator = new W3CTraceContextPropagator();
  readonly #contextManager = new AsyncLocalStorageContextManager().enable();
  readonly #boundedDynamicMetricValues: Readonly<Record<string, ReadonlySet<string>>>;

  constructor(options: ProviderTelemetryOptions) {
    this.#options = options;
    const dynamic = options.boundedDynamicMetricValues ?? {};
    for (const [label, values] of Object.entries(dynamic)) {
      if (label !== "sourceId" || values.size > 16) {
        throw new Error("TELEMETRY_DYNAMIC_METRIC_VALUES_INVALID");
      }
    }
    this.#boundedDynamicMetricValues = Object.fromEntries(
      Object.entries(dynamic).map(([label, values]) => [label, new Set(values)]),
    );
  }

  start(): void {
    if (this.#started || this.#shutdown || this.#options.enabled !== true) return;
    const resource = createProviderResource(this.#options.resource);
    const exporterOptions = {
      ...(this.#options.otlpHeaders === undefined ? {} : { headers: this.#options.otlpHeaders }),
      timeoutMillis: this.#options.otlpTimeoutMillis ?? 10_000,
      ...(this.#options.otlpTls === undefined
        ? {}
        : {
            httpAgentOptions: {
              ca: this.#options.otlpTls.ca,
              cert: this.#options.otlpTls.cert,
              key: this.#options.otlpTls.key,
              rejectUnauthorized: true,
            },
          }),
    };
    const usesInjectedSignals =
      this.#options.spanExporter !== undefined ||
      this.#options.eventExporter !== undefined ||
      this.#options.auditExporter !== undefined ||
      this.#options.metricReader !== undefined;
    const rawSpanExporter =
      this.#options.spanExporter ??
      (usesInjectedSignals
        ? new InMemorySpanExporter()
        : new OTLPTraceExporter({
            url: signalEndpoint(this.#options.otlpEndpoint, "traces"),
            ...exporterOptions,
          }));
    const rawEventExporter =
      this.#options.eventExporter ??
      (usesInjectedSignals
        ? new InMemoryLogRecordExporter()
        : new OTLPLogExporter({
            url: signalEndpoint(this.#options.otlpEndpoint, "logs"),
            ...exporterOptions,
          }));
    const rawAuditExporter =
      this.#options.auditExporter ??
      (usesInjectedSignals
        ? new InMemoryLogRecordExporter()
        : new OTLPLogExporter({
            url: signalEndpoint(this.#options.otlpEndpoint, "logs"),
            ...exporterOptions,
          }));
    const exportTimeoutMillis = this.#options.batch?.exportTimeoutMillis ?? 10_000;
    const spanExporter = observedSpanExporter(
      rawSpanExporter,
      exportTimeoutMillis,
      (reason) => this.#recordExportFailure("trace", reason),
      () => this.#recordExportAttempt("trace"),
    );
    const eventExporter = observedLogExporter(
      rawEventExporter,
      exportTimeoutMillis,
      (reason) => this.#recordExportFailure("log", reason),
      () => this.#recordExportAttempt("log"),
    );
    const auditExporter = observedLogExporter(
      rawAuditExporter,
      exportTimeoutMillis,
      (reason) => this.#recordExportFailure("audit", reason),
      () => this.#recordExportAttempt("audit"),
    );
    const metricReader =
      this.#options.metricReader ??
      new PeriodicExportingMetricReader({
        exporter: usesInjectedSignals
          ? new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)
          : new OTLPMetricExporter({
              url: signalEndpoint(this.#options.otlpEndpoint, "metrics"),
              ...exporterOptions,
            }),
        exportIntervalMillis: this.#options.metricExportIntervalMillis ?? 60_000,
        exportTimeoutMillis: this.#options.batch?.exportTimeoutMillis ?? 10_000,
      });
    this.#tracerProvider = new NodeTracerProvider({
      resource,
      spanProcessors: [new BatchSpanProcessor(spanExporter, batchOptions(this.#options.batch))],
    });
    this.#loggerProvider = new LoggerProvider({
      resource,
      forceFlushTimeoutMillis: this.#options.batch?.exportTimeoutMillis ?? 10_000,
      processors: [
        new BatchLogRecordProcessor({
          exporter: eventExporter,
          ...batchOptions(this.#options.batch),
        }),
      ],
    });
    this.#auditLoggerProvider = new LoggerProvider({
      resource,
      forceFlushTimeoutMillis: this.#options.batch?.exportTimeoutMillis ?? 10_000,
      processors: [new SimpleLogRecordProcessor({ exporter: auditExporter })],
    });
    this.#meterProvider = new MeterProvider({ resource, readers: [metricReader] });
    this.#started = true;
  }

  async shutdown(): Promise<void> {
    if (this.#shutdown) return;
    this.#shutdown = true;
    const signalProviders: {
      signal: "trace" | "log" | "audit";
      provider: { forceFlush(): Promise<void>; shutdown(): Promise<void> };
    }[] = [];
    if (this.#tracerProvider !== undefined) {
      signalProviders.push({ signal: "trace", provider: this.#tracerProvider });
    }
    if (this.#loggerProvider !== undefined) {
      signalProviders.push({ signal: "log", provider: this.#loggerProvider });
    }
    if (this.#auditLoggerProvider !== undefined) {
      signalProviders.push({ signal: "audit", provider: this.#auditLoggerProvider });
    }
    const flushes = await Promise.allSettled(
      signalProviders.map(({ provider }) => provider.forceFlush()),
    );
    for (const [index, result] of flushes.entries()) {
      if (result.status !== "rejected") continue;
      const signal = signalProviders[index]?.signal ?? "log";
      this.#recordExportFailure(signal, "timeout");
      if (signal === "log" && this.#queuedEvents > 0) {
        this.metric("telemetry_events_dropped_total", this.#queuedEvents, {
          signal: "log",
          reason: "timeout",
        });
      }
    }
    this.#queuedEvents = 0;
    this.metric("telemetry_queue_depth", 0, { signal: "log" }, "gauge");
    await this.#meterProvider?.forceFlush().catch(() => undefined);
    await Promise.allSettled([
      ...signalProviders.map(({ provider }) => provider.shutdown()),
      ...(this.#meterProvider === undefined ? [] : [this.#meterProvider.shutdown()]),
    ]);
    this.#contextManager.disable();
  }

  async trace<T>(name: string, attributes: Attributes, operation: () => Promise<T>): Promise<T> {
    return this.#traceInContext(
      this.#contextManager.active(),
      name,
      attributes,
      SpanKind.INTERNAL,
      operation,
    );
  }

  traceRequest<T>(
    name: string,
    headers: Record<string, string | string[] | undefined>,
    attributes: Attributes,
    operation: () => Promise<T>,
  ): Promise<T> {
    let parent = ROOT_CONTEXT;
    try {
      parent = this.#propagator.extract(ROOT_CONTEXT, headers, httpHeaderGetter);
    } catch {
      // Invalid upstream propagation becomes a new root span.
    }
    return this.#traceInContext(parent, name, attributes, SpanKind.SERVER, operation);
  }

  traceAdapterRpc<T>(
    method: string,
    attributes: Attributes,
    operation: (metadata: grpc.Metadata) => Promise<T>,
    persistedParent?: { traceparent: string; tracestate?: string },
  ): Promise<T> {
    let parent = this.#contextManager.active();
    if (persistedParent !== undefined) {
      try {
        parent = this.#propagator.extract(ROOT_CONTEXT, persistedParent, httpHeaderGetter);
      } catch {
        parent = this.#contextManager.active();
      }
    }
    return this.#traceInContext(
      parent,
      "adapter.rpc",
      {
        "rpc.system": "grpc",
        "rpc.method": method,
        "server.address": this.#options.resource.providerId,
        ...attributes,
      },
      SpanKind.CLIENT,
      async () => {
        const metadata = new grpc.Metadata();
        try {
          this.#propagator.inject(this.#contextManager.active(), metadata, grpcMetadataSetter);
        } catch {
          // Propagation failure cannot block the Adapter call.
        }
        return operation(metadata);
      },
    );
  }

  traceAdapterStreamRpc<T>(
    method: string,
    attributes: Attributes,
    open: (metadata: grpc.Metadata) => grpc.ClientReadableStream<T>,
  ): grpc.ClientReadableStream<T> {
    const fallback = (): grpc.ClientReadableStream<T> => open(new grpc.Metadata());
    if (!this.#started || this.#tracerProvider === undefined) return fallback();
    let span: Span | undefined;
    let opened = false;
    try {
      span = this.#tracerProvider
        .getTracer(INSTRUMENTATION_NAME, INSTRUMENTATION_VERSION)
        .startSpan("adapter.rpc.stream_business_events", {
          kind: SpanKind.CLIENT,
          attributes: this.#sanitizer.sanitizeAttributes({
            "rpc.system": "grpc",
            "rpc.method": method,
            "server.address": this.#options.resource.providerId,
            ...sanitizeBusinessEventTraceAttributes(attributes),
          }),
        });
      const activeSpan = span;
      const context = trace.setSpan(this.#contextManager.active(), span);
      const metadata = new grpc.Metadata();
      try {
        this.#propagator.inject(context, metadata, grpcMetadataSetter);
      } catch {
        // Propagation failure cannot block the stream.
      }
      const startedAt = performance.now();
      opened = true;
      const stream = this.#contextManager.with(context, () => open(metadata));
      let ended = false;
      const finish = (statusCode: number, outcome: "success" | "error" | "cancelled"): void => {
        if (ended) return;
        ended = true;
        try {
          activeSpan.setAttribute("rpc.grpc.status_code", statusCode);
          activeSpan.setAttribute("rpc.stream.duration_ms", performance.now() - startedAt);
          activeSpan.setAttribute("outcome", outcome);
          activeSpan.setStatus({
            code: outcome === "success" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
          });
          activeSpan.end();
        } catch {
          // Span completion cannot affect stream semantics.
        }
      };
      stream.once("end", () => finish(grpc.status.OK, "success"));
      stream.once("error", (error: grpc.ServiceError) =>
        finish(
          typeof error.code === "number" ? error.code : grpc.status.UNKNOWN,
          error.code === grpc.status.CANCELLED ? "cancelled" : "error",
        ),
      );
      return stream;
    } catch (error) {
      try {
        span?.end();
      } catch {
        // Ignore failed span cleanup.
      }
      if (opened) throw error;
      return fallback();
    }
  }

  currentTraceContext(): {
    traceId: string;
    rootTraceparent: string;
    rootTracestate?: string;
  } | null {
    const spanContext = trace.getSpanContext(this.#contextManager.active());
    if (spanContext === undefined) return null;
    const carrier: Record<string, string> = {};
    try {
      this.#propagator.inject(this.#contextManager.active(), carrier, recordSetter);
    } catch {
      return null;
    }
    const rootTraceparent = carrier.traceparent;
    if (rootTraceparent === undefined) return null;
    return {
      traceId: spanContext.traceId,
      rootTraceparent,
      ...(carrier.tracestate === undefined ? {} : { rootTracestate: carrier.tracestate }),
    };
  }

  traceProviderEvent<T>(
    input: {
      providerTraceparent?: string;
      providerTracestate?: string;
      taskTraceparent?: string;
      taskTracestate?: string;
      eventType: string;
    },
    operation: () => Promise<T>,
  ): Promise<T> {
    const providerParent = propagationContext(
      this.#propagator,
      input.providerTraceparent,
      input.providerTracestate,
    );
    const taskParent = propagationContext(
      this.#propagator,
      input.taskTraceparent,
      input.taskTracestate,
    );
    const taskSpanContext = taskParent === undefined ? undefined : trace.getSpanContext(taskParent);
    const links: Link[] = taskSpanContext === undefined ? [] : [{ context: taskSpanContext }];
    return this.#traceInContext(
      providerParent ?? taskParent ?? this.#contextManager.active(),
      "provider.event",
      { eventType: input.eventType },
      SpanKind.SERVER,
      operation,
      links,
    );
  }

  async #traceInContext<T>(
    parent: Context,
    name: string,
    attributes: Attributes,
    kind: SpanKind,
    operation: () => Promise<T>,
    links: Link[] = [],
  ): Promise<T> {
    if (!this.#started || this.#tracerProvider === undefined) return operation();
    let span;
    try {
      span = this.#tracerProvider
        .getTracer(INSTRUMENTATION_NAME, INSTRUMENTATION_VERSION)
        .startSpan(
          name,
          { kind, links, attributes: this.#sanitizer.sanitizeAttributes(attributes) },
          parent,
        );
      this.metric("telemetry_events_emitted_total", 1, { signal: "trace" });
    } catch {
      return operation();
    }
    const invocation = { started: false };
    const invoke = async (): Promise<T> => {
      invocation.started = true;
      try {
        const result = await operation();
        try {
          span.setStatus({ code: SpanStatusCode.OK });
        } catch {
          // Span mutation cannot replace a business result.
        }
        return result;
      } catch (error) {
        try {
          span.setStatus({ code: SpanStatusCode.ERROR });
          const safe = safeTraceError(error);
          span.setAttribute("error.type", safe.type);
          span.setAttribute("error.reason_code", safe.reasonCode);
          span.setAttribute("error.retryable", safe.retryable);
        } catch {
          // Raw exception content is never exported.
        }
        throw error;
      } finally {
        try {
          span.end();
        } catch {
          // Span shutdown cannot replace a business result.
        }
      }
    };
    try {
      return await this.#contextManager.with(trace.setSpan(parent, span), invoke);
    } catch (error) {
      if (invocation.started) throw error;
      return operation();
    }
  }

  event(name: string, body: unknown, attributes: Attributes = {}): void {
    if (!this.#started || this.#loggerProvider === undefined) return;
    const maximum = this.#options.batch?.maxQueueSize ?? 2_048;
    if (this.#queuedEvents >= maximum) {
      this.metric("telemetry_events_dropped_total", 1, {
        signal: "log",
        reason: "queue_full",
      });
      return;
    }
    this.#queuedEvents += 1;
    this.metric("telemetry_queue_depth", this.#queuedEvents, { signal: "log" }, "gauge");
    try {
      this.#loggerProvider.getLogger(INSTRUMENTATION_NAME, INSTRUMENTATION_VERSION).emit({
        eventName: name,
        body: this.#sanitizer.sanitize(body) as never,
        attributes: this.#sanitizer.sanitizeAttributes(attributes),
        timestamp: new Date(),
      });
      this.metric("telemetry_events_emitted_total", 1, { signal: "log" });
      const release = setTimeout(() => {
        this.#queuedEvents = Math.max(0, this.#queuedEvents - 1);
        this.metric("telemetry_queue_depth", this.#queuedEvents, { signal: "log" }, "gauge");
      }, this.#options.batch?.scheduledDelayMillis ?? 5_000);
      release.unref();
    } catch {
      this.#queuedEvents = Math.max(0, this.#queuedEvents - 1);
      this.metric("telemetry_events_dropped_total", 1, {
        signal: "log",
        reason: "serialization",
      });
    }
  }

  emitEnvelope(envelope: ProviderOpsEnvelope): void {
    this.event(envelope.recordType, envelope, {
      "sdar.schema.name": envelope.schemaName,
      "sdar.schema.version": envelope.schemaVersion,
      "sdar.record.id": envelope.recordId,
      "sdar.record.hash": envelope.recordHash,
    });
    const payload =
      typeof envelope.payload === "object" &&
      envelope.payload !== null &&
      !Array.isArray(envelope.payload)
        ? envelope.payload
        : {};
    if (envelope.recordType === "provider.task.lifecycle") {
      this.metric("provider_task_transition_total", 1, {
        state: stringAttribute(payload.currentState),
        resultClass: stringAttribute(payload.resultClass),
      });
    } else if (envelope.recordType === "provider.command.lifecycle") {
      this.metric("provider_command_total", 1, {
        commandType: stringAttribute(payload.commandType),
        state: stringAttribute(payload.currentState),
        status: stringAttribute(payload.adapterRpcStatus),
      });
    }
  }

  async exportAudit(envelopes: ProviderOpsEnvelope[]): Promise<void> {
    if (!this.#started || this.#auditLoggerProvider === undefined) {
      throw new Error("TELEMETRY_AUDIT_EXPORT_UNAVAILABLE");
    }
    const logger = this.#auditLoggerProvider.getLogger(
      `${INSTRUMENTATION_NAME}/audit`,
      INSTRUMENTATION_VERSION,
    );
    try {
      for (const envelope of envelopes) {
        logger.emit({
          eventName: envelope.recordType,
          body: this.#sanitizer.sanitize(envelope) as never,
          attributes: {
            "sdar.schema.name": envelope.schemaName,
            "sdar.schema.version": envelope.schemaVersion,
            "sdar.record.id": envelope.recordId,
            "sdar.record.hash": envelope.recordHash,
            "sdar.delivery.class": envelope.deliveryClass,
          },
          timestamp: new Date(envelope.occurredAt),
        });
        this.metric("telemetry_events_emitted_total", 1, { signal: "audit" });
      }
      await this.#auditLoggerProvider.forceFlush();
    } catch (error) {
      this.metric("telemetry_export_failed_total", 1, {
        signal: "audit",
        reason: "exporter_error",
      });
      throw error;
    }
  }

  metric(
    name: string,
    value = 1,
    attributes: Attributes = {},
    kind: ProviderMetricKind = "counter",
  ): void {
    if (!this.#started || this.#meterProvider === undefined) return;
    try {
      const key = `${kind}:${name}`;
      let instrument = this.#metricInstruments.get(key);
      if (instrument === undefined) {
        const meter = this.#meterProvider.getMeter(INSTRUMENTATION_NAME, INSTRUMENTATION_VERSION);
        if (kind === "counter") instrument = meter.createCounter(name);
        else if (kind === "histogram") instrument = meter.createHistogram(name);
        else {
          const gauge = meter.createObservableGauge(name);
          const series = new Map<string, { value: number; attributes: Attributes }>();
          gauge.addCallback((observation) => {
            for (const current of series.values()) {
              observation.observe(current.value, current.attributes);
            }
          });
          instrument = {
            set: (nextValue, nextAttributes = {}) => {
              series.set(attributeSeriesKey(nextAttributes), {
                value: nextValue,
                attributes: nextAttributes,
              });
            },
          };
        }
        this.#metricInstruments.set(key, instrument);
      }
      const boundedAttributes = boundedMetricAttributes(
        attributes,
        this.#boundedDynamicMetricValues,
      );
      if (name.startsWith("telemetry_")) {
        try {
          this.#options.onSelfMetric?.(name, value, boundedAttributes, kind);
        } catch {
          // Self-monitoring cannot alter signal delivery.
        }
      }
      if (kind === "counter") instrument.add?.(value, boundedAttributes);
      else if (kind === "histogram") instrument.record?.(value, boundedAttributes);
      else instrument.set?.(value, boundedAttributes);
      if (!name.startsWith("telemetry_")) {
        this.metric("telemetry_events_emitted_total", 1, { signal: "metric" });
      }
    } catch {
      // Instrumentation must never alter Runtime state or readiness.
    }
  }

  #recordExportAttempt(signal: "trace" | "log" | "audit"): void {
    this.metric("telemetry_export_attempt_total", 1, { signal });
  }

  #recordExportFailure(
    signal: "trace" | "log" | "audit",
    reason: "timeout" | "exporter_error",
  ): void {
    this.metric("telemetry_export_failed_total", 1, { signal, reason });
  }
}

function safeTraceError(error: unknown): {
  type: string;
  reasonCode: string;
  retryable: boolean;
} {
  const knownTypes = new Set([
    "Error",
    "TypeError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "AggregateError",
  ]);
  const record =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const name = error instanceof Error && knownTypes.has(error.name) ? error.name : "Error";
  const reason = record.reasonCode;
  return {
    type: name,
    reasonCode:
      typeof reason === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(reason) ? reason : "UNKNOWN",
    retryable: record.retryable === true,
  };
}

function observedSpanExporter(
  exporter: SpanExporter,
  timeoutMs: number,
  onFailure: (reason: "timeout" | "exporter_error") => void,
  onAttempt: () => void,
): SpanExporter {
  const observed: SpanExporter = {
    export: (spans, callback) => {
      onAttempt();
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) onFailure("timeout");
      }, timeoutMs);
      timer.unref();
      try {
        exporter.export(spans, (result) => {
          settled = true;
          clearTimeout(timer);
          if (result.code !== ExportResultCode.SUCCESS) onFailure("exporter_error");
          callback(result);
        });
      } catch (error) {
        settled = true;
        clearTimeout(timer);
        onFailure("exporter_error");
        throw error;
      }
    },
    shutdown: () => exporter.shutdown(),
  };
  const forceFlush = exporter.forceFlush?.bind(exporter);
  if (forceFlush !== undefined) observed.forceFlush = forceFlush;
  return observed;
}

function observedLogExporter(
  exporter: LogRecordExporter,
  timeoutMs: number,
  onFailure: (reason: "timeout" | "exporter_error") => void,
  onAttempt: () => void,
): LogRecordExporter {
  return {
    export: (logs, callback) => {
      onAttempt();
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) onFailure("timeout");
      }, timeoutMs);
      timer.unref();
      try {
        exporter.export(logs, (result) => {
          settled = true;
          clearTimeout(timer);
          if (result.code !== ExportResultCode.SUCCESS) onFailure("exporter_error");
          callback(result);
        });
      } catch (error) {
        settled = true;
        clearTimeout(timer);
        onFailure("exporter_error");
        throw error;
      }
    },
    shutdown: () => exporter.shutdown(),
    forceFlush: () => exporter.forceFlush(),
  };
}

function batchOptions(options: ProviderTelemetryBatchOptions | undefined) {
  const maxQueueSize = options?.maxQueueSize ?? 2_048;
  return {
    maxQueueSize,
    maxExportBatchSize: Math.min(options?.maxExportBatchSize ?? 512, maxQueueSize),
    scheduledDelayMillis: 5_000,
    exportTimeoutMillis: 10_000,
    ...(options?.scheduledDelayMillis === undefined
      ? {}
      : { scheduledDelayMillis: options.scheduledDelayMillis }),
    ...(options?.exportTimeoutMillis === undefined
      ? {}
      : { exportTimeoutMillis: options.exportTimeoutMillis }),
  };
}

function boundedMetricAttributes(
  attributes: Attributes,
  dynamicValues: Readonly<Record<string, ReadonlySet<string>>> = {},
): Attributes {
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(
        ([key, value]) =>
          (BOUNDED_METRIC_LABELS.has(key) || dynamicValues[key] !== undefined) &&
          value !== undefined,
      )
      .map(([key, value]) => {
        const text = typeof value === "string" ? value : "other";
        const allowed = dynamicValues[key] ?? METRIC_LABEL_VALUES[key];
        return [key, allowed?.has(text) === true ? text : "other"];
      }),
  );
}

function attributeSeriesKey(attributes: Attributes): string {
  return JSON.stringify(
    Object.entries(attributes).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function stringAttribute(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const httpHeaderGetter: TextMapGetter<Record<string, string | string[] | undefined>> = {
  keys: (carrier) => Object.keys(carrier),
  get: (carrier, key) => carrier[key.toLowerCase()],
};

const grpcMetadataSetter: TextMapSetter<grpc.Metadata> = {
  set: (carrier, key, value) => carrier.set(key, value),
};

const recordSetter: TextMapSetter<Record<string, string>> = {
  set: (carrier, key, value) => {
    carrier[key] = value;
  },
};

function propagationContext(
  propagator: W3CTraceContextPropagator,
  traceparent: string | undefined,
  tracestate: string | undefined,
): Context | undefined {
  if (traceparent === undefined) return undefined;
  try {
    return propagator.extract(
      ROOT_CONTEXT,
      { traceparent, ...(tracestate === undefined ? {} : { tracestate }) },
      httpHeaderGetter,
    );
  } catch {
    return undefined;
  }
}

function signalEndpoint(base: string | undefined, signal: "traces" | "metrics" | "logs"): string {
  const endpoint = (base ?? "http://127.0.0.1:4318").replace(/\/+$/, "");
  return `${endpoint}/v1/${signal}`;
}
