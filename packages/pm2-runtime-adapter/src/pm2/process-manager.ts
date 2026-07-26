import { isAbsolute, relative, resolve } from "node:path";
import type {
  RuntimeInfrastructureProcessObservation,
  RuntimeInfrastructureProcessState,
} from "@sdar/runtime-deployment";
import type { RenderedBootstrapConfig } from "../bootstrap/renderer.js";
import type { ResolvedRuntimeRelease } from "../releases/resolver.js";

const RUNTIME_ENTRY = "dist/apps/runtime/src/main.js";
const PROCESS_NAME = /^sdar-runtime-[a-z0-9][a-z0-9-]{0,112}$/;
const RUNTIME_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

export interface RuntimeCrashRecoveryPolicy {
  readonly restartDelayMs: number;
  readonly maxRestarts: number;
  readonly maxMemoryBytes: number;
  readonly minUptimeMs: number;
}

export const DEFAULT_RUNTIME_CRASH_RECOVERY_POLICY: RuntimeCrashRecoveryPolicy = Object.freeze({
  restartDelayMs: 5_000,
  maxRestarts: 5,
  maxMemoryBytes: 512 * 1024 * 1024,
  minUptimeMs: 10_000,
});

export interface RuntimeShutdownPolicy {
  readonly killTimeoutMs: number;
}

export const DEFAULT_RUNTIME_SHUTDOWN_POLICY: RuntimeShutdownPolicy = Object.freeze({
  killTimeoutMs: 30_000,
});

export interface Pm2ProcessDescription {
  readonly name?: string;
  readonly pid?: number;
  readonly pm2_env?: {
    readonly status?: string;
    readonly pm_uptime?: number;
    readonly restart_time?: number;
    readonly exec_mode?: string;
  };
}

export interface Pm2StartOptions {
  readonly name: string;
  readonly script: string;
  readonly cwd: string;
  readonly exec_mode: "fork";
  readonly instances: 1;
  readonly autorestart: true;
  readonly restart_delay: number;
  readonly max_restarts: number;
  readonly max_memory_restart: number;
  readonly min_uptime: number;
  readonly kill_timeout: number;
  readonly env: Readonly<Record<string, string>>;
}

export interface Pm2RestartOptions {
  readonly updateEnv: true;
  readonly env: Readonly<Record<string, string>>;
}

export interface Pm2JavascriptApi {
  connect(callback: (error?: Error) => void): void;
  disconnect(): void;
  start(
    options: Pm2StartOptions,
    callback: (error: Error | null, descriptions?: readonly Pm2ProcessDescription[]) => void,
  ): void;
  stop(name: string, callback: (error?: Error) => void): void;
  restart(name: string, options: Pm2RestartOptions, callback: (error?: Error) => void): void;
  delete(name: string, callback: (error?: Error) => void): void;
  describe(
    name: string,
    callback: (error: Error | null, descriptions?: readonly Pm2ProcessDescription[]) => void,
  ): void;
  list(
    callback: (error: Error | null, descriptions?: readonly Pm2ProcessDescription[]) => void,
  ): void;
}

export interface Pm2RuntimeStartRequest {
  readonly processName: string;
  readonly runtimeVersion: string;
  readonly bootstrap: RenderedBootstrapConfig;
  readonly release: ResolvedRuntimeRelease;
}

export interface Pm2RuntimeProcessResult {
  readonly outcome: "changed" | "unchanged";
  readonly process: RuntimeInfrastructureProcessObservation;
}

export type Pm2ProcessManagerErrorCode =
  | "PM2_PROCESS_NAME_FORBIDDEN"
  | "PM2_RUNTIME_RELEASE_INVALID"
  | "PM2_BOOTSTRAP_INVALID"
  | "PM2_RECOVERY_POLICY_INVALID"
  | "PM2_CONNECTION_FAILED"
  | "PM2_PROCESS_NOT_FOUND"
  | "PM2_OPERATION_FAILED";

export class Pm2ProcessManagerError extends Error {
  constructor(
    readonly code: Pm2ProcessManagerErrorCode,
    readonly operation: "connect" | "start" | "stop" | "restart" | "delete" | "describe" | "list",
    readonly retryable: boolean,
    options: ErrorOptions = {},
  ) {
    super(code, options);
    this.name = "Pm2ProcessManagerError";
  }
}

