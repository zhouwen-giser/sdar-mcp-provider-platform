import { describe, expect, it } from "vitest";
import { BoundedRateLimiter } from "../../apps/runtime/src/rate-limiter.js";

describe("Bounded rate limiter", () => {
  it("T-043 expires old windows and never grows beyond the configured key bound", () => {
    const limiter = new BoundedRateLimiter(2, 1_000, 16);

    for (let index = 0; index < 1_000; index += 1) {
      expect(limiter.consume(`198.51.100.${String(index)}`, index).allowed).toBe(true);
      expect(limiter.size).toBeLessThanOrEqual(16);
    }

    expect(limiter.consume("stable-client", 2_000).allowed).toBe(true);
    expect(limiter.consume("stable-client", 2_001).allowed).toBe(true);
    expect(limiter.consume("stable-client", 2_002).allowed).toBe(false);
    expect(limiter.consume("after-expiry", 3_001).allowed).toBe(true);
    expect(limiter.size).toBe(1);
  });
});
