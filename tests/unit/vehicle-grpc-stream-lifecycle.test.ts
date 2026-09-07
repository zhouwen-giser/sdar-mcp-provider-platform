import * as grpc from "@grpc/grpc-js";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { AdapterBusinessEvent } from "../../packages/adapter-protocol/src/index.js";
import { MemoryProviderStore } from "../../packages/provider-adapter-kit/src/memory-store.js";
import type { ProviderExecution } from "../../packages/provider-adapter-kit/src/types.js";
import {
  VehicleProviderGrpcServer,
  type VehicleAdapterRuntime,
} from "../../packages/provider-adapter-kit/src/vehicle-grpc-server.js";
import {
  createUgvSnapshot,
  VehicleBusinessEventHub,
} from "../../packages/vehicle-provider-core/src/index.js";

describe("vehicle gRPC stream subscription lifecycle", () => {
  it.each(["cancelled", "close", "error"])(
    "removes business event subscriptions exactly once on %s, including reconnects",
    async (terminalEvent) => {
      const fixture = setup();
      for (let attempt = 0; attempt < 25; attempt++) {
        const call = fixture.businessCall(
          attempt % 2 === 0 ? "vehicle.execution" : "vehicle.target",
        );
        fixture.handlers.streamBusinessEvents(call);
        await settle();
        expect(fixture.active.size).toBe(1);
        for (const listener of fixture.active) listener(event);
        expect(call.write).toHaveBeenCalledOnce();
        call.emit(terminalEvent, new Error("client disconnected"));
        call.emit("close");
        call.emit("cancelled");
        expect(fixture.active.size).toBe(0);
        expect(fixture.unsubscribed).toHaveBeenCalledTimes(attempt + 1);
        expect(call.listenerCount("close")).toBe(0);
        expect(call.listenerCount("cancelled")).toBe(0);
      }
    },
  );

  it.each(["resolve", "reject"])(
    "does not write or subscribe after a cancelled durable replay later %ss",
    async (completion) => {
      const fixture = setup();
      const replay = deferred<AdapterBusinessEvent[]>();
      vi.spyOn(fixture.store, "replayBusinessEvents").mockReturnValue(replay.promise);
      const call = fixture.businessCall();
      fixture.handlers.streamBusinessEvents(call);
      call.emit("cancelled");
      if (completion === "resolve") replay.resolve([event]);
      else replay.reject(new Error("SOURCE_CURSOR_EXPIRED"));
      await settle();
      expect(call.write).not.toHaveBeenCalled();
      expect(call.error).not.toHaveBeenCalled();
      expect(fixture.subscribed).not.toHaveBeenCalled();
    },
  );

  it("stops replay writes when the stream closes during replay delivery", async () => {
    const fixture = setup();
    vi.spyOn(fixture.store, "replayBusinessEvents").mockResolvedValue([event, event]);
    const call = fixture.businessCall();
    call.write.mockImplementation(() => {
      call.emit("close");
      return true;
    });
    fixture.handlers.streamBusinessEvents(call);
    await settle();
    expect(call.write).toHaveBeenCalledOnce();
    expect(fixture.subscribed).not.toHaveBeenCalled();
  });

  it("returns replay cursor errors while the stream is open and releases lifecycle listeners", async () => {
    const fixture = setup();
    vi.spyOn(fixture.store, "replayBusinessEvents").mockRejectedValue(
      new Error("SOURCE_CURSOR_EXPIRED"),
    );
    const call = fixture.businessCall();
    fixture.handlers.streamBusinessEvents(call);
    await settle();
    expect(call.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: grpc.status.OUT_OF_RANGE }),
    );
    expect(fixture.subscribed).not.toHaveBeenCalled();
    expect(call.listenerCount("close")).toBe(0);
    expect(call.listenerCount("cancelled")).toBe(0);
  });

  it.each(["cancelled", "close", "error"])(
    "removes execution event subscriptions on %s",
    async (terminalEvent) => {
      const fixture = setup();
      const call = executionCall();
      fixture.handlers.streamExecutionEvents(call);
      await settle();
      expect(fixture.runtime.events.listenerCount(execution.taskId)).toBe(1);
      expect(call.write).toHaveBeenCalledOnce();
      call.emit(terminalEvent, new Error("client disconnected"));
      call.emit("close");
      expect(fixture.runtime.events.listenerCount(execution.taskId)).toBe(0);
      fixture.runtime.events.emit(execution.taskId, { revision: 2 });
      expect(call.write).toHaveBeenCalledOnce();
    },
  );

  it.each(["resolve", "reject"])(
    "does not write or subscribe after closed execution lookup later %ss",
    async (completion) => {
      const fixture = setup();
      const lookup = deferred<ProviderExecution | undefined>();
      vi.spyOn(fixture.runtime, "get").mockReturnValue(lookup.promise);
      const call = executionCall();
      fixture.handlers.streamExecutionEvents(call);
      call.emit("close");
      if (completion === "resolve") lookup.resolve(execution);
      else lookup.reject(new Error("STORE_UNAVAILABLE"));
      await settle();
      expect(call.write).not.toHaveBeenCalled();
      expect(call.error).not.toHaveBeenCalled();
      expect(fixture.runtime.events.listenerCount(execution.taskId)).toBe(0);
    },
  );

  it("reports execution lookup failures through the open stream", async () => {
    const fixture = setup();
    vi.spyOn(fixture.runtime, "get").mockRejectedValue(new Error("STORE_UNAVAILABLE"));
    const call = executionCall();
    fixture.handlers.streamExecutionEvents(call);
    await settle();
    expect(call.error).toHaveBeenCalledOnce();
    expect(call.listenerCount("close")).toBe(0);
    expect(fixture.runtime.events.listenerCount(execution.taskId)).toBe(0);
  });
});

