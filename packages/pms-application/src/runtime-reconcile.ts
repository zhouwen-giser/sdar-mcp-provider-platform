import type {
  RuntimeDeployment,
  RuntimeDeploymentSnapshot,
  RuntimeDeploymentStatus,
  RuntimeInfrastructureInstanceTarget,
  RuntimeInfrastructureOperationContext,
  RuntimeInfrastructureProcessObservation,
} from "../../runtime-deployment/src/index.js";
import type { ProviderIdentityVerification } from "./provider-identity.js";

export interface RuntimeReconcileInstance {
  readonly target: RuntimeInfrastructureInstanceTarget;
  readonly configRevision: number;
  readonly configChecksum: string;
  readonly httpPort: number;
  readonly databaseUrlFile: string;
  readonly pms?: {
    readonly baseUrl: string;
    readonly tokenFile: string;
    readonly cachePath: string;
  };
  readonly effectiveConfig: Readonly<Record<string, string | number | boolean>>;
}

export interface RuntimeReconcileStore {
  getDeployment(providerId: string, deploymentId: string): Promise<RuntimeDeployment | null>;
  transition(
    providerId: string,
    deploymentId: string,
    target: RuntimeDeploymentStatus,
    expectedStatus: RuntimeDeploymentStatus,
    expectedObservedRevision: number,
  ): Promise<RuntimeDeployment>;
  fail(
    providerId: string,
    deploymentId: string,
    expectedStatus: RuntimeDeploymentStatus,
    expectedObservedRevision: number,
    errorCode: string,
  ): Promise<void>;
  ensureInstance(
    deployment: RuntimeDeploymentSnapshot,
    ordinal: 0,
  ): Promise<RuntimeReconcileInstance>;
  listInstances(
    providerId: string,
    deploymentId: string,
  ): Promise<readonly RuntimeReconcileInstance[]>;
  recordHealth(
    target: RuntimeInfrastructureInstanceTarget,
    result: RuntimeReconcileHealthResult,
  ): Promise<void>;
  recordOrphans(
    providerId: string,
    deploymentId: string,
    processNames: readonly string[],
    correlationId: string,
  ): Promise<void>;
}

export interface RuntimeReconcileDatabasePort {
  execute(input: {
    readonly providerId: string;
    readonly deploymentId: string;
    readonly operationId: string;
  }): Promise<RuntimeDeploymentSnapshot>;
}

export interface RuntimeReconcileLifecyclePort {
  start(
    request: RuntimeReconcileInstance,
    context: RuntimeInfrastructureOperationContext,
  ): Promise<unknown>;
  stop(
    request: { readonly target: RuntimeInfrastructureInstanceTarget },
    context: RuntimeInfrastructureOperationContext,
  ): Promise<unknown>;
}

export interface RuntimeReconcileHealthResult {
  readonly processState: RuntimeInfrastructureProcessObservation["state"];
  readonly live: boolean;
  readonly ready: boolean;
  readonly reasonCode: string;
  readonly checkedAt: string;
}

export interface RuntimeReconcileHealthPort {
  probe(input: {
    readonly target: RuntimeInfrastructureInstanceTarget;
    readonly httpPort: number;
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
  }): Promise<RuntimeReconcileHealthResult>;
}

export interface RuntimeReconcileProcessInventoryPort {
  list(): Promise<readonly RuntimeInfrastructureProcessObservation[]>;
}

export interface RuntimeReconcileProviderIdentityPort {
  verify(input: {
    readonly expectedProviderId: string;
    readonly target: RuntimeInfrastructureInstanceTarget;
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
  }): Promise<ProviderIdentityVerification>;
}

export interface RuntimeDeploymentReconcileInput {
  readonly providerId: string;
  readonly deploymentId: string;
  readonly context: RuntimeInfrastructureOperationContext;
}

export interface RuntimeDeploymentReconcileResult {
  readonly deployment: RuntimeDeploymentSnapshot;
  readonly progressed: boolean;
  readonly orphanProcessNames: readonly string[];
}

export type RuntimeDeploymentReconcileErrorCode =
  | "RUNTIME_RECONCILE_DEPLOYMENT_NOT_FOUND"
  | "RUNTIME_RECONCILE_STEP_LIMIT"
  | "RUNTIME_RECONCILE_OPERATION_FAILED";

export class RuntimeDeploymentReconcileError extends Error {
  constructor(
    readonly code: RuntimeDeploymentReconcileErrorCode,
    readonly retryable: boolean,
    options: ErrorOptions = {},
  ) {
    super(code, options);
    this.name = "RuntimeDeploymentReconcileError";
  }
}

