import type { DatabaseProfile } from "../../pms-domain/src/index.js";
import {
  PostgresProvisionerError,
  type PostgresProvisionContext,
  type PostgresProvisionerPort,
  type PostgresProvisioningSpec,
  type RuntimeDeployment,
  type RuntimeDeploymentSnapshot,
  type RuntimeDeploymentStatus,
} from "../../runtime-deployment/src/index.js";

export const RUNTIME_DATABASE_PREPARATION_STEPS = [
  "runtime_secret",
  "role",
  "database",
  "grant",
  "verify",
  "migration",
] as const;

export type RuntimeDatabasePreparationStep = (typeof RUNTIME_DATABASE_PREPARATION_STEPS)[number];

export interface RuntimeDatabasePreparationCheckpoint {
  readonly deploymentId: string;
  readonly completedSteps: readonly RuntimeDatabasePreparationStep[];
  readonly revision: number;
  readonly lastErrorCode?: RuntimeDatabasePreparationErrorCode;
}

export interface RuntimeDatabasePreparationStore {
  getDeployment(providerId: string, deploymentId: string): Promise<RuntimeDeployment | null>;
  saveDeployment(
    value: RuntimeDeploymentSnapshot,
    precondition: {
      readonly expectedDesiredRevision: number;
      readonly expectedObservedRevision: number;
    },
  ): Promise<boolean>;
  getDatabaseProfile(providerId: string, environment: string): Promise<DatabaseProfile | null>;
  getCheckpoint(deploymentId: string): Promise<RuntimeDatabasePreparationCheckpoint | null>;
  saveCheckpoint(
    checkpoint: RuntimeDatabasePreparationCheckpoint,
    expectedRevision: number,
  ): Promise<void>;
  appendAudit(event: RuntimeDatabasePreparationAuditEvent): Promise<void>;
}

export interface RuntimeDatabaseSecretPort {
  ensureRuntimeCredential(input: {
    readonly deploymentId: string;
    readonly instanceId: "database";
    readonly secretRef: string;
    readonly operationId: string;
  }): Promise<{ readonly secretRef: string }>;
}

export interface RuntimeDatabaseMigrationPort {
  run(input: {
    readonly deploymentId: string;
    readonly providerId: string;
    readonly runtimeVersion: string;
    readonly migrationSet: "runtime";
  }): Promise<unknown>;
}

export interface RuntimeDatabasePreparationAuditEvent {
  readonly action:
    | "runtime_database_preparation.started"
    | "runtime_database_preparation.completed"
    | "runtime_database_preparation.failed";
  readonly deploymentId: string;
  readonly providerId: string;
  readonly operationId: string;
  readonly errorCode?: RuntimeDatabasePreparationErrorCode;
}

export type RuntimeDatabasePreparationErrorCode =
  | "RUNTIME_DATABASE_DEPLOYMENT_NOT_FOUND"
  | "RUNTIME_DATABASE_PROFILE_NOT_FOUND"
  | "RUNTIME_DATABASE_PROFILE_MISMATCH"
  | "RUNTIME_DATABASE_STATE_CONFLICT"
  | "RUNTIME_DATABASE_SECRET_FAILED"
  | `RUNTIME_DATABASE_${string}`;

export class RuntimeDatabasePreparationError extends Error {
  constructor(
    readonly code: RuntimeDatabasePreparationErrorCode,
    readonly retryable: boolean,
    options: ErrorOptions = {},
  ) {
    super(code, options);
    this.name = "RuntimeDatabasePreparationError";
  }
}

export interface RuntimeDatabasePreparationInput {
  readonly providerId: string;
  readonly deploymentId: string;
  readonly operationId: string;
}

