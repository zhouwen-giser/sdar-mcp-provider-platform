import { describe, expect, it } from "vitest";
import { createConsoleTestApp } from "./helpers.js";

describe("Console Registry operations", () => {
  it("supports ETag, 304, history and diff", async () => {
    const { app } = createConsoleTestApp();
    const latest = await app.inject({
      method: "GET",
      url: "/api/console/v1/registry/production/latest",
    });
    expect(latest.statusCode).toBe(200);
    expect(latest.headers.etag).toBe(`"${"b".repeat(64)}"`);
    const unchanged = await app.inject({
      method: "GET",
      url: "/api/console/v1/registry/production/latest",
      headers: { "if-none-match": latest.headers.etag as string },
    });
    expect(unchanged.statusCode).toBe(304);
    const diff = await app.inject({
      method: "GET",
      url: "/api/console/v1/registry/production/diff?fromRevision=1&toRevision=2",
    });
    expect(diff.statusCode).toBe(200);
    expect(diff.json()).toMatchObject({ fromRevision: 1, toRevision: 2 });
    await app.close();
  });
});
