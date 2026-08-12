import { describe, expect, it, vi } from "vitest";
import {
  definePmsWorkerRuntimeCompositionContract,
  type PmsWorkerRuntimeCompositionContract,
} from "../src/index.js";

describe("PMS Worker Runtime composition contract", () => {
  it("defines immutable authority slots without constructing infrastructure", () => {
    const schedulerStart = vi.fn();
    const databasePreparationExecute = vi.fn(() => Promise.resolve());
    const input = contractFixture({ schedulerStart, databasePreparationExecute });

    const contract = definePmsWorkerRuntimeCompositionContract(input);

    expect(contract).toMatchObject({
      config: {
        runtimeReconcileIntervalMs: 15_000,
        runtimeReconcileTimeoutMs: 120_000,
        runtimeHealthTimeoutMs: 5_000,
      },
      repositories: {
        jobs: input.repositories.jobs,
        runtimeDeployments: input.repositories.runtimeDeployments,
        runtimeProcesses: input.repositories.runtimeProcesses,
        databaseProfiles: input.repositories.databaseProfiles,
        catalogSnapshots: input.repositories.catalogSnapshots,
        registrySnapshots: input.repositories.registrySnapshots,
      },
    });
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.config)).toBe(true);
    expect(Object.isFrozen(contract.repositories)).toBe(true);
    expect(schedulerStart).not.toHaveBeenCalled();
    expect(databasePreparationExecute).not.toHaveBeenCalled();
  });

  it("fails closed when a required authority method is absent", () => {
    const input = contractFixture();

    expect(() =>
      definePmsWorkerRuntimeCompositionContract({
        ...input,
        scheduler: { ...input.scheduler, tick: undefined },
      } as unknown as PmsWorkerRuntimeCompositionContract),
    ).toThrow("PMS_WORKER_RUNTIME_COMPOSITION_INVALID:scheduler.tick");
  });
});

function contractFixture(
  overrides: {
    readonly schedulerStart?: () => void;
    readonly databasePreparationExecute?: () => Promise<unknown>;
  } = {},
): PmsWorkerRuntimeCompositionContract {
  return {
    config: {
      postgresProvisioningCredentialFile: "/run/sdar/provisioning-credential",
      runtimeReleaseRoot: "/opt/sdar/runtime-releases",
      runtimeSecretRoot: "/run/sdar/runtime-secrets",
      runtimeConfigCacheRoot: "/var/lib/sdar/runtime-config",
      runtimeControlPlaneUrl: "https://pms.internal/",
      runtimeControlPlaneCredentialRoot: "/run/sdar/runtime-control-plane-credentials",
      externalRuntimeCatalogAuthMode: "file_credentials",
      allowInsecureInternalTransport: false,
      pm2Home: "/var/lib/sdar/pm2",
      runtimeReconcileIntervalMs: 15_000,
      runtimeReconcileTimeoutMs: 120_000,
      runtimeHealthTimeoutMs: 5_000,
    },
    repositories: {
      jobs: {},
      runtimeDeployments: {},
      runtimeProcesses: {},
      databaseProfiles: {},
      catalogSnapshots: {},
      registrySnapshots: {},
    },
    databasePreparation: {
      execute: overrides.databasePreparationExecute ?? vi.fn(() => Promise.resolve()),
    },
    lifecycle: {
      start: vi.fn(() => Promise.resolve()),
      stop: vi.fn(() => Promise.resolve()),
    },
    health: { probe: vi.fn(() => Promise.resolve()) },
    identity: { verify: vi.fn(() => Promise.resolve()) },
    catalogRegistry: { close: vi.fn(() => Promise.resolve()) },
    scheduler: {
      start: overrides.schedulerStart ?? vi.fn(),
      tick: vi.fn(() => Promise.resolve(0)),
      stop: vi.fn(() => Promise.resolve()),
    },
    cleanup: {
      cleanup: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
    },
    runtimeControlPlaneCredentialResolver: {
      resolve: vi.fn(() => Promise.resolve("/run/sdar/instance-control-plane-token")),
    },
  };
}
