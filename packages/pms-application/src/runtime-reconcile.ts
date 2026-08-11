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

export interface RuntimeReconcileDirectInstance {
  readonly target: RuntimeInfrastructureInstanceTarget;
  readonly controlEndpoint: string;
  readonly advertisedEndpoint: string;
  readonly registrationState: "unregistered" | "registered" | "identity_mismatch";
  /** Derived from the authoritative registration expiry, not only lastHeartbeatAt. */
  readonly registrationFresh: boolean;
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
  getDirectInstance(
    deployment: RuntimeDeploymentSnapshot,
    ordinal: 0,
  ): Promise<RuntimeReconcileDirectInstance>;
  listInstances(
    providerId: string,
    deploymentId: string,
  ): Promise<readonly (RuntimeReconcileInstance | RuntimeReconcileDirectInstance)[]>;
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

export interface RuntimeReconcileExternalHealthPort {
  probe(input: {
    readonly controlEndpoint: string;
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
  }): Promise<RuntimeReconcileHealthResult>;
}

export interface RuntimeReconcileProcessInventoryPort {
  list(): Promise<readonly RuntimeInfrastructureProcessObservation[]>;
}

export type RuntimeReconcileProviderIdentityVerification =
  | ProviderIdentityVerification
  | {
      readonly valid: false;
      readonly reasonCode: "PROVIDER_IDENTITY_UNAVAILABLE";
      readonly mismatchRelations: readonly never[];
      readonly retryable: true;
    };

export type RuntimeReconcileAdapterTlsConfiguration =
  | { readonly mode: "disabled" }
  | {
      readonly mode: "required";
      readonly caPath: string;
      readonly certPath: string;
      readonly keyPath: string;
    };

export interface RuntimeReconcileProviderIdentityPort {
  verify(input: {
    readonly expectedProviderId: string;
    readonly target: RuntimeInfrastructureInstanceTarget;
    readonly bootstrapProviderId: string;
    readonly adapterEndpoint: string;
    readonly adapterTls: RuntimeReconcileAdapterTlsConfiguration;
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
  }): Promise<RuntimeReconcileProviderIdentityVerification>;
}

type RuntimeReconcileProviderIdentityOutcome =
  | { readonly state: "verified" }
  | { readonly state: "unavailable" }
  | { readonly state: "mismatch"; readonly deployment: RuntimeDeployment };

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
    private readonly externalHealth?: RuntimeReconcileExternalHealthPort,
  ) {}

  async reconcile(
    input: RuntimeDeploymentReconcileInput,
  ): Promise<RuntimeDeploymentReconcileResult> {
    checkpoint(input);
    let deployment = await this.requireDeployment(input);
    if (deployment.snapshot.runtimeAuthority === "direct_container") {
      return this.reconcileDirectContainer(deployment, input);
    }
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
        checkpoint(input);
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
            await cancellable(input, () =>
              this.database.execute({
                providerId: input.providerId,
                deploymentId: input.deploymentId,
                operationId: input.context.operationId,
              }),
            );
            deployment = await this.requireDeployment(input);
            progressed = true;
            continue;
          case "CONFIG_PREPARING":
            await cancellable(input, () => this.store.ensureInstance(deployment.snapshot, 0));
            deployment = await this.transition(deployment, "STARTING", input);
            progressed = true;
            continue;
          case "STARTING": {
            const instance = await cancellable(input, () =>
              this.store.ensureInstance(deployment.snapshot, 0),
            );
            const identity = await this.reconcileProviderIdentity(deployment, instance, input);
            if (identity.state === "mismatch") {
              return {
                deployment: identity.deployment.snapshot,
                progressed: true,
                orphanProcessNames: orphans,
              };
            }
            if (identity.state === "unavailable") {
              return {
                deployment: deployment.snapshot,
                progressed,
                orphanProcessNames: orphans,
              };
            }
            await cancellable(input, () =>
              this.lifecycle.start(
                instance,
                stepContext(input.context, "start", deployment.snapshot.observedRevision),
              ),
            );
            deployment = await this.transition(deployment, "HEALTH_CHECKING", input);
            progressed = true;
            continue;
          }
          case "HEALTH_CHECKING": {
            const instance = await cancellable(input, () =>
              this.store.ensureInstance(deployment.snapshot, 0),
            );
            const identity = await this.reconcileProviderIdentity(deployment, instance, input);
            if (identity.state === "mismatch") {
              return {
                deployment: identity.deployment.snapshot,
                progressed: true,
                orphanProcessNames: orphans,
              };
            }
            if (identity.state === "unavailable") {
              deployment = await this.transition(deployment, "DEGRADED", input);
              return {
                deployment: deployment.snapshot,
                progressed: true,
                orphanProcessNames: orphans,
              };
            }
            const result = await cancellable(input, () =>
              this.health.probe({
                target: instance.target,
                httpPort: instance.httpPort,
                timeoutMs: input.context.timeoutMs,
                signal: input.context.signal,
              }),
            );
            await cancellable(input, () => this.store.recordHealth(instance.target, result));
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
            const instance = await cancellable(input, () =>
              this.store.ensureInstance(deployment.snapshot, 0),
            );
            await cancellable(input, () =>
              this.lifecycle.start(
                instance,
                stepContext(input.context, "start", deployment.snapshot.observedRevision),
              ),
            );
            const result = await cancellable(input, () =>
              this.health.probe({
                target: instance.target,
                httpPort: instance.httpPort,
                timeoutMs: input.context.timeoutMs,
                signal: input.context.signal,
              }),
            );
            await cancellable(input, () => this.store.recordHealth(instance.target, result));
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
            const identity = await this.reconcileProviderIdentity(deployment, instance, input);
            if (identity.state === "mismatch") {
              return {
                deployment: identity.deployment.snapshot,
                progressed: true,
                orphanProcessNames: orphans,
              };
            }
            if (identity.state === "unavailable") {
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
            const instance = await cancellable(input, () =>
              this.store.ensureInstance(deployment.snapshot, 0),
            );
            const identity = await this.reconcileProviderIdentity(deployment, instance, input);
            if (identity.state === "mismatch") {
              return {
                deployment: identity.deployment.snapshot,
                progressed: true,
                orphanProcessNames: orphans,
              };
            }
            if (identity.state === "unavailable") {
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
          case "STOPPED":
            deployment = await this.transition(deployment, "REQUESTED", input);
            progressed = true;
            continue;
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
      if (input.context.signal.aborted) throw mapped;
      let current: RuntimeDeployment | null = null;
      try {
        current = await cancellable(input, () =>
          this.store.getDeployment(input.providerId, input.deploymentId),
        );
      } catch {
        checkpoint(input);
      }
      if (current !== null && canFail(current.snapshot.status)) {
        try {
          await cancellable(input, () =>
            this.store.fail(
              input.providerId,
              input.deploymentId,
              current.snapshot.status,
              current.snapshot.observedRevision,
              mapped.code,
            ),
          );
        } catch {
          checkpoint(input);
        }
      }
      throw mapped;
    }
  }

  private async reconcileDirectContainer(
    deployment: RuntimeDeployment,
    input: RuntimeDeploymentReconcileInput,
  ): Promise<RuntimeDeploymentReconcileResult> {
    let progressed = false;
    const noOrphans = Object.freeze([]) as readonly string[];
    try {
      for (let step = 0; step < 12; step += 1) {
        checkpoint(input);
        if (deployment.snapshot.runtimeAuthority !== "direct_container") {
          throw new Error("RUNTIME_RECONCILE_AUTHORITY_CHANGED");
        }
        if (deployment.snapshot.desiredState !== "running") {
          const before = deployment.snapshot.status;
          const stopped = await this.reconcileStopped(deployment, input);
          return {
            deployment: stopped.snapshot,
            progressed: progressed || stopped.snapshot.status !== before,
            orphanProcessNames: noOrphans,
          };
        }
        switch (deployment.snapshot.status) {
          case "REQUESTED":
            await this.requireDirectInstance(deployment, input);
            deployment = await this.transition(deployment, "CONFIG_PREPARING", input);
            progressed = true;
            continue;
          case "CONFIG_PREPARING":
            await this.requireDirectInstance(deployment, input);
            deployment = await this.transition(deployment, "STARTING", input);
            progressed = true;
            continue;
          case "STARTING": {
            const instance = await this.requireDirectInstance(deployment, input);
            if (!isRegistered(instance)) {
              return directResult(deployment, progressed, noOrphans);
            }
            deployment = await this.transition(deployment, "HEALTH_CHECKING", input);
            progressed = true;
            continue;
          }
          case "HEALTH_CHECKING": {
            const instance = await this.requireDirectInstance(deployment, input);
            if (!isRegistered(instance)) {
              deployment = await this.transition(deployment, "DEGRADED", input);
              return directResult(deployment, true, noOrphans);
            }
            const identity = await this.reconcileDirectProviderIdentity(
              deployment,
              instance,
              input,
            );
            if (identity.state === "mismatch") {
              return directResult(identity.deployment, true, noOrphans);
            }
            if (identity.state === "unavailable") {
              deployment = await this.transition(deployment, "DEGRADED", input);
              return directResult(deployment, true, noOrphans);
            }
            const health = await this.probeDirectHealth(instance, input);
            await cancellable(input, () => this.store.recordHealth(instance.target, health));
            deployment = await this.transition(
              deployment,
              isHealthy(health) ? "DISCOVERING" : "DEGRADED",
              input,
            );
            return directResult(deployment, true, noOrphans);
          }
          case "ACTIVE":
          case "DEGRADED": {
            const before = deployment.snapshot.status;
            const instance = await this.requireDirectInstance(deployment, input);
            if (!isRegistered(instance)) {
              if (before === "ACTIVE") {
                deployment = await this.transition(deployment, "DEGRADED", input);
                return directResult(deployment, true, noOrphans);
              }
              return directResult(deployment, progressed, noOrphans);
            }
            const health = await this.probeDirectHealth(instance, input);
            await cancellable(input, () => this.store.recordHealth(instance.target, health));
            if (!isHealthy(health)) {
              if (before === "ACTIVE") {
                deployment = await this.transition(deployment, "DEGRADED", input);
                return directResult(deployment, true, noOrphans);
              }
              return directResult(deployment, progressed, noOrphans);
            }
            const identity = await this.reconcileDirectProviderIdentity(
              deployment,
              instance,
              input,
            );
            if (identity.state === "mismatch") {
              return directResult(identity.deployment, true, noOrphans);
            }
            if (identity.state === "unavailable") {
              if (before === "ACTIVE") {
                deployment = await this.transition(deployment, "DEGRADED", input);
                return directResult(deployment, true, noOrphans);
              }
              return directResult(deployment, progressed, noOrphans);
            }
            if (before === "DEGRADED") {
              deployment = await this.transition(deployment, "DISCOVERING", input);
              return directResult(deployment, true, noOrphans);
            }
            return directResult(deployment, progressed, noOrphans);
          }
          case "DISCOVERING": {
            const instance = await this.requireDirectInstance(deployment, input);
            if (!isRegistered(instance)) {
              deployment = await this.transition(deployment, "DEGRADED", input);
              return directResult(deployment, true, noOrphans);
            }
            const identity = await this.reconcileDirectProviderIdentity(
              deployment,
              instance,
              input,
            );
            if (identity.state === "mismatch") {
              return directResult(identity.deployment, true, noOrphans);
            }
            if (identity.state === "unavailable") {
              deployment = await this.transition(deployment, "DEGRADED", input);
              return directResult(deployment, true, noOrphans);
            }
            return directResult(deployment, progressed, noOrphans);
          }
          case "FAILED":
            deployment = await this.transition(deployment, "REQUESTED", input);
            progressed = true;
            continue;
          case "STOPPED":
          case "DRAINING":
            return directResult(deployment, progressed, noOrphans);
          case "DATABASE_PROVISIONING":
          case "MIGRATING":
            throw new Error("DIRECT_CONTAINER_MANAGED_DATABASE_STATE_INVALID");
        }
      }
      throw new RuntimeDeploymentReconcileError("RUNTIME_RECONCILE_STEP_LIMIT", true);
    } catch (error) {
      throw await this.mapAndRecordFailure(error, input);
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
    if (deployment.snapshot.runtimeAuthority === "direct_container") {
      return this.transition(deployment, "STOPPED", input);
    }
    const instances = await cancellable(input, () =>
      this.store.listInstances(input.providerId, input.deploymentId),
    );
    for (const instance of instances) {
      await cancellable(input, () =>
        this.lifecycle.stop(
          { target: instance.target },
          stepContext(input.context, "stop", deployment.snapshot.observedRevision),
        ),
      );
    }
    return this.transition(deployment, "STOPPED", input);
  }

  private async requireDirectInstance(
    deployment: RuntimeDeployment,
    input: RuntimeDeploymentReconcileInput,
  ): Promise<RuntimeReconcileDirectInstance> {
    return cancellable(input, () => this.store.getDirectInstance(deployment.snapshot, 0));
  }

  private async probeDirectHealth(
    instance: RuntimeReconcileDirectInstance,
    input: RuntimeDeploymentReconcileInput,
  ): Promise<RuntimeReconcileHealthResult> {
    const externalHealth = this.externalHealth;
    if (externalHealth === undefined) {
      throw new Error("RUNTIME_RECONCILE_EXTERNAL_HEALTH_REQUIRED");
    }
    return cancellable(input, () =>
      externalHealth.probe({
        controlEndpoint: instance.controlEndpoint,
        timeoutMs: input.context.timeoutMs,
        signal: input.context.signal,
      }),
    );
  }

  private reconcileDirectProviderIdentity(
    deployment: RuntimeDeployment,
    instance: RuntimeReconcileDirectInstance,
    input: RuntimeDeploymentReconcileInput,
  ): Promise<RuntimeReconcileProviderIdentityOutcome> {
    const adapterEndpoint = deployment.snapshot.adapterEndpoint;
    if (adapterEndpoint === undefined) {
      throw new Error("RUNTIME_ADAPTER_ENDPOINT_MISSING");
    }
    return this.verifyProviderIdentity(
      deployment,
      instance.target,
      adapterEndpoint,
      { mode: "disabled" },
      input,
    );
  }

  private async transition(
    deployment: RuntimeDeployment,
    target: RuntimeDeploymentStatus,
    input: RuntimeDeploymentReconcileInput,
  ): Promise<RuntimeDeployment> {
    const snapshot = deployment.snapshot;
    return cancellable(input, () =>
      this.store.transition(
        input.providerId,
        input.deploymentId,
        target,
        snapshot.status,
        snapshot.observedRevision,
      ),
    );
  }

  private async reconcileProviderIdentity(
    deployment: RuntimeDeployment,
    instance: RuntimeReconcileInstance,
    input: RuntimeDeploymentReconcileInput,
  ): Promise<RuntimeReconcileProviderIdentityOutcome> {
    return this.verifyProviderIdentity(
      deployment,
      instance.target,
      requireAdapterEndpoint(instance.effectiveConfig),
      requireAdapterTlsConfiguration(instance.effectiveConfig),
      input,
    );
  }

  private async verifyProviderIdentity(
    deployment: RuntimeDeployment,
    target: RuntimeInfrastructureInstanceTarget,
    adapterEndpoint: string,
    adapterTls: RuntimeReconcileAdapterTlsConfiguration,
    input: RuntimeDeploymentReconcileInput,
  ): Promise<RuntimeReconcileProviderIdentityOutcome> {
    const verification = await cancellable(input, () =>
      this.providerIdentity.verify({
        expectedProviderId: input.providerId,
        target,
        bootstrapProviderId: target.providerId,
        adapterEndpoint,
        adapterTls,
        timeoutMs: input.context.timeoutMs,
        signal: input.context.signal,
      }),
    );
    if (verification.valid) return { state: "verified" };
    if (verification.reasonCode === "PROVIDER_IDENTITY_UNAVAILABLE") {
      return { state: "unavailable" };
    }
    await cancellable(input, () =>
      this.store.fail(
        input.providerId,
        input.deploymentId,
        deployment.snapshot.status,
        deployment.snapshot.observedRevision,
        verification.reasonCode,
      ),
    );
    return { state: "mismatch", deployment: await this.requireDeployment(input) };
  }

  private async mapAndRecordFailure(
    error: unknown,
    input: RuntimeDeploymentReconcileInput,
  ): Promise<RuntimeDeploymentReconcileError> {
    const mapped =
      error instanceof RuntimeDeploymentReconcileError
        ? error
        : new RuntimeDeploymentReconcileError("RUNTIME_RECONCILE_OPERATION_FAILED", true, {
            cause: error,
          });
    if (input.context.signal.aborted) return mapped;
    let current: RuntimeDeployment | null = null;
    try {
      current = await cancellable(input, () =>
        this.store.getDeployment(input.providerId, input.deploymentId),
      );
    } catch {
      checkpoint(input);
    }
    if (current !== null && canFail(current.snapshot.status)) {
      const snapshot = current.snapshot;
      try {
        await cancellable(input, () =>
          this.store.fail(
            input.providerId,
            input.deploymentId,
            snapshot.status,
            snapshot.observedRevision,
            mapped.code,
          ),
        );
      } catch {
        checkpoint(input);
      }
    }
    return mapped;
  }

  private async requireDeployment(
    input: RuntimeDeploymentReconcileInput,
  ): Promise<RuntimeDeployment> {
    const deployment = await cancellable(input, () =>
      this.store.getDeployment(input.providerId, input.deploymentId),
    );
    if (deployment === null) {
      throw new RuntimeDeploymentReconcileError("RUNTIME_RECONCILE_DEPLOYMENT_NOT_FOUND", false);
    }
    return deployment;
  }

  private async detectOrphans(input: RuntimeDeploymentReconcileInput): Promise<readonly string[]> {
    const [known, observed] = await cancellable(input, () =>
      Promise.all([
        this.store.listInstances(input.providerId, input.deploymentId),
        this.inventory.list(),
      ]),
    );
    const knownNames = new Set(known.map(({ target }) => target.processName));
    const orphans = observed
      .filter(
        ({ target }) =>
          target.deploymentId === input.deploymentId && !knownNames.has(target.processName),
      )
      .map(({ target }) => target.processName)
      .sort();
    if (orphans.length > 0) {
      await cancellable(input, () =>
        this.store.recordOrphans(
          input.providerId,
          input.deploymentId,
          orphans,
          input.context.correlationId,
        ),
      );
    }
    return Object.freeze(orphans);
  }
}

function requireAdapterEndpoint(
  effectiveConfig: Readonly<Record<string, string | number | boolean>>,
): string {
  const endpoint = effectiveConfig.ADAPTER_ENDPOINT;
  if (typeof endpoint !== "string" || endpoint.length === 0)
    throw new Error("RUNTIME_ADAPTER_ENDPOINT_MISSING");
  return endpoint;
}

function requireAdapterTlsConfiguration(
  effectiveConfig: Readonly<Record<string, string | number | boolean>>,
): RuntimeReconcileAdapterTlsConfiguration {
  const mode = effectiveConfig.ADAPTER_TLS_MODE ?? "disabled";
  if (mode === "disabled") return { mode };
  const caPath = effectiveConfig.ADAPTER_TLS_CA_PATH;
  const certPath = effectiveConfig.ADAPTER_TLS_CERT_PATH;
  const keyPath = effectiveConfig.ADAPTER_TLS_KEY_PATH;
  if (
    mode !== "required" ||
    typeof caPath !== "string" ||
    caPath.length === 0 ||
    typeof certPath !== "string" ||
    certPath.length === 0 ||
    typeof keyPath !== "string" ||
    keyPath.length === 0
  ) {
    throw new Error("RUNTIME_ADAPTER_MTLS_CONFIGURATION_INVALID");
  }
  return { mode, caPath, certPath, keyPath };
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

function isRegistered(instance: RuntimeReconcileDirectInstance): boolean {
  return instance.registrationState === "registered" && instance.registrationFresh;
}

function directResult(
  deployment: RuntimeDeployment,
  progressed: boolean,
  orphanProcessNames: readonly string[],
): RuntimeDeploymentReconcileResult {
  return {
    deployment: deployment.snapshot,
    progressed,
    orphanProcessNames,
  };
}

function canFail(status: RuntimeDeploymentStatus): boolean {
  return !["FAILED", "STOPPED"].includes(status);
}

async function cancellable<T>(
  input: RuntimeDeploymentReconcileInput,
  operation: () => Promise<T>,
): Promise<T> {
  checkpoint(input);
  const result = await operation();
  checkpoint(input);
  return result;
}

function checkpoint(input: RuntimeDeploymentReconcileInput): void {
  input.context.signal.throwIfAborted();
}
