import type {
  RuntimeInfrastructureInstanceTarget,
  RuntimeInfrastructureOperationContext,
  RuntimeInfrastructureProcessObservation,
} from "@sdar/runtime-deployment";
import type { FileSecretRef, SecretCleanupPolicy, SecretStorePort } from "@sdar/secret-store";
import type {
  BootstrapConfigRenderer,
  BootstrapConfigRendererInput,
} from "../bootstrap/renderer.js";
import {
  Pm2ProcessManagerError,
  type Pm2ProcessManager,
  type Pm2RuntimeProcessResult,
} from "../pm2/process-manager.js";
import type { RuntimeReleaseResolver } from "../releases/resolver.js";

export type RuntimeLifecycleAction = "start" | "stop" | "restart" | "delete";
export type RuntimeLifecycleState =
  "starting" | "online" | "stopping" | "stopped" | "restarting" | "deleting" | "deleted" | "failed";

export interface RuntimeLifecycleEvent {
  readonly action: RuntimeLifecycleAction;
  readonly state: RuntimeLifecycleState;
  readonly target: RuntimeInfrastructureInstanceTarget;
  readonly operationId: string;
  readonly correlationId: string;
  readonly errorCode?: RuntimeLifecycleErrorCode;
}

export interface RuntimeLifecycleAuditEvent {
  readonly action: `runtime_process.${RuntimeLifecycleAction}_${
    "started" | "succeeded" | "failed"}`;
  readonly providerId: string;
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly operationId: string;
  readonly correlationId: string;
  readonly errorCode?: RuntimeLifecycleErrorCode;
}

export interface RuntimeLifecycleResult {
  readonly action: RuntimeLifecycleAction;
  readonly outcome: "changed" | "unchanged";
  readonly process: RuntimeInfrastructureProcessObservation;
  readonly operationId: string;
}

export interface RuntimeLifecycleStore {
  findCompleted(idempotencyKey: string): Promise<RuntimeLifecycleResult | null>;
  appendState(event: RuntimeLifecycleEvent): Promise<void>;
  complete(idempotencyKey: string, result: RuntimeLifecycleResult): Promise<void>;
  appendAudit(event: RuntimeLifecycleAuditEvent): Promise<void>;
}

export type RuntimeLifecycleStartRequest = BootstrapConfigRendererInput;

export interface RuntimeLifecycleTargetRequest {
  readonly target: RuntimeInfrastructureInstanceTarget;
}

export interface RuntimeLifecycleDeleteRequest extends RuntimeLifecycleTargetRequest {
  readonly secretFiles: readonly {
    readonly name: string;
    readonly ref: FileSecretRef;
  }[];
}

export type RuntimeLifecycleErrorCode =
  | "RUNTIME_LIFECYCLE_TIMEOUT"
  | "RUNTIME_LIFECYCLE_CANCELLED"
  | "RUNTIME_LIFECYCLE_PROCESS_ERRORED"
  | "RUNTIME_LIFECYCLE_OPERATION_FAILED";

export class RuntimeLifecycleError extends Error {
  constructor(
    readonly code: RuntimeLifecycleErrorCode,
    readonly action: RuntimeLifecycleAction,
    readonly retryable: boolean,
    options: ErrorOptions = {},
  ) {
    super(code, options);
    this.name = "RuntimeLifecycleError";
  }
}

