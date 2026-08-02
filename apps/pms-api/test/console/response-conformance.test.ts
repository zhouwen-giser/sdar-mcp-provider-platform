import { describe, expect, it } from "vitest";
import { createConsoleTestApp } from "./helpers.js";

describe("Console response conformance", () => {
  it("serializes Date fields and closes core response projections", async () => {
    const { app } = createConsoleTestApp();
    const provider = await app.inject({
      method: "GET",
      url: "/api/console/v1/providers/provider-1",
    });
    expect(provider.statusCode).toBe(200);
    expect(provider.json()).toEqual({
      providerId: "provider-1",
      providerTypeId: "isr.vehicle.ugv",
      packageId: "pkg-1",
      packageVersion: "1.0.0",
      hostingMode: "vendor_managed",
      status: "draft",
      updatedAt: "2026-07-30T00:00:00.000Z",
    });
    expect(provider.json()).not.toHaveProperty("displayStatus");
    await app.close();
  });
});
