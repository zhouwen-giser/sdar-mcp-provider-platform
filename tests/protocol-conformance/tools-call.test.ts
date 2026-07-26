import { describe, expect, it, vi } from "vitest";
import type { AuthorizationContext } from "../../packages/domain/src/index.js";
import { Sep2663ProtocolHandler } from "../../packages/mcp-protocol/src/index.js";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";
import type { TaskEngine } from "../../packages/task-engine/src/index.js";
import {
  jsonToProtoStruct,
  type ProviderManifest,
} from "../../packages/adapter-protocol/src/index.js";

const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "live",
  simulationId: null,
};

describe("frozen tools/call", () => {
  it("C-013 returns the engine's flat CreateTaskResult with parsed timing", async () => {
    const callFrozenOperation = vi.fn().mockResolvedValue({
      resultType: "task",
      taskId: "task-1",
      status: "working",
      createdAt: "2026-07-18T03:00:00.000Z",
      lastUpdatedAt: "2026-07-18T03:00:00.000Z",
      ttlMs: 3_600_000,
      _meta: { "io.sdar/taskExecution": { profileVersion: "1.0", runtimeRevision: "1" } },
    });
    const handler = new Sep2663ProtocolHandler(
      new OperationRegistry().validate(manifest("TASK_REQUIRED")),
      "2.0.0-rc.1",
      { callFrozenOperation } as unknown as TaskEngine,
    );
    const response = await handler.dispatchAsync(request(true), headers(), authorization);
    expect(response).toMatchObject({
      httpStatus: 200,
      body: { result: { resultType: "task", taskId: "task-1" } },
    });
    expect(response.body.result).not.toHaveProperty("task");
    expect(callFrozenOperation).toHaveBeenCalledWith(
      expect.objectContaining({ name: "task/run" }),
      { resourceId: "resource-1" },
      authorization,
      "key-1",
      {
        start: { mode: "immediate", startToleranceMs: 5_000 },
        maxElapsedMs: 60_000,
      },
      "reservation-1",
    );
  });

  it("C-011 rejects task-producing tools before execution when Tasks capability is absent", async () => {
    const callFrozenOperation = vi.fn();
    const handler = new Sep2663ProtocolHandler(
      new OperationRegistry().validate(manifest("TASK_REQUIRED")),
      "2.0.0-rc.1",
      { callFrozenOperation } as unknown as TaskEngine,
    );
    expect(await handler.dispatchAsync(request(false), headers(), authorization)).toMatchObject({
      httpStatus: 400,
      body: { error: { code: -32003 } },
    });
    expect(callFrozenOperation).not.toHaveBeenCalled();
  });

  it("rejects Legacy task control fields", async () => {
    const body = request(true);
    (body.params as Record<string, unknown>).task = { ttl: 1_000 };
    const handler = new Sep2663ProtocolHandler(
      new OperationRegistry().validate(manifest("SYNCHRONOUS")),
      "2.0.0-rc.1",
      {} as TaskEngine,
    );
    expect(await handler.dispatchAsync(body, headers(), authorization)).toMatchObject({
      httpStatus: 400,
      body: { error: { code: -32602 } },
    });
  });

  it("C-012 returns a synchronous complete CallToolResult", async () => {
    const callFrozenOperation = vi.fn().mockResolvedValue({
      resultType: "complete",
      content: [],
      structuredContent: { ok: true },
      isError: false,
    });
    const handler = new Sep2663ProtocolHandler(
      new OperationRegistry().validate(manifest("SYNCHRONOUS")),
      "2.0.0-rc.1",
      { callFrozenOperation } as unknown as TaskEngine,
    );
    expect(await handler.dispatchAsync(request(true), headers(), authorization)).toMatchObject({
      body: { result: { resultType: "complete", structuredContent: { ok: true } } },
    });
  });

  it("C-014 makes a newly created Task immediately queryable", async () => {
    const created = { resultType: "task", taskId: "task-immediate", status: "working" };
    const getFrozenTask = vi.fn().mockResolvedValue({ ...created, resultType: "complete" });
    const handler = new Sep2663ProtocolHandler(
      new OperationRegistry().validate(manifest("TASK_REQUIRED")),
      "2.0.0-rc.1",
      {
        callFrozenOperation: vi.fn().mockResolvedValue(created),
        getFrozenTask,
      } as unknown as TaskEngine,
    );
    expect(await handler.dispatchAsync(request(true), headers(), authorization)).toMatchObject({
      body: { result: { taskId: "task-immediate" } },
    });
    const getRequest = {
      jsonrpc: "2.0",
      id: "get-1",
      method: "tasks/get",
      params: {
        taskId: "task-immediate",
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "sdar", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {
            extensions: { "io.modelcontextprotocol/tasks": {} },
          },
        },
      },
    };
    expect(
      await handler.dispatchAsync(
        getRequest,
        { ...headers(), "mcp-method": "tasks/get", "mcp-name": "task-immediate" },
        authorization,
      ),
    ).toMatchObject({ body: { result: { taskId: "task-immediate" } } });
    expect(getFrozenTask).toHaveBeenCalledOnce();
  });
});

function request(tasksCapability: boolean): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: "request-1",
    method: "tools/call",
    params: {
      name: "task/run",
      arguments: { resourceId: "resource-1" },
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "sdar", version: "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": tasksCapability
          ? { extensions: { "io.modelcontextprotocol/tasks": {} } }
          : {},
        "io.sdar/taskExecution": {
          profileVersion: "1.0",
          reservationRef: "reservation-1",
          idempotencyKey: "key-1",
          timing: {
            start: { mode: "immediate", startToleranceMs: 5_000 },
            maxElapsedMs: 60_000,
          },
        },
      },
    },
  };
}

function headers(): Record<string, string> {
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": "tools/call",
    "mcp-name": "task/run",
  };
}

function manifest(execution: "SYNCHRONOUS" | "TASK_REQUIRED"): ProviderManifest {
  return {
    adapterProtocolVersion: "1.0",
    providerId: "test-provider",
    providerType: "test",
    providerVersion: "1.0.0",
    inventoryMode: "OPAQUE",
    operations: [
      {
        name: "task/run",
        description: "Run",
        execution,
        inputSchema: jsonToProtoStruct({
          type: "object",
          properties: { resourceId: { type: "string" } },
          required: ["resourceId"],
          additionalProperties: false,
        }),
        outputSchema: jsonToProtoStruct({ type: "object" }),
        capabilities: {
          availability: false,
          scheduling: false,
          maxElapsed: true,
          cancel: true,
          pauseResume: false,
          inputRequired: false,
          idempotency: true,
          observations: false,
        },
      },
    ],
  };
}
