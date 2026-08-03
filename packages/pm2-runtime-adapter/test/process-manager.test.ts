import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  Pm2JavascriptApi,
  Pm2ProcessDescription,
  Pm2RestartOptions,
  Pm2StartOptions,
} from "../src/index.js";
import { Pm2ProcessManager, Pm2ProcessManagerError } from "../src/index.js";

const RELEASE_ROOT = resolve("/opt/sdar/runtime-releases");
const RELEASE_DIRECTORY = resolve(RELEASE_ROOT, "2.0.0-rc.1");
const RUNTIME_ENTRY = resolve(RELEASE_DIRECTORY, "dist/apps/runtime/src/main.js");

describe("Pm2ProcessManager Fake JavaScript API contract", () => {
  it("starts only a fixed fork-mode Runtime entry and disconnects", async () => {
    const fake = new FakePm2Api();
    const manager = new Pm2ProcessManager(fake, RELEASE_ROOT);

    const result = await manager.start(request());

    expect(result).toMatchObject({ outcome: "changed", process: { state: "online" } });
    expect(fake.startOptions).toMatchObject({
      name: "sdar-runtime-provider-a-0",
      script: RUNTIME_ENTRY,
      cwd: RELEASE_DIRECTORY,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      restart_delay: 5_000,
      max_restarts: 5,
      max_memory_restart: 512 * 1024 * 1024,
      min_uptime: 10_000,
      kill_timeout: 30_000,
    });
    await manager.close();
    expect(fake.disconnect).toHaveBeenCalledOnce();
  });

  it("rejects non-platform process names before connecting", () => {
    const fake = new FakePm2Api();
    const manager = new Pm2ProcessManager(fake, RELEASE_ROOT);

    expect(() => manager.stop("unrelated-process")).toThrow(
      expect.objectContaining({
        code: "PM2_PROCESS_NAME_FORBIDDEN",
      }),
    );
    expect(fake.connect).not.toHaveBeenCalled();
  });

  it("rejects recovery policies that permit rapid or unbounded restart loops", () => {
    const fake = new FakePm2Api();

    expect(
      () =>
        new Pm2ProcessManager(fake, RELEASE_ROOT, {
          restartDelayMs: 0,
          maxRestarts: 100,
          maxMemoryBytes: 32,
          minUptimeMs: 0,
        }),
    ).toThrow(
      expect.objectContaining({
        code: "PM2_RECOVERY_POLICY_INVALID",
      }),
    );
    expect(fake.connect).not.toHaveBeenCalled();
  });

  it("rejects an unsafe graceful shutdown timeout", () => {
    const fake = new FakePm2Api();

    expect(
      () =>
        new Pm2ProcessManager(
          fake,
          RELEASE_ROOT,
          {
            restartDelayMs: 5_000,
            maxRestarts: 5,
            maxMemoryBytes: 512 * 1024 * 1024,
            minUptimeMs: 10_000,
          },
          { killTimeoutMs: 0 },
        ),
    ).toThrow(
      expect.objectContaining({
        code: "PM2_RECOVERY_POLICY_INVALID",
      }),
    );
  });

  it("restarts with only the rendered environment and explicit updateEnv", async () => {
    const fake = new FakePm2Api();
    fake.processes.set("sdar-runtime-provider-a-0", description("stopped"));
    const manager = new Pm2ProcessManager(fake, RELEASE_ROOT);

    await manager.restart(request());

    expect(fake.restartOptions).toEqual({
      updateEnv: true,
      env: request().bootstrap.environment,
    });
    expect(fake.restartOptions?.env).not.toHaveProperty("NODE_OPTIONS");
  });

  it("keeps an online process unchanged only when all bootstrap fingerprints match", async () => {
    const fake = new FakePm2Api();
    fake.processes.set(
      "sdar-runtime-provider-a-0",
      description("online", request().bootstrap.environment),
    );
    const manager = new Pm2ProcessManager(fake, RELEASE_ROOT);

    const result = await manager.start(request());

    expect(result.outcome).toBe("unchanged");
    expect(fake.restartOptions).toBeUndefined();
  });

  it.each([
    ["runtime version", "PMS_RUNTIME_VERSION", "2.0.0-rc.0"],
    ["config revision", "PMS_CONFIG_REVISION", "0"],
    ["bootstrap checksum", "PMS_BOOTSTRAP_CHECKSUM", "b".repeat(64)],
  ] as const)("restarts an online process with %s drift", async (_label, key, value) => {
    const fake = new FakePm2Api();
    fake.processes.set(
      "sdar-runtime-provider-a-0",
      description("online", { ...request().bootstrap.environment, [key]: value }),
    );
    const manager = new Pm2ProcessManager(fake, RELEASE_ROOT);

    const result = await manager.start(request());

    expect(result.outcome).toBe("changed");
    expect(fake.restartOptions).toEqual({
      updateEnv: true,
      env: request().bootstrap.environment,
    });
  });

  it("makes repeated stop and delete idempotent", async () => {
    const fake = new FakePm2Api();
    fake.processes.set("sdar-runtime-provider-a-0", description("online"));
    const manager = new Pm2ProcessManager(fake, RELEASE_ROOT);

    expect(await manager.stop("sdar-runtime-provider-a-0")).toMatchObject({
      outcome: "changed",
      process: { state: "stopped" },
    });
    expect(await manager.stop("sdar-runtime-provider-a-0")).toMatchObject({
      outcome: "unchanged",
      process: { state: "stopped" },
    });
    expect(await manager.delete("sdar-runtime-provider-a-0")).toMatchObject({
      outcome: "changed",
      process: { state: "missing" },
    });
    expect(await manager.delete("sdar-runtime-provider-a-0")).toMatchObject({
      outcome: "unchanged",
      process: { state: "missing" },
    });
  });

  it("filters list output and maps raw errors to stable redacted codes", async () => {
    const fake = new FakePm2Api();
    fake.processes.set("sdar-runtime-provider-a-0", description("online"));
    fake.processes.set("unrelated-process", { name: "unrelated-process" });
    const manager = new Pm2ProcessManager(fake, RELEASE_ROOT);

    expect(await manager.list()).toHaveLength(1);
    fake.listError = new Error("daemon socket /private/path failed");
    const error = await manager.list().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Pm2ProcessManagerError);
    expect(error).toMatchObject({
      code: "PM2_OPERATION_FAILED",
      operation: "list",
      retryable: true,
      message: "PM2_OPERATION_FAILED",
    });
    await manager.close();
    expect(fake.disconnect).toHaveBeenCalledOnce();
  });

  it("serializes concurrent operations on the shared PM2 connection", async () => {
    const fake = new FakePm2Api();
    fake.operationDelayMs = 5;
    const manager = new Pm2ProcessManager(fake, RELEASE_ROOT);

    await Promise.all([manager.start(request()), manager.start(requestFor("provider-b"))]);
    await manager.close();

    expect(fake.disconnectWhileOperationPending).toBe(false);
    expect(fake.connect).toHaveBeenCalledOnce();
    expect(fake.disconnect).toHaveBeenCalledOnce();
  });
});

