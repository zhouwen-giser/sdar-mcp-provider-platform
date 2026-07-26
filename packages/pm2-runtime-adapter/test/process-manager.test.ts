import { describe, expect, it, vi } from "vitest";
import type {
  Pm2JavascriptApi,
  Pm2ProcessDescription,
  Pm2RestartOptions,
  Pm2StartOptions,
} from "../src/index.js";
import { Pm2ProcessManager, Pm2ProcessManagerError } from "../src/index.js";

describe("Pm2ProcessManager Fake JavaScript API contract", () => {
  it("starts only a fixed fork-mode Runtime entry and disconnects", async () => {
    const fake = new FakePm2Api();
    const manager = new Pm2ProcessManager(fake, "/opt/sdar/runtime-releases");

    const result = await manager.start(request());

    expect(result).toMatchObject({ outcome: "changed", process: { state: "online" } });
    expect(fake.startOptions).toMatchObject({
      name: "sdar-runtime-provider-a-0",
      script: "/opt/sdar/runtime-releases/2.0.0-rc.1/dist/apps/runtime/src/main.js",
      cwd: "/opt/sdar/runtime-releases/2.0.0-rc.1",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      restart_delay: 5_000,
      max_restarts: 5,
      max_memory_restart: 512 * 1024 * 1024,
      min_uptime: 10_000,
    });
    expect(fake.disconnect).toHaveBeenCalledOnce();
  });

  it("rejects non-platform process names before connecting", () => {
    const fake = new FakePm2Api();
    const manager = new Pm2ProcessManager(fake, "/opt/sdar/runtime-releases");

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
        new Pm2ProcessManager(fake, "/opt/sdar/runtime-releases", {
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

  it("restarts with only the rendered environment and explicit updateEnv", async () => {
    const fake = new FakePm2Api();
    fake.processes.set("sdar-runtime-provider-a-0", description("stopped"));
    const manager = new Pm2ProcessManager(fake, "/opt/sdar/runtime-releases");

    await manager.restart(request());

    expect(fake.restartOptions).toEqual({
      updateEnv: true,
      env: request().bootstrap.environment,
    });
    expect(fake.restartOptions?.env).not.toHaveProperty("NODE_OPTIONS");
  });

  it("makes repeated stop and delete idempotent", async () => {
    const fake = new FakePm2Api();
    fake.processes.set("sdar-runtime-provider-a-0", description("online"));
    const manager = new Pm2ProcessManager(fake, "/opt/sdar/runtime-releases");

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
    const manager = new Pm2ProcessManager(fake, "/opt/sdar/runtime-releases");

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
    expect(fake.disconnect).toHaveBeenCalledTimes(2);
  });
});

class FakePm2Api implements Pm2JavascriptApi {
  readonly processes = new Map<string, Pm2ProcessDescription>();
  readonly connect = vi.fn((callback: (error?: Error) => void) => callback());
  readonly disconnect = vi.fn();
  startOptions?: Pm2StartOptions;
  restartOptions?: Pm2RestartOptions;
  listError?: Error;

  start(
    options: Pm2StartOptions,
    callback: (error: Error | null, descriptions?: readonly Pm2ProcessDescription[]) => void,
  ): void {
    this.startOptions = options;
    const value = description("online");
    this.processes.set(options.name, value);
    callback(null, [value]);
  }

  stop(name: string, callback: (error?: Error) => void): void {
    this.processes.set(name, description("stopped"));
    callback();
  }

  restart(name: string, options: Pm2RestartOptions, callback: (error?: Error) => void): void {
    this.restartOptions = options;
    this.processes.set(name, description("online"));
    callback();
  }

  delete(name: string, callback: (error?: Error) => void): void {
    this.processes.delete(name);
    callback();
  }

  describe(
    name: string,
    callback: (error: Error | null, descriptions?: readonly Pm2ProcessDescription[]) => void,
  ): void {
    const value = this.processes.get(name);
    callback(null, value === undefined ? [] : [value]);
  }

  list(
    callback: (error: Error | null, descriptions?: readonly Pm2ProcessDescription[]) => void,
  ): void {
    if (this.listError !== undefined) callback(this.listError);
    else callback(null, [...this.processes.values()]);
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
      },
      redactedPreview: { DATABASE_URL_FILE: "<secret-file>" },
    },
    release: {
      version: target.runtimeVersion,
      releaseDirectory: "/opt/sdar/runtime-releases/2.0.0-rc.1",
      runtimeEntry: "/opt/sdar/runtime-releases/2.0.0-rc.1/dist/apps/runtime/src/main.js",
      manifestDigest: "b".repeat(64),
    },
  };
}

function description(status: string): Pm2ProcessDescription {
  return {
    name: "sdar-runtime-provider-a-0",
    pid: 12_345,
    pm2_env: {
      status,
      pm_uptime: Date.parse("2026-07-26T00:00:00.000Z"),
      restart_time: 0,
      exec_mode: "fork_mode",
    },
  };
}
