import type { Attributes } from "@opentelemetry/api";
import {
  sanitizeBusinessEventDiagnosticBody,
  sanitizeBusinessEventTraceAttributes,
} from "./business-event-sanitizer.js";

export const BUSINESS_EVENT_METRIC_DEFINITIONS = {
  sdar_business_event_source_received_total: definition("counter", ["sourceId", "outcome"]),
  sdar_business_event_source_duplicate_total: definition("counter", ["sourceId"]),
  sdar_business_event_source_rejected_total: definition("counter", ["sourceId", "reason"]),
  sdar_business_event_source_mapping_failed_total: definition("counter", ["sourceId"]),
  sdar_business_event_source_blocked_total: definition("counter", ["sourceId", "reason"]),
  sdar_business_event_publication_barrier_waiting: definition("gauge", ["sourceId"]),
  sdar_business_event_finalized_total: definition("counter", ["sourceId", "outcome"]),
  sdar_business_event_stream_rotations_total: definition("counter", ["reason"]),
  sdar_business_event_continuity_loss_total: definition("counter", ["reason"]),
  sdar_business_event_continuity_notifications_total: definition("counter", []),
  sdar_business_event_replay_events_total: definition("counter", ["outcome"]),
  sdar_business_event_live_events_total: definition("counter", ["outcome"]),
  sdar_business_event_projection_filtered_total: definition("counter", ["reason"]),
  sdar_business_event_relation_pages_total: definition("counter", ["outcome"]),
  sdar_business_event_relation_token_expired_total: definition("counter", []),
} as const satisfies Record<string, BusinessEventMetricDefinition>;

const OPERATIONAL_METRIC_DEFINITIONS = {
  sdar_business_event_active_subscriptions: definition("gauge", []),
  sdar_business_event_ingest_duration_seconds: definition("histogram", ["sourceId", "outcome"]),
  sdar_business_event_mapping_duration_seconds: definition("histogram", ["sourceId", "outcome"]),
  sdar_business_event_finalization_duration_seconds: definition("histogram", [
    "sourceId",
    "outcome",
  ]),
  sdar_business_event_rotation_duration_seconds: definition("histogram", ["outcome", "reason"]),
  sdar_business_event_replay_batch_duration_seconds: definition("histogram", ["outcome"]),
  sdar_business_event_relation_query_duration_seconds: definition("histogram", ["outcome"]),
} as const satisfies Record<string, BusinessEventMetricDefinition>;

export type FrozenBusinessEventMetricName = keyof typeof BUSINESS_EVENT_METRIC_DEFINITIONS;
export type FrozenBusinessEventGaugeName = "sdar_business_event_publication_barrier_waiting";
export type BusinessEventHistogramName = keyof typeof OPERATIONAL_METRIC_DEFINITIONS;
export type BusinessEventMetricName =
  FrozenBusinessEventMetricName | keyof typeof OPERATIONAL_METRIC_DEFINITIONS;

export type BusinessEventDiagnosticEventName =
  | "business_events.source.connection"
  | "business_events.source.rejected"
  | "business_events.mapping.retry"
  | "business_events.finalizer.wait"
  | "business_events.stream.rotation"
  | "business_events.stream.delivery"
  | "business_events.relation.query";

export type BusinessEventSpanName =
  | "business_events.source.connect"
  | "business_events.source.ingest"
  | "business_events.source.prepare"
  | "business_events.source.finalize"
  | "business_events.stream.rotate"
  | "business_events.stream.listen"
  | "business_events.stream.replay"
  | "business_events.stream.live"
  | "business_events.relation.query"
  | "business_events.operator.rotate";

export interface BusinessEventMetricDefinition {
  kind: "counter" | "gauge" | "histogram";
  requiredLabels: readonly string[];
  optionalLabels: readonly string[];
}