export interface RuntimeLifecycleManagerOptions {
  readonly pollIntervalMs?: number;
  readonly now?: () => number;
  readonly delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export class RuntimeLifecycleManager {
  readonly #pollIntervalMs: number;
  readonly #now: () => number;
  readonly #delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;

  constructor(
    private readonly processes: Pick<
      Pm2ProcessManager,
      "start" | "stop" | "restart" | "delete" | "describe"
    >,
    private readonly releases: Pick<RuntimeReleaseResolver, "resolve">,
    private readonly renderer: BootstrapConfigRenderer,
    private readonly secrets: Pick<SecretStorePort, "cleanup">,
    private readonly store: RuntimeLifecycleStore,
    options: RuntimeLifecycleManagerOptions = {},
  ) {
    this.#pollIntervalMs = options.pollIntervalMs ?? 100;
    if (
      !Number.isSafeInteger(this.#pollIntervalMs) ||
      this.#pollIntervalMs < 1 ||
      this.#pollIntervalMs > 5_000
    ) {
      throw new TypeError("Runtime lifecycle pollIntervalMs is invalid");
    }
    this.#now = options.now ?? Date.now;
    this.#delay = options.delay ?? abortableDelay;
  }

  start(
    request: RuntimeLifecycleStartRequest,
    context: RuntimeInfrastructureOperationContext,
  ): Promise<RuntimeLifecycleResult> {
    return this.run("start", request.target, context, async () => {
      const release = await this.releases.resolve(request.target.runtimeVersion);
      const bootstrap = this.renderer.render(request);
      const started = await this.processes.start({
        processName: request.target.processName,
        runtimeVersion: request.target.runtimeVersion,
        bootstrap,
        release,
      });
      return this.waitFor(started, request.target, "online", "start", context);
    });
  }

  stop(
    request: RuntimeLifecycleTargetRequest,
    context: RuntimeInfrastructureOperationContext,
  ): Promise<RuntimeLifecycleResult> {
    return this.run("stop", request.target, context, async () => {
      const stopped = await this.processes.stop(request.target.processName);
      return this.waitFor(stopped, request.target, "stopped", "stop", context);
    });
  }

  restart(
    request: RuntimeLifecycleStartRequest,
    context: RuntimeInfrastructureOperationContext,
  ): Promise<RuntimeLifecycleResult> {
    return this.run("restart", request.target, context, async () => {
      const release = await this.releases.resolve(request.target.runtimeVersion);
      const bootstrap = this.renderer.render(request);
      const restarted = await this.processes.restart({
        processName: request.target.processName,
        runtimeVersion: request.target.runtimeVersion,
        bootstrap,
        release,
      });
      return this.waitFor(restarted, request.target, "online", "restart", context);
    });
  }

  delete(
    request: RuntimeLifecycleDeleteRequest,
    context: RuntimeInfrastructureOperationContext,
  ): Promise<RuntimeLifecycleResult> {
    return this.run("delete", request.target, context, async () => {
      const stopped = await this.processes.stop(request.target.processName);
      await this.waitFor(stopped, request.target, "stopped", "delete", context);
      const deleted = await this.processes.delete(request.target.processName);
      if (deleted.process.state !== "missing") {
        throw new RuntimeLifecycleError("RUNTIME_LIFECYCLE_OPERATION_FAILED", "delete", true);
      }
      for (const secret of request.secretFiles) {
        await this.secrets.cleanup(secret.ref, cleanupPolicy(request.target, secret.name));
      }
      return Object.freeze({
        ...deleted,
        process: attachTarget(deleted.process, request.target),
      });
    });
  }

  private async run(
    action: RuntimeLifecycleAction,
    target: RuntimeInfrastructureInstanceTarget,
    context: RuntimeInfrastructureOperationContext,
    operation: () => Promise<Pm2RuntimeProcessResult>,
  ): Promise<RuntimeLifecycleResult> {
    validateContext(context, action);
    const idempotencyKey = `${action}:${context.idempotencyKey}`;
    const completed = await this.store.findCompleted(idempotencyKey);
    if (completed !== null) return completed;
    await this.persist(action, initialState(action), target, context);
    await this.audit(action, "started", target, context);
    try {
      const result = await boundedOperation(operation(), action, context);
      const completedResult = Object.freeze({
        action,
        outcome: result.outcome,
        process: result.process,
        operationId: context.operationId,
      });
      await this.persist(action, successState(action), target, context);
      await this.store.complete(idempotencyKey, completedResult);
      await this.audit(action, "succeeded", target, context);
      return completedResult;
    } catch (error) {
      const mapped = mapError(error, action, context);
      await this.store
        .appendState({
          action,
          state: "failed",
          target,
          operationId: context.operationId,
          correlationId: context.correlationId,
          errorCode: mapped.code,
        })
        .catch(() => undefined);
      await this.audit(action, "failed", target, context, mapped.code).catch(() => undefined);
      throw mapped;
    }
  }

  private async waitFor(
    initial: Pm2RuntimeProcessResult,
    target: RuntimeInfrastructureInstanceTarget,
    desired: "online" | "stopped",
    action: RuntimeLifecycleAction,
    context: RuntimeInfrastructureOperationContext,
  ): Promise<Pm2RuntimeProcessResult> {
    const deadline = this.#now() + context.timeoutMs;
    let current = initial.process;
    while (!reached(current.state, desired)) {
      if (current.state === "errored") {
        throw new RuntimeLifecycleError("RUNTIME_LIFECYCLE_PROCESS_ERRORED", action, false);
      }
      requireNotCancelled(context, action);
      const remaining = deadline - this.#now();
      if (remaining <= 0) {
        throw new RuntimeLifecycleError("RUNTIME_LIFECYCLE_TIMEOUT", action, true);
      }
      await this.#delay(Math.min(this.#pollIntervalMs, remaining), context.signal);
      requireNotCancelled(context, action);
      current = await this.processes.describe(target.processName);
    }
    return Object.freeze({
      outcome: initial.outcome,
      process: attachTarget(current, target),
    });
  }

  private persist(
    action: RuntimeLifecycleAction,
    state: RuntimeLifecycleState,
    target: RuntimeInfrastructureInstanceTarget,
    context: RuntimeInfrastructureOperationContext,
  ): Promise<void> {
    return this.store.appendState({
      action,
      state,
      target,
      operationId: context.operationId,
      correlationId: context.correlationId,
    });
  }

  private audit(
    action: RuntimeLifecycleAction,
    outcome: "started" | "succeeded" | "failed",
    target: RuntimeInfrastructureInstanceTarget,
    context: RuntimeInfrastructureOperationContext,
    errorCode?: RuntimeLifecycleErrorCode,
  ): Promise<void> {
    return this.store.appendAudit({
      action: `runtime_process.${action}_${outcome}`,
      providerId: target.providerId,
      deploymentId: target.deploymentId,
      instanceId: target.instanceId,
      operationId: context.operationId,
      correlationId: context.correlationId,
      ...(errorCode === undefined ? {} : { errorCode }),
    });
  }
}

function initialState(action: RuntimeLifecycleAction): RuntimeLifecycleState {
  switch (action) {
    case "start":
      return "starting";
    case "stop":
      return "stopping";
    case "restart":
      return "restarting";
    case "delete":
      return "deleting";
  }
}

function successState(action: RuntimeLifecycleAction): RuntimeLifecycleState {
  switch (action) {
    case "start":
    case "restart":
      return "online";
    case "stop":
      return "stopped";
    case "delete":
      return "deleted";
  }
}

function reached(
  state: RuntimeInfrastructureProcessObservation["state"],
  desired: "online" | "stopped",
): boolean {
  return desired === "online" ? state === "online" : state === "stopped" || state === "missing";
}

function cleanupPolicy(
  target: RuntimeInfrastructureInstanceTarget,
  name: string,
): SecretCleanupPolicy {
  return {
    kind: "explicit-secret-cleanup",
    deploymentId: target.deploymentId,
    instanceId: target.instanceId,
    name,
    reason: "Runtime process deletion cleanup",
  };
}

function validateContext(
  context: RuntimeInfrastructureOperationContext,
  action: RuntimeLifecycleAction,
): void {
  if (
    context.signal.aborted ||
    !Number.isSafeInteger(context.timeoutMs) ||
    context.timeoutMs < 1 ||
    context.operationId.trim().length === 0 ||
    context.correlationId.trim().length === 0 ||
    context.idempotencyKey.trim().length === 0
  ) {
    throw new RuntimeLifecycleError("RUNTIME_LIFECYCLE_CANCELLED", action, false);
  }
}

function requireNotCancelled(
  context: RuntimeInfrastructureOperationContext,
  action: RuntimeLifecycleAction,
): void {
  if (context.signal.aborted) {
    throw new RuntimeLifecycleError("RUNTIME_LIFECYCLE_CANCELLED", action, false);
  }
}

function mapError(
  error: unknown,
  action: RuntimeLifecycleAction,
  context: RuntimeInfrastructureOperationContext,
): RuntimeLifecycleError {
  if (error instanceof RuntimeLifecycleError) return error;
  if (context.signal.aborted) {
    return new RuntimeLifecycleError("RUNTIME_LIFECYCLE_CANCELLED", action, false);
  }
  if (error instanceof Pm2ProcessManagerError) {
    return new RuntimeLifecycleError(
      "RUNTIME_LIFECYCLE_OPERATION_FAILED",
      action,
      error.retryable,
      { cause: error },
    );
  }
  return new RuntimeLifecycleError("RUNTIME_LIFECYCLE_OPERATION_FAILED", action, true, {
    cause: error,
  });
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveDelay, rejectDelay) => {
    if (signal.aborted) {
      rejectDelay(new Error("ABORTED"));
      return;
    }
    const timer = setTimeout(resolveDelay, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        rejectDelay(new Error("ABORTED"));
      },
      { once: true },
    );
  });
}

