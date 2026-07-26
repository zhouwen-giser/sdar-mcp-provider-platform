import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-node";
import { describe, expect, it } from "vitest";
import { ProviderTelemetry } from "../../packages/observability/src/index.js";

describe("ProviderTelemetry shutdown", () => {
  it("flushes queued spans and events and remains idempotent", async () => {
    const spans = new RetainingSpanExporter();
    const events = new RetainingLogExporter();
    const telemetry = new ProviderTelemetry({
      resource: {
        serviceVersion: "1.1.0",
        instanceId: "runtime-flush",
        deploymentEnvironment: "test",
        providerId: "provider-flush",
        providerVersion: "1.0.0",
      },
      enabled: true,
      spanExporter: spans,
      eventExporter: events,
      batch: { scheduledDelayMillis: 60_000 },
    });
    telemetry.start();
    await telemetry.trace("provider.flush", {}, () => Promise.resolve(undefined));
    telemetry.event("provider.flush_event", { state: "committed" });

    await telemetry.shutdown();
    await telemetry.shutdown();

    expect(spans.getFinishedSpans().map((span) => span.name)).toEqual(["provider.flush"]);
    expect(events.getFinishedLogRecords().map((record) => record.eventName)).toEqual([
      "provider.flush_event",
    ]);
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
