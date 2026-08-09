import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPm2JavascriptApi,
  Pm2JavascriptApiBridgeError,
  type InstalledPm2JavascriptApi,
  type InstalledPm2Module,
  type Pm2ProcessDescription,
  type Pm2RestartOptions,
  type Pm2StartOptions,
} from "../src/index.js";

const testPm2Home = resolve(tmpdir(), "sdar-pm2-test");

describe("createPm2JavascriptApi", () => {
  it("creates an isolated custom PM2 client without mutating PM2_HOME", () => {
    const original = process.env.PM2_HOME;
    const fixture = moduleFixture();

    createPm2JavascriptApi({ pm2Home: testPm2Home }, fixture.module);

    expect(fixture.constructedWith).toEqual([{ pm2_home: testPm2Home }]);
    expect(process.env.PM2_HOME).toBe(original);
  });

  it("adapts only the required callbacks and makes repeated disconnect safe", async () => {
    const fixture = moduleFixture();
    const api = createPm2JavascriptApi({ pm2Home: testPm2Home }, fixture.module);
    const options = startOptions();

    await connect(api);
    await start(api, options);
    await stop(api, options.name);
    await restart(api, options.name, { updateEnv: true, env: options.env });
    expect(await describeProcesses(api, options.name)).toEqual([processDescription()]);
    expect(await listProcesses(api)).toEqual([processDescription()]);
    await remove(api, options.name);
    api.disconnect();
    api.disconnect();

    expect(fixture.calls).toEqual([
      "connect",
      "start",
      "stop",
      "restart",
      "describe",
      "list",
      "delete",
      "disconnect",
    ]);
    expect(fixture.restartArguments).toEqual([
      { name: options.name, env: options.env },
      { updateEnv: true },
    ]);
    expect(
      (fixture.restartArguments[0] as { readonly env: Readonly<Record<string, string>> }).env,
    ).not.toBe(options.env);
    expect(fixture.startArgument).toEqual(options);
    expect(fixture.startArgument).not.toBe(options);
    expect(fixture.startArgument?.env).not.toBe(options.env);
  });

  it("redacts connection failures and disconnects the failed client", async () => {
    const fixture = moduleFixture({
      connectError: new Error("daemon socket /private/pm2.sock rejected"),
    });
    const api = createPm2JavascriptApi({ pm2Home: testPm2Home }, fixture.module);

    const error = await connect(api).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Pm2JavascriptApiBridgeError);
    expect(error).toMatchObject({
      code: "PM2_JAVASCRIPT_API_CONNECT_FAILED",
      operation: "connect",
      message: "PM2_JAVASCRIPT_API_CONNECT_FAILED",
    });
    expect(String(error)).not.toContain("/private");
    expect(fixture.calls).toEqual(["connect", "disconnect"]);
  });

  it("normalizes callback and synchronous operation failures", async () => {
    const fixture = moduleFixture({
      listError: new Error("environment and daemon path must not escape"),
      stopThrows: true,
    });
    const api = createPm2JavascriptApi({ pm2Home: testPm2Home }, fixture.module);
    await connect(api);

    const listError = await listProcesses(api).catch((reason: unknown) => reason);
    const stopError = await stop(api, "sdar-runtime-provider-a-0").catch(
      (reason: unknown) => reason,
    );
    api.disconnect();

    for (const error of [listError, stopError]) {
      expect(error).toBeInstanceOf(Pm2JavascriptApiBridgeError);
      expect(error).toMatchObject({
        code: "PM2_JAVASCRIPT_API_OPERATION_FAILED",
        message: "PM2_JAVASCRIPT_API_OPERATION_FAILED",
      });
      expect(String(error)).not.toContain("daemon path");
    }
  });

  it("rejects a relative PM2 home before constructing a client", () => {
    const fixture = moduleFixture();

    expect(() => createPm2JavascriptApi({ pm2Home: "../shared-pm2" }, fixture.module)).toThrow(
      expect.objectContaining({
        code: "PM2_JAVASCRIPT_API_CONFIG_INVALID",
        operation: "create",
      }),
    );
    expect(fixture.constructedWith).toEqual([]);
  });
});

interface FixtureOptions {
  readonly connectError?: Error;
  readonly listError?: Error;
  readonly stopThrows?: boolean;
}

