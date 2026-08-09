import { isAbsolute, resolve } from "node:path";
import { createRequire } from "node:module";
import type {
  Pm2JavascriptApi,
  Pm2ProcessDescription,
  Pm2RestartOptions,
  Pm2StartOptions,
} from "./process-manager.js";

export interface Pm2JavascriptApiOptions {
  readonly pm2Home: string;
}

export type Pm2JavascriptApiBridgeOperation =
  | "create"
  | "connect"
  | "disconnect"
  | "start"
  | "stop"
  | "restart"
  | "delete"
  | "describe"
  | "list";

export type Pm2JavascriptApiBridgeErrorCode =
  | "PM2_JAVASCRIPT_API_CONFIG_INVALID"
  | "PM2_JAVASCRIPT_API_CONNECT_FAILED"
  | "PM2_JAVASCRIPT_API_OPERATION_FAILED";

export class Pm2JavascriptApiBridgeError extends Error {
  constructor(
    readonly code: Pm2JavascriptApiBridgeErrorCode,
    readonly operation: Pm2JavascriptApiBridgeOperation,
  ) {
    super(code);
    this.name = "Pm2JavascriptApiBridgeError";
  }
}

export interface InstalledPm2JavascriptApi {
  connect(callback: (error?: unknown) => void): void;
  disconnect(): void;
  start(options: Pm2StartOptions, callback: (error: unknown, descriptions?: unknown) => void): void;
  stop(name: string, callback: (error?: unknown) => void): void;
  restart(
    application: string | { readonly name: string; readonly env: Readonly<Record<string, string>> },
    options: Pick<Pm2RestartOptions, "updateEnv">,
    callback: (error?: unknown) => void,
  ): void;
  delete(name: string, callback: (error?: unknown) => void): void;
  describe(name: string, callback: (error: unknown, descriptions?: unknown) => void): void;
  list(callback: (error: unknown, descriptions?: unknown) => void): void;
}

export interface InstalledPm2Module {
  readonly custom: new (options: { readonly pm2_home: string }) => InstalledPm2JavascriptApi;
}

interface Pm2InternalApi extends InstalledPm2JavascriptApi {
  readonly _conf: {
    DAEMON_RPC_PORT?: string;
    DAEMON_PUB_PORT?: string;
  };
  readonly Client: {
    rpc_socket_file?: string;
    pub_socket_file?: string;
  };
}

type Pm2ApiConstructor = new (options: {
  readonly pm2_home: string;
  readonly daemon_mode?: boolean;
}) => Pm2InternalApi;

// Match the official `pm2` programmatic entry point without constructing its global client.
process.env.PM2_PROGRAMMATIC = "true";
const installedPm2Api = createRequire(import.meta.url)("pm2/lib/API.js") as Pm2ApiConstructor;
const defaultInstalledModule: InstalledPm2Module = {
  custom: createPlatformPm2Constructor(installedPm2Api),
};

export function createPm2JavascriptApi(
  options: Pm2JavascriptApiOptions,
  installedModule: InstalledPm2Module = defaultInstalledModule,
): Pm2JavascriptApi {
  const pm2Home = validatePm2Home(options.pm2Home);
  let installed: InstalledPm2JavascriptApi;
  try {
    installed = new installedModule.custom({ pm2_home: pm2Home });
  } catch {
    throw new Pm2JavascriptApiBridgeError("PM2_JAVASCRIPT_API_CONFIG_INVALID", "create");
  }
  return new Pm2JavascriptApiBridge(installed);
}

class Pm2JavascriptApiBridge implements Pm2JavascriptApi {
  #connected = false;

  constructor(private readonly installed: InstalledPm2JavascriptApi) {}

  connect(callback: (error?: Error) => void): void {
    if (this.#connected) {
      callback();
      return;
    }
    try {
      this.installed.connect((error) => {
        if (error === undefined || error === null) {
          this.#connected = true;
          callback();
          return;
        }
        this.cleanupAfterFailedConnect();
        callback(new Pm2JavascriptApiBridgeError("PM2_JAVASCRIPT_API_CONNECT_FAILED", "connect"));
      });
    } catch {
      this.cleanupAfterFailedConnect();
      callback(new Pm2JavascriptApiBridgeError("PM2_JAVASCRIPT_API_CONNECT_FAILED", "connect"));
    }
  }

