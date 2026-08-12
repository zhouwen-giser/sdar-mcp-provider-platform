import { describe, expect, it, vi } from "vitest";
import type { CatalogSnapshot } from "../../../packages/catalog-manager/src/index.js";
import type { RuntimeDeploymentSnapshot } from "../../../packages/runtime-deployment/src/index.js";
import type { RegistrySnapshotCandidate } from "../../../packages/registry-snapshot/src/index.js";
import {
  CatalogRegistryPublicationPhase,
  HttpCatalogRegistryDiscovery,
} from "../src/catalog-registry-phase.js";

describe("HttpCatalogRegistryDiscovery transport policy", () => {
  it("rejects non-loopback plaintext before making a request by default", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      new HttpCatalogRegistryDiscovery({ fetch }).discover({
        endpoint: "http://runtime.internal:8080/mcp",
        timeoutMs: 1_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("CATALOG_ENDPOINT_INVALID");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses deployment-bound authorization when plaintext internal transport is explicit", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response("unavailable", { status: 503 })),
    );
    await expect(
      new HttpCatalogRegistryDiscovery({
        allowInsecureInternalTransport: true,
        fetch,
      }).discover({
        endpoint: "http://runtime.internal:8080/mcp",
        authorization: "Bearer signed-short-lived-token",
        timeoutMs: 1_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(3);
    const request = fetch.mock.calls[0];
    expect(request?.[0]).toBe("http://runtime.internal:8080/mcp");
    expect(new Headers(request?.[1]?.headers).get("authorization")).toBe(
      "Bearer signed-short-lived-token",
    );
  });

  it("does not synthesize authorization when unauthenticated direct discovery is explicit", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response("unavailable", { status: 503 })),
    );
    await expect(
      new HttpCatalogRegistryDiscovery({
        allowInsecureInternalTransport: true,
        fetch,
      }).discover({
        endpoint: "http://runtime.internal:8080/mcp",
        timeoutMs: 1_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).has("authorization")).toBe(false);
  });
});

describe("CatalogRegistryPublicationPhase process projection", () => {
  it("moves the expected process from pending to valid before activation", async () => {
    const states: string[] = [];
    const deployment = discoveringDeployment();
    const catalog = catalogSnapshot();
    const phase = new CatalogRegistryPublicationPhase(
      {
        discover: () =>
          Promise.resolve({ ...catalog.document, canonicalJson: JSON.stringify(catalog.document) }),
      },
      { resolve: () => Promise.resolve({ endpoint: "http://127.0.0.1:8080/mcp" }) },
      {
        publish: () => Promise.resolve({ created: true, snapshot: catalog }),
        active: () => Promise.resolve(catalog),
        history: () => Promise.resolve([]),
      } as never,
      {
        providers: () =>
          Promise.resolve([
            {
              providerId: "provider-a",
              serverId: "instance-a",
              protocolMode: "frozen_v1",
              effectiveEndpoint: "http://127.0.0.1:8080",
              catalog,
            },
          ]),
      },
      {
        publish: ({ candidate }: { readonly candidate: RegistrySnapshotCandidate }) =>
          Promise.resolve({
            created: true,
            snapshot: {
              environment: "production",
              revision: 1,
              ...candidate,
              publishedAt: new Date(0),
              createdAt: new Date(0),
            },
          }),
      } as never,
      {
        recordCatalogState: (_value, state) => {
          states.push(state);
          return Promise.resolve();
        },
        activate: (value) => Promise.resolve({ ...value, status: "ACTIVE" }),
        fail: (value) => Promise.resolve({ ...value, status: "FAILED" }),
      },
    );

    const result = await phase.close(deployment, reconcileContext());

    expect(states).toEqual(["pending", "valid"]);
    expect(result.deployment.status).toBe("ACTIVE");
  });

  it("marks the process catalog invalid when authenticated discovery fails", async () => {
    const states: string[] = [];
    const deployment = discoveringDeployment();
    const phase = new CatalogRegistryPublicationPhase(
      { discover: () => Promise.reject(new Error("unauthorized")) },
      { resolve: () => Promise.resolve({ endpoint: "http://127.0.0.1:8080/mcp" }) },
      {} as never,
      {} as never,
      {} as never,
      {
        recordCatalogState: (_value, state) => {
          states.push(state);
          return Promise.resolve();
        },
        activate: (value) => Promise.resolve({ ...value, status: "ACTIVE" }),
        fail: (value) => Promise.resolve({ ...value, status: "FAILED" }),
      },
    );

    await expect(phase.close(deployment, reconcileContext())).rejects.toMatchObject({
      code: "CATALOG_DISCOVERY_FAILED",
    });
    expect(states).toEqual(["pending", "invalid"]);
  });
});

function discoveringDeployment(): RuntimeDeploymentSnapshot {
  return {
    deploymentId: "deployment-a",
    providerId: "provider-a",
    environment: "production",
    desiredState: "running",
    desiredReplicas: 1,
    runtimeVersion: "2.0.0",
    runtimeAuthority: "direct_container",
    adapterEndpoint: "adapter:7010",
    directContainer: {
      instanceId: "instance-a",
      controlEndpoint: "http://runtime.internal:8080",
      advertisedEndpoint: "http://192.168.1.7:19100",
    },
    status: "DISCOVERING",
    desiredRevision: 0,
    observedRevision: 4,
  } as RuntimeDeploymentSnapshot;
}

function catalogSnapshot(): CatalogSnapshot {
  return {
    providerId: "provider-a",
    revision: 1,
    checksum: "a".repeat(64),
    document: {
      discovery: {
        resultType: "complete",
        supportedVersions: ["2026-07-28"],
        capabilities: {},
        serverInfo: { name: "runtime", version: "2.0.0" },
      },
      tools: [],
    },
    discoveredAt: new Date(0),
    createdAt: new Date(0),
  };
}

function reconcileContext() {
  return {
    operationId: "operation-a",
    correlationId: "correlation-a",
    idempotencyKey: "idempotency-a",
    timeoutMs: 1_000,
    signal: new AbortController().signal,
  };
}
