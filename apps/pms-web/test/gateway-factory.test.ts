import { afterEach, describe, expect, it, vi } from "vitest";
import { browserApiBase, createGateways, resolveDataMode } from "../src/gateways/factory.js";

const browserDocument = (
  globalThis as unknown as {
    readonly document: { readonly head: { innerHTML: string; replaceChildren(): void } };
  }
).document;

afterEach(() => {
  browserDocument.head.replaceChildren();
  vi.restoreAllMocks();
});

describe("PMS Gateway factory", () => {
  it("defaults to Mock only outside production and fails closed for missing or invalid production mode", () => {
    expect(resolveDataMode(undefined, { production: false })).toBe("mock");
    expect(resolveDataMode("mock", { production: false })).toBe("mock");
    expect(resolveDataMode("api", { production: true })).toBe("api");
    expect(() => resolveDataMode("mock", { production: true })).toThrow(
      "PMS_DATA_MODE_MOCK_FORBIDDEN_IN_PRODUCTION",
    );
    expect(() => resolveDataMode(undefined, { production: true })).toThrow(
      "PMS_DATA_MODE_REQUIRED",
    );
    expect(() => resolveDataMode("unexpected", { production: true })).toThrow(
      "PMS_DATA_MODE_INVALID",
    );
  });

  it("uses the real HTTP bundle in API mode and never falls back to Mock", async () => {
    const fetchImplementation: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ items: [], nextCursor: "server-cursor" }), {
        headers: { "content-type": "application/json" },
      });
    const fetch = vi.fn(fetchImplementation);
    const gateways = createGateways("healthy", { mode: "api", http: { fetch } });
    await expect(gateways.providers.listProviders()).resolves.toEqual({
      items: [],
      nextCursor: "server-cursor",
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/console/v1/providers");
  });

  it("accepts only the same-origin frozen Console V1 browser base", () => {
    expect(browserApiBase()).toBe("/api/console/v1");
    browserDocument.head.innerHTML =
      '<meta name="pms-web-api-base" content="http://pms-api:8090/api/console/v1">';
    expect(() => browserApiBase()).toThrow("PMS_WEB_API_BASE_MUST_BE_SAME_ORIGIN_CONSOLE_V1");
    browserDocument.head.innerHTML = '<meta name="pms-web-api-base" content="/api/console/v1/">';
    expect(browserApiBase()).toBe("/api/console/v1");
  });
});
