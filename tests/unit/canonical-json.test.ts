import { describe, expect, it } from "vitest";
import { canonicalizeJson, uuidV5 } from "../../packages/observability/src/index.js";

describe("canonical telemetry identity primitives", () => {
  it("canonicalizes object keys, arrays, strings, and ECMAScript numbers", () => {
    expect(
      canonicalizeJson({
        "€": 1,
        z: 3,
        a: [true, null, "x"],
        exponent: 1e30,
      }),
    ).toBe('{"a":[true,null,"x"],"exponent":1e+30,"z":3,"€":1}');
  });

  it("matches the standard UUIDv5 DNS vector", () => {
    expect(uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    );
  });
});