export class Pm2ProcessManager {
  readonly #releaseRoot: string;
  readonly #recoveryPolicy: RuntimeCrashRecoveryPolicy;
  readonly #shutdownPolicy: RuntimeShutdownPolicy;

  constructor(
    private readonly api: Pm2JavascriptApi,
    releaseRoot: string,
    recoveryPolicy: RuntimeCrashRecoveryPolicy = DEFAULT_RUNTIME_CRASH_RECOVERY_POLICY,
    shutdownPolicy: RuntimeShutdownPolicy = DEFAULT_RUNTIME_SHUTDOWN_POLICY,
  ) {
    if (!isAbsolute(releaseRoot)) {
      throw new Pm2ProcessManagerError("PM2_RUNTIME_RELEASE_INVALID", "connect", false);
    }
    this.#releaseRoot = resolve(releaseRoot);
    this.#recoveryPolicy = validateRecoveryPolicy(recoveryPolicy);
    this.#shutdownPolicy = validateShutdownPolicy(shutdownPolicy);
  }

  start(request: Pm2RuntimeStartRequest): Promise<Pm2RuntimeProcessResult> {
    const options = this.startOptions(request);
    return this.withConnection(async () => {
      const existing = await this.describeConnected(request.processName);
      if (existing?.state === "online") {
        return Object.freeze({ outcome: "unchanged" as const, process: existing });
      }
      if (existing !== null) {
        await callbackVoid("restart", (done) =>
          this.api.restart(request.processName, { updateEnv: true, env: options.env }, done),
        );
        return Object.freeze({
          outcome: "changed" as const,
          process:
            (await this.describeConnected(request.processName)) ??
            starting(request.processName, request.bootstrap.target),
        });
      }
      const descriptions = await callbackList("start", (done) => this.api.start(options, done));
      return Object.freeze({
        outcome: "changed" as const,
        process: mapDescription(descriptions[0], request.bootstrap.target),
      });
    });
  }

