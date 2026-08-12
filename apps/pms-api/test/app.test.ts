import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadProviderPackageQueryService } from "../../../packages/pms-application/src/index.js";
import { createPmsApi, pmsOpenApiDocument } from "../src/index.js";

describe("PMS control-plane API foundation", () => {
  it("starts and serves liveness plus dependency-aware readiness", async () => {
    const app = createPmsApi({
      readiness: () =>
        Promise.resolve({ ready: false, checks: { database: "unavailable" as const } }),
    });
    await app.ready();

    const live = await app.inject({ method: "GET", url: "/health/live" });
    const ready = await app.inject({ method: "GET", url: "/health/ready" });

    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: "ok" });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({
      status: "unavailable",
      checks: { database: "unavailable" },
    });
    await app.close();
  });

  it("publishes a versioned root and deterministic OpenAPI 3.1 document", async () => {
    const app = createPmsApi();
    const root = await app.inject({ method: "GET", url: "/api/v1" });
    const openapi = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });

    expect(root.statusCode).toBe(200);
    expect(root.json()).toMatchObject({
      apiVersion: "v1",
      links: { openapi: "/api/v1/openapi.json" },
    });
    expect(openapi.json()).toEqual(pmsOpenApiDocument());
    expect(openapi.json()).toMatchObject({ openapi: "3.1.0" });
    await app.close();
  });

  it("publishes the configured anonymous intranet management access profile", async () => {
    const app = createPmsApi({ managementAuthMode: "anonymous_intranet" });
    const openapi = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });

    expect(openapi.statusCode).toBe(200);
    expect(openapi.json()).toEqual(
      pmsOpenApiDocument({ managementAuthMode: "anonymous_intranet" }),
    );
    expect(
      openapi.json<{
        paths: Record<string, Record<string, Record<string, unknown>>>;
      }>().paths["/api/v1/registry/{environment}/consumers/sdar/v1/sources/{smppSourceId}/latest"]
        ?.get,
    ).toMatchObject({ security: [], "x-sdar-access-mode": "anonymous_intranet" });
    await app.close();
  });

  it("propagates safe request and correlation IDs in response context", async () => {
    const app = createPmsApi();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1",
      headers: {
        "x-request-id": "request-1",
        "x-correlation-id": "correlation-1",
        "x-actor-id": "admin-1",
      },
    });

    expect(response.headers["x-request-id"]).toBe("request-1");
    expect(response.headers["x-correlation-id"]).toBe("correlation-1");
    expect(response.json()).toMatchObject({
      request: {
        requestId: "request-1",
        correlationId: "correlation-1",
        actorId: "admin-1",
      },
    });
    await app.close();
  });

  it("returns a stable not-found envelope without echoing the URL", async () => {
    const app = createPmsApi();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/missing?token=secret-value",
      headers: { "x-request-id": "request-404", "x-correlation-id": "correlation-404" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "ROUTE_NOT_FOUND",
        message: "The requested API route does not exist",
        requestId: "request-404",
        correlationId: "correlation-404",
      },
    });
    expect(response.body).not.toContain("secret-value");
    await app.close();
  });

  it("redacts unexpected errors, SQL details, and Secret values", async () => {
    const app = createPmsApi({
      readiness: () =>
        Promise.reject(
          new Error(
            "password=super-secret SELECT * FROM provider connection=postgresql://admin:pw@db",
          ),
        ),
    });
    const response = await app.inject({
      method: "GET",
      url: "/health/ready",
      headers: { "x-request-id": "request-500", "x-correlation-id": "correlation-500" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An internal error occurred",
        requestId: "request-500",
        correlationId: "correlation-500",
      },
    });
    expect(response.body).not.toMatch(/super-secret|SELECT|postgresql/i);
    await app.close();
  });
});

describe("Provider Package query API", () => {
  it("lists the four production packages in stable order with safe qualification", async () => {
    const app = createPmsApi({
      providerPackages: await loadProviderPackageQueryService(workspaceRoot()),
    });
    const response = await app.inject({ method: "GET", url: "/api/v1/provider-packages" });
    const body = response.json<{
      items: { packageId: string; qualification: { realResourceStatus: string } }[];
    }>();

    expect(response.statusCode).toBe(200);
    expect(body.items.map(({ packageId }) => packageId)).toEqual([
      "builtin.home-assistant.climate",
      "builtin.home-assistant.light",
      "builtin.isr.vehicle.npc-tank",
      "builtin.isr.vehicle.ugv",
    ]);
    expect(
      body.items.every(({ qualification }) => qualification.realResourceStatus === "pending"),
    ).toBe(true);
    expect(response.body).not.toMatch(
      /mock|apps\/|reports\/|evidenceRefs|migrationSet|adapterEntry/i,
    );
    await app.close();
  });

  it("filters deterministically and returns package detail without internal paths", async () => {
    const app = createPmsApi({
      providerPackages: await loadProviderPackageQueryService(workspaceRoot()),
    });
    const filtered = await app.inject({
      method: "GET",
      url: "/api/v1/provider-packages?hostingMode=platform_managed&componentStatus=passed",
    });
    const detail = await app.inject({
      method: "GET",
      url: "/api/v1/provider-packages/builtin.isr.vehicle.ugv?version=1.0.0",
    });

    expect(
      filtered.json<{ items: { packageId: string }[] }>().items.map(({ packageId }) => packageId),
    ).toEqual(["builtin.isr.vehicle.npc-tank", "builtin.isr.vehicle.ugv"]);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      packageId: "builtin.isr.vehicle.ugv",
      packageVersion: "1.0.0",
      providerType: "isr.vehicle.ugv",
      qualification: {
        componentStatus: "passed",
        realResourceStatus: "pending",
      },
    });
    expect(detail.body).not.toMatch(/apps\/|reports\/|docs\/|migrationSet|evidenceRefs/i);
    await app.close();
  });

  it("returns stable validation and not-found errors", async () => {
    const app = createPmsApi({
      providerPackages: await loadProviderPackageQueryService(workspaceRoot()),
    });
    const invalid = await app.inject({
      method: "GET",
      url: "/api/v1/provider-packages?hostingMode=arbitrary",
      headers: { "x-request-id": "invalid-1", "x-correlation-id": "invalid-correlation" },
    });
    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/provider-packages/builtin.missing.provider",
      headers: { "x-request-id": "missing-1", "x-correlation-id": "missing-correlation" },
    });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      error: {
        code: "ENTITY_NOT_FOUND",
        message: "The entity does not exist",
        requestId: "missing-1",
        correlationId: "missing-correlation",
      },
    });
    await app.close();
  });

  it("includes list/detail operations in generated OpenAPI", () => {
    const document = pmsOpenApiDocument() as {
      paths: Readonly<Record<string, { get?: { operationId?: string } }>>;
    };
    expect(document.paths["/api/v1/provider-packages"]?.get?.operationId).toBe(
      "listProviderPackages",
    );
    expect(document.paths["/api/v1/provider-packages/{packageId}"]?.get?.operationId).toBe(
      "getProviderPackage",
    );
  });
});

function workspaceRoot(): string {
  return resolve(import.meta.dirname, "../../..");
}
