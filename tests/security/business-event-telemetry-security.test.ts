import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-node";
import { describe, expect, it } from "vitest";
import {
  BusinessEventMetricPolicy,
  BusinessEventTelemetryBridge,
  createBusinessEventProviderOpsEnvelope,
  ProviderTelemetry,
  RuntimeMetrics,
} from "../../packages/observability/src/index.js";

const forbiddenValues = [
  "raw-secret",
  "envelope-secret",
  "description-secret",
  "task-secret",
  "resource-secret",
  "projection-secret",
  "authorization-secret",
  "password-secret",
  "token-secret",
  "stack-secret",
] as const;

describe("Business Event telemetry export security", () => {
  it("keeps malicious fields out of audit, log, trace, metric and Prometheus exports", async () => {
    const spans = new RetainingSpanExporter();
    const logs = new RetainingLogExporter();
    const audits = new RetainingLogExporter();
    const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const telemetry = new ProviderTelemetry({
      resource: {
        serviceVersion: "2.0.0-rc.1",
        instanceId: "security-test",
        deploymentEnvironment: "test",
        providerId: "provider-a",
        providerVersion: "1.0.0",
      },
      enabled: true,
      boundedDynamicMetricValues: { sourceId: new Set(["source-a"]) },
      spanExporter: spans,
      eventExporter: logs,
      auditExporter: audits,
      metricReader: new PeriodicExportingMetricReader({
        exporter: metrics,
        exportIntervalMillis: 60_000,
      }),
      batch: { scheduledDelayMillis: 1 },
    });
    telemetry.start();
    const runtimeMetrics = new RuntimeMetrics();
    const prometheusGauges: Record<string, number> = {};
    const bridge = new BusinessEventTelemetryBridge(
      runtimeMetrics,
      telemetry,
      new BusinessEventMetricPolicy(["source-a"]),
      prometheusGauges,
    );
    const malicious = {
      sourceId: "source-a",
      outcome: "rejected",
      reasonCode: "SOURCE_POISON_EVENT",
      rawPayload: forbiddenValues[0],
      rawEnvelopeJson: forbiddenValues[1],
      description: forbiddenValues[2],
      relatedTaskIds: [forbiddenValues[3]],
      resourceRef: forbiddenValues[4],
      projectionToken: forbiddenValues[5],
      authorizationContextHash: forbiddenValues[6],
      password: forbiddenValues[7],
      token: forbiddenValues[8],
      stack: forbiddenValues[9],
    };
    bridge.increment("sdar_business_event_source_rejected_total", {
      sourceId: "source-a",
      reason: "poison_event",
    });
    bridge.gauge("sdar_business_event_publication_barrier_waiting", 1, { sourceId: "source-a" });
    bridge.event("business_events.source.rejected", malicious);
    await bridge.trace(
      "business_events.source.ingest",
      malicious as unknown as Record<string, string | number | boolean>,
      () => Promise.resolve(undefined),
    );
    const envelope = createBusinessEventProviderOpsEnvelope(
      { runtimeVersion: "2.0.0-rc.1", instanceId: "security-test" },
      {
        providerId: "provider-a",
        recordType: "provider.business_event.ingest.lifecycle",
        stableAggregateIdentity: "source-a:stream-a:event-a",
        eventIdentity: "rejected",
        revision: "1",
        occurredAt: "2026-07-22T00:00:00Z",
        payload: { ...malicious, event: "rejected", sourceId: "source-a", sourceSequence: "1" },
      },
    );
    await telemetry.exportAudit([envelope]);
    await telemetry.shutdown();

    const exported = JSON.stringify({
      audit: audits.getFinishedLogRecords().map((record) => record.body),
      log: logs.getFinishedLogRecords().map((record) => record.body),
      trace: spans.getFinishedSpans().map((span) => span.attributes),
      metrics: metrics.getMetrics(),
      prometheus: runtimeMetrics.render(prometheusGauges),
    });
    for (const secret of forbiddenValues) expect(exported).not.toContain(secret);
    expect(envelope.schemaVersion).toBe("1.1.0");
  });

  it("rejects forbidden labels and bounds unregistered sources to other", () => {
    const runtime = new RuntimeMetrics();
    const bridge = new BusinessEventTelemetryBridge(
      runtime,
      undefined,
      new BusinessEventMetricPolicy(["source-a"]),
    );
    expect(() =>
      bridge.increment("sdar_business_event_source_duplicate_total", {
        sourceId: "source-a",
        eventId: "must-not-be-a-label",
      }),
    ).toThrow("BUSINESS_EVENT_METRIC_LABEL_FORBIDDEN");
    bridge.increment("sdar_business_event_source_duplicate_total", { sourceId: "unknown" });
    expect(runtime.render()).toContain('sourceId="other"');
    expect(runtime.render()).not.toContain("unknown");
  });
});

class RetainingSpanExporter extends InMemorySpanExporter {
  override shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

class RetainingLogExporter extends InMemoryLogRecordExporter {
  override shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
