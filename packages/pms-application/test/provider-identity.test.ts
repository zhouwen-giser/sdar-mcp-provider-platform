import { describe, expect, it } from "vitest";
import { verifyProviderIdentity } from "../src/index.js";

describe("Provider identity three-way verification", () => {
  it("accepts only PMS = bootstrap = DescribeProvider manifest", () => {
    expect(
      verifyProviderIdentity("provider-a", {
        bootstrapProviderId: "provider-a",
        adapterManifestProviderId: "provider-a",
        describeProviderObserved: true,
      }),
    ).toEqual({
      valid: true,
      reasonCode: "PROVIDER_ID_VERIFIED",
      mismatchRelations: [],
      retryable: false,
    });
  });

  it.each([
    [
      "PMS differs",
      "provider-pms",
      "provider-runtime",
      "provider-runtime",
      ["pms_bootstrap", "pms_adapter_manifest"],
    ],
    [
      "Adapter manifest differs",
      "provider-a",
      "provider-a",
      "provider-adapter",
      ["pms_adapter_manifest", "bootstrap_adapter_manifest"],
    ],
    [
      "Runtime bootstrap differs",
      "provider-a",
      "provider-runtime",
      "provider-a",
      ["pms_bootstrap", "bootstrap_adapter_manifest"],
    ],
  ] as const)(
    "returns redacted structured mismatch relations when %s",
    (_label, pmsProviderId, bootstrapProviderId, adapterManifestProviderId, mismatchRelations) => {
      const result = verifyProviderIdentity(pmsProviderId, {
        bootstrapProviderId,
        adapterManifestProviderId,
        describeProviderObserved: true,
      });

      expect(result).toEqual({
        valid: false,
        reasonCode: "PROVIDER_ID_MISMATCH",
        mismatchRelations,
        retryable: true,
      });
      expect(JSON.stringify(result)).not.toContain(pmsProviderId);
      expect(JSON.stringify(result)).not.toContain(bootstrapProviderId);
      expect(JSON.stringify(result)).not.toContain(adapterManifestProviderId);
    },
  );

  it("can be retried successfully after evidence is corrected without rewriting identity", () => {
    const expectedProviderId = "provider-a";
    expect(
      verifyProviderIdentity(expectedProviderId, {
        bootstrapProviderId: expectedProviderId,
        adapterManifestProviderId: "provider-wrong",
        describeProviderObserved: true,
      }).valid,
    ).toBe(false);
    expect(
      verifyProviderIdentity(expectedProviderId, {
        bootstrapProviderId: expectedProviderId,
        adapterManifestProviderId: expectedProviderId,
        describeProviderObserved: true,
      }).valid,
    ).toBe(true);
    expect(expectedProviderId).toBe("provider-a");
  });
});
