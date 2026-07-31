import { describe, expect, it, vi } from "vitest";
import { createMockGateways } from "../src/gateways/mock/create-mock-gateways.js";

const context = { actorId: "test-admin", correlationId: "corr-test-001" };

describe("contract-first mock gateways", () => {
  it("serves deterministic frozen DTO projections", async () => {
    const gateways = createMockGateways("healthy");
    const providers = await gateways.providers.listProviders(context);
    const resources = await gateways.resources.listResources(context);
    const deployments = await gateways.runtime.listDeployments(context);
    expect(providers.items.map(item => item.providerId)).toEqual(["ugv-prod-001", "ha-east-001", "npc-training-001"]);
    expect(resources.items[0]?.environment).toBe("production");
    expect(deployments.items.every(item => item.desiredReplicas === 0 || item.desiredReplicas === 1)).toBe(true);
  });

  it("switches scenarios and notifies subscribers", async () => {
    const gateways = createMockGateways("healthy");
    const listener = vi.fn();
    const unsubscribe = gateways.scenarios.subscribe(listener);
    gateways.scenarios.set("provider-degraded");
    expect((await gateways.providers.listProviders(context)).items[0]?.status).toBe("degraded");
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("maps network failures to stable contract problems", async () => {
    const gateways = createMockGateways("network-error");
    await expect(gateways.providers.listProviders(context)).rejects.toMatchObject({
      problem: { code: "INTERNAL_ERROR", status: 503, correlationId: "corr-test-001" },
    });
  });

  it("supports request cancellation", async () => {
    const gateways = createMockGateways("slow-network");
    const controller = new AbortController();
    const request = gateways.providers.listProviders({ ...context, signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});
