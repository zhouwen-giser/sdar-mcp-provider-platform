import { afterEach, describe, expect, it } from "vitest";
import { createMockGateways } from "../src/gateways/mock/create-mock-gateways.js";
import { collectCursorPages, currentEnvironmentScope } from "../src/queries/query-runtime.js";

const browser = globalThis as unknown as {
  readonly document: { readonly head: { innerHTML: string; replaceChildren(): void } };
  readonly history: {
    replaceState(data: unknown, unused: string, url?: string | URL | null): void;
  };
};

afterEach(() => {
  browser.document.head.replaceChildren();
  browser.history.replaceState({}, "", "/");
});

describe("PMS Web pagination and API scope", () => {
  it("follows every opaque cursor without truncating the first page", async () => {
    const seen: (string | undefined)[] = [];
    const items = await collectCursorPages(async (cursor) => {
      seen.push(cursor);
      return cursor === undefined
        ? { items: ["first"], nextCursor: "opaque /+==" }
        : { items: ["second"] };
    });
    expect(seen).toEqual([undefined, "opaque /+=="]);
    expect(items).toEqual(["first", "second"]);
  });

  it("rejects empty or repeated cursors instead of looping or silently truncating", async () => {
    await expect(collectCursorPages(async () => ({ items: [], nextCursor: "" }))).rejects.toThrow(
      "PMS_PAGINATION_CURSOR_INVALID",
    );
    await expect(
      collectCursorPages(async () => ({ items: [], nextCursor: "same" })),
    ).rejects.toThrow("PMS_PAGINATION_CURSOR_INVALID");
  });

  it("keeps deterministic Mock pagination compatible with cursor-aware contracts", async () => {
    const gateways = createMockGateways("healthy");
    const first = await gateways.providers.listProviders(undefined, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBe("2");
    const second = await gateways.providers.listProviders(undefined, {
      limit: 2,
      ...(first.nextCursor === undefined ? {} : { cursor: first.nextCursor }),
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
  });

  it("uses user navigation as API environment authority and never injects sample scopes", () => {
    browser.document.head.innerHTML = '<meta name="pms-web-data-mode" content="api">';
    browser.history.replaceState(
      {},
      "",
      "/resources?environment=lab-west&environment=field%2Fnorth&environment=lab-west",
    );
    expect(currentEnvironmentScope()).toEqual(["lab-west", "field/north"]);
    browser.history.replaceState({}, "", "/resources");
    expect(currentEnvironmentScope()).toEqual([]);
  });
});
