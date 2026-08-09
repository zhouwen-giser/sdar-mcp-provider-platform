import { describe, expect, it, vi } from "vitest";
import type { RuntimeInfrastructureInstanceTarget } from "../../../packages/runtime-deployment/src/index.js";
import {
  RuntimeProviderIdentityVerifier,
  primitiveConfiguration,
} from "../src/runtime-composition.js";

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

  it("uses the observed adapter manifest instead of synthesizing Provider identity", async () => {
    const describeProvider = vi.fn().mockResolvedValue({ providerId: "adapter-provider" });
    const close = vi.fn();
    const factory = vi.fn(() => ({ describeProvider, close }));
    const credentials = {} as never;
    const verifier = new RuntimeProviderIdentityVerifier(factory, () => credentials);
    const controller = new AbortController();
    const result = await verifier.verify({
      expectedProviderId: "pms-provider",
      bootstrapProviderId: "pms-provider",
      adapterEndpoint: "127.0.0.1:17021",
      adapterTls: { mode: "disabled" },
      timeoutMs: 1000,
      signal: controller.signal,
      target: target("pms-provider"),
    });

    expect(factory).toHaveBeenCalledWith({
      endpoint: "127.0.0.1:17021",
      providerId: "pms-provider",
      timeoutMs: 1000,
      credentials,
    });
    expect(describeProvider).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      valid: false,
      reasonCode: "PROVIDER_ID_MISMATCH",
      mismatchRelations: ["pms_adapter_manifest", "bootstrap_adapter_manifest"],
    });
  });

  it("reports unavailable identity evidence without promoting it to a mismatch", async () => {
    const describeProvider = vi.fn().mockRejectedValue(new Error("private transport detail"));
    const close = vi.fn();
    const verifier = new RuntimeProviderIdentityVerifier(
      () => ({ describeProvider, close }),
      () => ({}) as never,
    );
    const result = await verifier.verify({
      expectedProviderId: "pms-provider",
      bootstrapProviderId: "pms-provider",
      adapterEndpoint: "127.0.0.1:17021",
      adapterTls: { mode: "disabled" },
      timeoutMs: 1000,
      signal: new AbortController().signal,
      target: target("pms-provider"),
    });

    expect(result).toEqual({
      valid: false,
      reasonCode: "PROVIDER_IDENTITY_UNAVAILABLE",
      mismatchRelations: [],
      retryable: true,
    });
    expect(close).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("private transport detail");
  });

  it("constructs the identity gateway with production mTLS credentials", async () => {
    const describeProvider = vi.fn().mockResolvedValue({ providerId: "pms-provider" });
    const gateway = vi.fn(() => ({ describeProvider, close: vi.fn() }));
    const credentials = {} as never;
    const credentialFactory = vi.fn(() => credentials);
    const verifier = new RuntimeProviderIdentityVerifier(gateway, credentialFactory);
    const adapterTls = {
      mode: "required" as const,
      caPath: "/run/secrets/adapter-ca",
      certPath: "/run/secrets/adapter-cert",
      keyPath: "/run/secrets/adapter-key",
    };

    await verifier.verify({
      expectedProviderId: "pms-provider",
      bootstrapProviderId: "pms-provider",
      adapterEndpoint: "adapter.internal:17021",
      adapterTls,
      timeoutMs: 1000,
      signal: new AbortController().signal,
      target: target("pms-provider"),
    });

    expect(credentialFactory).toHaveBeenCalledWith(adapterTls);
    expect(gateway).toHaveBeenCalledWith({
      endpoint: "adapter.internal:17021",
      providerId: "pms-provider",
      timeoutMs: 1000,
      credentials,
    });
  });
});

function target(providerId: string): RuntimeInfrastructureInstanceTarget {
  return {
    providerId,
    deploymentId: "deployment",
    environment: "home-lab",
    runtimeVersion: "0.1.0",
    instanceId: "instance",
    ordinal: 0,
    processName: "runtime",
  };
}
