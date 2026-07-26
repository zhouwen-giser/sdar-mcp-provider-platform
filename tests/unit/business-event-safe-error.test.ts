import { describe, expect, it } from "vitest";
import { businessEventSafeError } from "../../packages/observability/src/index.js";

describe("BusinessEventSafeError", () => {
  it("does not expose a free-text message or stack", () => {
    const error = Object.assign(new Error("postgres password=secret"), {
      reasonCode: "SOURCE_TEMPORARILY_UNAVAILABLE",
      retryable: true,
    });
    expect(businessEventSafeError(error)).toEqual({
      type: "Error",
      reasonCode: "SOURCE_TEMPORARILY_UNAVAILABLE",
      retryable: true,
    });
  });

  it("normalizes unknown reason text", () => {
    expect(businessEventSafeError(new Error("secret free text"))).toEqual({
      type: "Error",
      reasonCode: "UNKNOWN",
      retryable: false,
    });
  });
});
