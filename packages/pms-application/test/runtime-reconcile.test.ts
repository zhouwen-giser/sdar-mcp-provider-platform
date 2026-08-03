import { describe, expect, it, vi } from "vitest";
import {
  databaseProfileId,
  rehydrateRuntimeDeployment,
  requestRuntimeDeployment,
  runtimeConfigProfileId,
  runtimeDeploymentId,
  runtimeEnvironmentId,
  runtimeInfrastructureOperationContext,
  runtimeProviderId,
  type RuntimeDeployment,
  type RuntimeDeploymentSnapshot,
  type RuntimeDeploymentStatus,
} from "../../runtime-deployment/src/index.js";
import {
  RuntimeDeploymentReconciler,
  type RuntimeReconcileHealthResult,
  type RuntimeReconcileInstance,
  type RuntimeReconcileProviderIdentityPort,
  type RuntimeReconcileStore,
} from "../src/index.js";

describe("RuntimeDeploymentReconciler", () => {
  it("converges database, start and health stepwise without treating online as ACTIVE", async () => {
    const store = new MemoryReconcileStore(deployment("REQUESTED"));
    const database = databasePort(store);
    const lifecycle = lifecyclePort();
    const health = readyHealth();
    const reconciler = new RuntimeDeploymentReconciler(
      store,
      database,
      lifecycle,
      health,
      inventory([instance("sdar-runtime-orphan")]),
      validIdentity(),
    );

    const result = await reconciler.reconcile(input());

    expect(result.deployment.status).toBe("DISCOVERING");
    expect(result.deployment.status).not.toBe("ACTIVE");
    expect(store.transitions).toEqual([
      "DATABASE_PROVISIONING",
      "MIGRATING",
      "CONFIG_PREPARING",
      "STARTING",
      "HEALTH_CHECKING",
      "DISCOVERING",
    ]);
    expect(lifecycle.start).toHaveBeenCalledOnce();
    expect(health.probe).toHaveBeenCalledOnce();
    expect(store.health).toHaveLength(1);
    expect(result.orphanProcessNames).toEqual(["sdar-runtime-orphan"]);
    expect(store.orphans).toEqual([["sdar-runtime-orphan"]]);

    await reconciler.reconcile(input("replay"));
    expect(database.execute).toHaveBeenCalledOnce();
    expect(lifecycle.start).toHaveBeenCalledOnce();
    expect(health.probe).toHaveBeenCalledOnce();
  });

  it("converges desired stop through DRAINING without deleting database state", async () => {
    const store = new MemoryReconcileStore(deployment("ACTIVE", "draining"));
    await store.ensureInstance();
    const database = databasePort(store);
    const lifecycle = lifecyclePort();
    const reconciler = new RuntimeDeploymentReconciler(
      store,
      database,
      lifecycle,
      readyHealth(),
      inventory([]),
      validIdentity(),
    );

    const result = await reconciler.reconcile(input());

    expect(result.deployment.status).toBe("STOPPED");
    expect(result.progressed).toBe(true);
    expect(store.transitions).toEqual(["DRAINING", "STOPPED"]);
    expect(lifecycle.stop).toHaveBeenCalledOnce();
    expect(database.execute).not.toHaveBeenCalled();
    expect(database).not.toHaveProperty("delete");
  });

  it("re-enters the startup state when a stopped deployment is started", async () => {
    const store = new MemoryReconcileStore(deployment("STOPPED"));
    const database = databasePort(store);
    const lifecycle = lifecyclePort();
    const reconciler = new RuntimeDeploymentReconciler(
      store,
      database,
      lifecycle,
      readyHealth(),
      inventory([]),
      validIdentity(),
    );

    const result = await reconciler.reconcile(input("restart-after-stop"));

    expect(result.deployment.status).toBe("DISCOVERING");
    expect(store.transitions).toEqual([
      "REQUESTED",
      "DATABASE_PROVISIONING",
      "MIGRATING",
      "CONFIG_PREPARING",
      "STARTING",
      "HEALTH_CHECKING",
      "DISCOVERING",
    ]);
    expect(lifecycle.start).toHaveBeenCalledOnce();
    expect(database.execute).toHaveBeenCalledOnce();
  });

  it("persists FAILED on lifecycle failure and leaves destructive cleanup out of scope", async () => {
    const store = new MemoryReconcileStore(deployment("STARTING"));
    const lifecycle = lifecyclePort();
    lifecycle.start.mockRejectedValueOnce(new Error("private PM2 detail"));
    const database = databasePort(store);
    const reconciler = new RuntimeDeploymentReconciler(
      store,
      database,
      lifecycle,
      readyHealth(),
      inventory([]),
      validIdentity(),
    );

    await expect(reconciler.reconcile(input())).rejects.toMatchObject({
      code: "RUNTIME_RECONCILE_OPERATION_FAILED",
      message: "RUNTIME_RECONCILE_OPERATION_FAILED",
    });
    expect(store.current.snapshot.status).toBe("FAILED");
    expect(store.failureCodes).toEqual(["RUNTIME_RECONCILE_OPERATION_FAILED"]);
    expect(JSON.stringify(store.failureCodes)).not.toContain("private");
    expect(database).not.toHaveProperty("delete");
  });

  it("blocks health/ACTIVE progression on structured Provider identity mismatch", async () => {
    const store = new MemoryReconcileStore(deployment("HEALTH_CHECKING"));
    const health = readyHealth();
    const verify = vi.fn<RuntimeReconcileProviderIdentityPort["verify"]>(() =>
      Promise.resolve({
        valid: false as const,
        reasonCode: "PROVIDER_ID_MISMATCH" as const,
        mismatchRelations: ["pms_adapter_manifest" as const],
        retryable: true as const,
      }),
    );
    const reconciler = new RuntimeDeploymentReconciler(
      store,
      databasePort(store),
      lifecyclePort(),
      health,
      inventory([]),
      { verify },
    );

    const result = await reconciler.reconcile(input("identity-mismatch"));

    expect(result.deployment.status).toBe("FAILED");
    expect(store.failureCodes).toEqual(["PROVIDER_ID_MISMATCH"]);
    expect(health.probe).not.toHaveBeenCalled();
    expect(store.transitions).not.toContain("DISCOVERING");
    expect(store.transitions).not.toContain("ACTIVE");
    expect(verify.mock.calls[0]?.[0].expectedProviderId).toBe("provider-a");
    expect(verify.mock.calls[0]?.[0].target.providerId).toBe("provider-a");
  });

  it("moves unhealthy ACTIVE deployments to DEGRADED", async () => {
    const store = new MemoryReconcileStore(deployment("ACTIVE"));
    const health = unhealthyHealth();
    const identity = validIdentity();
    const reconciler = new RuntimeDeploymentReconciler(
      store,
      databasePort(store),
      lifecyclePort(),
      health,
      inventory([]),
      identity,
    );

    const result = await reconciler.reconcile(input("active-unhealthy"));

    expect(result.deployment.status).toBe("DEGRADED");
    expect(result.progressed).toBe(true);
    expect(store.transitions).toEqual(["DEGRADED"]);
    expect(health.probe).toHaveBeenCalledOnce();
    expect(identity.verify).not.toHaveBeenCalled();
  });

  it("keeps healthy identity-valid ACTIVE deployments idempotently ACTIVE", async () => {
    const store = new MemoryReconcileStore(deployment("ACTIVE"));
    const health = readyHealth();
    const identity = validIdentity();
    const lifecycle = lifecyclePort();
    const beforeRevision = store.current.snapshot.observedRevision;
    const reconciler = new RuntimeDeploymentReconciler(
      store,
      databasePort(store),
      lifecycle,
      health,
      inventory([]),
      identity,
    );

    const result = await reconciler.reconcile(input("active-healthy"));

    expect(result.deployment).toMatchObject({
      status: "ACTIVE",
      observedRevision: beforeRevision,
    });
    expect(result.progressed).toBe(false);
    expect(lifecycle.start).toHaveBeenCalledOnce();
    expect(store.transitions).toEqual([]);
    expect(identity.verify).toHaveBeenCalledOnce();
  });

  it("keeps an unhealthy DEGRADED deployment idempotently DEGRADED", async () => {
    const store = new MemoryReconcileStore(deployment("DEGRADED"));
    const health = unhealthyHealth();
    const identity = validIdentity();
    const beforeRevision = store.current.snapshot.observedRevision;
    const reconciler = new RuntimeDeploymentReconciler(
      store,
      databasePort(store),
      lifecyclePort(),
      health,
      inventory([]),
      identity,
    );

    const result = await reconciler.reconcile(input("degraded-unhealthy"));

    expect(result.deployment).toMatchObject({
      status: "DEGRADED",
      observedRevision: beforeRevision,
    });
    expect(result.progressed).toBe(false);
    expect(store.transitions).toEqual([]);
    expect(identity.verify).not.toHaveBeenCalled();
  });

  it("moves a healthy identity-valid DEGRADED deployment back to DISCOVERING", async () => {
    const store = new MemoryReconcileStore(deployment("DEGRADED"));
    const identity = validIdentity();
    const reconciler = new RuntimeDeploymentReconciler(
      store,
      databasePort(store),
      lifecyclePort(),
      readyHealth(),
      inventory([]),
      identity,
    );

    const result = await reconciler.reconcile(input("degraded-recovered"));

    expect(result.deployment.status).toBe("DISCOVERING");
    expect(result.progressed).toBe(true);
    expect(store.transitions).toEqual(["DISCOVERING"]);
    expect(identity.verify).toHaveBeenCalledOnce();
  });

  it("fails a healthy ACTIVE deployment when Provider identity no longer matches", async () => {
    const store = new MemoryReconcileStore(deployment("ACTIVE"));
    const identity = mismatchedIdentity();
    const reconciler = new RuntimeDeploymentReconciler(
      store,
      databasePort(store),
      lifecyclePort(),
      readyHealth(),
      inventory([]),
      identity,
    );

    const result = await reconciler.reconcile(input("active-identity-mismatch"));

    expect(result.deployment.status).toBe("FAILED");
    expect(result.deployment.status).not.toBe("ACTIVE");
    expect(store.failureCodes).toEqual(["PROVIDER_ID_MISMATCH"]);
    expect(store.transitions).toEqual(["FAILED"]);
  });

  it("checks cancellation after an uninterruptible database call before later state writes", async () => {
    const store = new MemoryReconcileStore(deployment("REQUESTED"));
    const controller = new AbortController();
    const database = {
      execute: vi.fn(() => {
        controller.abort(new Error("LEASE_LOST"));
        return Promise.resolve(store.current.snapshot);
      }),
    };
    const reconciler = new RuntimeDeploymentReconciler(
      store,
      database,
      lifecyclePort(),
      readyHealth(),
      inventory([]),
      validIdentity(),
    );

    await expect(
      reconciler.reconcile(input("database-abort", controller.signal)),
    ).rejects.toThrow();
    expect(database.execute).toHaveBeenCalledOnce();
    expect(store.transitions).toEqual([]);
    expect(store.failureCodes).toEqual([]);
  });

  it("checks cancellation after PM2 and health calls before recording observations", async () => {
    const lifecycleStore = new MemoryReconcileStore(deployment("STARTING"));
    const lifecycleController = new AbortController();
    const lifecycle = lifecyclePort();
    lifecycle.start.mockImplementationOnce(() => {
      lifecycleController.abort(new Error("LEASE_LOST"));
      return Promise.resolve({});
    });
    const lifecycleReconciler = new RuntimeDeploymentReconciler(
      lifecycleStore,
      databasePort(lifecycleStore),
      lifecycle,
      readyHealth(),
      inventory([]),
      validIdentity(),
    );
    await expect(
      lifecycleReconciler.reconcile(input("lifecycle-abort", lifecycleController.signal)),
    ).rejects.toThrow();
    expect(lifecycleStore.transitions).toEqual([]);
    expect(lifecycleStore.failureCodes).toEqual([]);

    const healthStore = new MemoryReconcileStore(deployment("HEALTH_CHECKING"));
    const healthController = new AbortController();
    const health = readyHealth();
    health.probe.mockImplementationOnce(() => {
      healthController.abort(new Error("LEASE_LOST"));
      return Promise.resolve({
        processState: "online",
        live: true,
        ready: true,
        reasonCode: "HEALTHY",
        checkedAt: "2026-07-26T00:00:00.000Z",
      });
    });
    const healthReconciler = new RuntimeDeploymentReconciler(
      healthStore,
      databasePort(healthStore),
      lifecyclePort(),
      health,
      inventory([]),
      validIdentity(),
    );
    await expect(
      healthReconciler.reconcile(input("health-abort", healthController.signal)),
    ).rejects.toThrow();
    expect(healthStore.health).toEqual([]);
    expect(healthStore.transitions).toEqual([]);
    expect(healthStore.failureCodes).toEqual([]);
  });

  it("checks cancellation after Provider identity verification before health or failure writes", async () => {
    const store = new MemoryReconcileStore(deployment("HEALTH_CHECKING"));
    const controller = new AbortController();
    const identity = validIdentity();
    identity.verify.mockImplementationOnce(() => {
      controller.abort(new Error("LEASE_LOST"));
      return Promise.resolve({
        valid: true,
        reasonCode: "PROVIDER_ID_VERIFIED",
        mismatchRelations: [],
        retryable: false,
      });
    });
    const health = readyHealth();
    const reconciler = new RuntimeDeploymentReconciler(
      store,
      databasePort(store),
      lifecyclePort(),
      health,
      inventory([]),
      identity,
    );

    await expect(
      reconciler.reconcile(input("identity-abort", controller.signal)),
    ).rejects.toThrow();
    expect(health.probe).not.toHaveBeenCalled();
    expect(store.transitions).toEqual([]);
    expect(store.failureCodes).toEqual([]);
  });
});

