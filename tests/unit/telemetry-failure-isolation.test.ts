import type { LogRecordExporter, ReadableLogRecord } from "@opentelemetry/sdk-logs";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-node";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-node";
import { describe, expect, it } from "vitest";
import { ProviderTelemetry } from "../../packages/observability/src/index.js";

describe("Provider telemetry failure isolation", () => {
  it.each(["exception_message_is_not_exported", "exception_stack_is_not_exported"])(
    "%s",
    async () => {
      const spans = new RetainingSpanExporter();
      const telemetry = new ProviderTelemetry({
        resource: {
          serviceVersion: "1.1.0",
          instanceId: "safe-exception",
          deploymentEnvironment: "test",
          providerId: "failure-provider",
          providerVersion: "1.0.0",
        },
        enabled: true,
        spanExporter: spans,
        metricReader: new PeriodicExportingMetricReader({
          exporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
          exportIntervalMillis: 60_000,
        }),
      });
      telemetry.start();
      const failure = new Error("classified database url and token=classified");
      failure.stack = "classified-stack /secret/path";
      await expect(
        telemetry.trace("provider.safe_failure", {}, () => Promise.reject(failure)),
      ).rejects.toBe(failure);
      await telemetry.shutdown();
      const exported = JSON.stringify(
        spans.getFinishedSpans().map((span) => ({
          attributes: span.attributes,
          events: span.events,
          status: span.status,
        })),
      );
      expect(exported).not.toMatch(/classified|secret\/path|database url/);
      expect(exported).toContain("error.type");
    },
  );

  it("keeps business execution successful when export times out and queues overflow", async () => {
    const telemetry = new ProviderTelemetry({
      resource: {
        serviceVersion: "1.1.0",
        instanceId: "runtime-failure-isolation",
        deploymentEnvironment: "test",
        providerId: "failure-provider",
        providerVersion: "1.0.0",
      },
      enabled: true,
      spanExporter: new NeverCompletesSpanExporter(),
      eventExporter: new NeverCompletesLogExporter(),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
        exportIntervalMillis: 60_000,
      }),
      batch: {
        maxQueueSize: 1,
        maxExportBatchSize: 1,
        scheduledDelayMillis: 1,
        exportTimeoutMillis: 10,
      },
    });
    telemetry.start();

    let executions = 0;
    await expect(
      telemetry.trace("provider.business", {}, () => {
        executions += 1;
        return Promise.resolve("task_create_success");
      }),
    ).resolves.toBe("task_create_success");
    expect(executions).toBe(1);
    for (let index = 0; index < 20; index += 1) {
      telemetry.event("provider.queue_pressure", { index });
      telemetry.metric("provider_command_total", 1, { outcome: "success" });
    }

    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });
});

class RetainingSpanExporter extends InMemorySpanExporter {
  override shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

class NeverCompletesSpanExporter implements SpanExporter {
  export(spans: ReadableSpan[], resultCallback: Parameters<SpanExporter["export"]>[1]): void {
    void spans;
    void resultCallback;
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

class NeverCompletesLogExporter implements LogRecordExporter {
  export(
    logs: ReadableLogRecord[],
    resultCallback: Parameters<LogRecordExporter["export"]>[1],
  ): void {
    void logs;
    void resultCallback;
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
