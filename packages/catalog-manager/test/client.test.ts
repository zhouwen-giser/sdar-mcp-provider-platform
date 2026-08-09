import { describe, expect, it, vi } from "vitest";
import {
  CatalogDiscoveryClient,
  CatalogDiscoveryError,
  type CatalogDiscoveryRequest,
  type CatalogDiscoveryTransport,
} from "../src/index.js";

describe("CatalogDiscoveryClient", () => {
  it("discovers the frozen profile and returns a stable sorted catalog", async () => {
    const first = await new CatalogDiscoveryClient(
      transport([discoveryResponse(), toolsResponse([tool("zeta"), tool("alpha", true)])]),
    ).discover();
    const second = await new CatalogDiscoveryClient(
      transport([discoveryResponse(), toolsResponse([tool("alpha", true), tool("zeta")])]),
    ).discover();

    expect(first.tools.map((entry) => entry.name)).toEqual(["alpha", "zeta"]);
    expect(first.tools[0]?.resourceBinding).toEqual({
      mode: "ARGUMENT_REFERENCE",
      resourceIdJsonPointer: "/resourceId",
    });
    expect(first.canonicalJson).toBe(second.canonicalJson);
  });

  it.each([
    [{ nextCursor: "page-2", tools: [tool("one")] }],
    [{ resultType: "partial", tools: [tool("one")] }],
  ])("rejects an incomplete tools/list without returning a partial catalog", async (result) => {
    const client = new CatalogDiscoveryClient(
      transport([discoveryResponse(), rpc("tools/list", result)]),
    );

    await expect(client.discover()).rejects.toMatchObject({
      code: "CATALOG_INCOMPLETE_TOOLS_LIST",
      retryable: false,
    });
  });

  it("rejects invalid JSON Schema and does not retry validation failures", async () => {
    const fake = transport([
      discoveryResponse(),
      toolsResponse([tool("invalid", false, { type: "definitely-not-a-json-type" })]),
    ]);
    const client = new CatalogDiscoveryClient(fake, { maxAttempts: 3, retryDelayMs: 0 });

    await expect(client.discover()).rejects.toMatchObject({
      code: "CATALOG_INVALID_SCHEMA",
      retryable: false,
    });
    expect(fake.call).toHaveBeenCalledTimes(2);
  });

  it.each([
    { profileVersion: "0.9" },
    { taskBehavior: "legacy_async" },
    { resourceBinding: { mode: "ARGUMENT_REFERENCE", resourceIdJsonPointer: "resourceId" } },
  ])("rejects invalid task profile or resource binding: %o", async (override) => {
    const candidate = tool("invalid");
    const metadata = candidate._meta as Record<string, unknown>;
    if ("resourceBinding" in override) {
      metadata["io.sdar/resourceBinding"] = override.resourceBinding;
    } else {
      metadata["io.sdar/taskExecution"] = {
        ...(metadata["io.sdar/taskExecution"] as Record<string, unknown>),
        ...override,
      };
    }
    await expect(
      new CatalogDiscoveryClient(
        transport([discoveryResponse(), toolsResponse([candidate])]),
      ).discover(),
    ).rejects.toMatchObject({ code: "CATALOG_INVALID_TOOL" });
  });

  it("retries bounded transient failures and then completes atomically", async () => {
    const call = vi
      .fn<CatalogDiscoveryTransport["call"]>()
      .mockRejectedValueOnce(new CatalogDiscoveryError("CATALOG_REQUEST_FAILED", true))
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(toolsResponse([tool("one")]));
    const fake: CatalogDiscoveryTransport = {
      call,
    };
    const result = await new CatalogDiscoveryClient(fake, {
      maxAttempts: 2,
      retryDelayMs: 0,
    }).discover();

    expect(result.tools).toHaveLength(1);
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("stops after the configured timeout and retry bound", async () => {
    const call = vi.fn<CatalogDiscoveryTransport["call"]>(
      (_request: CatalogDiscoveryRequest, signal: AbortSignal) => {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
    );
    const fake: CatalogDiscoveryTransport = {
      call,
    };
    const client = new CatalogDiscoveryClient(fake, {
      timeoutMs: 5,
      maxAttempts: 2,
      retryDelayMs: 0,
    });

    await expect(client.discover()).rejects.toMatchObject({
      code: "CATALOG_REQUEST_TIMEOUT",
      retryable: true,
    });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("sends the frozen method headers and per-request client declaration", async () => {
    const fake = transport([discoveryResponse(), toolsResponse([])]);
    await new CatalogDiscoveryClient(fake).discover();

    const firstCall = fake.call.mock.calls[0];
    expect(firstCall).toBeDefined();
    const request = firstCall?.[0];
    expect(request?.method).toBe("server/discover");
    expect(request?.headers["mcp-protocol-version"]).toBe("2026-07-28");
    expect(request?.headers["mcp-method"]).toBe("server/discover");
    expect(request?.body).toMatchObject({ jsonrpc: "2.0", method: "server/discover" });
    expect(firstCall?.[1]).toBeInstanceOf(AbortSignal);
  });

  it("projects only frozen public discovery capabilities", async () => {
    const response = discoveryResponse();
    const result = response.result as Record<string, unknown>;
    const capabilities = result.capabilities as Record<string, unknown>;
    const extensions = capabilities.extensions as Record<string, unknown>;
    extensions["io.sdar/privateDiagnostics"] = {
      note: "Bearer catalog-private-value",
    };

    const catalog = await new CatalogDiscoveryClient(
      transport([response, toolsResponse([tool("one")])]),
    ).discover();

    expect(catalog.discovery.capabilities).toEqual({
      tools: {},
      extensions: {
        "io.modelcontextprotocol/tasks": {},
        "io.sdar/taskExecution": { profileVersion: "1.0", taskNotifications: true },
      },
    });
    expect(catalog.canonicalJson).not.toContain("catalog-private-value");
  });

  it.each([
    "Authorization: Bearer classified-catalog-token",
    "Internal resource climate.private_lab_device",
    "https://example.test/docs?token=classified",
  ])("rejects sensitive values in otherwise public Tool fields: %s", async (description) => {
    const candidate = tool("unsafe");
    candidate.description = description;

    await expect(
      new CatalogDiscoveryClient(
        transport([discoveryResponse(), toolsResponse([candidate])]),
      ).discover(),
    ).rejects.toMatchObject({ code: "CATALOG_SENSITIVE_DATA", retryable: false });
  });
});

function transport(responses: unknown[]): CatalogDiscoveryTransport & {
  call: ReturnType<typeof vi.fn<CatalogDiscoveryTransport["call"]>>;
} {
  const call = vi.fn<CatalogDiscoveryTransport["call"]>(() => {
    const response = responses.shift();
    if (response === undefined) return Promise.reject(new Error("UNEXPECTED_CATALOG_CALL"));
    return Promise.resolve(response);
  });
  return {
    call,
  };
}

function discoveryResponse(): Record<string, unknown> {
  return rpc("server/discover", {
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
        version: "2.0.0",
      },
    },
    instructions: "Runtime catalog",
    ttlMs: 3_600_000,
    cacheScope: "public",
  });
}

function toolsResponse(tools: unknown[]): Record<string, unknown> {
  return rpc("tools/list", { tools });
}

function rpc(method: "server/discover" | "tools/list", result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id: `catalog-${method}`, result };
}

function tool(
  name: string,
  binding = false,
  inputSchema: Record<string, unknown> = { type: "object" },
): Record<string, unknown> {
  return {
    name,
    description: `${name} operation`,
    inputSchema,
    outputSchema: { type: "object" },
    _meta: {
      "io.sdar/taskExecution": {
        profileVersion: "1.0",
        taskBehavior: "task_required",
        availability: "dynamic",
        supportsScheduling: true,
        supportsMaxElapsed: true,
        supportsObservations: true,
        supportsInputRequired: true,
        idempotency: "server_managed",
      },
      ...(binding
        ? {
            "io.sdar/resourceBinding": {
              mode: "ARGUMENT_REFERENCE",
              resourceIdJsonPointer: "/resourceId",
            },
          }
        : {}),
    },
  };
}
