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

describe("authoritative notification equality", () => {
  it("R-010 R-011 does not synthesize Provider event identity or observation time", async () => {
    const authoritative = snapshot();
    const notification = await emitNotification(authoritative);
    const execution = ((notification._meta as Record<string, unknown>)["io.sdar/taskExecution"] ??
      {}) as Record<string, unknown>;
    expect(execution).not.toHaveProperty("eventId");
    expect(execution).not.toHaveProperty("observedAt");
  });

  it("R-012 equals tasks/get after removing only resultType and subscriptionId", async () => {
    const taskGet = { resultType: "complete", ...snapshot() };
    const notification = await emitNotification(snapshot());
    const expected = structuredClone(taskGet);
    delete (expected as Record<string, unknown>).resultType;
    const actual = structuredClone(notification);
    const meta = actual._meta as Record<string, unknown>;
    delete meta["io.modelcontextprotocol/subscriptionId"];
    expect(actual).toEqual(expected);
  });
});

async function emitNotification(
  authoritative: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const stream = new TaskNotificationStream({
    getFrozenTask: () => Promise.resolve(authoritative),
  });
  const response = new FakeResponse();
  await stream.listen(request(), response as unknown as ServerResponse, authorization);
  const params = response.messages()[1]?.params;
  if (params === undefined) {
    throw new Error("MISSING_TEST_NOTIFICATION_PARAMS");
  }
  return params;
}

class FakeResponse extends EventEmitter {
  readonly frames: string[] = [];
  statusCode = 0;
  setHeader(): void {
    return undefined;
  }
  flushHeaders(): void {
    return undefined;
  }
  write(frame: string): boolean {
    this.frames.push(frame);
    if (this.frames.length === 2) setImmediate(() => this.emit("close"));
    return true;
  }
  end(): void {
    setImmediate(() => this.emit("close"));
  }
  messages(): { params?: Record<string, unknown> }[] {
    return this.frames.map((frame) => parseMessage(frame));
  }
}

function parseMessage(frame: string): { params?: Record<string, unknown> } {
  const parsed: unknown = JSON.parse(frame.split("data: ")[1]?.trim() ?? "null");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("INVALID_TEST_FRAME");
  }
  return parsed;
}

function request(): FrozenJsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id: "subscription-1",
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

function snapshot(): Record<string, unknown> {
  return {
    taskId: "task-a",
    status: "working",
    createdAt: "2026-07-19T00:00:00.000Z",
    lastUpdatedAt: "2026-07-19T00:00:01.000Z",
    ttlMs: 60_000,
    _meta: { "io.sdar/taskExecution": { profileVersion: "1.0", runtimeRevision: "1" } },
  };
}
