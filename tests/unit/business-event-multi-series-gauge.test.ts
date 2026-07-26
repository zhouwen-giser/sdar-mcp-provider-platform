import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { describe, expect, it } from "vitest";
import { ProviderTelemetry } from "../../packages/observability/src/index.js";

describe("Business Event multi-series gauges", () => {
  it("retains one observable series per bounded source id", async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const telemetry = new ProviderTelemetry({
      resource: {
        serviceVersion: "2.0.0-rc.1",
        instanceId: "runtime-business-event-gauge",
        deploymentEnvironment: "test",
        providerId: "provider-a",
        providerVersion: "1.0.0",
      },
      enabled: true,
      boundedDynamicMetricValues: { sourceId: new Set(["source-a", "source-b"]) },
      metricReader: new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: 60_000,
      }),
    });
    telemetry.start();
    telemetry.metric(
      "sdar_business_event_publication_barrier_waiting",
      1,
      { sourceId: "source-a" },
      "gauge",
    );
    telemetry.metric(
      "sdar_business_event_publication_barrier_waiting",
      0,
      { sourceId: "source-b" },
      "gauge",
    );
    telemetry.metric(
      "sdar_business_event_publication_barrier_waiting",
      1,
      { sourceId: "unregistered" },
      "gauge",
    );
    await telemetry.shutdown();

    const metric = exporter
      .getMetrics()
      .flatMap((batch) => batch.scopeMetrics)
      .flatMap((scope) => scope.metrics)
      .find((item) => item.descriptor.name === "sdar_business_event_publication_barrier_waiting");
    expect(metric?.dataPoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 1, attributes: { sourceId: "source-a" } }),
        expect.objectContaining({ value: 0, attributes: { sourceId: "source-b" } }),
        expect.objectContaining({ value: 1, attributes: { sourceId: "other" } }),
      ]),
    );
  });
});
