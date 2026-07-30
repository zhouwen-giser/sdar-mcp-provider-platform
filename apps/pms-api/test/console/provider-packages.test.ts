import { describe, expect, it } from "vitest";
import { createConsoleTestApp } from "./helpers.js";

describe("Console Provider Package operations", () => {
  it("provides list and detail projections", async () => {
    const { app } = createConsoleTestApp();
    const list = await app.inject({
      method: "GET",
      url: "/api/console/v1/provider-packages?hostingMode=vendor_managed",
    });
    const detail = await app.inject({
      method: "GET",
      url: "/api/console/v1/provider-packages/pkg-1?version=1.0.0",
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ items: [{ packageId: "pkg-1" }] });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ packageVersion: "1.0.0" });
    await app.close();
  });
});

