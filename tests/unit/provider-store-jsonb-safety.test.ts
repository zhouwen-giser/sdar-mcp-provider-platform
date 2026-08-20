import { describe, expect, it } from "vitest";
import {
  assertPostgresJsonbSafe,
  ProviderStoreJsonbUnsafePayloadError,
} from "../../packages/provider-adapter-kit/src/index.js";

describe("PostgresProviderStore JSONB safety", () => {
  it("accepts ordinary JSON-compatible payloads and repeated non-cyclic references", () => {
    const shared = { cursor: "oc1.safe" };
    expect(() =>
      assertPostgresJsonbSafe({ authorities: [shared, shared], finite: 42 }, "execution"),
    ).not.toThrow();
  });

  it.each([
    ["nul_string", { cursor: "unsafe\0cursor" }, "$/cursor"],
    ["non_finite_number", { progress: Number.NaN }, "$/progress"],
    ["bigint", { sequence: 1n }, "$/sequence"],
  ] as const)("rejects %s without including the unsafe value", (kind, value, path) => {
    expect(() => assertPostgresJsonbSafe(value, "execution")).toThrow(
      expect.objectContaining({
        code: "PROVIDER_STORE_JSONB_UNSAFE_PAYLOAD",
        rootName: "execution",
        path,
        unsafeKind: kind,
      }),
    );
    try {
      assertPostgresJsonbSafe(value, "execution");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderStoreJsonbUnsafePayloadError);
      expect(String(error)).not.toContain("unsafe\0cursor");
    }
  });

  it("rejects cycles with a stable, value-free diagnostic", () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(() => assertPostgresJsonbSafe(value, "execution")).toThrow(
      expect.objectContaining({
        code: "PROVIDER_STORE_JSONB_UNSAFE_PAYLOAD",
        rootName: "execution",
        path: "$/self",
        unsafeKind: "cyclic_reference",
      }),
    );
  });
});
