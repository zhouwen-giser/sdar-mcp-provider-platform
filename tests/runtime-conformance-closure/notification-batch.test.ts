import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { AuthorizationContext } from "../../packages/domain/src/index.js";
import {
  TaskNotificationStream,
  type FrozenJsonRpcRequest,
} from "../../packages/mcp-protocol/src/index.js";
import { TaskRepository } from "../../packages/persistence-postgres/src/index.js";

const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "live",
  simulationId: null,
};

describe("Runtime notification batch polling", () => {
  it("executes exactly two bounded repository queries for 256 Task IDs", async () => {
    const taskIds = Array.from(
      { length: 256 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new TaskRepository({ query } as never);

    await repository.getAuthorizedTasksByIds(taskIds, authorization);
    await repository.listInputRequestsByTaskIds(taskIds);

    expect(query).toHaveBeenCalledTimes(2);
    const calls = query.mock.calls as [string, unknown[]][];
    expect(calls.map(([, parameters]) => parameters[0])).toEqual([taskIds, taskIds]);
  });

  it("R-018 loads 256 Tasks and their input requests through bounded batch queries", async () => {
    const taskIds = Array.from(
      { length: 256 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    const getFrozenTasks = vi
      .fn()
      .mockResolvedValue(new Map(taskIds.map((taskId) => [taskId, snapshot(taskId)])));
    const getFrozenTask = vi
      .fn()
      .mockImplementation((taskId: string) => Promise.resolve(snapshot(taskId)));
    const stream = new TaskNotificationStream(
      { getFrozenTasks, getFrozenTask },
      {
        pollIntervalMs: 5,
        batchSize: 256,
      },
    );
    const response = new FakeResponse(257);

    await stream.listen(request(taskIds), response as never, authorization);

    expect(getFrozenTasks).toHaveBeenCalledOnce();
    expect(getFrozenTask).not.toHaveBeenCalled();
  });
});

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
}

function request(taskIds: string[]): FrozenJsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id: "batch",
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
