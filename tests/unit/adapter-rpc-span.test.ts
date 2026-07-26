import { SpanStatusCode } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-node";
import { describe, expect, it } from "vitest";
import { ProviderTelemetry } from "../../packages/observability/src/index.js";

const resource = {
  serviceVersion: "1.1.0",
  instanceId: "runtime-test-1",
  deploymentEnvironment: "test",
  providerId: "telemetry-provider",
  providerVersion: "1.0.0",
};

describe("Adapter RPC spans", () => {
  it.each(["success", "error"] as const)(
    "records %s without request or response payloads",
    async (outcome) => {
      const exporter = new RetainingSpanExporter();
      const telemetry = new ProviderTelemetry({
        resource,
        enabled: true,
        spanExporter: exporter,
        batch: { scheduledDelayMillis: 60_000 },
      });
      telemetry.start();

      let activeDuringRpc = false;
      let propagatedTraceparent = "";
      const operation = telemetry.traceAdapterRpc(
        "startOperation",
        {
          taskId: "task-1",
          externalExecutionId: "execution-1",
          operationName: "durable_task",
          commandSequence: 7,
        },
        (metadata) => {
          activeDuringRpc = telemetry.currentTraceContext() !== null;
          propagatedTraceparent = String(metadata.get("traceparent")[0] ?? "");
          return outcome === "success"
            ? Promise.resolve("accepted")
            : Promise.reject(new Error("adapter failed"));
        },
      );
      if (outcome === "success") await expect(operation).resolves.toBe("accepted");
      else await expect(operation).rejects.toThrow("adapter failed");
      await telemetry.shutdown();

      const span = exporter.getFinishedSpans()[0];
      expect(span).toMatchObject({
        name: "adapter.rpc",
        attributes: {
          "rpc.system": "grpc",
          "rpc.method": "startOperation",
          "server.address": "telemetry-provider",
          taskId: "task-1",
          externalExecutionId: "execution-1",
          operationName: "durable_task",
          commandSequence: 7,
        },
        status: {
          code: outcome === "success" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
        },
      });
      expect(activeDuringRpc).toBe(true);
      expect(propagatedTraceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
      expect(JSON.stringify(span?.attributes)).not.toMatch(
        /request|response|argument|payload|token/i,
      );
    },
  );

  it("creates an Adapter child span under the extracted MCP request trace", async () => {
    const exporter = new RetainingSpanExporter();
    const telemetry = new ProviderTelemetry({ resource, enabled: true, spanExporter: exporter });
    telemetry.start();
    const upstreamTraceId = "1".repeat(32);
    await telemetry.traceRequest(
      "mcp.tools.call",
      { traceparent: `00-${upstreamTraceId}-${"2".repeat(16)}-01` },
      {},
      () => telemetry.traceAdapterRpc("startOperation", {}, () => Promise.resolve(undefined)),
    );
    await telemetry.shutdown();

    const root = exporter.getFinishedSpans().find((span) => span.name === "mcp.tools.call");
    const child = exporter.getFinishedSpans().find((span) => span.name === "adapter.rpc");
    expect(root?.spanContext().traceId).toBe(upstreamTraceId);
    expect(child?.spanContext().traceId).toBe(upstreamTraceId);
    expect(child?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId);
  });

  it("provider_event_joins_task_trace with an OTel link", async () => {
    const exporter = new RetainingSpanExporter();
    const telemetry = new ProviderTelemetry({ resource, enabled: true, spanExporter: exporter });
    telemetry.start();
    const providerTraceId = "3".repeat(32);
    const taskTraceId = "4".repeat(32);
    await telemetry.traceProviderEvent(
      {
        providerTraceparent: `00-${providerTraceId}-${"5".repeat(16)}-01`,
        taskTraceparent: `00-${taskTraceId}-${"6".repeat(16)}-01`,
        eventType: "execution.progress",
      },
      () => Promise.resolve(undefined),
    );
    await telemetry.shutdown();

    const span = exporter
      .getFinishedSpans()
      .find((candidate) => candidate.name === "provider.event");
    expect(span?.spanContext().traceId).toBe(providerTraceId);
    expect(span?.links.map((link) => link.context.traceId)).toEqual([taskTraceId]);
  });

  it("dispatcher_span_links_to_original_task_trace through its persisted parent", async () => {
    const exporter = new RetainingSpanExporter();
    const telemetry = new ProviderTelemetry({ resource, enabled: true, spanExporter: exporter });
    telemetry.start();
    const taskTraceId = "7".repeat(32);
    await telemetry.traceAdapterRpc(
      "updateExecution",
      { taskId: "task-1" },
      () => Promise.resolve(undefined),
      { traceparent: `00-${taskTraceId}-${"8".repeat(16)}-01` },
    );
    await telemetry.shutdown();
    expect(exporter.getFinishedSpans()[0]?.spanContext().traceId).toBe(taskTraceId);
  });
});

class RetainingSpanExporter extends InMemorySpanExporter {
  override shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
