import { describe, expect, it } from "vitest";
import { createConsoleTestApp, WRITE_HEADERS } from "./helpers.js";

describe("Console Provider operations", () => {
  it("lists Provider Types and creates a Provider through the existing service", async () => {
    const { app, spies } = createConsoleTestApp();
    const types = await app.inject({ method: "GET", url: "/api/console/v1/provider-types" });
    expect(types.statusCode).toBe(200);
    expect(types.json()).toMatchObject({ items: [{ providerTypeId: "isr.vehicle.ugv" }] });

    const created = await app.inject({
      method: "POST",
      url: "/api/console/v1/providers",
      headers: WRITE_HEADERS,
      payload: { providerId: "provider-1", providerTypeId: "isr.vehicle.ugv" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ providerId: "provider-1", status: "draft" });
    expect(spies.createProvider).toHaveBeenCalledWith(
      { providerId: "provider-1", providerTypeId: "isr.vehicle.ugv" },
      { actorId: "prototype-user", correlationId: "corr-1" },
    );
    await app.close();
  });
});