export class RuntimeDatabasePreparationJob {
  constructor(
    private readonly store: RuntimeDatabasePreparationStore,
    private readonly provisioner: PostgresProvisionerPort,
    private readonly secrets: RuntimeDatabaseSecretPort,
    private readonly migrations: RuntimeDatabaseMigrationPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: RuntimeDatabasePreparationInput): Promise<RuntimeDeploymentSnapshot> {
    validateInput(input);
    let deployment = await this.requireDeployment(input);
    if (deployment.snapshot.status === "CONFIG_PREPARING") return deployment.snapshot;

    try {
      deployment = await this.prepareState(deployment);
      await this.store.appendAudit({
        action: "runtime_database_preparation.started",
        ...input,
      });
      const profile = await this.requireProfile(deployment.snapshot);
      const spec = provisioningSpec(profile);
      let checkpoint =
        (await this.store.getCheckpoint(input.deploymentId)) ??
        initialCheckpoint(input.deploymentId);

      checkpoint = await this.runStep(checkpoint, "runtime_secret", async () => {
        const result = await this.secrets.ensureRuntimeCredential({
          deploymentId: input.deploymentId,
          instanceId: "database",
          secretRef: profile.runtimeSecretRef.secretRef,
          operationId: input.operationId,
        });
        if (result.secretRef !== profile.runtimeSecretRef.secretRef) {
          throw new RuntimeDatabasePreparationError("RUNTIME_DATABASE_PROFILE_MISMATCH", false);
        }
      });
      checkpoint = await this.runStep(checkpoint, "role", () =>
        this.provisioner.createRole(spec, context(input.operationId, "role")),
      );
      checkpoint = await this.runStep(checkpoint, "database", () =>
        this.provisioner.createDatabase(spec, context(input.operationId, "database")),
      );
      checkpoint = await this.runStep(checkpoint, "grant", () =>
        this.provisioner.grantRuntimeAccess(spec, context(input.operationId, "grant")),
      );
      checkpoint = await this.runStep(checkpoint, "verify", () =>
        this.provisioner.verify(spec, context(input.operationId, "verify")),
      );

      deployment = await this.transition(deployment, "MIGRATING");
      await this.runStep(checkpoint, "migration", () =>
        this.migrations.run({
          deploymentId: input.deploymentId,
          providerId: input.providerId,
          runtimeVersion: deployment.snapshot.runtimeVersion,
          migrationSet: "runtime",
        }),
      );
      deployment = await this.transition(deployment, "CONFIG_PREPARING");
      await this.store.appendAudit({
        action: "runtime_database_preparation.completed",
        ...input,
      });
      return deployment.snapshot;
    } catch (error) {
      const mapped = mapPreparationError(error);
      await this.recordFailure(input, deployment, mapped);
      throw mapped;
    }
  }

  private async prepareState(deployment: RuntimeDeployment): Promise<RuntimeDeployment> {
    if (deployment.snapshot.status === "FAILED") {
      deployment = await this.transition(deployment, "REQUESTED");
    }
    if (deployment.snapshot.status === "REQUESTED") {
      return this.transition(deployment, "DATABASE_PROVISIONING");
    }
    if (
      deployment.snapshot.status !== "DATABASE_PROVISIONING" &&
      deployment.snapshot.status !== "MIGRATING"
    ) {
      throw new RuntimeDatabasePreparationError("RUNTIME_DATABASE_STATE_CONFLICT", false);
    }
    return deployment;
  }

  private async requireDeployment(
    input: RuntimeDatabasePreparationInput,
  ): Promise<RuntimeDeployment> {
    const deployment = await this.store.getDeployment(input.providerId, input.deploymentId);
    if (deployment === null) {
      throw new RuntimeDatabasePreparationError("RUNTIME_DATABASE_DEPLOYMENT_NOT_FOUND", false);
    }
    return deployment;
  }

  private async requireProfile(snapshot: RuntimeDeploymentSnapshot): Promise<DatabaseProfile> {
    const profile = await this.store.getDatabaseProfile(
      String(snapshot.providerId),
      String(snapshot.environment),
    );
    if (profile === null) {
      throw new RuntimeDatabasePreparationError("RUNTIME_DATABASE_PROFILE_NOT_FOUND", false);
    }
    if (String(profile.profileId) !== String(snapshot.databaseProfileId)) {
      throw new RuntimeDatabasePreparationError("RUNTIME_DATABASE_PROFILE_MISMATCH", false);
    }
    return profile;
  }

