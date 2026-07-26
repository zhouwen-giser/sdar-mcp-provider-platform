import { describe, expect, it } from "vitest";
import { frozenDiscoveryResult } from "../../packages/mcp-protocol/src/index.js";

describe("frozen server discovery", () => {
  it("C-004 C-005 publishes the fixed version, Tasks Extension and mandatory notifications", () => {
    expect(frozenDiscoveryResult("2.0.0-rc.1")).toEqual({
      resultType: "complete",
      supportedVersions: ["2026-07-28"],
      capabilities: {
        tools: {},
        extensions: {
          "io.modelcontextprotocol/tasks": {},
          "io.sdar/taskExecution": { profileVersion: "1.0", taskNotifications: true },
        },
      },
      _meta: {
        "io.modelcontextprotocol/serverInfo": {
          name: "sdar-mcp-tasks-provider-runtime",
          version: "2.0.0-rc.1",
        },
      },
      instructions: "This server provides SDAR task-capable tools.",
      ttlMs: 3_600_000,
      cacheScope: "public",
    });
  });
});