class MemoryReconcileStore implements RuntimeReconcileStore {
  readonly instances: RuntimeReconcileInstance[] = [];
  readonly transitions: RuntimeDeploymentStatus[] = [];
  readonly health: RuntimeReconcileHealthResult[] = [];
  readonly orphans: string[][] = [];
  readonly failureCodes: string[] = [];

  constructor(public current: RuntimeDeployment) {}

  getDeployment(providerId: string, deploymentId: string): Promise<RuntimeDeployment | null> {
    return Promise.resolve(
      this.current.snapshot.providerId === providerId &&
        this.current.snapshot.deploymentId === deploymentId
        ? this.current
        : null,
    );
  }

  transition(
    _providerId: string,
    _deploymentId: string,
    target: RuntimeDeploymentStatus,
    expectedStatus: RuntimeDeploymentStatus,
    expectedObservedRevision: number,
  ): Promise<RuntimeDeployment> {
    this.current.transition(
      target,
      { expectedStatus, expectedRevision: expectedObservedRevision },
      new Date("2026-07-26T00:00:00.000Z"),
    );
    this.transitions.push(target);
    return Promise.resolve(this.current);
  }

  async fail(
    providerId: string,
    deploymentId: string,
    expectedStatus: RuntimeDeploymentStatus,
    expectedObservedRevision: number,
    errorCode: string,
  ): Promise<void> {
    this.failureCodes.push(errorCode);
    await this.transition(
      providerId,
      deploymentId,
      "FAILED",
      expectedStatus,
      expectedObservedRevision,
    );
  }

