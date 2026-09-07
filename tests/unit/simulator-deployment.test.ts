import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { createRuntime } from "../../apps/runtime/src/runtime.js";
import { loadUgvProviderConfig } from "../../apps/ugv-provider-adapter/src/config.js";

describe("credential-free isolated simulator deployment", () => {
  it.each(["development_debug", "integration_candidate", "qualification"])(
    "loads %s without token files",
    (stage) => {
      const adapter = loadUgvProviderConfig({
        UGV_DELIVERY_STAGE: stage,
        SIMULATOR_CREDENTIAL_FREE: "true",
        UGV_DIAGNOSTICS_ENABLED: "true",
      });
      expect(adapter.SIMULATOR_CREDENTIAL_FREE).toBe(true);
      expect(adapter.UGV_DELIVERY_STAGE).toBe(stage);
      expect(adapter.UGV_EXECUTION_MODE).toBe("live");
      const runtime = loadRuntimeConfig({
        SIMULATOR_CREDENTIAL_FREE: "true",
        SMPP_DIAGNOSTICS_ENABLED: "true",
        INTERNAL_ENDPOINTS_ENABLED: "true",
      });
      expect(runtime.SMPP_DIAGNOSTICS_OPERATOR_TOKEN_FILE).toBeUndefined();
    },
  );
  it("keeps token enforcement when the explicit option is absent", () => {
    expect(() => loadRuntimeConfig({ SMPP_DIAGNOSTICS_ENABLED: "true" })).toThrow();
    expect(() => loadUgvProviderConfig({ UGV_DIAGNOSTICS_ENABLED: "true" })).toThrow();
  });
  it("admits anonymous diagnostics to validation, not unvalidated side effects", async () => {
    const runtime = createRuntime(
      loadRuntimeConfig({
        SIMULATOR_CREDENTIAL_FREE: "true",
        SMPP_DIAGNOSTICS_ENABLED: "true",
        INTERNAL_ENDPOINTS_ENABLED: "true",
      }),
    );
    try {
      for (const url of [
        "/v1/diagnostics/response-loss",
        "/v1/diagnostics/provider-business-success",
      ]) {
        const response = await runtime.app.inject({ method: "POST", url, payload: {} });
        expect(response.statusCode).toBe(400);
      }
      const identity = await runtime.app.inject({
        method: "GET",
        url: "/internal/provider-identity",
      });
      expect(identity.statusCode).not.toBe(401);
      expect(identity.statusCode).not.toBe(403);
    } finally {
      await runtime.app.close();
    }
  });
});
