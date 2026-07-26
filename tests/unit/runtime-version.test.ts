import { describe, expect, it } from "vitest";
import { RUNTIME_VERSION } from "../../packages/domain/src/index.js";
import { PROVIDER_OPS_SCHEMA_VERSION } from "../../packages/observability/src/index.js";

describe("Runtime release version", () => {
  it("publishes v2 RC identity without changing the Provider Ops Wire Schema", () => {
    expect(RUNTIME_VERSION).toBe("2.0.0-rc.1");
    expect(PROVIDER_OPS_SCHEMA_VERSION).toBe("1.1.0");
  });
});
