import { describe, expect, it } from "vitest";
import { createConsoleTestApp } from "./helpers.js";

describe("Console RuntimeProcess operations", () => {
  it("keeps RuntimeProcess read-only and omits the deferred logs route", async () => {
    const { app } = createConsoleTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/console/v1/runtime-processes?providerId=provider-1&deploymentId=deployment-1",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ instanceId: "instance-1", observedHealth: "READY" }],
    });
    const logs = await app.inject({
      method: "GET",
      url: "/api/console/v1/runtime-processes/instance-1/logs?providerId=provider-1",
    });
    expect(logs.statusCode).toBe(404);
    expect(logs.headers["content-type"]).toContain("application/problem+json");
    await app.close();
  });
});

