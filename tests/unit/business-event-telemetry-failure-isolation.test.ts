import { describe, expect, it, vi } from "vitest";
import {
  BusinessEventMetricPolicy,
  BusinessEventTelemetryBridge,
} from "../../packages/observability/src/index.js";

describe("Business Event telemetry failure isolation", () => {
  it("does not replace metric, gauge, log or pre-invocation trace business results", async () => {
    const businessOperation = vi.fn(() => Promise.resolve("committed"));
    const bridge = new BusinessEventTelemetryBridge(
      {
        increment: () => {
          throw new Error("runtime metric failure");
        },
      },
      {
        metric: () => {
          throw new Error("OTLP metric failure");
        },
        event: () => {
          throw new Error("OTLP log failure");
        },
        trace: () => {
          throw new Error("OTLP trace initialization failure");
        },
      },
      new BusinessEventMetricPolicy(["source-a"]),
      new Proxy(
        {},
        {
          set: () => {
            throw new Error("Prometheus gauge failure");
          },
        },
      ),
    );
    expect(() =>
      bridge.increment("sdar_business_event_source_duplicate_total", { sourceId: "source-a" }),
    ).not.toThrow();
    expect(() =>
      bridge.gauge("sdar_business_event_publication_barrier_waiting", 1, { sourceId: "source-a" }),
    ).not.toThrow();
    expect(() =>
      bridge.event("business_events.source.connection", { sourceId: "source-a" }),
    ).not.toThrow();
    await expect(
      bridge.trace("business_events.source.ingest", { sourceId: "source-a" }, businessOperation),
    ).resolves.toBe("committed");
    expect(businessOperation).toHaveBeenCalledOnce();
  });

  it("preserves a business error after the traced operation starts", async () => {
    const expected = new Error("BUSINESS_EVENT_STALE_FENCE");
    const bridge = new BusinessEventTelemetryBridge(
      { increment: () => undefined },
      { metric: () => undefined, trace: (_name, _attributes, operation) => operation() },
      new BusinessEventMetricPolicy(["source-a"]),
    );
    await expect(
      bridge.trace("business_events.source.ingest", { sourceId: "source-a" }, () =>
        Promise.reject(expected),
      ),
    ).rejects.toBe(expected);
  });
});
