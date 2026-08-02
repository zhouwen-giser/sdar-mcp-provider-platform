import { describe, expect, it } from "vitest";
import { FrozenErrorCode } from "../../packages/mcp-protocol/src/sep2663/errors.js";
import { mapFrozenRuntimeError } from "../../packages/mcp-protocol/src/sep2663/error-mapper.js";

describe("frozen Runtime error mapping", () => {
  it("maps idempotency conflicts to invalid parameters", () => {
    expect(mapFrozenRuntimeError(new Error("IDEMPOTENCY_KEY_CONFLICT"))).toMatchObject({
      code: FrozenErrorCode.InvalidParams,
      httpStatus: 400,
      data: { reasonCode: "IDEMPOTENCY_KEY_CONFLICT" },
    });
  });

  it("keeps unknown technical failures internal", () => {
    expect(mapFrozenRuntimeError(new Error("unexpected database failure"))).toMatchObject({
      code: FrozenErrorCode.InternalError,
      httpStatus: 500,
    });
  });
});
