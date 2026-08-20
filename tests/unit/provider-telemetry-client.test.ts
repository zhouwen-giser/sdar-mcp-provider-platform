import { describe, expect, it, vi } from "vitest";
import {
  grpcStructToRecord,
  recordToGrpcStruct,
  type EmitProviderEventsRequest,
  type ProviderTelemetryStructError,
} from "../../packages/provider-telemetry/src/index.js";
import {
  VehicleTelemetry,
  type VehicleTelemetryOptions,
  type VehicleTelemetryOutcome,
  type VehicleTelemetryTransport,
} from "../../packages/vehicle-provider-core/src/index.js";

describe("Vehicle Provider telemetry delivery client", () => {
  it("round-trips canonical values through google.protobuf.Struct", () => {
    const value = {
      metricName: "temperature",
      value: 12.5,
      quality: "good",
      healthy: true,
      optional: null,
      dimensions: ["front", 2, false, { axis: "x" }],
    };
    expect(grpcStructToRecord(recordToGrpcStruct(value))).toEqual(value);
  });

  it("bounds Struct depth and complexity before recursive decoding", () => {
    let deep: unknown = {
      fields: { leaf: { kind: "stringValue", stringValue: "value" } },
    };
    for (let index = 0; index < 32; index += 1) {
      deep = {
        fields: { nested: { kind: "structValue", structValue: deep } },
      };
    }
    expect(() => grpcStructToRecord(deep)).toThrow(
      expect.objectContaining<Partial<ProviderTelemetryStructError>>({
        reasonCode: "PROVIDER_EVENT_TOO_DEEP",
      }),
    );
    expect(() =>
      grpcStructToRecord(
        {
          fields: {
            first: { kind: "numberValue", numberValue: 1 },
            second: { kind: "numberValue", numberValue: 2 },
          },
        },
        { maxNodes: 2 },
      ),
    ).toThrow(
      expect.objectContaining<Partial<ProviderTelemetryStructError>>({
        reasonCode: "PROVIDER_EVENT_TOO_COMPLEX",
      }),
    );
    expect(() => recordToGrpcStruct({ value: Number.NaN })).toThrow(
      expect.objectContaining<Partial<ProviderTelemetryStructError>>({
        reasonCode: "PROVIDER_EVENT_PAYLOAD_INVALID",
      }),
    );
    expect(() => recordToGrpcStruct({ when: new Date("2026-08-20T00:00:00Z") })).toThrow(
      expect.objectContaining<Partial<ProviderTelemetryStructError>>({
        reasonCode: "PROVIDER_EVENT_PAYLOAD_INVALID",
      }),
    );
    expect(() => recordToGrpcStruct({ values: new Map([["x", 1]]) })).toThrow(
      expect.objectContaining<Partial<ProviderTelemetryStructError>>({
        reasonCode: "PROVIDER_EVENT_PAYLOAD_INVALID",
      }),
    );
  });

  it("parses per-event accepted and duplicate results", async () => {
    const outcomes: VehicleTelemetryOutcome[] = [];
    const transport = new ScriptedTransport((request) => ({
      results: request.events.map((event, index) => ({
        providerEventId: event.providerEventId,
        accepted: true,
        duplicate: index === 1,
        recordId: `record-${String(index + 1)}`,
        reasonCode: "",
        message: "",
      })),
    }));
    const telemetry = client(transport, { onOutcome: (outcome) => outcomes.push(outcome) });

    await telemetry.emit("RESOURCE_STATE", { state: "ready", reasonCode: "UGV_READY" });
    await telemetry.metric("speed_kmh", 0, "km/h", "observed");
    await telemetry.drain();

    expect(telemetry.snapshot()).toMatchObject({
      enqueued: 2,
      sent: 2,
      accepted: 1,
      duplicate: 1,
      rejected: 0,
      transportFailed: 0,
      retry: 0,
      dropped: 0,
      queueDepth: 0,
    });
    expect(outcomes.map(({ kind }) => kind)).toEqual(["accepted", "duplicate"]);
    await telemetry.closeAndDrain();
    expect(transport.closed).toBe(true);
  });

  it("surfaces stable rejection reasons without retaining the response message", async () => {
    const outcomes: VehicleTelemetryOutcome[] = [];
    const transport = new ScriptedTransport((request) => ({
      results: request.events.map((event) => ({
        providerEventId: event.providerEventId,
        accepted: false,
        duplicate: false,
        recordId: "",
        reasonCode: "PROVIDER_EVENT_ID_CONFLICT",
        message: "sensitive server diagnostic must not be retained",
      })),
    }));
    const telemetry = client(transport, { onOutcome: (outcome) => outcomes.push(outcome) });

    await telemetry.emit("RESOURCE_HEALTH", {
      health: "degraded",
      reasonCode: "UGV_DEPENDENCY_DEGRADED",
    });
    await telemetry.drain();

    expect(telemetry.snapshot()).toMatchObject({
      sent: 1,
      accepted: 0,
      rejected: 1,
      retry: 0,
      dropped: 0,
      queueDepth: 0,
      reasonCodes: { PROVIDER_EVENT_ID_CONFLICT: 1 },
    });
    expect(JSON.stringify(outcomes)).not.toContain("sensitive server diagnostic");
    await telemetry.closeAndDrain();
  });

  it("retries transport failure with the same event identity", async () => {
    const eventIds: string[] = [];
    const transport = new ScriptedTransport((request, attempt) => {
      eventIds.push(request.events[0]?.providerEventId ?? "");
      if (attempt === 1) throw new Error("connection unavailable");
      return accepted(request);
    });
    const telemetry = client(transport, { maximumAttempts: 3 });

    await telemetry.emit("RESOURCE_STATE", { state: "ready", reasonCode: "UGV_READY" });
    await telemetry.drain();

    expect(eventIds).toHaveLength(2);
    expect(new Set(eventIds).size).toBe(1);
    expect(telemetry.snapshot()).toMatchObject({
      sent: 2,
      accepted: 1,
      transportFailed: 1,
      retry: 1,
      dropped: 0,
      queueDepth: 0,
    });
    await telemetry.closeAndDrain();
  });

  it("retries a transient Runtime task-binding rejection with the same event identity", async () => {
    const eventIds: string[] = [];
    const transport = new ScriptedTransport((request, attempt) => {
      eventIds.push(request.events[0]?.providerEventId ?? "");
      if (attempt > 1) return accepted(request);
      return {
        results: request.events.map((event) => ({
          providerEventId: event.providerEventId,
          accepted: false,
          duplicate: false,
          recordId: "",
          reasonCode: "PROVIDER_EVENT_EXECUTION_ID_MISMATCH",
          message: "Runtime binding transaction is not visible yet",
        })),
      };
    });
    const telemetry = client(transport, { maximumAttempts: 3 });

    await telemetry.emit(
      "EXECUTION_PROGRESS",
      { current: 0, total: 100, percentage: 0, unit: "percent" },
      {
        taskId: "task-1",
        externalExecutionId: "execution-1",
        operationName: "vehicle_navigate",
      },
    );
    await telemetry.drain();

    expect(eventIds).toHaveLength(2);
    expect(new Set(eventIds).size).toBe(1);
    expect(telemetry.snapshot()).toMatchObject({
      sent: 2,
      accepted: 1,
      rejected: 1,
      retry: 1,
      dropped: 0,
      queueDepth: 0,
    });
    await telemetry.closeAndDrain();
  });

  it("rejects mismatched result identities and drops only after bounded retries", async () => {
    const requestIds: string[] = [];
    const transport = new ScriptedTransport((request) => {
      requestIds.push(request.events[0]?.providerEventId ?? "");
      return {
        results: [
          {
            providerEventId: "different-event-id",
            accepted: true,
            duplicate: false,
            recordId: "record-mismatch",
            reasonCode: "",
            message: "",
          },
        ],
      };
    });
    const telemetry = client(transport, { maximumAttempts: 2 });

    await telemetry.emit("RESOURCE_STATE", { state: "ready", reasonCode: "UGV_READY" });
    await telemetry.drain();

    expect(requestIds).toHaveLength(2);
    expect(new Set(requestIds).size).toBe(1);
    expect(telemetry.snapshot()).toMatchObject({
      sent: 2,
      accepted: 0,
      transportFailed: 2,
      retry: 1,
      dropped: 1,
      queueDepth: 0,
      reasonCodes: {
        PROVIDER_TELEMETRY_RESULT_ID_MISMATCH: 3,
        PROVIDER_TELEMETRY_RETRY_EXHAUSTED: 1,
      },
    });
    await telemetry.closeAndDrain();
  });

  it("uses a bounded queue and prioritizes task progress over resource metrics", async () => {
    const transport = new ScriptedTransport((request) => accepted(request));
    const telemetry = client(transport, { maxQueueSize: 2 });

    await telemetry.metric("speed_kmh", 1, "km/h", "observed");
    await telemetry.emit("RESOURCE_STATE", { state: "ready", reasonCode: "UGV_READY" });
    await telemetry.emit(
      "EXECUTION_PROGRESS",
      { current: 1, total: 100, percentage: 1, unit: "percent" },
      {
        taskId: "task-1",
        externalExecutionId: "execution-1",
        operationName: "vehicle_navigate",
      },
    );
    await telemetry.drain();

    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.events.map(({ eventType }) => eventType)).toEqual([
      "RESOURCE_STATE",
      "EXECUTION_PROGRESS",
    ]);
    expect(telemetry.snapshot()).toMatchObject({
      enqueued: 3,
      accepted: 2,
      dropped: 1,
      queueDepth: 0,
      reasonCodes: { PROVIDER_TELEMETRY_QUEUE_PRIORITY_EVICTION: 1 },
    });
    await telemetry.closeAndDrain();
  });

  it("preserves terminal and error task transitions ahead of ordinary progress", async () => {
    const transport = new ScriptedTransport((request) => accepted(request));
    const telemetry = client(transport, { maxQueueSize: 2 });
    const identity = {
      taskId: "task-1",
      externalExecutionId: "execution-1",
      operationName: "vehicle_navigate",
    };

    await telemetry.emit(
      "EXECUTION_PROGRESS",
      { current: 10, total: 100, percentage: 10, unit: "percent" },
      { ...identity, attributes: { transition: "RUNNING", reasonCode: "UGV_DEVICE_TASK_RUNNING" } },
    );
    await telemetry.emit(
      "EXECUTION_PROGRESS",
      { current: 20, total: 100, percentage: 20, unit: "percent" },
      { ...identity, attributes: { transition: "PAUSED", reasonCode: "UGV_DEVICE_TASK_PAUSED" } },
    );
    await telemetry.emit(
      "EXECUTION_PROGRESS",
      { current: 20, total: 100, percentage: 20, unit: "percent" },
      {
        ...identity,
        attributes: {
          transition: "TECHNICAL_FAILED",
          reasonCode: "UGV_ADAPTER_INTERNAL_ERROR",
        },
      },
    );
    await telemetry.drain();

    expect(
      transport.requests[0]?.events.map((event) => ({
        transition: event.attributes.transition,
        percentage: event.payload.percentage,
      })),
    ).toEqual([
      { transition: "PAUSED", percentage: 20 },
      { transition: "TECHNICAL_FAILED", percentage: 20 },
    ]);
    expect(telemetry.snapshot()).toMatchObject({
      enqueued: 3,
      accepted: 2,
      dropped: 1,
      queueDepth: 0,
      reasonCodes: { PROVIDER_TELEMETRY_QUEUE_PRIORITY_EVICTION: 1 },
    });
    await telemetry.closeAndDrain();
  });

  it("uses bounded critical reserve when an ordinary batch is already in flight", async () => {
    let release: (() => void) | undefined;
    const transport = new ScriptedTransport((request, attempt) =>
      attempt === 1
        ? new Promise((resolve) => {
            release = () => resolve(accepted(request));
          })
        : accepted(request),
    );
    const telemetry = client(transport, { maxQueueSize: 1, maxBatchSize: 1 });
    const identity = {
      taskId: "task-1",
      externalExecutionId: "execution-1",
      operationName: "vehicle_navigate",
    };
    await telemetry.emit(
      "EXECUTION_PROGRESS",
      { current: 10, total: 100, percentage: 10, unit: "percent" },
      { ...identity, attributes: { transition: "RUNNING", reasonCode: "UGV_DEVICE_TASK_RUNNING" } },
    );
    const inFlight = telemetry.flush();
    expect(transport.requests).toHaveLength(1);

    await telemetry.emit(
      "EXECUTION_PROGRESS",
      { current: 100, total: 100, percentage: 100, unit: "percent" },
      {
        ...identity,
        attributes: { transition: "SUCCEEDED", reasonCode: "UGV_DEVICE_TASK_COMPLETED" },
      },
    );
    expect(telemetry.snapshot()).toMatchObject({ queueDepth: 2, queueCapacity: 2, dropped: 0 });
    release?.();
    await inFlight;
    await telemetry.drain();

    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[1]?.events[0]?.attributes.transition).toBe("SUCCEEDED");
    expect(telemetry.snapshot()).toMatchObject({ accepted: 2, dropped: 0, queueDepth: 0 });
    await telemetry.closeAndDrain();
  });

  it("maps a legacy diagnostic to an explicit health event", async () => {
    const transport = new ScriptedTransport((request) => accepted(request));
    const telemetry = client(transport);
    await telemetry.emit("PROVIDER_DIAGNOSTIC", {
      diagnostic: "legacy_consumer_notice",
      countBucket: "few",
    });
    await telemetry.drain();

    expect(telemetry.records[0]).toMatchObject({
      eventType: "RESOURCE_HEALTH",
      payload: {
        health: "diagnostic",
        reasonCode: "VEHICLE_PROVIDER_DIAGNOSTIC_REPORTED",
      },
      attributes: { diagnostic: "legacy_consumer_notice", countBucket: "few" },
    });
    await telemetry.closeAndDrain();
  });

  it("drains queued events on close and creates restart-unique event IDs", async () => {
    const firstTransport = new ScriptedTransport((request) => accepted(request));
    const first = client(firstTransport, { sessionId: "process-a" });
    await first.emit("RESOURCE_STATE", { state: "ready", reasonCode: "UGV_READY" });
    const firstId = first.records[0]?.providerEventId;
    await first.closeAndDrain();

    const secondTransport = new ScriptedTransport((request) => accepted(request));
    const second = client(secondTransport, { sessionId: "process-b" });
    await second.emit("RESOURCE_STATE", { state: "ready", reasonCode: "UGV_READY" });
    const secondId = second.records[0]?.providerEventId;
    await second.closeAndDrain();

    expect(firstTransport.requests).toHaveLength(1);
    expect(secondTransport.requests).toHaveLength(1);
    expect(firstTransport.closed).toBe(true);
    expect(secondTransport.closed).toBe(true);
    expect(firstId).toBeDefined();
    expect(secondId).toBeDefined();
    expect(firstId).not.toBe(secondId);
  });

  it("bounds close drain time and reports events left after the deadline", async () => {
    const transport = new ScriptedTransport(() => new Promise<never>(() => undefined));
    const telemetry = client(transport, {
      requestTimeoutMs: 2_000,
      closeDrainTimeoutMs: 20,
    });
    await telemetry.emit("RESOURCE_STATE", { state: "ready", reasonCode: "UGV_READY" });

    const startedAt = Date.now();
    await telemetry.closeAndDrain();

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(transport.closed).toBe(true);
    expect(telemetry.snapshot()).toMatchObject({
      transportFailed: 1,
      retry: 1,
      dropped: 1,
      queueDepth: 0,
      reasonCodes: {
        PROVIDER_TELEMETRY_TRANSPORT_FAILED: 2,
        PROVIDER_TELEMETRY_CLOSE_DRAIN_TIMEOUT: 1,
      },
    });
  });

  it("tracks a concurrent public drain and applies the close deadline", async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const transport = new ScriptedTransport(
      (request) =>
        new Promise((resolve) => {
          release = () => resolve(accepted(request));
        }),
    );
    const telemetry = client(transport, {
      requestTimeoutMs: 500,
      closeDrainTimeoutMs: 20,
    });
    try {
      await telemetry.emit("RESOURCE_STATE", { state: "ready", reasonCode: "UGV_READY" });
      const publicDrain = telemetry.drain(500);
      expect(transport.requests).toHaveLength(1);

      const closing = telemetry.closeAndDrain();
      await vi.advanceTimersByTimeAsync(21);
      await closing;

      expect(transport.closed).toBe(true);
      expect(telemetry.snapshot()).toMatchObject({ dropped: 1, queueDepth: 0 });
      release?.();
      await publicDrain;
    } finally {
      vi.useRealTimers();
    }
  });
});

