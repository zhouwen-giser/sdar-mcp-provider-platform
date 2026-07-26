import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { AuthorizationContext } from "../../packages/domain/src/index.js";
import {
  TaskNotificationStream,
  type FrozenJsonRpcRequest,
} from "../../packages/mcp-protocol/src/index.js";

const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "live",
  simulationId: null,
};

describe("Runtime notification capacity", () => {
  it("R-016 enforces the configured global subscription limit", async () => {
    const stream = new TaskNotificationStream(
      { getFrozenTask: (taskId) => Promise.resolve(snapshot(taskId)) },
      { pollIntervalMs: 5, maxSubscriptions: 1 },
    );
    const first = new FakeResponse(Number.POSITIVE_INFINITY);
    const listening = stream.listen(request("first", ["task-a"]), first as never, authorization);
    await first.waitForFrames(2);
    try {
      await expect(
        stream.listen(request("second", ["task-b"]), new FakeResponse(2) as never, authorization),
      ).rejects.toMatchObject({
        code: -32603,
        httpStatus: 503,
        data: { reasonCode: "TASK_NOTIFICATION_CAPACITY_EXCEEDED", retryable: true },
      });
    } finally {
      stream.cancel("first");
      await listening;
    }
  });

  it("R-017 enforces the configured global Task binding limit", async () => {
    const stream = new TaskNotificationStream(
      { getFrozenTask: (taskId) => Promise.resolve(snapshot(taskId)) },
      { maxTaskBindings: 1 },
    );
    await expect(
      stream.listen(
        request("too-many-bindings", ["task-a", "task-b"]),
        new FakeResponse(2) as never,
        authorization,
      ),
    ).rejects.toMatchObject({
      code: -32603,
      httpStatus: 503,
      data: { reasonCode: "TASK_NOTIFICATION_CAPACITY_EXCEEDED", retryable: true },
    });
  });

  it("enforces the configured subscription limit per authorization scope", async () => {
    const stream = new TaskNotificationStream(
      { getFrozenTask: (taskId) => Promise.resolve(snapshot(taskId)) },
      { pollIntervalMs: 5, maxSubscriptionsPerAuth: 1 },
    );
    const first = new FakeResponse(Number.POSITIVE_INFINITY);
    const listening = stream.listen(
      request("first-auth", ["task-a"]),
      first as never,
      authorization,
    );
    await first.waitForFrames(2);
    await expect(
      stream.listen(request("same-auth", ["task-b"]), new FakeResponse(2) as never, authorization),
    ).rejects.toMatchObject({
      code: -32603,
      httpStatus: 503,
      data: { reasonCode: "TASK_NOTIFICATION_CAPACITY_EXCEEDED", retryable: true },
    });
    const otherAuthorization = { ...authorization, hash: "b".repeat(64) };
    const other = new FakeResponse(2);
    await stream.listen(request("other-auth", ["task-c"]), other as never, otherAuthorization);
    stream.cancel("first-auth");
    await listening;
  });

  it("waits for drain instead of closing a stream on Node backpressure", async () => {
    const stream = new TaskNotificationStream({
      getFrozenTask: (taskId) => Promise.resolve(snapshot(taskId)),
    });
    const response = new BackpressureResponse();
    await stream.listen(request("slow", ["task-a"]), response as never, authorization);
    expect(response.endedForBackpressure).toBe(false);
    expect(response.frames).toHaveLength(2);
  });

  it("closes only the overflowing stream and keeps other subscriptions active", async () => {
    const stream = new TaskNotificationStream(
      { getFrozenTask: (taskId) => Promise.resolve(snapshot(taskId)) },
      { pollIntervalMs: 5, maxQueueMessages: 1 },
    );
    const healthy = new FakeResponse(Number.POSITIVE_INFINITY);
    const healthyListening = stream.listen(
      request("healthy", ["task-a"]),
      healthy as never,
      authorization,
    );
    await healthy.waitForFrames(2);

    const slow = new NeverDrainResponse();
    await stream.listen(
      request("slow-overflow", ["task-b", "task-c"]),
      slow as never,
      authorization,
    );

    expect(slow.endedForOverflow).toBe(true);
    expect(healthy.ended).toBe(false);
    stream.cancel("healthy");
    await healthyListening;
  });

  it("uses one Runtime poll interval for concurrent subscriptions", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    const stream = new TaskNotificationStream(
      { getFrozenTask: (taskId) => Promise.resolve(snapshot(taskId)) },
      { pollIntervalMs: 50 },
    );
    const first = new FakeResponse(Number.POSITIVE_INFINITY);
    const second = new FakeResponse(Number.POSITIVE_INFINITY);
    const firstListening = stream.listen(request("one", ["task-a"]), first as never, authorization);
    const secondListening = stream.listen(
      request("two", ["task-b"]),
      second as never,
      authorization,
    );
    await Promise.all([first.waitForFrames(2), second.waitForFrames(2)]);
    expect(interval).toHaveBeenCalledTimes(1);
    stream.cancel("one");
    stream.cancel("two");
    await Promise.all([firstListening, secondListening]);
    interval.mockRestore();
  });

  it("reports the required notification metrics without identity labels", async () => {
    const increments: string[] = [];
    const gauges: string[] = [];
    const stream = new TaskNotificationStream(
      { getFrozenTask: (taskId) => Promise.resolve(snapshot(taskId)) },
      {
        metrics: {
          increment: (name) => increments.push(name),
          gauge: (name) => gauges.push(name),
        },
      },
    );
    await stream.listen(
      request("metrics", ["task-a"]),
      new FakeResponse(2) as never,
      authorization,
    );

    expect(new Set(increments)).toEqual(
      new Set([
        "sdar_task_notification_events_total",
        "sdar_task_notification_poll_batches_total",
        "sdar_task_notification_poll_tasks_total",
        "sdar_task_notification_stream_duration_seconds",
      ]),
    );
    expect(new Set(gauges)).toEqual(
      new Set([
        "sdar_task_notification_active_subscriptions",
        "sdar_task_notification_active_bindings",
        "sdar_task_notification_queue_messages",
        "sdar_task_notification_queue_bytes",
      ]),
    );
  });
});

