import { describe, expect, it, vi } from "vitest";
import {
  BusinessEventMetricPolicy,
  BusinessEventTelemetryBridge,
} from "../../packages/observability/src/business-event-metrics.js";

describe("BusinessEventTelemetryBridge", () => {
  it("emits the same bounded counter to Prometheus and OTLP", () => {
    const runtime = { increment: vi.fn() };
    const provider = { metric: vi.fn() };
    const bridge = new BusinessEventTelemetryBridge(
      runtime,
      provider,
      new BusinessEventMetricPolicy(["source-a"]),
    );
    bridge.increment("sdar_business_event_source_duplicate_total", { sourceId: "source-a" });
    expect(runtime.increment).toHaveBeenCalledWith(
      "sdar_business_event_source_duplicate_total",
      { sourceId: "source-a" },
      1,
    );
    expect(provider.metric).toHaveBeenCalledWith(
      "sdar_business_event_source_duplicate_total",
      1,
      { sourceId: "source-a" },
      "counter",
    );
  });

  it("is fail-open for both sinks", () => {
    const bridge = new BusinessEventTelemetryBridge(
      {
        increment: () => {
          throw new Error("prometheus unavailable");
        },
      },
      {
        metric: () => {
          throw new Error("otlp unavailable");
        },
      },
      new BusinessEventMetricPolicy(["source-a"]),
    );
    expect(() =>
      bridge.increment("sdar_business_event_source_duplicate_total", { sourceId: "source-a" }),
    ).not.toThrow();
  });
});
