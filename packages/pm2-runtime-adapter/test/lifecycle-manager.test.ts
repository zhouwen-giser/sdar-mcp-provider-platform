import { describe, expect, it, vi } from "vitest";
import {
  runtimeInfrastructureOperationContext,
  type RuntimeInfrastructureInstanceTarget,
  type RuntimeInfrastructureProcessObservation,
} from "@sdar/runtime-deployment";
import type { SecretStorePort } from "@sdar/secret-store";
import {
  BootstrapConfigRenderer,
  RuntimeLifecycleManager,
  type Pm2RuntimeProcessResult,
  type RuntimeLifecycleAuditEvent,
  type RuntimeLifecycleEvent,
  type RuntimeLifecycleResult,
  type RuntimeLifecycleStore,
} from "../src/index.js";

describe("RuntimeLifecycleManager", () => {
  it("converges start/stop/restart/delete idempotently with state and audit evidence", async () => {
    const processes = new FakeProcesses();
    const store = new MemoryLifecycleStore();
    const cleanup = vi.fn<SecretStorePort["cleanup"]>(() =>
      Promise.resolve({ secretRef: "ref", outcome: "deleted" as const }),
    );
    const manager = managerFixture(processes, store, cleanup);

    const startResult = await manager.start(startRequest(), context("start"));
    const startReplay = await manager.start(startRequest(), context("start"));
    expect(startResult).toEqual(startReplay);
    expect(processes.calls.start).toBe(1);
    expect(startResult.process.state).toBe("online");

    await manager.stop({ target: target() }, context("stop"));
    await manager.stop({ target: target() }, context("stop"));
    expect(processes.calls.stop).toBe(1);

    await manager.restart(startRequest(), context("restart"));
    await manager.restart(startRequest(), context("restart"));
    expect(processes.calls.restart).toBe(1);

    const deletion = await manager.delete(
      {
        target: target(),
        secretFiles: [
          {
            name: "database-url",
            ref: { secretRef: "file/v1/deployment-1/instance-1/database-url" },
          },
        ],
      },
      context("delete"),
    );
    const deletionReplay = await manager.delete(
      { target: target(), secretFiles: [] },
      context("delete"),
    );
    expect(deletion).toEqual(deletionReplay);
    expect(processes.calls.delete).toBe(1);
    expect(cleanup).toHaveBeenCalledWith(
      { secretRef: "file/v1/deployment-1/instance-1/database-url" },
      {
        kind: "explicit-secret-cleanup",
        deploymentId: "deployment-1",
        instanceId: "instance-1",
        name: "database-url",
        reason: "Runtime process deletion cleanup",
      },
    );

    expect(store.states.map(({ state }) => state)).toEqual([
      "starting",
      "online",
      "stopping",
      "stopped",
      "restarting",
      "online",
      "deleting",
      "deleted",
    ]);
    expect(store.audits).toHaveLength(8);
    expect(JSON.stringify(store.audits)).not.toContain("file/v1");
  });

  it("stops waiting at the deadline and persists a redacted stable failure", async () => {
    let now = 0;
    const processes = new FakeProcesses();
    processes.neverOnline = true;
    const store = new MemoryLifecycleStore();
    const manager = managerFixture(
      processes,
      store,
      vi.fn<SecretStorePort["cleanup"]>(() =>
        Promise.resolve({ secretRef: "ref", outcome: "missing" }),
      ),
      {
        now: () => now,
        delay: (milliseconds: number) => {
          now += milliseconds;
          return Promise.resolve();
        },
      },
    );

    await expect(
      manager.start(startRequest(), {
        ...context("timeout"),
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({
      code: "RUNTIME_LIFECYCLE_TIMEOUT",
      action: "start",
      retryable: true,
      message: "RUNTIME_LIFECYCLE_TIMEOUT",
    });
    expect(store.states.at(-1)).toMatchObject({
      state: "failed",
      errorCode: "RUNTIME_LIFECYCLE_TIMEOUT",
    });
    expect(store.audits.at(-1)).toMatchObject({
      action: "runtime_process.start_failed",
      errorCode: "RUNTIME_LIFECYCLE_TIMEOUT",
    });
  });

  it("bounds a hung process-manager callback with the operation timeout", async () => {
    const processes = new FakeProcesses();
    processes.hangStop = true;
    const store = new MemoryLifecycleStore();
    const manager = managerFixture(
      processes,
      store,
      vi.fn<SecretStorePort["cleanup"]>(() =>
        Promise.resolve({ secretRef: "ref", outcome: "missing" }),
      ),
    );

    await expect(
      manager.stop(
        { target: target() },
        {
          ...context("hung-stop"),
          timeoutMs: 5,
        },
      ),
    ).rejects.toMatchObject({
      code: "RUNTIME_LIFECYCLE_TIMEOUT",
      action: "stop",
    });
  });
});

class FakeProcesses {
  state: RuntimeInfrastructureProcessObservation["state"] = "missing";
  neverOnline = false;
  hangStop = false;
  readonly calls = { start: 0, stop: 0, restart: 0, delete: 0, describe: 0 };

  start(): Promise<Pm2RuntimeProcessResult> {
    this.calls.start += 1;
    this.state = "starting";
    return Promise.resolve(result("changed", this.state));
  }

  stop(): Promise<Pm2RuntimeProcessResult> {
    this.calls.stop += 1;
    if (this.hangStop) return new Promise(() => undefined);
    if (this.state === "missing" || this.state === "stopped") {
      return Promise.resolve(result("unchanged", this.state));
    }
    this.state = "stopping";
    return Promise.resolve(result("changed", this.state));
  }

  restart(): Promise<Pm2RuntimeProcessResult> {
    this.calls.restart += 1;
    this.state = "starting";
    return Promise.resolve(result("changed", this.state));
  }

  delete(): Promise<Pm2RuntimeProcessResult> {
    this.calls.delete += 1;
    const outcome = this.state === "missing" ? "unchanged" : "changed";
    this.state = "missing";
    return Promise.resolve(result(outcome, this.state));
  }

  describe(): Promise<RuntimeInfrastructureProcessObservation> {
    this.calls.describe += 1;
    if (this.state === "starting" && !this.neverOnline) this.state = "online";
    if (this.state === "stopping") this.state = "stopped";
    return Promise.resolve(observation(this.state));
  }
}

class MemoryLifecycleStore implements RuntimeLifecycleStore {
  readonly completed = new Map<string, RuntimeLifecycleResult>();
  readonly states: RuntimeLifecycleEvent[] = [];
  readonly audits: RuntimeLifecycleAuditEvent[] = [];

  findCompleted(idempotencyKey: string): Promise<RuntimeLifecycleResult | null> {
    return Promise.resolve(this.completed.get(idempotencyKey) ?? null);
  }

  appendState(event: RuntimeLifecycleEvent): Promise<void> {
    this.states.push(event);
    return Promise.resolve();
  }

  complete(idempotencyKey: string, result: RuntimeLifecycleResult): Promise<void> {
    this.completed.set(idempotencyKey, result);
    return Promise.resolve();
  }

  appendAudit(event: RuntimeLifecycleAuditEvent): Promise<void> {
    this.audits.push(event);
    return Promise.resolve();
  }
}

function managerFixture(
  processes: FakeProcesses,
  store: RuntimeLifecycleStore,
  cleanup: SecretStorePort["cleanup"],
  timing: {
    readonly now?: () => number;
    readonly delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  } = {},
) {
  return new RuntimeLifecycleManager(
    processes,
    {
      resolve: (version: string) =>
        Promise.resolve({
          version,
          releaseDirectory: `/opt/sdar/runtime-releases/${version}`,
          runtimeEntry: `/opt/sdar/runtime-releases/${version}/dist/apps/runtime/src/main.js`,
          manifestDigest: "b".repeat(64),
        }),
    },
    new BootstrapConfigRenderer(),
    { cleanup },
    store,
    { pollIntervalMs: 5, ...timing },
  );
}

function startRequest() {
  return {
    target: target(),
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

function target(): RuntimeInfrastructureInstanceTarget {
  return {
    providerId: "provider-a",
    deploymentId: "deployment-1",
    environment: "production",
    runtimeVersion: "2.0.0-rc.1",
    instanceId: "instance-1",
    ordinal: 0,
    processName: "sdar-runtime-provider-a-0",
  };
}

function context(suffix: string) {
  return runtimeInfrastructureOperationContext({
    operationId: `operation-${suffix}`,
    correlationId: `correlation-${suffix}`,
    idempotencyKey: `idempotency-${suffix}`,
    timeoutMs: 100,
  });
}

function result(
  outcome: "changed" | "unchanged",
  state: RuntimeInfrastructureProcessObservation["state"],
): Pm2RuntimeProcessResult {
  return { outcome, process: observation(state) };
}

function observation(
  state: RuntimeInfrastructureProcessObservation["state"],
): RuntimeInfrastructureProcessObservation {
  return {
    target: target(),
    state,
    restartCount: 0,
    opaqueLogRef: "runtime-process:instance-1",
  };
}