class FakeResponse extends EventEmitter {
  readonly frames: string[] = [];
  statusCode = 0;
  ended = false;
  constructor(readonly closeAfterFrames: number) {
    super();
  }
  setHeader(): void {
    return undefined;
  }
  flushHeaders(): void {
    return undefined;
  }
  write(frame: string): boolean {
    this.frames.push(frame);
    if (this.frames.length >= this.closeAfterFrames) setImmediate(() => this.emit("close"));
    return true;
  }
  end(): void {
    this.ended = true;
    setImmediate(() => this.emit("close"));
  }
  async waitForFrames(count: number): Promise<void> {
    while (this.frames.length < count) await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

class NeverDrainResponse extends FakeResponse {
  endedForOverflow = false;
  constructor() {
    super(Number.POSITIVE_INFINITY);
  }
  override write(frame: string): boolean {
    this.frames.push(frame);
    return false;
  }
  override end(): void {
    this.endedForOverflow = true;
    super.end();
  }
}

class BackpressureResponse extends FakeResponse {
  endedForBackpressure = false;
  constructor() {
    super(Number.POSITIVE_INFINITY);
  }
  override write(frame: string): boolean {
    this.frames.push(frame);
    if (this.frames.length === 1) {
      setImmediate(() => this.emit("drain"));
      return false;
    }
    setImmediate(() => this.emit("close"));
    return true;
  }
  override end(): void {
    this.endedForBackpressure = true;
    super.end();
  }
}

function request(id: string, taskIds: string[]): FrozenJsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id,
    method: "subscriptions/listen",
    params: { notifications: { taskIds }, _meta: {} },
    meta: {
      protocolVersion: "2026-07-28",
      clientInfo: { name: "closure", version: "1.0.0" },
      clientCapabilities: { extensions: { "io.modelcontextprotocol/tasks": {} } },
      raw: {},
    },
  };
}

function snapshot(taskId: string): Record<string, unknown> {
  return {
    taskId,
    status: "working",
    createdAt: "2026-07-19T00:00:00.000Z",
    lastUpdatedAt: "2026-07-19T00:00:01.000Z",
    ttlMs: 60_000,
    _meta: { "io.sdar/taskExecution": { profileVersion: "1.0", runtimeRevision: "1" } },
  };
}
