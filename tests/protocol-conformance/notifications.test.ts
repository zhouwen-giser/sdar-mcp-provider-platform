import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { AuthorizationContext } from "../../packages/domain/src/index.js";
import { TaskNotFoundOrUnauthorizedError } from "../../packages/domain/src/index.js";
import {
  TaskNotificationStream,
  type FrozenJsonRpcRequest,
} from "../../packages/mcp-protocol/src/index.js";

const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "live",
  simulationId: null,
};

describe("frozen Task notification SSE", () => {
  it("C-045 C-047 C-048 C-049 C-050 C-064 establishes an authorized stream with Ack first", async () => {
    const stream = new TaskNotificationStream({
      getFrozenTask: (taskId) => {
        if (taskId === "unknown") return Promise.reject(new TaskNotFoundOrUnauthorizedError());
        return Promise.resolve(snapshot(taskId, "1", "working"));
      },
    });
    const response = new FakeSseResponse(2);
    await stream.listen(
      request(["task-b", "unknown", "task-a", "task-b"]),
      response as unknown as ServerResponse,
      authorization,
    );

    expect(response.headers["content-type"]).toBe("text/event-stream");
    const messages = response.messages();
    expect(messages[0]).toMatchObject({
      method: "notifications/subscriptions/acknowledged",
      params: { notifications: { taskIds: ["task-a", "task-b"] } },
    });
    expect(messages[1]).toMatchObject({
      method: "notifications/tasks",
      params: {
        taskId: "task-a",
        _meta: {
          "io.modelcontextprotocol/subscriptionId": "subscription-1",
          "io.sdar/taskExecution": { runtimeRevision: "1" },
        },
      },
    });
  });

  it("C-055 lets two Runtime replicas observe the same committed revision without regression", async () => {
    let revision = "1";
    const reader = {
      getFrozenTask: (taskId: string) => Promise.resolve(snapshot(taskId, revision, "working")),
    };
    const first = new FakeSseResponse(3);
    const second = new FakeSseResponse(3);
    const streams = [
      new TaskNotificationStream(reader, { pollIntervalMs: 5 }).listen(
        request(["task-a"]),
        first as unknown as ServerResponse,
        authorization,
      ),
      new TaskNotificationStream(reader, { pollIntervalMs: 5 }).listen(
        request(["task-a"]),
        second as unknown as ServerResponse,
        authorization,
      ),
    ];
    setTimeout(() => {
      revision = "2";
    }, 10);
    await Promise.all(streams);
    for (const response of [first, second]) {
      expect(
        response
          .messages()
          .filter((message) => message.method === "notifications/tasks")
          .map((message) =>
            String(
              (
                (message.params as Record<string, unknown>)._meta as Record<
                  string,
                  Record<string, unknown>
                >
              )["io.sdar/taskExecution"]?.runtimeRevision,
            ),
          ),
      ).toEqual(["1", "2"]);
    }
  });

  it("C-058 stops a STDIO subscription when notifications/cancelled names its request ID", async () => {
    const stream = new TaskNotificationStream(
      { getFrozenTask: (taskId) => Promise.resolve(snapshot(taskId, "1", "working")) },
      { pollIntervalMs: 5 },
    );
    const response = new FakeSseResponse(Number.POSITIVE_INFINITY);
    const listening = stream.listen(
      request(["task-a"]),
      response as unknown as ServerResponse,
      authorization,
    );

    await vi.waitFor(() => expect(response.frames).toHaveLength(2));
    expect(
      stream.handleCancelledNotification({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: "subscription-1" },
      }),
    ).toBe(true);
    await listening;
    expect(stream.cancel("subscription-1")).toBe(false);
  });

  it("C-054 de-duplicates an identical notification revision", async () => {
    const stream = new TaskNotificationStream(
      { getFrozenTask: (taskId) => Promise.resolve(snapshot(taskId, "1", "working")) },
      { pollIntervalMs: 2 },
    );
    const response = new FakeSseResponse(Number.POSITIVE_INFINITY);
    const listening = stream.listen(request(["task-a"]), response as never, authorization);
    await vi.waitFor(() => expect(response.frames).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 10));
    response.emit("close");
    await listening;
    expect(
      response.messages().filter((message) => message.method === "notifications/tasks"),
    ).toHaveLength(1);
  });

  it("C-056 closes instead of emitting a non-terminal state after a terminal state", async () => {
    let current = snapshot("task-a", "1", "completed");
    const stream = new TaskNotificationStream(
      { getFrozenTask: () => Promise.resolve(current) },
      { pollIntervalMs: 2 },
    );
    const response = new FakeSseResponse(Number.POSITIVE_INFINITY);
    const listening = stream.listen(request(["task-a"]), response as never, authorization);
    await vi.waitFor(() => expect(response.frames).toHaveLength(2));
    current = snapshot("task-a", "2", "working");
    await listening;
    expect(
      response.messages().filter((message) => message.method === "notifications/tasks"),
    ).toHaveLength(1);
  });

  it("C-060 waits for drain instead of treating backpressure as disconnect", async () => {
    const stream = new TaskNotificationStream({
      getFrozenTask: (taskId) => Promise.resolve(snapshot(taskId, "1", "working")),
    });
    const response = new FakeSseResponse(Number.POSITIVE_INFINITY, 1);
    await stream.listen(request(["task-a"]), response as never, authorization);
    expect(response.frames).toHaveLength(2);
    expect(
      response.messages().filter((message) => message.method === "notifications/tasks"),
    ).toHaveLength(1);
  });

  it("C-061 C-062 emits only the frozen Task notification methods", async () => {
    const stream = new TaskNotificationStream({
      getFrozenTask: (taskId) => Promise.resolve(snapshot(taskId, "1", "working")),
    });
    const response = new FakeSseResponse(2);
    await stream.listen(request(["task-a"]), response as never, authorization);
    expect(response.messages().map((message) => message.method)).toEqual([
      "notifications/subscriptions/acknowledged",
      "notifications/tasks",
    ]);
  });

  it("C-063 routes concurrent subscriptions by their independent request IDs", async () => {
    const stream = new TaskNotificationStream({
      getFrozenTask: (taskId) => Promise.resolve(snapshot(taskId, "1", "working")),
    });
    const first = new FakeSseResponse(2);
    const second = new FakeSseResponse(2);
    await Promise.all([
      stream.listen(request(["task-a"], "subscription-a"), first as never, authorization),
      stream.listen(request(["task-b"], "subscription-b"), second as never, authorization),
    ]);
    expect(first.messages()[0]).toMatchObject({
      params: { _meta: { "io.modelcontextprotocol/subscriptionId": "subscription-a" } },
    });
    expect(second.messages()[0]).toMatchObject({
      params: { _meta: { "io.modelcontextprotocol/subscriptionId": "subscription-b" } },
    });
  });

  it("C-051 C-052 C-053 preserves complete input, result, Evidence and error snapshots", async () => {
    const values: Record<string, unknown>[] = [
      {
        ...snapshot("input", "2", "input_required"),
        inputRequests: {
          approval: {
            method: "elicitation/create",
            params: { mode: "form", message: "Approve", requestedSchema: { type: "boolean" } },
          },
        },
      },
      {
        ...snapshot("complete", "3", "completed"),
        result: {
          resultType: "complete",
          structuredContent: { ok: true },
          isError: false,
          _meta: {
            "io.sdar/evidence": {
              profileVersion: "1.0",
              items: [{ evidenceId: "e-1", evidenceType: "completion" }],
            },
          },
        },
      },
      {
        ...snapshot("failed", "4", "failed"),
        error: { code: -32603, message: "Execution failed" },
      },
    ];
    const byId = new Map(values.map((value) => [String(value.taskId), value]));
    const stream = new TaskNotificationStream({
      getFrozenTask: (taskId) =>
        Promise.resolve(byId.get(taskId) ?? snapshot(taskId, "1", "working")),
    });
    const response = new FakeSseResponse(4);
    await stream.listen(request(["input", "complete", "failed"]), response as never, authorization);
    const messages = response
      .messages()
      .filter((message) => message.method === "notifications/tasks");
    expect(messages.map((message) => message.params)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "input_required",
          inputRequests: values[0]?.inputRequests,
        }),
        expect.objectContaining({ status: "completed", result: values[1]?.result }),
        expect.objectContaining({ status: "failed", error: values[2]?.error }),
      ]),
    );
  });

  it("C-057 releases polling immediately after the HTTP response closes", async () => {
    let reads = 0;
    const stream = new TaskNotificationStream(
      {
        getFrozenTask: (taskId) => {
          reads += 1;
          return Promise.resolve(snapshot(taskId, "1", "working"));
        },
      },
      { pollIntervalMs: 2 },
    );
    const response = new FakeSseResponse(2);
    await stream.listen(request(["task-a"]), response as never, authorization);
    const readsAtClose = reads;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reads).toBe(readsAtClose);
  });

  it("C-059 C-065 reconnects from authoritative tasks/get state without a replay assumption", async () => {
    const authoritative = snapshot("task-a", "7", "completed");
    const reader = { getFrozenTask: () => Promise.resolve(authoritative) };
    const stream = new TaskNotificationStream(reader);
    const response = new FakeSseResponse(2);
    await stream.listen(
      request(["task-a"], "subscription-reconnected"),
      response as never,
      authorization,
    );
    const notification = response.messages()[1]?.params as Record<string, unknown>;
    expect(notification).toMatchObject(authoritative);
    expect(notification._meta).toMatchObject({
      "io.modelcontextprotocol/subscriptionId": "subscription-reconnected",
      "io.sdar/taskExecution": { runtimeRevision: "7" },
    });
  });
});

