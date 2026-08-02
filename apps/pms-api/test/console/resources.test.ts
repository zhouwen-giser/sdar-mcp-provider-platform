import { describe, expect, it } from "vitest";
import { createConsoleTestApp, WRITE_HEADERS } from "./helpers.js";

describe("Console Resource operations", () => {
  it("creates, lists, binds and unbinds existing Resource objects", async () => {
    const { app, spies } = createConsoleTestApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/console/v1/resources",
      headers: WRITE_HEADERS,
      payload: {
        environment: "production",
        resourceId: "vehicle:1",
        resourceType: "vehicle",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(spies.createResource).toHaveBeenCalledOnce();
    const bound = await app.inject({
      method: "POST",
      url: "/api/console/v1/providers/provider-1/resource-bindings",
      headers: WRITE_HEADERS,
      payload: { environment: "production", resourceId: "vehicle:1" },
    });
    expect(bound.statusCode).toBe(201);
    expect(bound.json()).toMatchObject({ boundAt: "2026-07-30T00:00:00.000Z" });
    const removed = await app.inject({
      method: "DELETE",
      url: "/api/console/v1/providers/provider-1/resource-bindings/production/vehicle:1",
      headers: WRITE_HEADERS,
    });
    expect(removed.statusCode).toBe(204);
    await app.close();
  });
});
