import { describe, expect, it } from "vitest";
import type { CatalogSnapshot } from "../../../packages/catalog-manager/src/index.js";
import type { RuntimeDeployment } from "../../../packages/runtime-deployment/src/index.js";
import { buildRegistryProviderProjection } from "../src/registry-provider-projection.js";

describe("buildRegistryProviderProjection", () => {
  it("retains the existing active provider when publishing a second provider", async () => {
    const current = deployment("provider-a", "deployment-a", "DISCOVERING");
    const existing = deployment("provider-b", "deployment-b", "ACTIVE");
    const catalogA = catalog("provider-a", 1);
    const catalogB = catalog("provider-b", 3);

    const result = await buildRegistryProviderProjection({
      deployment: current.snapshot,
      catalog: catalogA,
      deployments: [current, existing],
      activeCatalog: async (providerId) => (providerId === "provider-b" ? catalogB : null),
      ensureInstance: async (candidate) => ({ instanceId: `instance-${candidate.providerId}` }),
      advertisedBaseUrl: async (candidate) =>
        candidate.providerId === "provider-b" ? "http://127.0.0.1:18081" : "http://127.0.0.1:18080",
    });

    expect(result.map((provider) => provider.providerId)).toEqual(["provider-a", "provider-b"]);
    expect(result[1]).toMatchObject({
      providerId: "provider-b",
      serverId: "instance-provider-b",
      effectiveEndpoint: "http://127.0.0.1:18081",
      catalog: catalogB,
    });
  });

  it("fails closed when an active provider has no catalog", async () => {
    const current = deployment("provider-a", "deployment-a", "DISCOVERING");
    const existing = deployment("provider-b", "deployment-b", "ACTIVE");

    await expect(
      buildRegistryProviderProjection({
        deployment: current.snapshot,
        catalog: catalog("provider-a", 1),
        deployments: [current, existing],
        activeCatalog: async () => null,
        ensureInstance: async (candidate) => ({ instanceId: `instance-${candidate.providerId}` }),
        advertisedBaseUrl: async () => "http://127.0.0.1:18081",
      }),
    ).rejects.toThrow("REGISTRY_ACTIVE_CATALOG_MISSING");
  });
});

function deployment(
  providerId: string,
  deploymentId: string,
  status: "ACTIVE" | "DISCOVERING",
): RuntimeDeployment {
  return {
    snapshot: {
      providerId,
      deploymentId,
      environment: "home-lab",
      desiredState: "running",
      desiredReplicas: 1,
      runtimeVersion: "2.0.0-rc.1",
      databaseProfileId: `${deploymentId}-database`,
      configProfileId: `${deploymentId}-config`,
      adapterEndpoint: "127.0.0.1:17020",
      status,
      desiredRevision: 1,
      observedRevision: 1,
    },
  } as unknown as RuntimeDeployment;
}

function catalog(providerId: string, revision: number): CatalogSnapshot {
  return {
    providerId,
    revision,
    checksum: `checksum-${providerId}`,
    document: {
      discovery: {
        resultType: "complete",
        supportedVersions: ["2026-07-28"],
        capabilities: frozenCapabilities(),
        serverInfo: { name: providerId, version: "0.1.0" },
      },
      tools: [],
    },
    discoveredAt: new Date(0),
    createdAt: new Date(0),
  };
}

function frozenCapabilities() {
  return {
    tools: {},
    extensions: {
      "io.modelcontextprotocol/tasks": {},
      "io.sdar/taskExecution": { profileVersion: "1.0" as const, taskNotifications: true as const },
    },
  };
}