  disconnect(): void {
    if (!this.#connected) return;
    this.#connected = false;
    try {
      this.installed.disconnect();
    } catch {
      throw new Pm2JavascriptApiBridgeError("PM2_JAVASCRIPT_API_OPERATION_FAILED", "disconnect");
    }
  }

  start(
    options: Pm2StartOptions,
    callback: (error: Error | null, descriptions?: readonly Pm2ProcessDescription[]) => void,
  ): void {
    this.invokeList("start", callback, (done) =>
      this.installed.start({ ...options, env: { ...options.env } }, done),
    );
  }

  stop(name: string, callback: (error?: Error) => void): void {
    this.invokeVoid("stop", callback, (done) => this.installed.stop(name, done));
  }

  restart(name: string, options: Pm2RestartOptions, callback: (error?: Error) => void): void {
    this.invokeVoid("restart", callback, (done) =>
      this.installed.restart({ name, env: { ...options.env } }, { updateEnv: true }, done),
    );
  }

  delete(name: string, callback: (error?: Error) => void): void {
    this.invokeVoid("delete", callback, (done) => this.installed.delete(name, done));
  }

  describe(
    name: string,
    callback: (error: Error | null, descriptions?: readonly Pm2ProcessDescription[]) => void,
  ): void {
    this.invokeList("describe", callback, (done) => this.installed.describe(name, done));
  }

  list(
    callback: (error: Error | null, descriptions?: readonly Pm2ProcessDescription[]) => void,
  ): void {
    this.invokeList("list", callback, (done) => this.installed.list(done));
  }

  private invokeVoid(
    operation: Exclude<Pm2JavascriptApiBridgeOperation, "create" | "connect" | "disconnect">,
    callback: (error?: Error) => void,
    invoke: (done: (error?: unknown) => void) => void,
  ): void {
    try {
      invoke((error) => {
        if (error === undefined || error === null) callback();
        else callback(operationError(operation));
      });
    } catch {
      callback(operationError(operation));
    }
  }

  private invokeList(
    operation: "start" | "describe" | "list",
    callback: (error: Error | null, descriptions?: readonly Pm2ProcessDescription[]) => void,
    invoke: (done: (error: unknown, descriptions?: unknown) => void) => void,
  ): void {
    try {
      invoke((error, descriptions) => {
        if (error !== undefined && error !== null) {
          callback(operationError(operation));
          return;
        }
        callback(null, processDescriptions(descriptions));
      });
    } catch {
      callback(operationError(operation));
    }
  }

  private cleanupAfterFailedConnect(): void {
    this.#connected = false;
    try {
      this.installed.disconnect();
    } catch {
      // The stable connection error remains authoritative.
    }
  }
}

function validatePm2Home(value: string): string {
  if (!isAbsolute(value) || value.length > 4_096 || /[\0\r\n]/.test(value)) {
    throw new Pm2JavascriptApiBridgeError("PM2_JAVASCRIPT_API_CONFIG_INVALID", "create");
  }
  return resolve(value);
}

function createPlatformPm2Constructor(
  constructor: Pm2ApiConstructor,
): InstalledPm2Module["custom"] {
  if (process.platform !== "win32") return constructor;

  return class WindowsIsolatedPm2Api extends constructor {
    constructor(options: { readonly pm2_home: string }) {
      super({ ...options, daemon_mode: false });
      const identity = resolve(options.pm2_home)
        .slice(-32)
        .replace(/[^A-Za-z0-9_-]/g, "-");
      const rpc = `\\\\.\\pipe\\sdar-pm2-${identity}-rpc`;
      const pub = `\\\\.\\pipe\\sdar-pm2-${identity}-pub`;
      this._conf.DAEMON_RPC_PORT = rpc;
      this._conf.DAEMON_PUB_PORT = pub;
      this.Client.rpc_socket_file = rpc;
      this.Client.pub_socket_file = pub;
    }
  };
}

function operationError(
  operation: Exclude<Pm2JavascriptApiBridgeOperation, "create" | "connect" | "disconnect">,
): Pm2JavascriptApiBridgeError {
  return new Pm2JavascriptApiBridgeError("PM2_JAVASCRIPT_API_OPERATION_FAILED", operation);
}

function processDescriptions(value: unknown): readonly Pm2ProcessDescription[] {
  return Array.isArray(value) ? (value as readonly Pm2ProcessDescription[]) : [];
}
