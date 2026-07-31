import { describe, expect, it } from "vitest";
import { createMockGateways } from "../src/gateways/mock/create-mock-gateways.js";

const context = { actorId: "test-admin", correlationId: "corr-provider" };

describe("provider and resource contract behavior", () => {
  it("creates a draft provider without onboarding side effects", async () => {
    const gateways = createMockGateways("healthy");
    const created = await gateways.providers.createProvider({
      providerId: "provider-test-001",
      providerTypeId: "ugv",
      packageId: "ugv-provider",
      packageVersion: "1.0.0",
      hostingMode: "platform_managed",
      adapterEndpoint: "127.0.0.1:8999",
    }, context);
    expect(created.status).toBe("draft");
    expect((await gateways.runtime.listDeployments(context)).items.some(item => item.providerId === created.providerId)).toBe(false);
  });

  it("enforces expectedUpdatedAt for provider status", async () => {
    const gateways = createMockGateways("healthy");
    const provider = await gateways.providers.getProvider("ugv-prod-001", context);
    await expect(gateways.providers.updateProviderStatus(provider.providerId, { status: "degraded", expectedUpdatedAt: "stale" }, context)).rejects.toMatchObject({ problem: { code: "OPTIMISTIC_CONCURRENCY_CONFLICT", status: 409 } });
    const updated = await gateways.providers.updateProviderStatus(provider.providerId, { status: "degraded", expectedUpdatedAt: provider.updatedAt ?? "" }, context);
    expect(updated.status).toBe("degraded");
  });

  it("binds and unbinds resources with duplicate protection", async () => {
    const gateways = createMockGateways("healthy");
    const input = { environment: "staging", resourceId: "npc-tank-07" };
    await gateways.resources.bind("npc-training-001", input, context);
    expect((await gateways.resources.listBindings("npc-training-001", context)).items).toHaveLength(1);
    await expect(gateways.resources.bind("npc-training-001", input, context)).rejects.toMatchObject({ problem: { code: "DUPLICATE_RESOURCE_BINDING" } });
    await gateways.resources.unbind("npc-training-001", input.environment, input.resourceId, context);
    expect((await gateways.resources.listBindings("npc-training-001", context)).items).toHaveLength(0);
  });
});