const OUTCOMES = new Set([
  "received",
  "duplicate",
  "rejected",
  "finalized",
  "published",
  "filtered",
  "sent",
  "failed",
  "blocked",
  "closed",
  "expired",
  "subscription_capacity",
  "queue_message_overflow",
  "queue_byte_overflow",
  "complete",
  "delivered",
  "success",
  "error",
  "other",
]);
const REASONS = new Set([
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
]);
const FORBIDDEN_LABELS = new Set([
  "eventId",
  "taskId",
  "resourceRef",
  "sourceEventId",
  "subscriptionId",
  "authorizationHash",
  "authorizationContextHash",
  "projectionToken",
  "recordHash",
  "payloadHash",
]);

export class BusinessEventMetricPolicy {
  #sourceIds: ReadonlySet<string> = new Set();

  constructor(sourceIds: Iterable<string> = []) {
    this.replaceSourceRoster(sourceIds);
  }

  replaceSourceRoster(sourceIds: Iterable<string>): void {
    const next = new Set(sourceIds);
    if (next.size > 16) throw new Error("BUSINESS_EVENT_SOURCE_COUNT_INVALID");
    if ([...next].some((sourceId) => sourceId.length === 0)) {
      throw new Error("BUSINESS_EVENT_SOURCE_ID_INVALID");
    }
    this.#sourceIds = next;
  }

  sourceIds(): ReadonlySet<string> {
    return new Set(this.#sourceIds);
  }

  attributes(
    name: BusinessEventMetricName,
    labels: Record<string, string> = {},
  ): Record<string, string> {
    const metric = metricDefinition(name);
    for (const label of Object.keys(labels)) {
      if (
        FORBIDDEN_LABELS.has(label) ||
        ![...metric.requiredLabels, ...metric.optionalLabels].includes(label)
      ) {
        throw new Error("BUSINESS_EVENT_METRIC_LABEL_FORBIDDEN");
      }
    }
    for (const required of metric.requiredLabels) {
      if (labels[required] === undefined) throw new Error("BUSINESS_EVENT_METRIC_LABEL_REQUIRED");
    }
    return Object.fromEntries(
      Object.entries(labels).map(([key, value]) => [key, this.#normalize(key, value)]),
    );
  }

  #normalize(label: string, value: string): string {
    if (label === "sourceId") return this.#sourceIds.has(value) ? value : "other";
    if (label === "outcome") return OUTCOMES.has(value) ? value : "other";
    if (label === "reason" || label === "reasonCode") return REASONS.has(value) ? value : "other";
    return "other";
  }
}

export interface BusinessEventMetricRuntimeSink {
  increment(name: string, labels?: Record<string, string>, amount?: number): void;
}

export interface BusinessEventMetricOtlpSink {
  metric(
    name: string,
    value?: number,
    attributes?: Attributes,
    kind?: "counter" | "histogram" | "gauge",
  ): void;
  event?(name: string, body: unknown, attributes?: Attributes): void;
  trace?<T>(name: string, attributes: Attributes, operation: () => Promise<T>): Promise<T>;
}

export interface BusinessEventOperationalTelemetry {
  increment(
    name: FrozenBusinessEventMetricName,
    labels?: Record<string, string>,
    amount?: number,
  ): void;
  gauge(
    name: FrozenBusinessEventGaugeName | "sdar_business_event_active_subscriptions",
    value: number,
    labels?: Record<string, string>,
  ): void;
  histogram(name: BusinessEventHistogramName, value: number, labels?: Record<string, string>): void;
  event(name: BusinessEventDiagnosticEventName, body: Record<string, unknown>): void;
  trace<T>(
    name: BusinessEventSpanName,
    attributes: Record<string, string | number | boolean>,
    operation: () => Promise<T>,
  ): Promise<T>;
}

export class BusinessEventTelemetryBridge {
  constructor(
    readonly runtimeMetrics: BusinessEventMetricRuntimeSink,
    readonly providerTelemetry: BusinessEventMetricOtlpSink | undefined,
    readonly policy: BusinessEventMetricPolicy,
    readonly prometheusGauges: Record<string, number> = {},
  ) {}

  increment(name: string, labels: Record<string, string> = {}, amount = 1): void {
    const metricName = name as BusinessEventMetricName;
    const attributes = this.policy.attributes(metricName, labels);
    try {
      this.runtimeMetrics.increment(name, attributes, amount);
    } catch {
      /* fail open */
    }
    try {
      this.providerTelemetry?.metric(name, amount, attributes, "counter");
    } catch {
      /* fail open */
    }
  }

  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const metricName = name as BusinessEventMetricName;
    const attributes = this.policy.attributes(metricName, labels);
    try {
      this.prometheusGauges[prometheusMetricKey(name, attributes)] = value;
    } catch {
      /* fail open */
    }
    try {
      this.providerTelemetry?.metric(name, value, attributes, "gauge");
    } catch {
      /* fail open */
    }
  }

  histogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const metricName = name as BusinessEventMetricName;
    const attributes = this.policy.attributes(metricName, labels);
    try {
      this.providerTelemetry?.metric(name, value, attributes, "histogram");
    } catch {
      /* fail open */
    }
  }

