import { describe, expect, it } from "vitest";
import type { CatalogSnapshot, CatalogTool } from "../../catalog-manager/src/index.js";
import {
  buildRegistrySnapshot,
  effectiveEndpoint,
  type RegistryProviderInput,
} from "../src/index.js";

describe("Registry Snapshot projection", () => {
  it("builds a stable provider/tool ordering and checksum", () => {
    const first = buildRegistrySnapshot("production", [
      provider("zeta-provider", ["zeta", "alpha"]),
      provider("alpha-provider", ["bravo"]),
    ]);
    const second = buildRegistrySnapshot("production", [
      provider("alpha-provider", ["bravo"]),
      provider("zeta-provider", ["alpha", "zeta"]),
    ]);

    expect(first).toEqual(second);
    expect(first.document.providers.map(({ providerId }) => providerId)).toEqual([
      "alpha-provider",
      "zeta-provider",
    ]);
    expect(first.document.providers[1]?.tools.map(({ name }) => name)).toEqual(["alpha", "zeta"]);
  });

  it("projects only public registry fields from a broad runtime-shaped input", () => {
    const input = {
      ...provider("provider-a", ["operate"]),
      secretRef: "secret://runtime/database",
      pm2Name: "sdar-provider-a-0",
      pid: 42,
      port: 31_000,
      taskId: "task-private",
      qualification: "mock-certified",
    };

    const result = buildRegistrySnapshot("production", [input]);

    expect(result.document.providers[0]).toEqual({
      providerId: "provider-a",
      serverId: "server-provider-a",
      protocolMode: "frozen_v1",
      effectiveEndpoint: "https://provider-a.example.test/mcp",
      catalogRevision: 1,
      tools: [tool("operate")],
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "secretRef",
      "pm2Name",
      '"pid"',
      '"port"',
      "taskId",
      "qualification",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it.each([
    "http://external.example.test/mcp",
    "https://user:password@example.test/mcp",
    "https://example.test/mcp?token=secret",
    "file:///tmp/runtime.sock",
  ])("rejects unsafe effective endpoint %s", (endpoint) => {
    expect(() => effectiveEndpoint(endpoint)).toThrow("REGISTRY_EFFECTIVE_ENDPOINT_INVALID");
  });

  it("allows loopback HTTP, requires one MCP path, and strips no authority", () => {
    expect(effectiveEndpoint("http://127.0.0.1:31000")).toBe("http://127.0.0.1:31000/mcp");
    expect(effectiveEndpoint("https://runtime.example.test/mcp/")).toBe(
      "https://runtime.example.test/mcp",
    );
  });

  it("rejects duplicate Provider or Server identities and catalog identity drift", () => {
    expect(() =>
      buildRegistrySnapshot("production", [
        provider("provider-a", ["one"]),
        provider("provider-a", ["two"]),
      ]),
    ).toThrow("REGISTRY_PROVIDER_DUPLICATE");
    expect(() =>
      buildRegistrySnapshot("production", [
        provider("provider-a", ["one"]),
        { ...provider("provider-b", ["two"]), serverId: "server-provider-a" },
      ]),
    ).toThrow("REGISTRY_SERVER_DUPLICATE");
    expect(() =>
      buildRegistrySnapshot("production", [
        {
          ...provider("provider-a", ["one"]),
          catalog: catalog("other-provider", ["one"]),
        },
      ]),
    ).toThrow("REGISTRY_CATALOG_PROVIDER_MISMATCH");
  });

  it.each([
    "Authorization: Bearer classified-registry-token",
    "Internal resource light.private_lab_device",
    "https://example.test/docs?password=classified",
  ])(
    "rejects sensitive values even when injected into public Catalog fields: %s",
    (description) => {
      const input = provider("provider-a", ["operate"]);
      const unsafeTool = { ...input.catalog.document.tools[0], description } as CatalogTool;
      const unsafe = {
        ...input,
        catalog: {
          ...input.catalog,
          document: { ...input.catalog.document, tools: [unsafeTool] },
        },
      };

      expect(() => buildRegistrySnapshot("production", [unsafe])).toThrow(
        "CATALOG_SENSITIVE_DATA_REJECTED",
      );
    },
  );
});

function provider(providerId: string, tools: string[]): RegistryProviderInput {
  return {
    providerId,
    serverId: `server-${providerId}`,
    protocolMode: "frozen_v1",
    effectiveEndpoint: `https://${providerId}.example.test`,
    catalog: catalog(providerId, tools),
  };
}

function catalog(providerId: string, tools: string[]): CatalogSnapshot {
  const entries = tools.map(tool);
  return {
    providerId,
    revision: 1,
    checksum: "a".repeat(64),
    document: {
      discovery: {
        resultType: "complete",
        supportedVersions: ["2026-07-28"],
        capabilities: {},
        serverInfo: { name: "runtime", version: "2.0.0" },
      },
      tools: entries,
    },
    discoveredAt: new Date("2026-07-26T00:00:00.000Z"),
    createdAt: new Date("2026-07-26T00:00:00.000Z"),
  };
}

function tool(name: string): CatalogTool {
  return {
    name,
    description: `${name} operation`,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    taskExecution: {
      profileVersion: "1.0",
      taskBehavior: "task_required",
      availability: "dynamic",
      supportsScheduling: true,
      supportsMaxElapsed: true,
      supportsObservations: true,
      supportsInputRequired: true,
      idempotency: "server_managed",
    },
  };
}
