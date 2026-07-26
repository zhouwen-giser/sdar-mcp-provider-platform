import * as grpc from "@grpc/grpc-js";
import { EventEmitter } from "node:events";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-node";
import { describe, expect, it } from "vitest";
import {
  BusinessEventMetricPolicy,
  BusinessEventTelemetryBridge,
  ProviderTelemetry,
  RuntimeMetrics,
} from "../../packages/observability/src/index.js";

const resource = {
  serviceVersion: "2.0.0-rc.1",
  instanceId: "business-event-export-test",
  deploymentEnvironment: "test",
  providerId: "provider-a",
  providerVersion: "1.0.0",
};

describe("Business Event OTel export", () => {
  it("exports sanitized diagnostic logs and trace attributes", async () => {
    const spans = new RetainingSpanExporter();
    const logs = new RetainingLogExporter();
    const telemetry = new ProviderTelemetry({
      resource,
      enabled: true,
      spanExporter: spans,
      eventExporter: logs,
      metricReader: metricReader(),
      batch: { scheduledDelayMillis: 1 },
    });
    telemetry.start();
    const bridge = new BusinessEventTelemetryBridge(
      new RuntimeMetrics(),
      telemetry,
      new BusinessEventMetricPolicy(["source-a"]),
    );
    bridge.event("business_events.source.rejected", {
      sourceId: "source-a",
      outcome: "rejected",
      reasonCode: "SOURCE_POISON_EVENT",
      rawPayload: "password=secret",
      resourceRef: "resource-secret",
      stack: "stack-secret",
    });
    await bridge.trace(
      "business_events.source.ingest",
      {
        sourceId: "source-a",
        outcome: "received",
        rawPayload: "secret",
        taskId: "task-secret",
      },
      () => Promise.resolve("ok"),
    );
    await telemetry.shutdown();

    expect(spans.getFinishedSpans()[0]?.attributes).toMatchObject({
      sourceId: "source-a",
      outcome: "received",
    });
    expect(spans.getFinishedSpans()[0]?.attributes).not.toHaveProperty("rawPayload");
    expect(spans.getFinishedSpans()[0]?.attributes).not.toHaveProperty("taskId");
    const body = logs.getFinishedLogRecords()[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ sourceId: "source-a", outcome: "rejected" });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("injects W3C context and ends the gRPC client stream span", async () => {
    const spans = new RetainingSpanExporter();
    const telemetry = new ProviderTelemetry({
      resource,
      enabled: true,
      spanExporter: spans,
      metricReader: metricReader(),
    });
    telemetry.start();
    const stream = new EventEmitter() as unknown as grpc.ClientReadableStream<unknown>;
    let metadata: grpc.Metadata | undefined;
    const returned = telemetry.traceAdapterStreamRpc(
      "streamBusinessEvents",
      { sourceId: "source-a", rawPayload: "secret" },
      (value) => {
        metadata = value;
        return stream;
      },
    );
    expect(returned).toBe(stream);
    expect(metadata?.get("traceparent")[0]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    stream.emit("end");
    await telemetry.shutdown();
    const span = spans
      .getFinishedSpans()
      .find((item) => item.name === "adapter.rpc.stream_business_events");
    expect(span?.kind).toBe(2);
    expect(span?.attributes).toMatchObject({
      "rpc.system": "grpc",
      "rpc.method": "streamBusinessEvents",
      "rpc.grpc.status_code": grpc.status.OK,
      outcome: "success",
      sourceId: "source-a",
    });
    expect(span?.attributes).not.toHaveProperty("rawPayload");
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

function metricReader(): PeriodicExportingMetricReader {
  return new PeriodicExportingMetricReader({
    exporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    exportIntervalMillis: 60_000,
  });
}