  ensureInstance(): Promise<RuntimeReconcileInstance> {
    const existing = this.instances[0];
    if (existing !== undefined) return Promise.resolve(existing);
    const created = instance("sdar-runtime-provider-a-0");
    this.instances.push(created);
    return Promise.resolve(created);
  }

  listInstances(): Promise<readonly RuntimeReconcileInstance[]> {
    return Promise.resolve(this.instances);
  }

  recordHealth(
    _target: RuntimeReconcileInstance["target"],
    result: RuntimeReconcileHealthResult,
  ): Promise<void> {
    this.health.push(result);
    return Promise.resolve();
  }

  recordOrphans(
    _providerId: string,
    _deploymentId: string,
    processNames: readonly string[],
  ): Promise<void> {
    this.orphans.push([...processNames]);
    return Promise.resolve();
  }
}

function databasePort(store: MemoryReconcileStore) {
  return {
    execute: vi.fn(async () => {
      for (const target of ["DATABASE_PROVISIONING", "MIGRATING", "CONFIG_PREPARING"] as const) {
        const snapshot = store.current.snapshot;
        if (snapshot.status === target) continue;
        await store.transition(
          String(snapshot.providerId),
          String(snapshot.deploymentId),
          target,
          snapshot.status,
          snapshot.observedRevision,
        );
      }
      return store.current.snapshot;
    }),
  };
}

