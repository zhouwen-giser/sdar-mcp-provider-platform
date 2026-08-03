import { describe, expect, it } from "vitest";
import { primitiveConfiguration } from "../src/runtime-composition.js";

describe("runtime bootstrap configuration projection", () => {
  it("does not pass PMS-owned immutable fields to the bootstrap renderer", () => {
    expect(
      primitiveConfiguration({
        PORT: 8080,
        PROVIDER_ID: "mock-provider",
        DATABASE_URL_FILE: { secretRef: "file/v1/runtime/database" },
        PMS_RUNTIME_CONFIG_URL: "http://127.0.0.1:8090",
        HOST: "127.0.0.1",
        ADAPTER_ENDPOINT: "127.0.0.1:17021",
      }),
    ).toEqual({
      HOST: "127.0.0.1",
      ADAPTER_ENDPOINT: "127.0.0.1:17021",
    });
  });
});
