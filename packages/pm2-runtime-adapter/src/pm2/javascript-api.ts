import { isAbsolute, resolve } from "node:path";
import pm2 from "pm2";
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
  restart(name: string, options: Pm2RestartOptions, callback: (error?: unknown) => void): void;
  delete(name: string, callback: (error?: unknown) => void): void;
  describe(name: string, callback: (error: unknown, descriptions?: unknown) => void): void;
  list(callback: (error: unknown, descriptions?: unknown) => void): void;
}

export interface InstalledPm2Module {
  readonly custom: new (options: { readonly pm2_home: string }) => InstalledPm2JavascriptApi;
}

export function createPm2JavascriptApi(
  options: Pm2JavascriptApiOptions,
  installedModule: InstalledPm2Module = pm2 as unknown as InstalledPm2Module,
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
    this.invokeList("start", callback, (done) => this.installed.start(options, done));
  }

  stop(name: string, callback: (error?: Error) => void): void {
    this.invokeVoid("stop", callback, (done) => this.installed.stop(name, done));
  }

  restart(name: string, options: Pm2RestartOptions, callback: (error?: Error) => void): void {
    this.invokeVoid("restart", callback, (done) => this.installed.restart(name, options, done));
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

function operationError(
  operation: Exclude<Pm2JavascriptApiBridgeOperation, "create" | "connect" | "disconnect">,
): Pm2JavascriptApiBridgeError {
  return new Pm2JavascriptApiBridgeError("PM2_JAVASCRIPT_API_OPERATION_FAILED", operation);
}

function processDescriptions(value: unknown): readonly Pm2ProcessDescription[] {
  return Array.isArray(value) ? (value as readonly Pm2ProcessDescription[]) : [];
}
