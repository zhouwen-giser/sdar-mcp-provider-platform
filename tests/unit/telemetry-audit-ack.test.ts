import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { LogRecordExporter, ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { createServer } from "node:http";
import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProviderOpsEnvelope,
  ProviderTelemetry,
} from "../../packages/observability/src/index.js";
import {
  ProviderOpsDeliveryRepository,
  type ProviderOpsDeliveryRecord,
} from "../../packages/persistence-postgres/src/index.js";
import { DurableProviderOpsPublisher } from "../../packages/task-engine/src/durable-provider-ops-publisher.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe("audit exporter acknowledgement", () => {
  it("waits for the actual callback and preserves SDK resource, timestamp and batch records", async () => {
    const exporter = new ControlledExporter();
    const telemetry = setup(exporter);
    const records = [envelope("first"), envelope("second")];
    let settled = false;
    const pending = telemetry.exportAudit(records).then(() => {
      settled = true;
    });
    await turn();
    expect(settled).toBe(false);
    expect(exporter.calls).toHaveLength(1);
    const call = exporter.call(0);
    expect(call.logs.map((record) => record.attributes["sdar.record.id"])).toEqual(
      records.map((record) => record.recordId),
    );
    expect(call.logs[0]?.resource.attributes["sdar.provider.id"]).toBe("audit-ack-provider");
    expect(call.logs[0]?.hrTime).toEqual([1767225600, 123000000]);
    expect(call.logs[0]?.instrumentationScope.name).toBe("@sdar/provider-ops-telemetry/audit");
    expect(call.logs[0]?.body).toMatchObject({ recordId: records[0]?.recordId });
    call.callback({ code: ExportResultCode.SUCCESS });
    await pending;
    expect(settled).toBe(true);
  });

  it("isolates concurrent batches whose callbacks finish out of order with mixed results", async () => {
    const exporter = new ControlledExporter();
    const telemetry = setup(exporter);
    const first = telemetry.exportAudit([envelope("first")]);
    const second = telemetry.exportAudit([envelope("second")]);
    const firstResult = first.then(
      () => "success",
      () => "failed",
    );
    exporter.call(1).callback({ code: ExportResultCode.SUCCESS });
    await expect(second).resolves.toBeUndefined();
    exporter.call(0).callback({
      code: ExportResultCode.FAILED,
      error: new Error("Concurrent export limit reached"),
    });
    expect(await firstResult).toBe("failed");
  });

  it("rejects synchronous exporter exceptions", async () => {
    const exporter = new ControlledExporter();
    vi.spyOn(exporter, "export").mockImplementation(() => {
      throw new Error("exporter unavailable");
    });
    const telemetry = setup(exporter);
    await expect(telemetry.exportAudit([envelope("throw")])).rejects.toThrow(
      "TELEMETRY_AUDIT_EXPORT_FAILED",
    );
  });

  it("rejects missing callbacks at the deadline and ignores a late success without affecting retry", async () => {
    const exporter = new ControlledExporter();
    const telemetry = setup(exporter, 20);
    await expect(telemetry.exportAudit([envelope("timeout")])).rejects.toThrow(
      "TELEMETRY_AUDIT_EXPORT_TIMEOUT",
    );
    const retry = telemetry.exportAudit([envelope("timeout")]);
    exporter.call(0).callback({ code: ExportResultCode.SUCCESS });
    let retried = false;
    void retry.then(() => {
      retried = true;
    });
    await turn();
    expect(retried).toBe(false);
    exporter.call(1).callback({ code: ExportResultCode.SUCCESS });
    await retry;
  });

  it("keeps the actual durable publisher in retry state on failed callback and delivers only after successful retry", async () => {
    const exporter = new ControlledExporter();
    const telemetry = setup(exporter);
    const pool = new Pool();
    cleanup.push(() => pool.end());
    const repository = new ProviderOpsDeliveryRepository(pool);
    const record: ProviderOpsDeliveryRecord = {
      recordId: "record-1",
      eventKey: "event-1",
      recordType: "provider.task.lifecycle",
      eventCategory: "task.lifecycle",
      deliveryClass: "audit",
      aggregateType: "task",
      aggregateId: "task-1",
      occurredAt: new Date(),
      recordBody: envelope("publisher"),
      state: "CLAIMED",
      attemptCount: 1,
      nextAttemptAt: new Date(),
      claimOwner: "owner",
      claimUntil: new Date(Date.now() + 30000),
    };
    vi.spyOn(repository, "claimDue").mockResolvedValue([record]);
    const delivered = vi.spyOn(repository, "markDelivered").mockResolvedValue(true);
    const failure = vi.spyOn(repository, "recordFailure").mockResolvedValue("RETRY_WAIT");
    const publisher = new DurableProviderOpsPublisher(
      repository,
      {
        export: async (records) => telemetry.exportAudit(records.map((value) => value.recordBody)),
      },
      "owner",
    );
    const first = publisher.tick();
    await turn();
    expect(delivered).not.toHaveBeenCalled();
    exporter.call(0).callback({ code: ExportResultCode.FAILED, error: new Error("HTTP 503") });
    expect(await first).toMatchObject({ delivered: 0, retried: 1 });
    expect(failure).toHaveBeenCalledOnce();
    expect(delivered).not.toHaveBeenCalled();
    const retry = publisher.tick();
    await turn();
    expect(delivered).not.toHaveBeenCalled();
    exporter.call(1).callback({ code: ExportResultCode.SUCCESS });
    expect(await retry).toMatchObject({ delivered: 1, retried: 0 });
    expect(delivered).toHaveBeenCalledOnce();
  });

  it("waits for in-flight audit acknowledgement during shutdown and refuses new exports", async () => {
    const exporter = new ControlledExporter();
    const telemetry = setup(exporter);
    const pending = telemetry.exportAudit([envelope("shutdown")]);
    let stopped = false;
    const shutdown = telemetry.shutdown().then(() => {
      stopped = true;
    });
    await turn();
    expect(stopped).toBe(false);
    await expect(telemetry.exportAudit([envelope("too-late")])).rejects.toThrow(
      "TELEMETRY_AUDIT_EXPORT_UNAVAILABLE",
    );
    exporter.call(0).callback({ code: ExportResultCode.SUCCESS });
    await pending;
    await shutdown;
    expect(stopped).toBe(true);
  });

  it("propagates real OTLP HTTP rejection and succeeds on a subsequent acknowledged request", async () => {
    let requests = 0;
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        requests++;
        response.writeHead(requests === 1 ? 400 : 200, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanup.push(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("test server did not bind");
    const telemetry = setup(
      new OTLPLogExporter({ url: `http://127.0.0.1:${address.port}/v1/logs`, timeoutMillis: 1000 }),
    );
    await expect(telemetry.exportAudit([envelope("http")])).rejects.toThrow(
      "TELEMETRY_AUDIT_EXPORT_FAILED",
    );
    await expect(telemetry.exportAudit([envelope("http")])).resolves.toBeUndefined();
    expect(requests).toBe(2);
  });
});