export class RuntimeDeploymentReconciler {
  constructor(
    private readonly store: RuntimeReconcileStore,
    private readonly database: RuntimeReconcileDatabasePort,
    private readonly lifecycle: RuntimeReconcileLifecyclePort,
    private readonly health: RuntimeReconcileHealthPort,
    private readonly inventory: RuntimeReconcileProcessInventoryPort,
    private readonly providerIdentity: RuntimeReconcileProviderIdentityPort,
  ) {}

  async reconcile(
    input: RuntimeDeploymentReconcileInput,
  ): Promise<RuntimeDeploymentReconcileResult> {
    let deployment = await this.requireDeployment(input);
    let orphans: readonly string[];
    try {
      orphans = await this.detectOrphans(input);
    } catch (error) {
      throw new RuntimeDeploymentReconcileError("RUNTIME_RECONCILE_OPERATION_FAILED", true, {
        cause: error,
      });
    }
    let progressed = false;
    try {
      for (let step = 0; step < 12; step += 1) {
        if (deployment.snapshot.desiredState !== "running") {
          const before = deployment.snapshot.status;
          const result = await this.reconcileStopped(deployment, input);
          return {
            deployment: result.snapshot,
            progressed: progressed || result.snapshot.status !== before,
            orphanProcessNames: orphans,
          };
        }
        switch (deployment.snapshot.status) {
          case "REQUESTED":
          case "DATABASE_PROVISIONING":
          case "MIGRATING":
          case "FAILED":
            await this.database.execute({
              providerId: input.providerId,
              deploymentId: input.deploymentId,
              operationId: input.context.operationId,
            });
            deployment = await this.requireDeployment(input);
            progressed = true;
            continue;
          case "CONFIG_PREPARING":
            await this.store.ensureInstance(deployment.snapshot, 0);
            deployment = await this.transition(deployment, "STARTING", input);
            progressed = true;
            continue;
          case "STARTING": {
            const instance = await this.store.ensureInstance(deployment.snapshot, 0);
            await this.lifecycle.start(
              instance,
              stepContext(input.context, "start", deployment.snapshot.observedRevision),
            );
            deployment = await this.transition(deployment, "HEALTH_CHECKING", input);
            progressed = true;
            continue;
          }
          case "HEALTH_CHECKING": {
            const instance = await this.store.ensureInstance(deployment.snapshot, 0);
            const identityFailure = await this.failOnIdentityMismatch(deployment, instance, input);
            if (identityFailure !== null) {
              return {
                deployment: identityFailure.snapshot,
                progressed: true,
                orphanProcessNames: orphans,
              };
            }
            const result = await this.health.probe({
              target: instance.target,
              httpPort: instance.httpPort,
              timeoutMs: input.context.timeoutMs,
              signal: input.context.signal,
            });
            await this.store.recordHealth(instance.target, result);
            deployment = await this.transition(
              deployment,
              isHealthy(result) ? "DISCOVERING" : "DEGRADED",
              input,
            );
            return {
              deployment: deployment.snapshot,
              progressed: true,
              orphanProcessNames: orphans,
            };
          }
          case "ACTIVE":
          case "DEGRADED": {
            const before = deployment.snapshot.status;
            const instance = await this.store.ensureInstance(deployment.snapshot, 0);
            const result = await this.health.probe({
              target: instance.target,
              httpPort: instance.httpPort,
              timeoutMs: input.context.timeoutMs,
              signal: input.context.signal,
            });
            await this.store.recordHealth(instance.target, result);
            if (!isHealthy(result)) {
              if (before === "ACTIVE") {
                deployment = await this.transition(deployment, "DEGRADED", input);
                return {
                  deployment: deployment.snapshot,
                  progressed: true,
                  orphanProcessNames: orphans,
                };
              }
              return {
                deployment: deployment.snapshot,
                progressed,
                orphanProcessNames: orphans,
              };
            }
            const identityFailure = await this.failOnIdentityMismatch(deployment, instance, input);
            if (identityFailure !== null) {
              return {
                deployment: identityFailure.snapshot,
                progressed: true,
                orphanProcessNames: orphans,
              };
            }
            if (before === "DEGRADED") {
              deployment = await this.transition(deployment, "DISCOVERING", input);
              return {
                deployment: deployment.snapshot,
                progressed: true,
                orphanProcessNames: orphans,
              };
            }
            return {
              deployment: deployment.snapshot,
              progressed,
              orphanProcessNames: orphans,
            };
          }
          case "DISCOVERING": {
            const instance = await this.store.ensureInstance(deployment.snapshot, 0);
            const identityFailure = await this.failOnIdentityMismatch(deployment, instance, input);
            if (identityFailure !== null) {
              return {
                deployment: identityFailure.snapshot,
                progressed: true,
                orphanProcessNames: orphans,
              };
            }
            return {
              deployment: deployment.snapshot,
              progressed,
              orphanProcessNames: orphans,
            };
          }
          case "STOPPED":
          case "DRAINING":
            return {
              deployment: deployment.snapshot,
              progressed,
              orphanProcessNames: orphans,
            };
        }
      }
      throw new RuntimeDeploymentReconcileError("RUNTIME_RECONCILE_STEP_LIMIT", true);
    } catch (error) {
      const mapped =
        error instanceof RuntimeDeploymentReconcileError
          ? error
          : new RuntimeDeploymentReconcileError("RUNTIME_RECONCILE_OPERATION_FAILED", true, {
              cause: error,
            });
      const current = await this.store
        .getDeployment(input.providerId, input.deploymentId)
        .catch(() => null);
      if (current !== null && canFail(current.snapshot.status)) {
        await this.store
          .fail(
            input.providerId,
            input.deploymentId,
            current.snapshot.status,
            current.snapshot.observedRevision,
            mapped.code,
          )
          .catch(() => undefined);
      }
      throw mapped;
    }
  }