class FakePm2Api implements Pm2JavascriptApi {
  readonly processes = new Map<string, Pm2ProcessDescription>();
  readonly connect = vi.fn((callback: (error?: Error) => void) => callback());
  readonly disconnect = vi.fn(() => {
    if (this.pendingOperations > 0) this.disconnectWhileOperationPending = true;
  });
  startOptions?: Pm2StartOptions;
  restartOptions?: Pm2RestartOptions;
  listError?: Error;
  operationDelayMs = 0;
  pendingOperations = 0;
  disconnectWhileOperationPending = false;

  start(
    options: Pm2StartOptions,
    callback: (error: Error | null, descriptions?: readonly Pm2ProcessDescription[]) => void,
  ): void {
    this.startOptions = options;
    this.defer(() => {
      const value = description("online");
      this.processes.set(options.name, value);
      callback(null, [value]);
    });
  }

  stop(name: string, callback: (error?: Error) => void): void {
    this.defer(() => {
      this.processes.set(name, description("stopped"));
      callback();
    });
  }

  restart(name: string, options: Pm2RestartOptions, callback: (error?: Error) => void): void {
    this.restartOptions = options;
    this.defer(() => {
      this.processes.set(name, description("online", options.env));
      callback();
    });
  }

  delete(name: string, callback: (error?: Error) => void): void {
    this.defer(() => {
      this.processes.delete(name);
      callback();
    });
  }

  describe(
    name: string,
    callback: (error: Error | null, descriptions?: readonly Pm2ProcessDescription[]) => void,
  ): void {
    this.defer(() => {
      const value = this.processes.get(name);
      callback(null, value === undefined ? [] : [value]);
    });
  }

  list(
    callback: (error: Error | null, descriptions?: readonly Pm2ProcessDescription[]) => void,
  ): void {
    this.defer(() => {
      if (this.listError !== undefined) callback(this.listError);
      else callback(null, [...this.processes.values()]);
    });
  }

  private defer(callback: () => void): void {
    if (this.operationDelayMs === 0) {
      callback();
      return;
    }
    this.pendingOperations += 1;
    setTimeout(() => {
      try {
        callback();
      } finally {
        this.pendingOperations -= 1;
      }
    }, this.operationDelayMs);
  }
}

function request() {
  const target = {
    providerId: "provider-a",
    deploymentId: "deployment-1",
    environment: "production",
    runtimeVersion: "2.0.0-rc.1",
    instanceId: "instance-1",
    ordinal: 0,
    processName: "sdar-runtime-provider-a-0",
  };
  return {
    processName: target.processName,
    runtimeVersion: target.runtimeVersion,
    bootstrap: {
      artifactId: "bootstrap-1",
      target,
      configRevision: 1,
      configChecksum: "a".repeat(64),
      httpPort: 18_080,
      databaseUrlFileRef: "/run/sdar/database-url",
      environment: {
        PORT: "18080",
        PROVIDER_ID: "provider-a",
        DATABASE_URL_FILE: "/run/sdar/database-url",
        PMS_BOOTSTRAP_CHECKSUM: "a".repeat(64),
        PMS_CONFIG_REVISION: "1",
        PMS_RUNTIME_VERSION: target.runtimeVersion,
      },
      redactedPreview: { DATABASE_URL_FILE: "<secret-file>" },
    },
    release: {
      version: target.runtimeVersion,
      releaseDirectory: `${RELEASE_ROOT}/2.0.0-rc.1`,
      runtimeEntry: `${RELEASE_ROOT}/2.0.0-rc.1/dist/apps/runtime/src/main.js`,
      manifestDigest: "b".repeat(64),
    },
  };
}

function requestFor(provider: string) {
  const value = request();
  const processName = `sdar-runtime-${provider}-0`;
  return {
    ...value,
    processName,
    bootstrap: {
      ...value.bootstrap,
      target: { ...value.bootstrap.target, providerId: provider, processName },
      environment: { ...value.bootstrap.environment, PROVIDER_ID: provider },
    },
  };
}

function description(
  status: string,
  environment: Readonly<Record<string, string>> = {},
): Pm2ProcessDescription {
  return {
    name: "sdar-runtime-provider-a-0",
    pid: 12_345,
    pm2_env: {
      status,
      pm_uptime: Date.parse("2026-07-26T00:00:00.000Z"),
      restart_time: 0,
      exec_mode: "fork_mode",
      ...environment,
    },
  };
}