class ScriptedTransport implements VehicleTelemetryTransport {
  readonly requests: EmitProviderEventsRequest[] = [];
  closed = false;

  constructor(readonly respond: (request: EmitProviderEventsRequest, attempt: number) => unknown) {}

  emit(request: EmitProviderEventsRequest): Promise<unknown> {
    this.requests.push(structuredClone(request));
    try {
      return Promise.resolve(this.respond(request, this.requests.length));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error("TEST_TRANSPORT_FAILED"));
    }
  }

  close(): void {
    this.closed = true;
  }
}

function client(
  transport: VehicleTelemetryTransport,
  overrides: Partial<VehicleTelemetryOptions> = {},
): VehicleTelemetry {
  return new VehicleTelemetry({
    providerId: "isr.vehicle.ugv.ugv1",
    resourceId: "vehicle:ugv1",
    resourceType: "isr.vehicle.ugv",
    enabled: true,
    endpoint: "127.0.0.1:7002",
    tlsMode: "disabled",
    flushIntervalMs: 60_000,
    retryBaseDelayMs: 0,
    retryMaximumDelayMs: 0,
    transport,
    ...overrides,
  });
}

function accepted(request: EmitProviderEventsRequest) {
  return {
    results: request.events.map((event, index) => ({
      providerEventId: event.providerEventId,
      accepted: true,
      duplicate: false,
      recordId: `record-${String(index + 1)}`,
      reasonCode: "",
      message: "",
    })),
  };
}
