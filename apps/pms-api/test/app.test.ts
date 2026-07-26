import { describe, expect, it } from "vitest";
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
