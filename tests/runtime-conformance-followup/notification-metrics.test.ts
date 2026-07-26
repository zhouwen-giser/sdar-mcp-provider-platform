import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { AuthorizationContext } from "../../packages/domain/src/index.js";
import { TaskNotificationStream } from "../../packages/mcp-protocol/src/index.js";

const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "live",
  simulationId: null,
};

describe("notification low-cardinality metrics", () => {
  it("classifies sent, closed, and replica-limit outcomes without identities", async () => {
    const increment = vi.fn();
    const stream = new TaskNotificationStream(
      { getFrozenTask: (taskId) => Promise.resolve(snapshot(taskId)) },
      { maxSubscriptions: 1, metrics: { increment, gauge: vi.fn() } },
    );
    const first = new Response(Number.POSITIVE_INFINITY);
    const listening = stream.listen(request("first"), first as never, authorization);
    await first.waitForFrames(2);
    await expect(
      stream.listen(request("second"), new Response(2) as never, authorization),
    ).rejects.toMatchObject({ data: { reasonCode: "TASK_NOTIFICATION_CAPACITY_EXCEEDED" } });
    stream.cancel("first");
    await listening;

    expect(increment).toHaveBeenCalledWith(
      "sdar_task_notification_events_total",
      { outcome: "sent" },
      1,
    );
    expect(increment).toHaveBeenCalledWith(
      "sdar_task_notification_events_total",
      { outcome: "closed" },
      1,
    );
    expect(increment).toHaveBeenCalledWith(
      "sdar_task_notification_rejections_total",
      { reason: "replica_limit" },
      1,
    );
    for (const call of increment.mock.calls) {
      expect(Object.keys((call[1] ?? {}) as object)).not.toContain("taskId");
    }
  });

  it("keeps subscription behavior fail-open when metrics throw", async () => {
    const response = new Response(2);
    const stream = new TaskNotificationStream(
      { getFrozenTask: (taskId) => Promise.resolve(snapshot(taskId)) },
      {
        metrics: {
          increment: () => {
            throw new Error("collector unavailable");
          },
          gauge: () => {
            throw new Error("collector unavailable");
          },
        },
      },
    );
    await expect(
      stream.listen(request("fail-open"), response as never, authorization),
    ).resolves.toBeUndefined();
    expect(response.frames).toHaveLength(2);
  });

  it.each([
    ["authorization_limit", { maxSubscriptionsPerAuth: 1 }, "second"],
    ["binding_limit", { maxTaskBindings: 1 }, "two-bindings"],
  ] as const)("classifies %s capacity rejection", async (reason, limits, secondId) => {
    const increment = vi.fn();
    const stream = new TaskNotificationStream(
      { getFrozenTask: (taskId) => Promise.resolve(snapshot(taskId)) },
      { maxSubscriptions: 10, ...limits, metrics: { increment, gauge: vi.fn() } },
    );
    const first = new Response(Number.POSITIVE_INFINITY);
    const listening = stream.listen(request("first"), first as never, authorization);
    await first.waitForFrames(2);
    await expect(
      stream.listen(request(secondId), new Response(2) as never, authorization),
    ).rejects.toMatchObject({ data: { reasonCode: "TASK_NOTIFICATION_CAPACITY_EXCEEDED" } });
    expect(increment).toHaveBeenCalledWith(
      "sdar_task_notification_rejections_total",
      { reason },
      1,
    );
    stream.cancel("first");
    await listening;
  });

  it.each([
    ["queue_message_limit", { maxQueueMessages: 1, maxQueueBytes: 1_048_576 }, "overflow-message"],
    ["queue_byte_limit", { maxQueueMessages: 64, maxQueueBytes: 32 }, "overflow-byte"],
  ] as const)("classifies %s overflow", async (reason, limits, id) => {
    const increment = vi.fn();
    const stream = new TaskNotificationStream(
      { getFrozenTask: (taskId) => Promise.resolve(snapshot(taskId)) },
      { ...limits, metrics: { increment, gauge: vi.fn() } },
    );
    await stream.listen(request(id), new NeverDrainResponse() as never, authorization);
    expect(increment).toHaveBeenCalledWith(
      "sdar_task_notification_rejections_total",
      { reason },
      1,
    );
    expect(increment).toHaveBeenCalledWith(
      "sdar_task_notification_events_total",
      { outcome: "overflow" },
      1,
    );
  });

  it("classifies same-revision suppression as deduplicated", async () => {
    const increment = vi.fn();
    const stream = new TaskNotificationStream(
      { getFrozenTask: (taskId) => Promise.resolve(snapshot(taskId)) },
      { pollIntervalMs: 5, metrics: { increment, gauge: vi.fn() } },
    );
    const response = new Response(Number.POSITIVE_INFINITY);
    const listening = stream.listen(request("deduplicated"), response as never, authorization);
    await waitForMetric(increment, "deduplicated");
    expect(increment).toHaveBeenCalledWith(
      "sdar_task_notification_events_total",
      { outcome: "deduplicated" },
      1,
    );
    stream.cancel("deduplicated");
    await listening;
  });
});

class Response extends EventEmitter {
  readonly frames: string[] = [];
  statusCode = 0;
  constructor(readonly closeAfter: number) {
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
    if (this.frames.length >= this.closeAfter) setImmediate(() => this.emit("close"));
    return true;
  }
  end(): void {
    setImmediate(() => this.emit("close"));
  }
  async waitForFrames(count: number): Promise<void> {
    while (this.frames.length < count) await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

class NeverDrainResponse extends Response {
  constructor() {
    super(Number.POSITIVE_INFINITY);
  }
  override write(frame: string): boolean {
    this.frames.push(frame);
    return false;
  }
}

function request(id: string) {
  const taskIds =
    id === "two-bindings" || id === "overflow-message"
      ? ["00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"]
      : [
          id === "second"
            ? "00000000-0000-4000-8000-000000000002"
            : "00000000-0000-4000-8000-000000000001",
        ];
  return {
    jsonrpc: "2.0",
    id,
    method: "subscriptions/listen",
    params: { notifications: { taskIds }, _meta: {} },
    meta: {
      protocolVersion: "2026-07-28",
      clientInfo: { name: "followup", version: "1.0.0" },
      clientCapabilities: { extensions: { "io.modelcontextprotocol/tasks": {} } },
      raw: {},
    },
  } as never;
}

async function waitForMetric(increment: ReturnType<typeof vi.fn>, outcome: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (
      increment.mock.calls.some((call) => {
        const labels = call[1] as Record<string, unknown> | undefined;
        return call[0] === "sdar_task_notification_events_total" && labels?.outcome === outcome;
      })
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`EXPECTED_NOTIFICATION_METRIC:${outcome}`);
}

function snapshot(taskId: string): Record<string, unknown> {
  return {
    taskId,
    status: "working",
    createdAt: "2026-07-22T00:00:00.000Z",
    lastUpdatedAt: "2026-07-22T00:00:00.000Z",
    pollIntervalMs: 500,
    ttlMs: null,
    _meta: { "io.sdar/taskExecution": { runtimeRevision: "1" } },
  };
}
