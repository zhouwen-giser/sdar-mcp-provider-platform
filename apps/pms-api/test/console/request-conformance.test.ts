import { describe, expect, it } from "vitest";
import { createConsoleTestApp } from "./helpers.js";

describe("Console request conformance", () => {
  it.each([
    ["POST", "/api/console/v1/providers", { providerId: "p", providerTypeId: "t" }],
    [
      "POST",
      "/api/console/v1/resources",
      { environment: "production", resourceId: "r", resourceType: "vehicle" },
    ],
    [
      "POST",
      "/api/console/v1/runtime-deployments/deployment-1/start",
      { providerId: "provider-1", expectedDesiredRevision: 1 },
    ],
  ] as const)("requires X-Actor-ID for %s %s", async (method, url, payload) => {
    const { app } = createConsoleTestApp();
    const response = await app.inject({ method, url, payload });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_REQUEST" });
    await app.close();
  });

  it("rejects unsupported ranges and additional request properties independently", async () => {
    const { app } = createConsoleTestApp();
    const invalidRange = await app.inject({
      method: "POST",
      url: "/api/console/v1/runtime-deployments/deployment-1/scale",
      headers: { "x-actor-id": "prototype-user" },
      payload: {
        providerId: "provider-1",
        expectedDesiredRevision: 1,
        desiredReplicas: 2,
      },
    });
    expect(invalidRange.statusCode).toBe(400);
    expect(invalidRange.json()).toMatchObject({ code: "INVALID_REQUEST" });

    const extraProperty = await app.inject({
      method: "POST",
      url: "/api/console/v1/providers",
      headers: { "x-actor-id": "prototype-user" },
      payload: {
        providerId: "provider-1",
        providerTypeId: "isr.vehicle.ugv",
        ignored: true,
      },
    });
    expect(extraProperty.statusCode).toBe(400);
    expect(extraProperty.json()).toMatchObject({ code: "INVALID_REQUEST" });
    await app.close();
  });

  it("rejects invalid date, optimistic-concurrency and identifier values", async () => {
    const { app } = createConsoleTestApp();
    const invalidDate = await app.inject({
      method: "PATCH",
      url: "/api/console/v1/providers/provider-1/status",
      headers: { "x-actor-id": "prototype-user" },
      payload: { status: "active", expectedUpdatedAt: "not-a-date" },
    });
    expect(invalidDate.statusCode).toBe(400);
    expect(invalidDate.json()).toMatchObject({ code: "INVALID_REQUEST" });

    const invalidRevision = await app.inject({
      method: "POST",
      url: "/api/console/v1/runtime-deployments/deployment-1/start",
      headers: { "x-actor-id": "prototype-user" },
      payload: { providerId: "provider-1", expectedDesiredRevision: -1 },
    });
    expect(invalidRevision.statusCode).toBe(400);
    expect(invalidRevision.json()).toMatchObject({ code: "INVALID_REQUEST" });

    const invalidIdentifier = await app.inject({
      method: "POST",
      url: "/api/console/v1/providers",
      headers: { "x-actor-id": "prototype-user" },
      payload: { providerId: "", providerTypeId: "isr.vehicle.ugv" },
    });
    expect(invalidIdentifier.statusCode).toBe(400);
    expect(invalidIdentifier.json()).toMatchObject({ code: "INVALID_REQUEST" });
    await app.close();
  });

  it("maps malformed and oversized JSON to Console ProblemDetails", async () => {
    const { app } = createConsoleTestApp();
    const malformed = await app.inject({
      method: "POST",
      url: "/api/console/v1/providers",
      headers: {
        "content-type": "application/json",
        "x-actor-id": "prototype-user",
      },
      payload: "{",
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.headers["content-type"]).toContain("application/problem+json");
    expect(malformed.json()).toMatchObject({ status: 400, code: "INVALID_JSON" });

    const oversized = await app.inject({
      method: "POST",
      url: "/api/console/v1/providers",
      headers: {
        "content-type": "application/json",
        "x-actor-id": "prototype-user",
      },
      payload: JSON.stringify({
        providerId: "provider-1",
        providerTypeId: "isr.vehicle.ugv",
        padding: "x".repeat(1_048_576),
      }),
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.headers["content-type"]).toContain("application/problem+json");
    expect(oversized.json()).toMatchObject({
      status: 413,
      code: "REQUEST_BODY_TOO_LARGE",
    });
    await app.close();
  });

  it("validates query, tracing headers and JSON content type", async () => {
    const { app } = createConsoleTestApp();
    const invalidQuery = await app.inject({
      method: "GET",
      url: "/api/console/v1/providers?unexpected=true",
    });
    expect(invalidQuery.statusCode).toBe(400);
    const invalidHeader = await app.inject({
      method: "GET",
      url: "/api/console/v1/providers",
      headers: { "x-correlation-id": "not allowed" },
    });
    expect(invalidHeader.statusCode).toBe(400);
    const invalidContentType = await app.inject({
      method: "POST",
      url: "/api/console/v1/providers",
      headers: { "x-actor-id": "prototype-user", "content-type": "text/plain" },
      payload: "not-json",
    });
    expect(invalidContentType.statusCode).toBe(400);
    expect(invalidContentType.headers["content-type"]).toContain("application/problem+json");
    expect(invalidContentType.json()).toMatchObject({ code: "INVALID_REQUEST" });
    await app.close();
  });
});
