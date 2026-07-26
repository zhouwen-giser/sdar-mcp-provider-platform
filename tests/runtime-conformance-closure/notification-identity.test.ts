import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
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

describe("transport-scoped typed notification identity", () => {
  it("R-005 permits two clients to use the same string Request ID", async () => {
    const stream = notificationStream();
    const results = await Promise.allSettled([
      listen(stream, request("same"), new FakeResponse(2), authorization, "transport-a"),
      listen(stream, request("same"), new FakeResponse(2), authorization, "transport-b"),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
  });

  it("R-006 keeps numeric 1 distinct from string 1", async () => {
    const stream = notificationStream();
    const results = await Promise.allSettled([
      listen(stream, request(1), new FakeResponse(2), authorization, "transport-a"),
      listen(stream, request("1"), new FakeResponse(2), authorization, "transport-a"),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
  });

  it("R-007 isolates identical IDs across authorization scopes", async () => {
    const stream = notificationStream();
    const results = await Promise.allSettled([
      listen(stream, request("same"), new FakeResponse(2), authorization, "transport-a"),
      listen(
        stream,
        request("same"),
        new FakeResponse(2),
        { ...authorization, hash: "b".repeat(64) },
        "transport-b",
      ),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
  });

  it("R-008 closing one stream leaves the other stream active", async () => {
    const stream = notificationStream();
    const first = new FakeResponse(2);
    const second = new FakeResponse(2);
    const results = await Promise.allSettled([
      listen(stream, request("same"), first, authorization, "transport-a"),
      listen(stream, request("same"), second, authorization, "transport-b"),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(
      second.messages().filter((message) => message.method === "notifications/tasks"),
    ).toHaveLength(1);
  });

  it("R-009 uses typed Request IDs when cancelling", async () => {
    const stream = notificationStream();
    const response = new FakeResponse(Number.POSITIVE_INFINITY);
    const listening = listen(stream, request(1), response, authorization, "transport-a");
    await response.waitForFrames(2);
    expect(stream.cancel("1", "transport-a")).toBe(false);
    expect(stream.cancel(1, "transport-a")).toBe(true);
    await listening;
  });
});

function notificationStream(): TaskNotificationStream {
  return new TaskNotificationStream(
    { getFrozenTask: (taskId) => Promise.resolve(snapshot(taskId, "1")) },
    { pollIntervalMs: 2 },
  );
}

function listen(
  stream: TaskNotificationStream,
  value: FrozenJsonRpcRequest,
  response: FakeResponse,
  auth: AuthorizationContext,
  transportScopeId: string,
): Promise<void> {
  return stream.listen(value, response as unknown as ServerResponse, auth, transportScopeId);
}

class FakeResponse extends EventEmitter {
  readonly frames: string[] = [];
  statusCode = 0;

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
    setImmediate(() => this.emit("close"));
  }
  messages(): Record<string, unknown>[] {
    return this.frames.map((frame) => parseMessage(frame));
  }
  async waitForFrames(count: number): Promise<void> {
    while (this.frames.length < count) await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function parseMessage(frame: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(frame.split("data: ")[1]?.trim() ?? "null");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("INVALID_TEST_FRAME");
  }
  return parsed as Record<string, unknown>;
}

function request(id: string | number): FrozenJsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id,
    method: "subscriptions/listen",
    params: { notifications: { taskIds: ["task-a"] }, _meta: {} },
    meta: {
      protocolVersion: "2026-07-28",
      clientInfo: { name: "closure", version: "1.0.0" },
      clientCapabilities: { extensions: { "io.modelcontextprotocol/tasks": {} } },
      raw: {},
    },
  };
}

function snapshot(taskId: string, revision: string): Record<string, unknown> {
  return {
    taskId,
    status: "working",
    createdAt: "2026-07-19T00:00:00.000Z",
    lastUpdatedAt: "2026-07-19T00:00:01.000Z",
    ttlMs: 60_000,
    _meta: {
      "io.sdar/taskExecution": { profileVersion: "1.0", runtimeRevision: revision },
    },
  };
}
