import { describe, expect, it } from "vitest";
import { MockPmsWebDataSource } from "../src/data/mock-data-source.js";
import type { ProviderOnboardingDraft } from "../src/data/types.js";
import { validateOnboardingStep } from "../src/features/providers/ProviderOnboardingPage.js";

const completeDraft: ProviderOnboardingDraft = {
  name: "示例 Provider",
  providerId: "provider-example",
  packageId: "home-assistant-climate",
  hostingMode: "platform-managed",
  adapterEndpoint: "mock://adapter.local",
  databaseProfileId: "db-profile-production-shared",
  runtimeRelease: "@sdar/runtime@2.0.0-rc.1",
  environment: "production-mock",
};

describe("Provider experience", () => {
  it("blocks invalid identity and preserves valid progression inputs", () => {
    expect(
      validateOnboardingStep(0, { ...completeDraft, name: "", providerId: "INVALID" }),
    ).toHaveLength(2);
    expect(validateOnboardingStep(0, completeDraft)).toEqual([]);
  });

  it("performs adapter and preflight checks without transport", async () => {
    const source = new MockPmsWebDataSource("healthy", { id: () => "fixed" });
    expect((await source.checkAdapter(completeDraft)).passed).toBe(true);
    expect((await source.preflightProvider(completeDraft)).passed).toBe(true);
  });

  it("creates an in-memory Provider and simulated operation", async () => {
    const source = new MockPmsWebDataSource("healthy", { id: () => "fixed" });
    const result = source.onboardProvider(completeDraft);
    expect(result.provider.status).toBe("PENDING");
    expect(result.operation.simulated).toBe(true);
    expect(await source.provider("provider-example")).toEqual(result.provider);
  });
});
