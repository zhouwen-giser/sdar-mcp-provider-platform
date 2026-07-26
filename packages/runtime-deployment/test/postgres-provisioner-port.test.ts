import { describe, expect, it } from "vitest";
import {
  PostgresProvisionerError,
  assertPostgresDatabaseDeletionPolicy,
  isRetryablePostgresProvisionerError,
  type PostgresDatabaseDeletionPolicy,
  type PostgresProvisionContext,
  type PostgresProvisionerPort,
  type PostgresProvisioningSpec,
} from "../src/index.js";

const spec: PostgresProvisioningSpec = {
  profileId: "database-profile-1",
  providerId: "provider-1",
  environment: "production",
  clusterRef: "postgres-primary",
  host: "postgres.internal",
  port: 5432,
  databaseMode: "provisioned",
  databaseName: "sdar_rt_provider_1_111111111111",
  runtimeRoleName: "sdar_rt_provider_1_111111111111_app",
  sslMode: "verify-full",
  adminSecretRef: { secretRef: "vault/postgres/provisioner" },
  runtimeSecretRef: { secretRef: "vault/runtime/provider-1" },
};

const context: PostgresProvisionContext = {
  operationId: "operation-1",
  idempotencyKey: "profile-1:create-role",
  mode: "dry_run",
};

describe("PostgresProvisioner Port", () => {
  it("is implementable by a deterministic Fake without exposing secret values", async () => {
    const fake = new FakePostgresProvisioner();

    expect(await fake.inspect(spec)).toMatchObject({ databaseExists: false });
    expect(await fake.plan(spec)).toEqual({
      profileId: "database-profile-1",
      mode: "dry_run",
      operations: ["create_role", "create_database", "grant_runtime_access", "verify"],
    });
    const first = await fake.createRole(spec, context);
    const replay = await fake.createRole(spec, context);
    expect(first).toEqual(replay);
    expect(first).toMatchObject({ outcome: "planned", changed: false });
    const serialized = JSON.stringify({ spec, first });
    expect(serialized).not.toContain("postgresql://");
    expect(serialized).not.toContain("adminUrl");
    expect(serialized).not.toContain("secretValue");
  });

  it("requires an explicit deletion policy bound to every target identity", () => {
    const policy: PostgresDatabaseDeletionPolicy = {
      kind: "explicit-provider-database-delete",
      profileId: spec.profileId,
      providerId: spec.providerId,
      environment: spec.environment,
      databaseName: spec.databaseName,
      runtimeRoleName: spec.runtimeRoleName,
      reason: "operator approved cleanup",
    };
    expect(() => assertPostgresDatabaseDeletionPolicy(spec, policy)).not.toThrow();
    expect(() =>
      assertPostgresDatabaseDeletionPolicy(spec, {
        ...policy,
        databaseName: "another_database",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "POSTGRES_DELETE_POLICY_REQUIRED",
        retryable: false,
      }),
    );
  });

  it("classifies transient and policy errors for bounded retry", () => {
    expect(isRetryablePostgresProvisionerError("POSTGRES_CLUSTER_UNAVAILABLE")).toBe(true);
    expect(isRetryablePostgresProvisionerError("POSTGRES_LOCK_TIMEOUT")).toBe(true);
    expect(isRetryablePostgresProvisionerError("POSTGRES_AUTHORIZATION_DENIED")).toBe(false);
    expect(isRetryablePostgresProvisionerError("POSTGRES_RESOURCE_CONFLICT")).toBe(false);
    expect(new PostgresProvisionerError("POSTGRES_CONNECTION_FAILED", "inspect")).toMatchObject({
      code: "POSTGRES_CONNECTION_FAILED",
      operation: "inspect",
      retryable: true,
    });
  });
});

class FakePostgresProvisioner implements PostgresProvisionerPort {
  readonly #results = new Map<string, ReturnType<typeof step>>();

  inspect(input: PostgresProvisioningSpec) {
    return Promise.resolve({
      profileId: input.profileId,
      databaseExists: false,
      runtimeRoleExists: false,
      runtimeAccessGranted: false,
      verified: false,
    });
  }

  plan(input: PostgresProvisioningSpec) {
    return Promise.resolve({
      profileId: input.profileId,
      mode: "dry_run" as const,
      operations: ["create_role", "create_database", "grant_runtime_access", "verify"] as const,
    });
  }

  createRole(input: PostgresProvisioningSpec, request: PostgresProvisionContext) {
    return Promise.resolve(this.#idempotent(input, request, "create_role"));
  }

  createDatabase(input: PostgresProvisioningSpec, request: PostgresProvisionContext) {
    return Promise.resolve(this.#idempotent(input, request, "create_database"));
  }

  grantRuntimeAccess(input: PostgresProvisioningSpec, request: PostgresProvisionContext) {
    return Promise.resolve(this.#idempotent(input, request, "grant_runtime_access"));
  }

  verify(input: PostgresProvisioningSpec, request: PostgresProvisionContext) {
    return Promise.resolve(this.#idempotent(input, request, "verify"));
  }

  delete(
    input: PostgresProvisioningSpec,
    policy: PostgresDatabaseDeletionPolicy,
    request: PostgresProvisionContext,
  ) {
    assertPostgresDatabaseDeletionPolicy(input, policy);
    return Promise.resolve(this.#idempotent(input, request, "delete"));
  }

  #idempotent(
    input: PostgresProvisioningSpec,
    request: PostgresProvisionContext,
    operation: Parameters<typeof step>[2],
  ) {
    const prior = this.#results.get(request.idempotencyKey);
    if (prior !== undefined) return prior;
    const result = step(input, request, operation);
    this.#results.set(request.idempotencyKey, result);
    return result;
  }
}

function step(
  input: PostgresProvisioningSpec,
  request: PostgresProvisionContext,
  operation: "create_role" | "create_database" | "grant_runtime_access" | "verify" | "delete",
) {
  return Object.freeze({
    operationId: request.operationId,
    operation,
    outcome: request.mode === "dry_run" ? ("planned" as const) : ("created" as const),
    changed: request.mode === "apply",
    databaseName: input.databaseName,
    runtimeRoleName: input.runtimeRoleName,
  });
}
