import { describe, expect, it, vi } from "vitest";
import {
  createRuntimeProcessProjection,
  runtimeDeploymentId,
  runtimeInstanceId,
  updateRuntimeProcessObservation,
  type RuntimeInfrastructureInstanceTarget,
  type RuntimeProcessObservation,
} from "../../../packages/runtime-deployment/src/index.js";
import {
  RuntimeProviderIdentityVerifier,
  primitiveConfiguration,
  runtimeMcpEndpoint,
  updateRuntimeProcessObservationWithRetry,
} from "../src/runtime-composition.js";

describe("runtime bootstrap configuration projection", () => {
  it("joins /mcp without duplicating a normalized base URL slash", () => {
    expect(runtimeMcpEndpoint("http://ugv-runtime:8080/")).toBe("http://ugv-runtime:8080/mcp");
  });

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

describe("Runtime process observation CAS retry", () => {
  it("re-reads a concurrent heartbeat and preserves it while committing catalog state", async () => {
    const initial = createRuntimeProcessProjection(
      {
        instanceId: runtimeInstanceId("instance-a"),
        deploymentId: runtimeDeploymentId("deployment-a"),
        processManager: "direct_container",
        pm2Name: null,
        port: null,
        controlEndpoint: "http://runtime.internal:8080",
        advertisedEndpoint: "http://192.168.1.7:19100",
      },
      processObservation(),
    );
    const heartbeatAt = new Date("2026-08-11T00:00:10.000Z");
    const heartbeat = updateRuntimeProcessObservation(
      initial,
      {
        ...processObservation(),
        registrationState: "registered",
        readinessState: "ready",
        lastHeartbeatAt: heartbeatAt,
        runtimeVersion: "2.0.0",
        configRevision: 0,
      },
      initial.observedRevision,
    );
    const load = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(heartbeat);
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("RUNTIME_PROCESS_REVISION_CONFLICT"))
      .mockResolvedValueOnce(true);

    await updateRuntimeProcessObservationWithRetry({
      load,
      save,
      patch: (current) => ({ ...processObservation(current), catalogState: "valid" }),
      failureCode: "RUNTIME_CATALOG_STATE_CONFLICT",
    });

    expect(load).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      observedRevision: 2,
      registrationState: "registered",
      readinessState: "ready",
      lastHeartbeatAt: heartbeatAt,
      catalogState: "valid",
    });
    expect(save.mock.calls[1]?.[1]).toBe(1);
  });
});

function processObservation(
  current?: ReturnType<typeof createRuntimeProcessProjection>,
): RuntimeProcessObservation {
  return {
    pid: current?.pid ?? null,
    processState: current?.processState ?? "missing",
    livenessState: current?.livenessState ?? "unknown",
    readinessState: current?.readinessState ?? "unknown",
    registrationState: current?.registrationState ?? "unregistered",
    catalogState: current?.catalogState ?? "unknown",
    configState: current?.configState ?? "externally_managed",
    lastHeartbeatAt: current?.lastHeartbeatAt ?? null,
    runtimeVersion: current?.runtimeVersion ?? null,
    configRevision: current?.configRevision ?? 0,
    restartCount: current?.restartCount ?? 0,
  };
}

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