function lifecyclePort() {
  return {
    start: vi.fn(() => Promise.resolve({})),
    stop: vi.fn(() => Promise.resolve({})),
  };
}

function readyHealth() {
  return {
    probe: vi.fn(() =>
      Promise.resolve({
        processState: "online" as const,
        live: true,
        ready: true,
        reasonCode: "HEALTHY",
        checkedAt: "2026-07-26T00:00:00.000Z",
      }),
    ),
  };
}

function unhealthyHealth() {
  return {
    probe: vi.fn(() =>
      Promise.resolve({
        processState: "stopped" as const,
        live: false,
        ready: false,
        reasonCode: "PROCESS_OFFLINE",
        checkedAt: "2026-07-26T00:00:00.000Z",
      }),
    ),
  };
}

function validIdentity() {
  const verify = vi.fn<RuntimeReconcileProviderIdentityPort["verify"]>(() =>
    Promise.resolve({
      valid: true as const,
      reasonCode: "PROVIDER_ID_VERIFIED" as const,
      mismatchRelations: [],
      retryable: false as const,
    }),
  );
  return { verify } satisfies RuntimeReconcileProviderIdentityPort;
}

function mismatchedIdentity() {
  const verify = vi.fn<RuntimeReconcileProviderIdentityPort["verify"]>(() =>
    Promise.resolve({
      valid: false as const,
      reasonCode: "PROVIDER_ID_MISMATCH" as const,
      mismatchRelations: ["pms_adapter_manifest" as const],
      retryable: true as const,
    }),
  );
  return { verify } satisfies RuntimeReconcileProviderIdentityPort;
}