  stop(processName: string): Promise<Pm2RuntimeProcessResult> {
    assertProcessName(processName);
    return this.withConnection(async () => {
      const existing = await this.describeConnected(processName);
      if (existing === null || ["stopped", "missing"].includes(existing.state)) {
        return Object.freeze({
          outcome: "unchanged" as const,
          process: existing ?? missing(processName),
        });
      }
      try {
        await callbackVoid("stop", (done) => this.api.stop(processName, done));
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      return Object.freeze({
        outcome: "changed" as const,
        process: (await this.describeConnected(processName)) ?? missing(processName),
      });
    });
  }

  restart(request: Pm2RuntimeStartRequest): Promise<Pm2RuntimeProcessResult> {
    const options = this.startOptions(request);
    return this.withConnection(async () => {
      const existing = await this.describeConnected(request.processName);
      if (existing === null) {
        throw new Pm2ProcessManagerError("PM2_PROCESS_NOT_FOUND", "restart", false);
      }
      await callbackVoid("restart", (done) =>
        this.api.restart(request.processName, { updateEnv: true, env: options.env }, done),
      );
      return Object.freeze({
        outcome: "changed" as const,
        process:
          (await this.describeConnected(request.processName)) ??
          starting(request.processName, request.bootstrap.target),
      });
    });
  }

  delete(processName: string): Promise<Pm2RuntimeProcessResult> {
    assertProcessName(processName);
    return this.withConnection(async () => {
      const existing = await this.describeConnected(processName);
      if (existing === null) {
        return Object.freeze({
          outcome: "unchanged" as const,
          process: missing(processName),
        });
      }
      try {
        await callbackVoid("delete", (done) => this.api.delete(processName, done));
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      return Object.freeze({
        outcome: "changed" as const,
        process: missing(processName),
      });
    });
  }

  describe(processName: string): Promise<RuntimeInfrastructureProcessObservation> {
    assertProcessName(processName);
    return this.withConnection(async () => {
      return (await this.describeConnected(processName)) ?? missing(processName);
    });
  }

  list(): Promise<readonly RuntimeInfrastructureProcessObservation[]> {
    return this.withConnection(async () => {
      const descriptions = await callbackList("list", (done) => this.api.list(done));
      return Object.freeze(
        descriptions
          .filter(({ name }) => name !== undefined && PROCESS_NAME.test(name))
          .map((description) => mapDescription(description)),
      );
    });
  }

  private async describeConnected(
    processName: string,
  ): Promise<RuntimeInfrastructureProcessObservation | null> {
    const descriptions = await callbackList("describe", (done) =>
      this.api.describe(processName, done),
    );
    return descriptions[0] === undefined ? null : mapDescription(descriptions[0]);
  }

  private startOptions(request: Pm2RuntimeStartRequest): Pm2StartOptions {
    assertProcessName(request.processName);
    if (!RUNTIME_VERSION.test(request.runtimeVersion)) {
      throw new Pm2ProcessManagerError("PM2_RUNTIME_RELEASE_INVALID", "start", false);
    }
    if (
      request.bootstrap.target.processName !== request.processName ||
      request.bootstrap.target.runtimeVersion !== request.runtimeVersion ||
      request.release.version !== request.runtimeVersion
    ) {
      throw new Pm2ProcessManagerError("PM2_BOOTSTRAP_INVALID", "start", false);
    }
    validateEnvironment(request.bootstrap.environment);
    const cwd = resolve(this.#releaseRoot, request.runtimeVersion);
    assertContained(this.#releaseRoot, cwd);
    const script = resolve(cwd, RUNTIME_ENTRY);
    if (request.release.releaseDirectory !== cwd || request.release.runtimeEntry !== script) {
      throw new Pm2ProcessManagerError("PM2_RUNTIME_RELEASE_INVALID", "start", false);
    }
    return Object.freeze({
      name: request.processName,
      script,
      cwd,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      restart_delay: this.#recoveryPolicy.restartDelayMs,
      max_restarts: this.#recoveryPolicy.maxRestarts,
      max_memory_restart: this.#recoveryPolicy.maxMemoryBytes,
      min_uptime: this.#recoveryPolicy.minUptimeMs,
      kill_timeout: this.#shutdownPolicy.killTimeoutMs,
      env: request.bootstrap.environment,
    });
  }

  private async withConnection<T>(operation: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolveConnect, rejectConnect) => {
      this.api.connect((error) => {
        if (error === undefined) resolveConnect();
        else
          rejectConnect(
            new Pm2ProcessManagerError("PM2_CONNECTION_FAILED", "connect", true, {
              cause: error,
            }),
          );
      });
    });
    try {
      return await operation();
    } finally {
      this.api.disconnect();
    }
  }
}

function callbackVoid(
  operation: Pm2ProcessManagerError["operation"],
  call: (done: (error?: Error) => void) => void,
): Promise<void> {
  return new Promise((resolveCall, rejectCall) => {
    call((error) => {
      if (error === undefined) resolveCall();
      else rejectCall(mappedError(error, operation));
    });
  });
}

function callbackList(
  operation: Pm2ProcessManagerError["operation"],
  call: (
    done: (error: Error | null, descriptions?: readonly Pm2ProcessDescription[]) => void,
  ) => void,
): Promise<readonly Pm2ProcessDescription[]> {
  return new Promise((resolveCall, rejectCall) => {
    call((error, descriptions) => {
      if (error === null) resolveCall(descriptions ?? []);
      else rejectCall(mappedError(error, operation));
    });
  });
}

function mappedError(
  error: Error,
  operation: Pm2ProcessManagerError["operation"],
): Pm2ProcessManagerError {
  if (error instanceof Pm2ProcessManagerError) return error;
  const code = isNotFound(error) ? "PM2_PROCESS_NOT_FOUND" : "PM2_OPERATION_FAILED";
  return new Pm2ProcessManagerError(code, operation, code !== "PM2_PROCESS_NOT_FOUND", {
    cause: error,
  });
}

function isNotFound(error: unknown): boolean {
  return error instanceof Pm2ProcessManagerError
    ? error.code === "PM2_PROCESS_NOT_FOUND"
    : error instanceof Error &&
        /not found|unknown process|process or namespace/i.test(error.message);
}

function mapDescription(
  description: Pm2ProcessDescription | undefined,
  target?: RuntimeInfrastructureProcessObservation["target"],
): RuntimeInfrastructureProcessObservation {
  if (description === undefined) {
    if (target !== undefined) return starting(target.processName, target);
    throw new Pm2ProcessManagerError("PM2_PROCESS_NOT_FOUND", "describe", false);
  }
  const processName = description.name;
  if (processName === undefined || !PROCESS_NAME.test(processName)) {
    if (target !== undefined) return starting(target.processName, target);
    throw new Pm2ProcessManagerError("PM2_PROCESS_NAME_FORBIDDEN", "describe", false);
  }
  return Object.freeze({
    target:
      target ??
      Object.freeze({
        providerId: "unknown",
        deploymentId: "unknown",
        environment: "unknown",
        runtimeVersion: "unknown",
        instanceId: processName,
        ordinal: 0,
        processName,
      }),
    state: mapState(description.pm2_env?.status),
    ...(validPid(description.pid) ? { pid: description.pid } : {}),
    ...(description.pm2_env?.pm_uptime === undefined
      ? {}
      : { startedAt: new Date(description.pm2_env.pm_uptime).toISOString() }),
    restartCount: safeCount(description.pm2_env?.restart_time),
    opaqueLogRef: `runtime-process:${processName}`,
  });
}

function starting(
  processName: string,
  target: RuntimeInfrastructureProcessObservation["target"],
): RuntimeInfrastructureProcessObservation {
  return Object.freeze({
    target,
    state: "starting",
    restartCount: 0,
    opaqueLogRef: `runtime-process:${processName}`,
  });
}

function missing(processName: string): RuntimeInfrastructureProcessObservation {
  return Object.freeze({
    target: Object.freeze({
      providerId: "unknown",
      deploymentId: "unknown",
      environment: "unknown",
      runtimeVersion: "unknown",
      instanceId: processName,
      ordinal: 0,
      processName,
    }),
    state: "missing",
    restartCount: 0,
    opaqueLogRef: `runtime-process:${processName}`,
  });
}

function mapState(value: string | undefined): RuntimeInfrastructureProcessState {
  switch (value) {
    case "online":
      return "online";
    case "launching":
      return "starting";
    case "stopping":
      return "stopping";
    case "stopped":
      return "stopped";
    case "errored":
      return "errored";
    default:
      return "missing";
  }
}

function validateEnvironment(environment: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(environment)) {
    if (
      !/^[A-Z][A-Z0-9_]{0,127}$/.test(key) ||
      value.length === 0 ||
      value.length > 8_192 ||
      /[\0\r\n]/.test(value) ||
      /(?:PASSWORD|SECRET)$/.test(key) ||
      key === "DATABASE_URL" ||
      key === "NODE_OPTIONS"
    ) {
      throw new Pm2ProcessManagerError("PM2_BOOTSTRAP_INVALID", "start", false);
    }
  }
}

function assertProcessName(value: string): void {
  if (!PROCESS_NAME.test(value)) {
    throw new Pm2ProcessManagerError("PM2_PROCESS_NAME_FORBIDDEN", "describe", false);
  }
}

function assertContained(parent: string, candidate: string): void {
  const path = relative(parent, candidate);
  if (path.startsWith("..") || isAbsolute(path)) {
    throw new Pm2ProcessManagerError("PM2_RUNTIME_RELEASE_INVALID", "start", false);
  }
}

function validPid(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0;
}

function safeCount(value: number | undefined): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function validateRecoveryPolicy(policy: RuntimeCrashRecoveryPolicy): RuntimeCrashRecoveryPolicy {
  if (
    !boundedInteger(policy.restartDelayMs, 1_000, 300_000) ||
    !boundedInteger(policy.maxRestarts, 1, 20) ||
    !boundedInteger(policy.maxMemoryBytes, 64 * 1024 * 1024, 8 * 1024 * 1024 * 1024) ||
    !boundedInteger(policy.minUptimeMs, 1_000, 300_000)
  ) {
    throw new Pm2ProcessManagerError("PM2_RECOVERY_POLICY_INVALID", "connect", false);
  }
  return Object.freeze({ ...policy });
}

function boundedInteger(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function validateShutdownPolicy(policy: RuntimeShutdownPolicy): RuntimeShutdownPolicy {
  if (!boundedInteger(policy.killTimeoutMs, 1_000, 300_000)) {
    throw new Pm2ProcessManagerError("PM2_RECOVERY_POLICY_INVALID", "connect", false);
  }
  return Object.freeze({ ...policy });
}
