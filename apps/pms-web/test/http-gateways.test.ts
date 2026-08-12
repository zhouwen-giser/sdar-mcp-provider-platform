import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpGateways } from "../src/gateways/openapi/http-gateways.js";
import { GatewayProblem } from "../src/gateways/contracts/index.js";

const context = {
  actorId: "console-operator",
  correlationId: "corr-http-test",
};

interface RecordedRequest {
  readonly url: string;
  readonly init: RequestInit;
}

afterEach(() => vi.restoreAllMocks());

describe("Console HTTP Gateway Bundle", () => {
  it("maps all 36 frozen operations to their exact methods and paths", async () => {
    const requests: RecordedRequest[] = [];
    const gateways = createHttpGateways({ fetch: recordingFetch(requests) });
    const body = {} as never;

    await gateways.providers.listProviderPackages(context, { providerType: "ugv" });
    await gateways.providers.getProviderPackage("pkg", "1.0.0", context);
    await gateways.providers.listProviderTypes(context, { limit: 5, cursor: "type-cursor" });
    await gateways.providers.getProviderType("type", context);
    await gateways.providers.listProviders(context, {
      status: "active",
      cursor: "provider-cursor",
    });
    await gateways.providers.createProvider(body, context);
    await gateways.providers.getProvider("provider", context);
    await gateways.providers.updateProviderStatus("provider", body, context);

    await gateways.resources.listResources("production", context, { cursor: "resource-cursor" });
    await gateways.resources.createResource(body, context);
    await gateways.resources.getResource("production", "resource", context);
    await gateways.resources.updateResourceStatus("production", "resource", body, context);
    await gateways.resources.listBindings("provider", context);
    await gateways.resources.bind("provider", body, context);
    await gateways.resources.unbind("provider", "production", "resource", context);

    await gateways.configuration.createDraft(body, context);
    await gateways.configuration.getDraft("draft", context);
    await gateways.configuration.updateDraft("draft", body, context);
    await gateways.configuration.validateDraft("draft", context);
    await gateways.configuration.previewDraft("draft", context);
    await gateways.configuration.publishDraft("draft", body, context);
    await gateways.configuration.rollbackDraft("draft", body, context);

    await gateways.runtime.listDeployments("provider", context, { cursor: "deployment-cursor" });
    await gateways.runtime.createDeployment(body, context);
    await gateways.runtime.getDeployment("provider", "deployment", context);
    await gateways.runtime.startDeployment("deployment", body, context);
    await gateways.runtime.stopDeployment("deployment", body, context);
    await gateways.runtime.restartDeployment("deployment", body, context);
    await gateways.runtime.scaleDeployment("deployment", body, context);
    await gateways.runtime.reconcileDeployment("deployment", body, context);
    await gateways.runtime.listProcesses("provider", "deployment", context, {
      cursor: "process-cursor",
    });
    await gateways.runtime.getProcess("provider", "instance", context);

    await gateways.registry.latest("production", context);
    await gateways.registry.history("production", context, { limit: 7 });
    await gateways.registry.diff("production", 2, 3, context);
    await gateways.audit.list({ cursor: "audit-cursor", limit: 9 }, context);

    expect(requests).toHaveLength(36);
    expect(requests.map(({ url, init }) => `${init.method} ${url}`)).toEqual([
      "GET /api/console/v1/provider-packages?providerType=ugv",
      "GET /api/console/v1/provider-packages/pkg?version=1.0.0",
      "GET /api/console/v1/provider-types?limit=5&cursor=type-cursor",
      "GET /api/console/v1/provider-types/type",
      "GET /api/console/v1/providers?status=active&cursor=provider-cursor",
      "POST /api/console/v1/providers",
      "GET /api/console/v1/providers/provider",
      "PATCH /api/console/v1/providers/provider/status",
      "GET /api/console/v1/resources?environment=production&cursor=resource-cursor",
      "POST /api/console/v1/resources",
      "GET /api/console/v1/resources/production/resource",
      "PATCH /api/console/v1/resources/production/resource/status",
      "GET /api/console/v1/providers/provider/resource-bindings",
      "POST /api/console/v1/providers/provider/resource-bindings",
      "DELETE /api/console/v1/providers/provider/resource-bindings/production/resource",
      "POST /api/console/v1/configuration-drafts",
      "GET /api/console/v1/configuration-drafts/draft",
      "PATCH /api/console/v1/configuration-drafts/draft",
      "POST /api/console/v1/configuration-drafts/draft/validate",
      "GET /api/console/v1/configuration-drafts/draft/effective",
      "POST /api/console/v1/configuration-drafts/draft/publish",
      "POST /api/console/v1/configuration-drafts/draft/rollback",
      "GET /api/console/v1/runtime-deployments?providerId=provider&cursor=deployment-cursor",
      "POST /api/console/v1/runtime-deployments",
      "GET /api/console/v1/runtime-deployments/deployment?providerId=provider",
      "POST /api/console/v1/runtime-deployments/deployment/start",
      "POST /api/console/v1/runtime-deployments/deployment/stop",
      "POST /api/console/v1/runtime-deployments/deployment/restart",
      "POST /api/console/v1/runtime-deployments/deployment/scale",
      "POST /api/console/v1/runtime-deployments/deployment/reconcile",
      "GET /api/console/v1/runtime-processes?providerId=provider&deploymentId=deployment&cursor=process-cursor",
      "GET /api/console/v1/runtime-processes/instance?providerId=provider",
      "GET /api/console/v1/registry/production/latest",
      "GET /api/console/v1/registry/production/history?limit=7",
      "GET /api/console/v1/registry/production/diff?fromRevision=2&toRevision=3",
      "GET /api/console/v1/audit-events?cursor=audit-cursor&limit=9",
    ]);

    for (const request of requests) {
      const headers = new Headers(request.init.headers);
      expect(headers.has("authorization")).toBe(false);
      expect(headers.get("x-correlation-id")).toBe(context.correlationId);
      if (request.init.method === "GET") expect(headers.has("x-actor-id")).toBe(false);
      else expect(headers.get("x-actor-id")).toBe(context.actorId);
    }
  });

  it("strictly encodes path segments and opaque query cursors", async () => {
    const requests: RecordedRequest[] = [];
    const gateways = createHttpGateways({
      baseUrl: "https://console.example.test/api/console/v1/",
      fetch: recordingFetch(requests),
    });
    await gateways.resources.getResource("prod/east", "resource ?#/%", context);
    await gateways.audit.list({ subjectId: "subject /?#", cursor: "opaque/+? =" }, context);
    expect(requests[0]?.url).toBe(
      "https://console.example.test/api/console/v1/resources/prod%2Feast/resource%20%3F%23%2F%25",
    );
    expect(requests[1]?.url).toBe(
      "https://console.example.test/api/console/v1/audit-events?subjectId=subject+%2F%3F%23&cursor=opaque%2F%2B%3F+%3D",
    );
  });

  it("preserves nextCursor without interpreting it", async () => {
    const cursor = "opaque:next/+==";
    const gateways = createHttpGateways({
      fetch: vi.fn(async () => jsonResponse({ items: [], nextCursor: cursor })),
    });
    await expect(gateways.providers.listProviders(context)).resolves.toEqual({
      items: [],
      nextCursor: cursor,
    });
  });

  it("maps application/problem+json into GatewayProblem without inventing retryability", async () => {
    const problem = {
      type: "urn:sdar:pms:problem:entity-not-found",
      title: "Provider not found",
      status: 404,
      code: "ENTITY_NOT_FOUND",
      detail: "No provider exists for the supplied identifier",
      correlationId: "corr-problem",
    };
    const gateways = createHttpGateways({
      fetch: vi.fn(
        async () =>
          new Response(JSON.stringify(problem), {
            status: 404,
            headers: { "content-type": "application/problem+json; charset=utf-8" },
          }),
      ),
    });
    const failure = await gateways.providers.getProvider("missing", context).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(GatewayProblem);
    expect(failure).toMatchObject({ problem });
    if (!(failure instanceof GatewayProblem)) throw new Error("EXPECTED_GATEWAY_PROBLEM");
    expect(failure.problem).not.toHaveProperty("retryable");
  });

  it("maps a successful 204 response to void", async () => {
    const gateways = createHttpGateways({
      fetch: vi.fn(async () => new Response(null, { status: 204 })),
    });
    await expect(
      gateways.resources.unbind("provider", "production", "resource", context),
    ).resolves.toBeUndefined();
  });
});

function recordingFetch(requests: RecordedRequest[]): typeof globalThis.fetch {
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const requestInit = init ?? {};
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, init: requestInit });
    return requestInit.method === "DELETE"
      ? new Response(null, { status: 204 })
      : jsonResponse({ items: [] });
  };
  return vi.fn(fetch);
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
