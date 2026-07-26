import type { IncomingHttpHeaders } from "node:http";
import { describe, expect, it } from "vitest";
import {
  FrozenErrorCode,
  validateFrozenHeaders,
  validateFrozenRequest,
} from "../../packages/mcp-protocol/src/index.js";

describe("frozen Streamable HTTP routing headers", () => {
  it("accepts matching version, method and name headers", () => {
    const request = parsed("tools/call", { name: "embodied.move", arguments: {} });
    expect(() =>
      validateFrozenHeaders(headers("tools/call", "embodied.move"), request),
    ).not.toThrow();
  });

  it("C-041 C-042 C-043 rejects missing routing headers", () => {
    const request = parsed("tasks/get", { taskId: "task-1" });
    for (const name of [
      "accept",
      "content-type",
      "mcp-protocol-version",
      "mcp-method",
      "mcp-name",
    ]) {
      const candidate = headers("tasks/get", "task-1");
      candidate[name] = undefined;
      expectHeaderMismatch(() => validateFrozenHeaders(candidate, request));
    }
  });

  it("C-044 maps a Header and Body identity mismatch to -32001 and HTTP 400", () => {
    const request = parsed("tasks/get", { taskId: "task-1" });
    expectHeaderMismatch(() => validateFrozenHeaders(headers("tasks/get", "other"), request));
  });

  it("forbids Mcp-Name on subscriptions/listen", () => {
    const request = parsed("subscriptions/listen", { notifications: { taskIds: [] } });
    expect(() => validateFrozenHeaders(headers("subscriptions/listen"), request)).not.toThrow();
    expectHeaderMismatch(() =>
      validateFrozenHeaders(headers("subscriptions/listen", "forbidden"), request),
    );
  });
});

function parsed(method: string, params: Record<string, unknown>) {
  return validateFrozenRequest({
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
  });
}

function headers(method: string, name?: string): IncomingHttpHeaders {
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
    ...(name === undefined ? {} : { "mcp-name": name }),
  };
}

function expectHeaderMismatch(action: () => unknown): void {
  try {
    action();
    expect.fail("expected HeaderMismatch");
  } catch (error) {
    expect(error).toMatchObject({ code: FrozenErrorCode.HeaderMismatch, httpStatus: 400 });
  }
}
