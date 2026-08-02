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

  it("rejects enums, ranges and additional request properties", async () => {
    const { app } = createConsoleTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/console/v1/runtime-deployments/deployment-1/scale",
      headers: { "x-actor-id": "prototype-user" },
      payload: {
        providerId: "provider-1",
        expectedDesiredRevision: 1,
        desiredReplicas: 2,
        ignored: true,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_REQUEST" });
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
    expect(invalidContentType.json()).toMatchObject({ code: "INVALID_REQUEST" });
    await app.close();
  });
});
