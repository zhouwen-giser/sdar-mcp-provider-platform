import { describe, expect, it, vi } from "vitest";
import type { AuthorizationContext } from "../../packages/domain/src/index.js";
import { Sep2663ProtocolHandler } from "../../packages/mcp-protocol/src/index.js";
import type { TaskEngine } from "../../packages/task-engine/src/index.js";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";
import {
  jsonToProtoStruct,
  type ProviderManifest,
} from "../../packages/adapter-protocol/src/index.js";

const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "live",
  simulationId: null,
};

describe("frozen Task acknowledgements", () => {
  it("C-022 returns empty complete acknowledgements for update and cooperative cancel", async () => {
    const updateTaskInputResponses = vi.fn().mockResolvedValue(undefined);
    const cancelTaskCooperatively = vi.fn().mockResolvedValue(undefined);
    const handler = new Sep2663ProtocolHandler(
      new OperationRegistry().validate(manifest()),
      "2.0.0-rc.1",
      { updateTaskInputResponses, cancelTaskCooperatively } as unknown as TaskEngine,
    );

    const updated = await handler.dispatchAsync(
      request("tasks/update", {
        taskId: "task-1",
        inputResponses: { approval: { action: "accept", content: { approved: true } } },
      }),
      headers("tasks/update", "task-1"),
      authorization,
    );
    expect(updated).toMatchObject({
      httpStatus: 200,
      body: { result: { resultType: "complete" } },
    });
    expect(Object.keys(updated.body.result ?? {})).toEqual(["resultType"]);

    const cancelled = await handler.dispatchAsync(
      request("tasks/cancel", { taskId: "task-1" }),
      headers("tasks/cancel", "task-1"),
      authorization,
    );
    expect(cancelled).toMatchObject({
      httpStatus: 200,
      body: { result: { resultType: "complete" } },
    });
    expect(updateTaskInputResponses).toHaveBeenCalledOnce();
    expect(cancelTaskCooperatively).toHaveBeenCalledOnce();
  });

  it("C-046 requires the Tasks capability", async () => {
    const handler = new Sep2663ProtocolHandler(
      new OperationRegistry().validate(manifest()),
      "2.0.0-rc.1",
      {} as TaskEngine,
    );
    const body = request("tasks/cancel", { taskId: "task-1" });
    const meta = (body.params as Record<string, Record<string, unknown>>)._meta;
    if (meta !== undefined) meta["io.modelcontextprotocol/clientCapabilities"] = {};
    expect(
      await handler.dispatchAsync(body, headers("tasks/cancel", "task-1"), authorization),
    ).toMatchObject({
      httpStatus: 400,
      body: { error: { code: -32003 } },
    });
  });
});

function request(method: string, params: Record<string, unknown>): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: "request-1",
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "sdar", version: "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {
          extensions: { "io.modelcontextprotocol/tasks": {} },
        },
      },
    },
  };
}

function headers(method: string, name: string): Record<string, string> {
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
    "mcp-name": name,
  };
}

function manifest(): ProviderManifest {
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
        execution: "TASK_REQUIRED",
        inputSchema: jsonToProtoStruct({ type: "object" }),
        outputSchema: jsonToProtoStruct({ type: "object" }),
        capabilities: {
          availability: false,
          scheduling: false,
          maxElapsed: false,
          cancel: false,
          pauseResume: false,
          inputRequired: true,
          idempotency: true,
          observations: false,
        },
      },
    ],
  };
}