class ControlledExporter implements LogRecordExporter {
  readonly calls: { logs: ReadableLogRecord[]; callback: (result: ExportResult) => void }[] = [];
  export(logs: ReadableLogRecord[], callback: (result: ExportResult) => void): void {
    this.calls.push({ logs, callback });
  }
  call(index: number) {
    const call = this.calls[index];
    if (call === undefined) throw new Error(`Missing exporter call ${index}`);
    return call;
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

function setup(exporter: LogRecordExporter, timeout = 1000) {
  const telemetry = new ProviderTelemetry({
    resource: {
      serviceVersion: "1.1.0",
      instanceId: "audit-ack-instance",
      deploymentEnvironment: "test",
      providerId: "audit-ack-provider",
      providerVersion: "1.0.0",
    },
    enabled: true,
    auditExporter: exporter,
    batch: { exportTimeoutMillis: timeout },
  });
  telemetry.start();
  cleanup.push(() => telemetry.shutdown());
  return telemetry;
}

function envelope(id: string) {
  return createProviderOpsEnvelope({
    recordType: "provider.task.lifecycle",
    eventCategory: "task.lifecycle",
    deliveryClass: "audit",
    providerId: "audit-ack-provider",
    runtimeVersion: "1.1.0",
    instanceId: "audit-ack-instance",
    taskId: id,
    stableAggregateIdentity: id,
    eventIdentity: `${id}:started`,
    occurredAt: "2026-01-01T00:00:00.123Z",
    attributes: { source: "test" },
    payload: { currentState: "RUNNING" },
  });
}

async function turn() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
