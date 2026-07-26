import { readFileSync } from "node:fs";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { describe, expect, it } from "vitest";
import {
  createProviderOpsEnvelope,
  ProviderTelemetry,
  TelemetrySanitizer,
} from "../../packages/observability/src/index.js";

const root = (path: string) => readFileSync(path, "utf8");

describe("v1.1 telemetry completion regression guards", () => {
  it("uses the canonical dotted record types and schema version", () => {
    const envelope = root("packages/observability/src/event-envelope.ts");
    const sink = root("packages/task-engine/src/provider-ops-outbox-sink.ts");
    expect(envelope).toContain('PROVIDER_OPS_SCHEMA_VERSION = "1.1.0"');
    expect(sink).toContain('recordType: "provider.task.lifecycle"');
    expect(sink).toContain('recordType: "provider.command.lifecycle"');
    expect(sink).not.toContain('recordType: "provider.task_lifecycle"');
    expect(sink).not.toContain('recordType: "provider.command_dispatch"');
  });

  it("uses stable event keys and excludes Runtime instance identity from record hashes", () => {
    const outbox = root("packages/persistence-postgres/src/outbox.ts");
    const sink = root("packages/task-engine/src/provider-ops-outbox-sink.ts");
    expect(outbox).toContain("eventKey: string");
    expect(sink).toContain("eventIdentity: event.eventKey");

    const base = {
      recordType: "provider.task.lifecycle",
      eventCategory: "task.lifecycle",
      deliveryClass: "audit",
      providerId: "provider",
      runtimeVersion: "1.1.0",
      taskId: "task-1",
      stableAggregateIdentity: "task-1",
      eventIdentity: "task-1:7:task.completed",
      revision: 7,
      occurredAt: "2026-07-18T00:00:00.000Z",
      attributes: {},
      payload: { eventType: "task.completed" },
    } as const;
    const first = createProviderOpsEnvelope({ ...base, instanceId: "replica-a" });
    const second = createProviderOpsEnvelope({ ...base, instanceId: "replica-b" });
    expect(first.recordId).toBe(second.recordId);
    expect(first.recordHash).toBe(second.recordHash);
  });

  it("defines the durable audit migration and Runtime-hosted Provider ingress protocol", () => {
    const migrations = root("migrations/017_provider_ops_audit_delivery.sql");
    const protoGeneration = root("scripts/generate-proto.mjs");
    expect(migrations).toContain("provider_ops_delivery");
    expect(protoGeneration).toContain("provider_telemetry.proto");
  });

  it("does not directly export raw exceptions or legacy aggregate worker events", () => {
    const telemetry = root("packages/observability/src/telemetry.ts");
    const runtime = root("apps/runtime/src/runtime.ts");
    expect(telemetry).not.toContain("span.recordException(error)");
    expect(runtime).not.toContain('telemetry?.event("provider.scheduler_decision"');
    expect(runtime).not.toContain('telemetry?.event("provider.recovery_event"');
    expect(runtime).not.toContain('telemetry?.event("provider.ttl_event"');
  });

  it("aggregate_worker_count_is_metric_only", () => {
    const runtime = root("apps/runtime/src/runtime.ts");
    expect(runtime).not.toContain('telemetry?.event("provider.scheduler_decision"');
    expect(runtime).not.toContain('telemetry?.event("provider.recovery_event"');
    expect(runtime).not.toContain('telemetry?.event("provider.ttl_event"');
    expect(runtime).toContain('telemetry?.metric("provider_scheduler_total"');
    expect(runtime).toContain('telemetry?.metric("provider_recovery_total"');
  });

  it("operational_event_has_stable_record_id", () => {
    const input = {
      recordType: "provider.scheduler.decision",
      eventCategory: "scheduler.decision",
      deliveryClass: "operational",
      providerId: "provider",
      runtimeVersion: "1.1.0",
      taskId: "task-operational",
      stableAggregateIdentity: "task-operational",
      eventIdentity: "task-operational:start:1",
      occurredAt: "2026-07-18T00:00:00.000Z",
      eventType: "started",
      attributes: {},
      payload: { decision: "started" },
    } as const;
    const first = createProviderOpsEnvelope({ ...input, instanceId: "replica-a" });
    const replay = createProviderOpsEnvelope({ ...input, instanceId: "replica-b" });
    expect(first.recordId).toBe(replay.recordId);
    expect(first.recordHash).toBe(replay.recordHash);
  });

  it("redacts credential text and handles circular arrays without recursion failure", () => {
    const sanitizer = new TelemetrySanitizer();
    const circular: unknown[] = [];
    circular.push(circular);
    expect(sanitizer.sanitize(circular)).toEqual(["[REDACTED_CIRCULAR]"]);
    expect(
      JSON.stringify(sanitizer.sanitize("url=https://host/?api_key=classified&cookie=session")),
    ).not.toContain("classified");
  });

  it("bounds metric label values and exposes telemetry self-monitoring instruments", async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const telemetry = new ProviderTelemetry({
      resource: {
        serviceVersion: "1.1.0",
        instanceId: "completion-metrics",
        deploymentEnvironment: "test",
        providerId: "provider",
        providerVersion: "1.0.0",
      },
      enabled: true,
      metricReader: new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: 60_000,
      }),
    });
    telemetry.start();
    telemetry.metric("telemetry_events_dropped_total", 1, {
      signal: "arbitrary-signal",
      reason: "arbitrary-reason",
    });
    await telemetry.shutdown();
    const point = exporter
      .getMetrics()
      .flatMap((batch) => batch.scopeMetrics)
      .flatMap((scope) => scope.metrics)
      .find((metric) => metric.descriptor.name === "telemetry_events_dropped_total")
      ?.dataPoints.at(0);
    expect(point?.attributes).toEqual({ signal: "other", reason: "other" });
  });

  it("declares secure production OTLP and Provider ingress configuration", () => {
    const config = root("apps/runtime/src/config.ts");
    for (const key of [
      "OTEL_EXPORTER_OTLP_TLS_MODE",
      "OTEL_EXPORTER_OTLP_HEADERS_FILE",
      "PROVIDER_TELEMETRY_INGRESS_ENABLED",
      "PROVIDER_TELEMETRY_TLS_MODE",
    ]) {
      expect(config).toContain(key);
    }
  });
});
