import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import type { LogRecordExporter, ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { describe, expect, it } from "vitest";
import { ProviderTelemetry } from "../../packages/observability/src/index.js";

const resource = {
  serviceVersion: "1.1.0",
  instanceId: "runtime-metrics",
  deploymentEnvironment: "test",
  providerId: "metrics-provider",
  providerVersion: "1.0.0",
};

describe("Provider OTel metrics", () => {
  it.each([
    ["unknown_metric_label_value_becomes_other", { status: "adapter-free-text" }],
    ["arbitrary_reason_code_does_not_create_series", { reasonCode: "ADAPTER_TEXT_12345" }],
    [
      "metric_labels_are_bounded_by_key_and_value",
      { commandType: "DELETE", source: "custom-source", taskId: "forbidden" },
    ],
  ])("%s", async (_name, attributes) => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const telemetry = metricTelemetry(exporter);
    telemetry.start();
    telemetry.metric("provider_command_total", 1, attributes);
    await telemetry.shutdown();
    const point = metricPoint(exporter, "provider_command_total");
    expect(Object.values(point?.attributes ?? {})).toEqual(
      expect.arrayContaining(
        Object.keys(attributes)
          .filter((key) => key !== "taskId")
          .map(() => "other"),
      ),
    );
    expect(point?.attributes).not.toHaveProperty("taskId");
  });

  it("queue_full_increments_drop_counter", async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const telemetry = metricTelemetry(exporter, {
      eventExporter: new NeverCompletesLogExporter(),
      batch: {
        maxQueueSize: 1,
        maxExportBatchSize: 1,
        scheduledDelayMillis: 60_000,
        exportTimeoutMillis: 5,
      },
    });
    telemetry.start();
    telemetry.event("first", {});
    telemetry.event("dropped", {});
    await telemetry.shutdown();
    expect(metricPoint(exporter, "telemetry_events_dropped_total")).toMatchObject({
      value: 1,
      attributes: { signal: "log", reason: "queue_full" },
    });
  });

  it("export_timeout_increments_failure_counter", async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const telemetry = metricTelemetry(exporter, {
      eventExporter: new NeverCompletesLogExporter(),
      batch: {
        maxQueueSize: 2,
        maxExportBatchSize: 1,
        scheduledDelayMillis: 1,
        exportTimeoutMillis: 5,
      },
    });
    telemetry.start();
    telemetry.event("timeout", {});
    await new Promise((resolve) => setTimeout(resolve, 15));
    await telemetry.shutdown();
    expect(metricPoint(exporter, "telemetry_export_failed_total")).toMatchObject({
      value: 1,
      attributes: { signal: "log", reason: "timeout" },
    });
  });

  it("exports the required instruments with bounded low-cardinality labels", async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const telemetry = new ProviderTelemetry({
      resource,
      enabled: true,
      metricReader: new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: 60_000,
      }),
    });
    telemetry.start();

    for (const name of [
      "provider_task_transition_total",
      "provider_command_total",
      "adapter_rpc_total",
      "provider_error_total",
      "provider_recovery_total",
    ]) {
      telemetry.metric(name, 2, {
        method: "startOperation",
        outcome: "success",
        taskId: "must-not-be-a-label",
        argumentHash: "must-not-be-a-label",
        userId: "must-not-be-a-label",
      });
    }
    for (const name of [
      "adapter_rpc_duration",
      "command_dispatch_duration",
      "task_transition_duration",
      "recovery_duration",
    ]) {
      telemetry.metric(name, 12.5, { outcome: "success" }, "histogram");
    }
    for (const name of ["active_tasks", "pending_commands", "outbox_pending", "recovery_backlog"]) {
      telemetry.metric(name, 3, {}, "gauge");
    }

    await telemetry.shutdown();

    const metrics = exporter
      .getMetrics()
      .flatMap((batch) => batch.scopeMetrics)
      .flatMap((scope) => scope.metrics);
    expect(new Set(metrics.map((metric) => metric.descriptor.name))).toEqual(
      new Set([
        "provider_task_transition_total",
        "provider_command_total",
        "adapter_rpc_total",
        "provider_error_total",
        "provider_recovery_total",
        "adapter_rpc_duration",
        "command_dispatch_duration",
        "task_transition_duration",
        "recovery_duration",
        "active_tasks",
        "pending_commands",
        "outbox_pending",
        "recovery_backlog",
        "telemetry_events_emitted_total",
        "telemetry_queue_depth",
      ]),
    );
    const counter = metrics.find(
      (metric) => metric.descriptor.name === "provider_task_transition_total",
    );
    expect(counter?.dataPoints[0]).toMatchObject({
      value: 2,
      attributes: { method: "startOperation", outcome: "success" },
    });
    expect(counter?.dataPoints[0]?.attributes).not.toHaveProperty("taskId");
    expect(counter?.dataPoints[0]?.attributes).not.toHaveProperty("argumentHash");
    expect(counter?.dataPoints[0]?.attributes).not.toHaveProperty("userId");
  });
});

function metricTelemetry(
  exporter: InMemoryMetricExporter,
  options: Partial<ConstructorParameters<typeof ProviderTelemetry>[0]> = {},
): ProviderTelemetry {
  return new ProviderTelemetry({
    resource,
    enabled: true,
    metricReader: new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60_000,
    }),
    ...options,
  });
}

function metricPoint(exporter: InMemoryMetricExporter, name: string) {
  return exporter
    .getMetrics()
    .flatMap((batch) => batch.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .find((metric) => metric.descriptor.name === name)
    ?.dataPoints.at(0);
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