  private async reconcileStopped(
    deployment: RuntimeDeployment,
    input: RuntimeDeploymentReconcileInput,
  ): Promise<RuntimeDeployment> {
    if (deployment.snapshot.status === "STOPPED") return deployment;
    if (["REQUESTED", "FAILED"].includes(deployment.snapshot.status)) {
      return this.transition(deployment, "STOPPED", input);
    }
    if (deployment.snapshot.status !== "DRAINING") {
      deployment = await this.transition(deployment, "DRAINING", input);
    }
    const instances = await this.store.listInstances(input.providerId, input.deploymentId);
    for (const instance of instances) {
      await this.lifecycle.stop(
        { target: instance.target },
        stepContext(input.context, "stop", deployment.snapshot.observedRevision),
      );
    }
    return this.transition(deployment, "STOPPED", input);
  }

  private transition(
    deployment: RuntimeDeployment,
    target: RuntimeDeploymentStatus,
    input: RuntimeDeploymentReconcileInput,
  ): Promise<RuntimeDeployment> {
    const snapshot = deployment.snapshot;
    return this.store.transition(
      input.providerId,
      input.deploymentId,
      target,
      snapshot.status,
      snapshot.observedRevision,
    );
  }

  private async failOnIdentityMismatch(
    deployment: RuntimeDeployment,
    instance: RuntimeReconcileInstance,
    input: RuntimeDeploymentReconcileInput,
  ): Promise<RuntimeDeployment | null> {
    const verification = await this.providerIdentity.verify({
      expectedProviderId: input.providerId,
      target: instance.target,
      timeoutMs: input.context.timeoutMs,
      signal: input.context.signal,
    });
    if (verification.valid) return null;
    await this.store.fail(
      input.providerId,
      input.deploymentId,
      deployment.snapshot.status,
      deployment.snapshot.observedRevision,
      verification.reasonCode,
    );
    return this.requireDeployment(input);
  }

  private async requireDeployment(
    input: RuntimeDeploymentReconcileInput,
  ): Promise<RuntimeDeployment> {
    const deployment = await this.store.getDeployment(input.providerId, input.deploymentId);
    if (deployment === null) {
      throw new RuntimeDeploymentReconcileError("RUNTIME_RECONCILE_DEPLOYMENT_NOT_FOUND", false);
    }
    return deployment;
  }

  private async detectOrphans(input: RuntimeDeploymentReconcileInput): Promise<readonly string[]> {
    const [known, observed] = await Promise.all([
      this.store.listInstances(input.providerId, input.deploymentId),
      this.inventory.list(),
    ]);
    const knownNames = new Set(known.map(({ target }) => target.processName));
    const orphans = observed
      .filter(
        ({ target }) =>
          target.deploymentId === input.deploymentId && !knownNames.has(target.processName),
      )
      .map(({ target }) => target.processName)
      .sort();
    if (orphans.length > 0) {
      await this.store.recordOrphans(
        input.providerId,
        input.deploymentId,
        orphans,
        input.context.correlationId,
      );
    }
    return Object.freeze(orphans);
  }
}

function stepContext(
  context: RuntimeInfrastructureOperationContext,
  step: "start" | "stop",
  revision: number,
): RuntimeInfrastructureOperationContext {
  return Object.freeze({
    ...context,
    idempotencyKey: `${context.idempotencyKey}:${step}:${String(revision)}`,
  });
}

function isHealthy(result: RuntimeReconcileHealthResult): boolean {
  return result.processState === "online" && result.live && result.ready;
}

function canFail(status: RuntimeDeploymentStatus): boolean {
  return !["FAILED", "STOPPED"].includes(status);
}