function moduleFixture(options: FixtureOptions = {}): {
  readonly module: InstalledPm2Module;
  readonly calls: string[];
  readonly constructedWith: { readonly pm2_home: string }[];
  readonly restartArguments: unknown[];
  readonly startArgument: Pm2StartOptions | undefined;
} {
  const calls: string[] = [];
  const constructedWith: { readonly pm2_home: string }[] = [];
  const restartArguments: unknown[] = [];
  let startArgument: Pm2StartOptions | undefined;
  const process = processDescription();
  class CustomApi implements InstalledPm2JavascriptApi {
    constructor(configuration: { readonly pm2_home: string }) {
      constructedWith.push(configuration);
    }

    connect(callback: (error?: unknown) => void): void {
      calls.push("connect");
      callback(options.connectError);
    }

    disconnect(): void {
      calls.push("disconnect");
    }

    start(
      startOptions: Pm2StartOptions,
      callback: (error: unknown, descriptions?: unknown) => void,
    ): void {
      calls.push("start");
      startArgument = startOptions;
      callback(null, [process]);
    }

    stop(_name: string, callback: (error?: unknown) => void): void {
      calls.push("stop");
      if (options.stopThrows === true) throw new Error("private stop failure");
      callback();
    }

    restart(
      application:
        string | { readonly name: string; readonly env: Readonly<Record<string, string>> },
      restartOptions: Pick<Pm2RestartOptions, "updateEnv">,
      callback: (error?: unknown) => void,
    ): void {
      calls.push("restart");
      restartArguments.push(application, restartOptions);
      callback();
    }

    delete(_name: string, callback: (error?: unknown) => void): void {
      calls.push("delete");
      callback();
    }

    describe(_name: string, callback: (error: unknown, descriptions?: unknown) => void): void {
      calls.push("describe");
      callback(null, [process]);
    }

    list(callback: (error: unknown, descriptions?: unknown) => void): void {
      calls.push("list");
      callback(options.listError ?? null, [process]);
    }
  }
  return {
    module: { custom: CustomApi },
    calls,
    constructedWith,
    restartArguments,
    get startArgument() {
      return startArgument;
    },
  };
}

function connect(api: ReturnType<typeof createPm2JavascriptApi>): Promise<void> {
  return new Promise((resolve, reject) => {
    api.connect((error) => (error === undefined ? resolve() : reject(error)));
  });
}

function start(
  api: ReturnType<typeof createPm2JavascriptApi>,
  options: Pm2StartOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    api.start(options, (error) => (error === null ? resolve() : reject(error)));
  });
}

function stop(api: ReturnType<typeof createPm2JavascriptApi>, name: string): Promise<void> {
  return voidOperation((callback) => api.stop(name, callback));
}

function restart(
  api: ReturnType<typeof createPm2JavascriptApi>,
  name: string,
  options: Pm2RestartOptions,
): Promise<void> {
  return voidOperation((callback) => api.restart(name, options, callback));
}

function remove(api: ReturnType<typeof createPm2JavascriptApi>, name: string): Promise<void> {
  return voidOperation((callback) => api.delete(name, callback));
}

function describeProcesses(
  api: ReturnType<typeof createPm2JavascriptApi>,
  name: string,
): Promise<readonly Pm2ProcessDescription[]> {
  return listOperation((callback) => api.describe(name, callback));
}

function listProcesses(
  api: ReturnType<typeof createPm2JavascriptApi>,
): Promise<readonly Pm2ProcessDescription[]> {
  return listOperation((callback) => api.list(callback));
}

function voidOperation(operation: (callback: (error?: Error) => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    operation((error) => (error === undefined ? resolve() : reject(error)));
  });
}

function listOperation(
  operation: (
    callback: (error: Error | null, descriptions?: readonly Pm2ProcessDescription[]) => void,
  ) => void,
): Promise<readonly Pm2ProcessDescription[]> {
  return new Promise((resolve, reject) => {
    operation((error, descriptions) =>
      error === null ? resolve(descriptions ?? []) : reject(error),
    );
  });
}

function startOptions(): Pm2StartOptions {
  return {
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
    kill_timeout: 30_000,
    env: { PORT: "18080" },
  };
}

function processDescription(): Pm2ProcessDescription {
  return {
    name: "sdar-runtime-provider-a-0",
    pid: 12_345,
    pm2_env: {
      status: "online",
      exec_mode: "fork_mode",
      restart_time: 0,
    },
  };
}