  private async runStep(
    checkpoint: RuntimeDatabasePreparationCheckpoint,
    step: RuntimeDatabasePreparationStep,
    action: () => Promise<unknown>,
  ): Promise<RuntimeDatabasePreparationCheckpoint> {
    if (checkpoint.completedSteps.includes(step)) return checkpoint;
    await action();
    const updated: RuntimeDatabasePreparationCheckpoint = Object.freeze({
      deploymentId: checkpoint.deploymentId,
      completedSteps: Object.freeze([...checkpoint.completedSteps, step]),
      revision: checkpoint.revision + 1,
    });
    await this.store.saveCheckpoint(updated, checkpoint.revision);
    return updated;
  }

  private async transition(
    deployment: RuntimeDeployment,
    status: RuntimeDeploymentStatus,
  ): Promise<RuntimeDeployment> {
    const before = deployment.snapshot;
    deployment.transition(
      status,
      { expectedStatus: before.status, expectedRevision: before.observedRevision },
      this.now(),
    );
    const saved = await this.store.saveDeployment(deployment.snapshot, {
      expectedDesiredRevision: before.desiredRevision,
      expectedObservedRevision: before.observedRevision,
    });
    if (!saved) {
      throw new RuntimeDatabasePreparationError("RUNTIME_DATABASE_STATE_CONFLICT", true);
    }
    return deployment;
  }

  private async recordFailure(
    input: RuntimeDatabasePreparationInput,
    deployment: RuntimeDeployment,
    error: RuntimeDatabasePreparationError,
  ): Promise<void> {
    if (
      deployment.snapshot.status !== "FAILED" &&
      ["REQUESTED", "DATABASE_PROVISIONING", "MIGRATING"].includes(deployment.snapshot.status)
    ) {
      await this.transition(deployment, "FAILED").catch(() => undefined);
    }
    const checkpoint =
      (await this.store.getCheckpoint(input.deploymentId).catch(() => null)) ??
      initialCheckpoint(input.deploymentId);
    await this.store
      .saveCheckpoint(
        Object.freeze({
          ...checkpoint,
          revision: checkpoint.revision + 1,
          lastErrorCode: error.code,
        }),
        checkpoint.revision,
      )
      .catch(() => undefined);
    await this.store
      .appendAudit({
        action: "runtime_database_preparation.failed",
        ...input,
        errorCode: error.code,
      })
      .catch(() => undefined);
  }
}

function context(operationId: string, step: string): PostgresProvisionContext {
  return Object.freeze({
    operationId,
    idempotencyKey: `${operationId}:${step}`,
    mode: "apply",
  });
}

function provisioningSpec(profile: DatabaseProfile): PostgresProvisioningSpec {
  return Object.freeze({
    ...profile,
    profileId: String(profile.profileId),
    providerId: String(profile.providerId),
    environment: String(profile.environment),
    clusterRef: String(profile.clusterRef),
    adminSecretRef: { secretRef: String(profile.adminSecretRef.secretRef) },
    runtimeSecretRef: { secretRef: String(profile.runtimeSecretRef.secretRef) },
  });
}

function initialCheckpoint(deploymentId: string): RuntimeDatabasePreparationCheckpoint {
  return Object.freeze({
    deploymentId,
    completedSteps: Object.freeze([]),
    revision: 0,
  });
}

function mapPreparationError(error: unknown): RuntimeDatabasePreparationError {
  if (error instanceof RuntimeDatabasePreparationError) return error;
  if (error instanceof PostgresProvisionerError) {
    return new RuntimeDatabasePreparationError(`RUNTIME_DATABASE_${error.code}`, error.retryable, {
      cause: error,
    });
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    const retryable =
      "retryable" in error && typeof error.retryable === "boolean" && error.retryable;
    return new RuntimeDatabasePreparationError(
      `RUNTIME_DATABASE_${sanitizeCode(error.code)}`,
      retryable,
      { cause: error },
    );
  }
  return new RuntimeDatabasePreparationError("RUNTIME_DATABASE_SECRET_FAILED", true, {
    cause: error,
  });
}

function sanitizeCode(code: string): string {
  const sanitized = code.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return sanitized.length === 0 ? "UNKNOWN_FAILURE" : sanitized.slice(0, 96);
}

function validateInput(input: RuntimeDatabasePreparationInput): void {
  const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  if (
    !identifier.test(input.providerId) ||
    !identifier.test(input.deploymentId) ||
    !identifier.test(input.operationId)
  ) {
    throw new TypeError("Runtime database preparation input is invalid");
  }
}
