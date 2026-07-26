import { describe, expect, it } from "vitest";
import {
  FrozenErrorCode,
  requireTasksCapability,
  validateFrozenRequest,
} from "../../packages/mcp-protocol/src/index.js";

describe("frozen request meta", () => {
  it.each([
    ["C-007", "io.modelcontextprotocol/protocolVersion"],
    ["C-009 C-066", "io.modelcontextprotocol/clientInfo"],
    ["C-008", "io.modelcontextprotocol/clientCapabilities"],
  ])("%s rejects a request missing %s", (_caseId, missing) => {
    const request = validRequest();
    request.params._meta[missing] = undefined;
    expectFrozenCode(() => validateFrozenRequest(request), FrozenErrorCode.InvalidParams);
  });

  it("rejects a non-frozen protocol version", () => {
    const request = validRequest();
    request.params._meta["io.modelcontextprotocol/protocolVersion"] = "2025-11-25";
    expectFrozenCode(
      () => validateFrozenRequest(request),
      FrozenErrorCode.UnsupportedProtocolVersion,
    );
  });

  it("C-010 C-011 requires the Tasks Extension for relevant requests", () => {
    const parsed = validateFrozenRequest(validRequest());
    expect(() => requireTasksCapability(parsed)).not.toThrow();

    const request = validRequest();
    request.params._meta["io.modelcontextprotocol/clientCapabilities"] = {};
    expectFrozenCode(
      () => requireTasksCapability(validateFrozenRequest(request)),
      FrozenErrorCode.MissingRequiredClientCapability,
    );
  });
});

function validRequest(): {
  jsonrpc: string;
  id: string;
  method: string;
  params: { _meta: Record<string, unknown> };
} {
  return {
    jsonrpc: "2.0",
    id: "request-1",
    method: "server/discover",
    params: {
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

function expectFrozenCode(action: () => unknown, code: number): void {
  try {
    action();
    expect.fail("expected frozen protocol error");
  } catch (error) {
    expect(error).toMatchObject({ code, httpStatus: 400 });
  }
}
