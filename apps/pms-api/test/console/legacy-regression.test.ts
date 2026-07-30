import { describe, expect, it } from "vitest";
import { createConsoleTestApp } from "./helpers.js";

describe("legacy route regression", () => {
  it("preserves health and /api/v1 response shapes", async () => {
    const { app } = createConsoleTestApp();
    const health = await app.inject({ method: "GET", url: "/health/live" });
    const root = await app.inject({ method: "GET", url: "/api/v1" });
    const legacyMissing = await app.inject({ method: "GET", url: "/api/v1/not-present" });
    expect(health.json()).toEqual({ status: "ok" });
    expect(root.json()).toMatchObject({ apiVersion: "v1" });
    expect(legacyMissing.json()).toHaveProperty("error.code", "ROUTE_NOT_FOUND");
    expect(legacyMissing.headers["content-type"]).not.toContain("application/problem+json");
    await app.close();
  });
});

