import { describe, expect, it } from "vitest";
import {
  AdapterContractError,
  AdapterTransientError,
  TechnicalExecutionError,
  type AuthorizationContext,
} from "../../packages/domain/src/index.js";
import { Sep2663ProtocolHandler } from "../../packages/mcp-protocol/src/index.js";
import type { TaskEngine } from "../../packages/task-engine/src/index.js";

const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "live",
  simulationId: null,
};

describe("frozen Runtime error classification", () => {
  it.each([
    ["R-013", new AdapterContractError("ADAPTER_RESPONSE_INVALID"), false],
    ["R-014", new AdapterTransientError(), true],
    ["R-015", new TechnicalExecutionError(), false],
  ])(
    "%s maps internal Runtime failures to safe -32603 responses",
    async (_id, error, retryable) => {
      const handler = new Sep2663ProtocolHandler({ operations: [] } as never, "2.0.0-rc.1", {
        getFrozenTask: () => Promise.reject(error),
      } as unknown as TaskEngine);

      const result = await handler.dispatchAsync(
        request("tasks/get", { taskId: "task-1" }),
        headers("tasks/get", "task-1"),
        authorization,
      );

      expect(result).toMatchObject({
        httpStatus: 500,
        body: {
          error: {
            code: -32603,
            message: error.safeMessage,
            data: { reasonCode: error.reasonCode, ...(retryable ? { retryable: true } : {}) },
          },
        },
      });
      expect(JSON.stringify(result.body)).not.toMatch(
        /stack|cause|authorization|token|inputResponses/i,
      );
    },
  );
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
        "io.modelcontextprotocol/clientInfo": { name: "closure", version: "1.0.0" },
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