class FakeSseResponse extends EventEmitter {
  readonly headers: Record<string, string> = {};
  readonly frames: string[] = [];
  statusCode = 0;

  constructor(
    readonly closeAfterFrames: number,
    readonly acceptedFrames = Number.POSITIVE_INFINITY,
  ) {
    super();
  }

  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  flushHeaders(): void {
    return undefined;
  }

  write(frame: string): boolean {
    this.frames.push(frame);
    if (this.frames.length >= this.closeAfterFrames) setImmediate(() => this.emit("close"));
    const accepted = this.frames.length <= this.acceptedFrames;
    if (!accepted) {
      setImmediate(() => {
        this.emit("drain");
        this.emit("close");
      });
    }
    return accepted;
  }

  end(): void {
    setImmediate(() => this.emit("close"));
  }

  messages(): Record<string, unknown>[] {
    return this.frames.map((frame) => {
      const value: unknown = JSON.parse(frame.split("data: ")[1]?.trim() ?? "null");
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("INVALID_TEST_SSE_FRAME");
      }
      return value as Record<string, unknown>;
    });
  }
}

function request(taskIds: string[], id = "subscription-1"): FrozenJsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id,
    method: "subscriptions/listen",
    params: { notifications: { taskIds }, _meta: {} },
    meta: {
      protocolVersion: "2026-07-28",
      clientInfo: { name: "sdar", version: "1.0.0" },
      clientCapabilities: { extensions: { "io.modelcontextprotocol/tasks": {} } },
      raw: {},
    },
  };
}

function snapshot(taskId: string, revision: string, status: string): Record<string, unknown> {
  return {
    taskId,
    status,
    createdAt: "2026-07-18T03:00:00.000Z",
    lastUpdatedAt: "2026-07-18T03:01:00.000Z",
    ttlMs: 3_600_000,
    _meta: {
      "io.sdar/taskExecution": { profileVersion: "1.0", runtimeRevision: revision },
    },
  };
}
