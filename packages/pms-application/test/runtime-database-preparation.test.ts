import { describe, expect, it, vi } from "vitest";
import {
  createDatabaseProfile,
  environmentId,
  providerId,
  secretRef,
  type DatabaseProfile,
} from "../../pms-domain/src/index.js";
import {
  PostgresProvisionerError,
  rehydrateRuntimeDeployment,
  requestRuntimeDeployment,
  runtimeConfigProfileId,
  runtimeDeploymentId,
  runtimeEnvironmentId,
  runtimeProviderId,
  databaseProfileId,
  type PostgresProvisionerPort,
  type PostgresProvisionOperation,
  type PostgresProvisionStepResult,
  type RuntimeDeployment,
} from "../../runtime-deployment/src/index.js";
import {
  RuntimeDatabasePreparationError,
  RuntimeDatabasePreparationJob,
  type RuntimeDatabasePreparationAuditEvent,
  type RuntimeDatabasePreparationCheckpoint,
  type RuntimeDatabasePreparationStore,
} from "../src/index.js";

describe("RuntimeDatabasePreparationJob", () => {
  it("checkpoints each external step and advances to CONFIG_PREPARING", async () => {
    const fixture = createFixture();

    const result = await fixture.job.execute(input());

    expect(result.status).toBe("CONFIG_PREPARING");
    expect(fixture.checkpoint?.completedSteps).toEqual([
      "runtime_secret",
      "role",
      "database",
      "grant",
      "verify",
      "migration",
    ]);
    expect(fixture.operations).toEqual([
      "secret",
      "role",
      "database",
      "grant",
      "verify",
      "migration",
    ]);
    expect(fixture.statuses).toEqual(["DATABASE_PROVISIONING", "MIGRATING", "CONFIG_PREPARING"]);
    expect(fixture.audits.map(({ action }) => action)).toEqual([
      "runtime_database_preparation.started",
      "runtime_database_preparation.completed",
    ]);
  });

  it("records a stable failure and retry resumes after the last durable checkpoint", async () => {
    let migrationAttempts = 0;
    const fixture = createFixture({
      migration: () => {
        migrationAttempts += 1;
        if (migrationAttempts === 1) {
          return Promise.reject(
            Object.assign(new Error("connection detail must not escape"), {
              code: "RUNTIME_MIGRATION_DATABASE_UNAVAILABLE",
              retryable: true,
            }),
          );
        }
        return Promise.resolve();
      },
    });

    await expect(fixture.job.execute(input())).rejects.toMatchObject({
      code: "RUNTIME_DATABASE_RUNTIME_MIGRATION_DATABASE_UNAVAILABLE",
      retryable: true,
    });
    expect(fixture.deployment.status).toBe("FAILED");
    expect(fixture.checkpoint?.completedSteps).toEqual([
      "runtime_secret",
      "role",
      "database",
      "grant",
      "verify",
    ]);
    expect(fixture.checkpoint?.lastErrorCode).toBe(
      "RUNTIME_DATABASE_RUNTIME_MIGRATION_DATABASE_UNAVAILABLE",
    );

    const result = await fixture.job.execute(input());

    expect(result.status).toBe("CONFIG_PREPARING");
    expect(fixture.operations.filter((operation) => operation === "role")).toHaveLength(1);
    expect(fixture.operations.filter((operation) => operation === "migration")).toHaveLength(2);
    expect(fixture.statuses).toEqual([
      "DATABASE_PROVISIONING",
      "MIGRATING",
      "FAILED",
      "REQUESTED",
      "DATABASE_PROVISIONING",
      "MIGRATING",
      "CONFIG_PREPARING",
    ]);
  });

  it("maps Provisioner errors without exposing their cause text", async () => {
    const fixture = createFixture({
      createRole: () =>
        Promise.reject(
          new PostgresProvisionerError("POSTGRES_AUTHORIZATION_DENIED", "create_role", {
            cause: new Error("password=never-report-this"),
          }),
        ),
    });

    const error = await fixture.job.execute(input()).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RuntimeDatabasePreparationError);
    expect(error).toMatchObject({
      code: "RUNTIME_DATABASE_POSTGRES_AUTHORIZATION_DENIED",
      retryable: false,
      message: "RUNTIME_DATABASE_POSTGRES_AUTHORIZATION_DENIED",
    });
    expect(JSON.stringify(fixture.audits)).not.toContain("password");
    expect(fixture.deployment.status).toBe("FAILED");
  });
});