function inventory(values: readonly RuntimeReconcileInstance[]) {
  return {
    list: () =>
      Promise.resolve(
        values.map(({ target }) => ({
          target,
          state: "online" as const,
          restartCount: 0,
        })),
      ),
  };
}

function instance(processName: string): RuntimeReconcileInstance {
  return {
    target: {
      providerId: "provider-a",
      deploymentId: "deployment-1",
      environment: "production",
      runtimeVersion: "2.0.0-rc.1",
      instanceId: processName === "sdar-runtime-orphan" ? "instance-orphan" : "instance-1",
      ordinal: 0,
      processName,
    },
    configRevision: 1,
    configChecksum: "a".repeat(64),
    httpPort: 18_080,
    databaseUrlFile: "/run/sdar/database-url",
    effectiveConfig: {
      RUNTIME_ENV: "production",
      ADAPTER_TLS_MODE: "required",
    },
  };
}

function input(suffix = "1", signal?: AbortSignal) {
  return {
    providerId: "provider-a",
    deploymentId: "deployment-1",
    context: runtimeInfrastructureOperationContext({
      operationId: `operation-${suffix}`,
      correlationId: `correlation-${suffix}`,
      idempotencyKey: `idempotency-${suffix}`,
      timeoutMs: 1_000,
      ...(signal === undefined ? {} : { signal }),
    }),
  };
}

function deployment(
  status: RuntimeDeploymentStatus,
  desiredState: RuntimeDeploymentSnapshot["desiredState"] = "running",
): RuntimeDeployment {
  return rehydrateRuntimeDeployment({
    ...requestRuntimeDeployment(
      {
        deploymentId: runtimeDeploymentId("deployment-1"),
        providerId: runtimeProviderId("provider-a"),
        environment: runtimeEnvironmentId("production"),
        desiredState: "running",
        desiredReplicas: 1,
        runtimeVersion: "2.0.0-rc.1",
        databaseProfileId: databaseProfileId("database-1"),
        configProfileId: runtimeConfigProfileId("config-1"),
      },
      new Date("2026-07-26T00:00:00.000Z"),
    ).snapshot,
    desiredState,
    desiredReplicas: desiredState === "running" ? 1 : 0,
    desiredRevision: desiredState === "running" ? 0 : 1,
    status,
    observedRevision: observedRevision(status),
  });
}

function observedRevision(status: RuntimeDeploymentStatus): number {
  return Math.max(
    0,
    [
      "REQUESTED",
      "DATABASE_PROVISIONING",
      "MIGRATING",
      "CONFIG_PREPARING",
      "STARTING",
      "HEALTH_CHECKING",
      "DISCOVERING",
      "ACTIVE",
      "DEGRADED",
    ].indexOf(status),
  );
}