  event(name: string, body: Record<string, unknown>): void {
    if (!BUSINESS_EVENT_DIAGNOSTIC_EVENTS.has(name as BusinessEventDiagnosticEventName)) return;
    try {
      this.providerTelemetry?.event?.(name, sanitizeBusinessEventDiagnosticBody(body));
    } catch {
      // Diagnostics are fail-open.
    }
  }

  async trace<T>(
    name: string,
    attributes: Record<string, string | number | boolean>,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (
      !BUSINESS_EVENT_SPANS.has(name as BusinessEventSpanName) ||
      this.providerTelemetry?.trace === undefined
    ) {
      return operation();
    }
    const invocation = { started: false };
    const invoke = (): Promise<T> => {
      invocation.started = true;
      return operation();
    };
    try {
      return await this.providerTelemetry.trace<T>(
        name,
        sanitizeBusinessEventTraceAttributes(attributes),
        invoke,
      );
    } catch (error) {
      if (invocation.started) throw error;
      return operation();
    }
  }
}

const BUSINESS_EVENT_DIAGNOSTIC_EVENTS = new Set<BusinessEventDiagnosticEventName>([
  "business_events.source.connection",
  "business_events.source.rejected",
  "business_events.mapping.retry",
  "business_events.finalizer.wait",
  "business_events.stream.rotation",
  "business_events.stream.delivery",
  "business_events.relation.query",
]);

const BUSINESS_EVENT_SPANS = new Set<BusinessEventSpanName>([
  "business_events.source.connect",
  "business_events.source.ingest",
  "business_events.source.prepare",
  "business_events.source.finalize",
  "business_events.stream.rotate",
  "business_events.stream.listen",
  "business_events.stream.replay",
  "business_events.stream.live",
  "business_events.relation.query",
  "business_events.operator.rotate",
]);

function definition(
  kind: BusinessEventMetricDefinition["kind"],
  requiredLabels: readonly string[],
  optionalLabels: readonly string[] = [],
): BusinessEventMetricDefinition {
  return { kind, requiredLabels, optionalLabels };
}

function metricDefinition(name: BusinessEventMetricName): BusinessEventMetricDefinition {
  const definition =
    (BUSINESS_EVENT_METRIC_DEFINITIONS as Record<string, BusinessEventMetricDefinition>)[name] ??
    (OPERATIONAL_METRIC_DEFINITIONS as Record<string, BusinessEventMetricDefinition>)[name];
  if (definition === undefined) throw new Error("BUSINESS_EVENT_METRIC_NAME_FORBIDDEN");
  return definition;
}

function prometheusMetricKey(name: string, labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return name;
  return `${name}{${entries.map(([key, value]) => `${key}="${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(",")}}`;
}