interface FixtureOverrides {
  readonly createRole?: PostgresProvisionerPort["createRole"];
  readonly migration?: () => Promise<void>;
}

function createFixture(overrides: FixtureOverrides = {}) {
  let deployment = initialDeployment().snapshot;
  let checkpoint: RuntimeDatabasePreparationCheckpoint | null = null;
  const operations: string[] = [];
  const statuses: string[] = [];
  const audits: RuntimeDatabasePreparationAuditEvent[] = [];
  const profile = databaseProfile();
  const store: RuntimeDatabasePreparationStore = {
    getDeployment: () => Promise.resolve(rehydrateRuntimeDeployment(deployment)),
    saveDeployment: (value, precondition) => {
      if (
        deployment.desiredRevision !== precondition.expectedDesiredRevision ||
        deployment.observedRevision !== precondition.expectedObservedRevision
      ) {
        return Promise.resolve(false);
      }
      deployment = value;
      statuses.push(value.status);
      return Promise.resolve(true);
    },
    getDatabaseProfile: () => Promise.resolve(profile),
    getCheckpoint: () => Promise.resolve(checkpoint),
    saveCheckpoint: (value, expectedRevision) => {
      if ((checkpoint?.revision ?? 0) !== expectedRevision) throw new Error("CHECKPOINT_CONFLICT");
      checkpoint = value;
      return Promise.resolve();
    },
    appendAudit: (event) => {
      audits.push(event);
      return Promise.resolve();
    },
  };
  const step = (name: string, operation: PostgresProvisionOperation) => () => {
    operations.push(name);
    return Promise.resolve(result(operation));
  };
  const provisioner: PostgresProvisionerPort = {
    inspect: vi.fn(),
    plan: vi.fn(),
    createRole: overrides.createRole ?? step("role", "create_role"),
    createDatabase: step("database", "create_database"),
    grantRuntimeAccess: step("grant", "grant_runtime_access"),
    verify: step("verify", "verify"),
    delete: vi.fn(),
  };
  const job = new RuntimeDatabasePreparationJob(
    store,
    provisioner,
    {
      ensureRuntimeCredential: ({ secretRef: requested }) => {
        operations.push("secret");
        return Promise.resolve({ secretRef: requested });
      },
    },
    {
      run: async () => {
        operations.push("migration");
        await overrides.migration?.();
      },
    },
    () => new Date("2026-07-26T00:00:00.000Z"),
  );
  return {
    job,
    operations,
    statuses,
    audits,
    get deployment() {
      return deployment;
    },
    get checkpoint() {
      return checkpoint;
    },
  };
}

function initialDeployment(): RuntimeDeployment {
  return requestRuntimeDeployment(
    {
      deploymentId: runtimeDeploymentId("deployment-1"),
      providerId: runtimeProviderId("provider-a"),
      environment: runtimeEnvironmentId("production"),
      desiredState: "running",
      desiredReplicas: 1,
      runtimeVersion: "0.1.0",
      databaseProfileId: databaseProfileId("database-profile-1"),
      configProfileId: runtimeConfigProfileId("config-profile-1"),
    },
    new Date("2026-07-26T00:00:00.000Z"),
  );
}

function databaseProfile(): DatabaseProfile {
  return createDatabaseProfile({
    profileId: "database-profile-1",
    providerId: providerId("provider-a"),
    environment: environmentId("production"),
    clusterRef: "cluster-a",
    host: "postgres.internal",
    adminSecretRef: secretRef("vault/admin-a"),
    runtimeSecretRef: secretRef("file/v1/deployment-1/database/runtime"),
  });
}

function input() {
  return {
    providerId: "provider-a",
    deploymentId: "deployment-1",
    operationId: "operation-1",
  };
}

function result(operation: PostgresProvisionOperation): PostgresProvisionStepResult {
  return {
    operationId: "operation-1",
    operation,
    outcome: "created" as const,
    changed: true,
    databaseName: "database",
    runtimeRoleName: "role",
  };
}
