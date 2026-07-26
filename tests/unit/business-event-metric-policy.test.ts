import { describe, expect, it } from "vitest";
import {
  BUSINESS_EVENT_METRIC_DEFINITIONS,
  BusinessEventMetricPolicy,
} from "../../packages/observability/src/business-event-metrics.js";

describe("BusinessEventMetricPolicy", () => {
  it("locks the fifteen frozen metric names", () => {
    expect(Object.keys(BUSINESS_EVENT_METRIC_DEFINITIONS)).toHaveLength(15);
  });

  it("accepts only registered source ids and exact metric labels", () => {
    const policy = new BusinessEventMetricPolicy(["source-a", "source-b"]);
    expect(
      policy.attributes("sdar_business_event_source_received_total", {
        sourceId: "source-a",
        outcome: "received",
      }),
    ).toEqual({ sourceId: "source-a", outcome: "received" });
    expect(
      policy.attributes("sdar_business_event_source_received_total", {
        sourceId: "unregistered",
        outcome: "invented free text",
      }),
    ).toEqual({ sourceId: "other", outcome: "other" });
    expect(() =>
      policy.attributes("sdar_business_event_source_received_total", {
        sourceId: "source-a",
        outcome: "received",
        eventId: "secret",
      }),
    ).toThrow("BUSINESS_EVENT_METRIC_LABEL_FORBIDDEN");
  });

  it("rejects a source roster above the frozen maximum", () => {
    expect(
      () => new BusinessEventMetricPolicy(Array.from({ length: 17 }, (_, i) => `s-${String(i)}`)),
    ).toThrow("BUSINESS_EVENT_SOURCE_COUNT_INVALID");
  });
});
