import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeApplication } from "../../apps/runtime/src/runtime.js";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { createRuntime } from "../../apps/runtime/src/runtime.js";

let runtime: RuntimeApplication | undefined;

afterEach(async () => {
  if (runtime !== undefined) await runtime.app.close();
  runtime = undefined;
});

describe("Runtime health", () => {
  it("is live before dependencies are ready and reports readiness detail", async () => {
    runtime = createRuntime(loadRuntimeConfig({}));
    const live = await runtime.app.inject({ method: "GET", url: "/health/live" });
    const ready = await runtime.app.inject({ method: "GET", url: "/health/ready" });

    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: "live" });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toMatchObject({
      status: "not_ready",
      dependencies: { database: "starting", adapter: "starting", recovery: "starting" },
    });
  });

  it("rejects an oversized HTTP body before protocol handling", async () => {
    runtime = createRuntime(loadRuntimeConfig({ HTTP_BODY_LIMIT_BYTES: "1024" }));
    const response = await runtime.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "content-type": "application/json" },
      payload: { value: "x".repeat(2_048) },
    });
    expect(response.statusCode).toBe(413);
  });
});
