import { describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertRuntimeProviderIdentity,
  pendingRuntimeProviderIdentity,
  verifyRuntimeProviderIdentity,
} from "../src/provider-identity.js";
import { loadRuntimeConfig } from "../src/config.js";

describe("Runtime bootstrap and Adapter manifest identity", () => {
  it("captures structured DescribeProvider evidence", () => {
    expect(verifyRuntimeProviderIdentity("provider-a", "provider-a")).toEqual({
      state: "verified",
      reasonCode: "PROVIDER_ID_VERIFIED",
      bootstrapProviderId: "provider-a",
      adapterManifestProviderId: "provider-a",
      describeProviderObserved: true,
    });
  });

  it("throws only a stable redacted code on mismatch", () => {
    const snapshot = verifyRuntimeProviderIdentity("provider-bootstrap", "provider-adapter");
    const error = capture(() => assertRuntimeProviderIdentity(snapshot));

    expect(snapshot).toMatchObject({
      state: "mismatch",
      reasonCode: "PROVIDER_ID_MISMATCH",
      describeProviderObserved: true,
    });
    expect(error).toMatchObject({
      code: "PROVIDER_ID_MISMATCH",
      message: "PROVIDER_ID_MISMATCH",
    });
    expect(JSON.stringify(error)).not.toContain("provider-bootstrap");
    expect(JSON.stringify(error)).not.toContain("provider-adapter");
  });

  it("does not claim identity before DescribeProvider evidence exists", () => {
    const pending = pendingRuntimeProviderIdentity("provider-a");
    expect(pending).toEqual({
      state: "pending",
      bootstrapProviderId: "provider-a",
      describeProviderObserved: false,
    });
    expect(() => assertRuntimeProviderIdentity(pending)).toThrow(
      "PROVIDER_IDENTITY_EVIDENCE_INVALID",
    );
  });

  it("exposes evidence only through the authenticated internal endpoint", async () => {
    process.env.SDAR_RUNTIME_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const { createRuntime } = await import("../src/runtime.js");
    const runtime = createRuntime(
      loadRuntimeConfig({
        RUNTIME_ENV: "test",
        PROVIDER_ID: "provider-a",
        INTERNAL_ENDPOINTS_ENABLED: "true",
        INTERNAL_ADMIN_TOKEN: "a".repeat(32),
      }),
    );
    const unauthorized = await runtime.app.inject({
      method: "GET",
      url: "/internal/provider-identity",
    });
    const authorized = await runtime.app.inject({
      method: "GET",
      url: "/internal/provider-identity",
      headers: { "x-sdar-admin-token": "a".repeat(32) },
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toEqual({
      state: "pending",
      bootstrapProviderId: "provider-a",
      describeProviderObserved: false,
    });
    await runtime.app.close();
  });
});

function capture(operation: () => void): unknown {
  try {
    operation();
  } catch (error) {
    return error;
  }
  throw new Error("EXPECTED_OPERATION_TO_FAIL");
}
