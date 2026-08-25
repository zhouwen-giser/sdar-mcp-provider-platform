import { describe, expect, it } from "vitest";
import { frozenDiscoveryResult } from "../../packages/mcp-protocol/src/index.js";

describe("frozen server discovery", () => {
  it("C-004 C-005 publishes the fixed version, Tasks Extension and provider catalog", () => {
    expect(
      frozenDiscoveryResult("2.0.0-rc.1", {
        providerId: "isr.vehicle.ugv.ugv1",
        providerType: "isr.vehicle.ugv",
        providerVersion: "1.0.0",
        manifestHash: "a".repeat(64),
      }),
    ).toEqual({
      resultType: "complete",
      supportedVersions: ["2026-07-28"],
      capabilities: {
        tools: {},
        extensions: {
          "io.modelcontextprotocol/tasks": {},
          "io.sdar/taskExecution": { profileVersion: "1.0", taskNotifications: true },
          "io.sdar/providerCatalog": {
            providerId: "isr.vehicle.ugv.ugv1",
            providerType: "isr.vehicle.ugv",
            providerVersion: "1.0.0",
            manifestHash: "a".repeat(64),
          },
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

  it("keeps readiness, endpoints and secrets out of the public provider catalog", () => {
    const serialized = JSON.stringify(
      frozenDiscoveryResult("2.0.0-rc.1", {
        providerId: "provider-1",
        providerType: "isr.vehicle.ugv",
        providerVersion: "1.0.0",
        manifestHash: "b".repeat(64),
      }),
    );
    expect(serialized).not.toContain("readiness");
    expect(serialized).not.toContain("endpoint");
    expect(serialized).not.toContain("secret");
  });
});