function boundedOperation<T>(
  operation: Promise<T>,
  action: RuntimeLifecycleAction,
  context: RuntimeInfrastructureOperationContext,
): Promise<T> {
  return new Promise<T>((resolveOperation, rejectOperation) => {
    const aborted = () => {
      clearTimeout(timeout);
      rejectOperation(new RuntimeLifecycleError("RUNTIME_LIFECYCLE_CANCELLED", action, false));
    };
    const timeout = setTimeout(() => {
      context.signal.removeEventListener("abort", aborted);
      rejectOperation(new RuntimeLifecycleError("RUNTIME_LIFECYCLE_TIMEOUT", action, true));
    }, context.timeoutMs);
    context.signal.addEventListener("abort", aborted, { once: true });
    operation.then(
      (value) => {
        clearTimeout(timeout);
        context.signal.removeEventListener("abort", aborted);
        resolveOperation(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        context.signal.removeEventListener("abort", aborted);
        rejectOperation(error instanceof Error ? error : new Error("LIFECYCLE_OPERATION_FAILED"));
      },
    );
  });
}

function attachTarget(
  process: RuntimeInfrastructureProcessObservation,
  target: RuntimeInfrastructureInstanceTarget,
): RuntimeInfrastructureProcessObservation {
  return Object.freeze({ ...process, target });
}