function setup() {
  let implementation: grpc.UntypedServiceImplementation | undefined;
  const registration = vi
    .spyOn(grpc.Server.prototype, "addService")
    .mockImplementation((_service, handlers) => {
      implementation = handlers;
    });
  const store = new MemoryProviderStore();
  const runtime: VehicleAdapterRuntime = {
    events: new EventEmitter(),
    snapshot: () => createUgvSnapshot(),
    availability: () => {
      throw new Error("not used by stream tests");
    },
    start: async () => {
      throw new Error("not used by stream tests");
    },
    get: async () => execution,
    reconcile: async () => ({}),
    command: async () => ({}),
    updateFire: async () => ({}),
    executionSnapshot: (value) => ({ taskId: value.taskId, revision: value.revision }),
  };
  const hub = new VehicleBusinessEventHub(store, {
    reasonPrefix: "UGV",
    resourceId: "vehicle:ugv1",
  });
  const active = new Set<(event: AdapterBusinessEvent) => void>();
  const unsubscribed = vi.fn();
  const subscribed = vi.spyOn(hub, "subscribe").mockImplementation((_source, listener) => {
    active.add(listener);
    return () => {
      active.delete(listener);
      unsubscribed();
    };
  });
  new VehicleProviderGrpcServer(
    {
      host: "127.0.0.1",
      port: 0,
      tlsMode: "disabled",
      internalErrorCode: "UGV_INTERNAL",
      manifest: () => ({}),
      resource: () => ({}),
    },
    runtime,
    store,
    hub,
  );
  registration.mockRestore();
  if (implementation === undefined) throw new Error("gRPC service was not registered");
  // Exercise the registered public gRPC handlers with a controllable writable stream.
  const handlers = implementation as unknown as {
    streamBusinessEvents(call: FakeCall<Record<string, string>>): void;
    streamExecutionEvents(call: ReturnType<typeof executionCall>): void;
  };
  return {
    handlers,
    store,
    runtime,
    active,
    unsubscribed,
    subscribed,
    businessCall(sourceId = "vehicle.execution") {
      const source = store
        .businessEventSources()
        .find((candidate) => candidate.sourceId === sourceId);
      if (source === undefined) throw new Error("missing source fixture");
      return new FakeCall({ sourceId, sourceStreamId: source.sourceStreamId });
    },
  };
}

class FakeCall<T> extends EventEmitter {
  readonly write = vi.fn<(event: unknown) => boolean>(() => true);
  readonly error = vi.fn();
  constructor(readonly request: T) {
    super();
    this.on("error", this.error);
  }
}

function executionCall() {
  return new FakeCall({ execution: { taskId: execution.taskId }, afterRevision: "0" });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

const execution: ProviderExecution = {
  taskId: "stream-simulation-task",
  externalExecutionId: "stream-simulation-execution",
  operationName: "vehicle_navigate",
  argumentHash: "a".repeat(64),
  resourceId: "vehicle:ugv1",
  tracks: [],
  arguments: {},
  executionContext: {
    authorizationContextHash: "b".repeat(64),
    executionMode: "simulation",
    simulationId: "stream-test",
    correlationId: "stream-test",
  },
  downstreamMissionIds: [],
  state: "RUNNING",
  revision: 1,
  reasonCode: "UGV_RUNNING",
  createdAt: "2026-09-07T00:00:00Z",
  updatedAt: "2026-09-07T00:00:00Z",
  evidence: [],
};

const event: AdapterBusinessEvent = {
  sourceEventId: "event-1",
  sourceSequence: "1",
  sourceStreamId: "stream-1",
  scope: "task",
  occurredAt: { seconds: "1", nanos: 0 },
  eventType: "vehicle.mission.started",
  description: "started",
  severityHint: "info",
  reasonCode: "UGV_RUNNING",
  rawPayload: { fields: {} },
};
