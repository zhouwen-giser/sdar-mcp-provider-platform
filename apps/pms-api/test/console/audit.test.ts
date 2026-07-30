import { describe, expect, it } from "vitest";
import { createConsoleTestApp } from "./helpers.js";

describe("Console Audit operations", () => {
  it("maps filters and RFC3339 timestamps without exposing metadata", async () => {
    const { app, spies } = createConsoleTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/console/v1/audit-events?subjectType=provider&limit=25",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ action: "provider.created", occurredAt: "2026-07-30T00:00:00.000Z" }],
    });
    expect(response.json<{ items: unknown[] }>().items[0]).not.toHaveProperty("metadata");
    expect(spies.auditList).toHaveBeenCalledWith({ limit: 25, subjectType: "provider" });
    await app.close();
  });
});

