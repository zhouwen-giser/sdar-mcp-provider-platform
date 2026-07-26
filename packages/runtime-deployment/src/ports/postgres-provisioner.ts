export const POSTGRES_SSL_MODES = ["disable", "require", "verify-ca", "verify-full"] as const;
export type PostgresSslMode = (typeof POSTGRES_SSL_MODES)[number];

export type PostgresDatabaseMode = "provisioned" | "preexisting";

export interface ProvisioningSecretRef {
  readonly secretRef: string;
}

export interface PostgresProvisioningSpec {
  readonly profileId: string;
  readonly providerId: string;
  readonly environment: string;
  readonly clusterRef: string;
  readonly host: string;
  readonly port: number;
  readonly databaseMode: PostgresDatabaseMode;
  readonly databaseName: string;
  readonly runtimeRoleName: string;
  readonly sslMode: PostgresSslMode;
  readonly adminSecretRef: ProvisioningSecretRef;
  readonly runtimeSecretRef: ProvisioningSecretRef;
}

export type PostgresProvisionOperation =
  "inspect" | "create_role" | "create_database" | "grant_runtime_access" | "verify" | "delete";

export interface PostgresProvisionContext {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly mode: "apply" | "dry_run";
}

export interface PostgresProvisionInspection {
  readonly profileId: string;
  readonly databaseExists: boolean;
  readonly runtimeRoleExists: boolean;
  readonly runtimeAccessGranted: boolean;
  readonly verified: boolean;
}

export interface PostgresProvisionStepResult {
  readonly operationId: string;
  readonly operation: PostgresProvisionOperation;
  readonly outcome: "planned" | "created" | "exists" | "updated" | "verified" | "deleted";
  readonly changed: boolean;
  readonly databaseName: string;
  readonly runtimeRoleName: string;
}

export interface PostgresProvisionPlan {
  readonly profileId: string;
  readonly mode: "dry_run";
  readonly operations: readonly Exclude<PostgresProvisionOperation, "inspect" | "delete">[];
}

export interface PostgresDatabaseDeletionPolicy {
  readonly kind: "explicit-provider-database-delete";
  readonly profileId: string;
  readonly providerId: string;
  readonly environment: string;
  readonly databaseName: string;
  readonly runtimeRoleName: string;
  readonly reason: string;
}

export interface PostgresProvisionerPort {
  inspect(spec: PostgresProvisioningSpec): Promise<PostgresProvisionInspection>;
  plan(spec: PostgresProvisioningSpec): Promise<PostgresProvisionPlan>;
  createRole(
    spec: PostgresProvisioningSpec,
    context: PostgresProvisionContext,
  ): Promise<PostgresProvisionStepResult>;
  createDatabase(
    spec: PostgresProvisioningSpec,
    context: PostgresProvisionContext,
  ): Promise<PostgresProvisionStepResult>;
  grantRuntimeAccess(
    spec: PostgresProvisioningSpec,
    context: PostgresProvisionContext,
  ): Promise<PostgresProvisionStepResult>;
  verify(
    spec: PostgresProvisioningSpec,
    context: PostgresProvisionContext,
  ): Promise<PostgresProvisionStepResult>;
  delete(
    spec: PostgresProvisioningSpec,
    policy: PostgresDatabaseDeletionPolicy,
    context: PostgresProvisionContext,
  ): Promise<PostgresProvisionStepResult>;
}

export type PostgresProvisionerErrorCode =
  | "POSTGRES_CLUSTER_UNAVAILABLE"
  | "POSTGRES_CONNECTION_FAILED"
  | "POSTGRES_LOCK_TIMEOUT"
  | "POSTGRES_AUTHENTICATION_FAILED"
  | "POSTGRES_AUTHORIZATION_DENIED"
  | "POSTGRES_INVALID_SPEC"
  | "POSTGRES_RESOURCE_CONFLICT"
  | "POSTGRES_VERIFICATION_FAILED"
  | "POSTGRES_DELETE_POLICY_REQUIRED";

const RETRYABLE_ERRORS: ReadonlySet<PostgresProvisionerErrorCode> = new Set([
  "POSTGRES_CLUSTER_UNAVAILABLE",
  "POSTGRES_CONNECTION_FAILED",
  "POSTGRES_LOCK_TIMEOUT",
  "POSTGRES_VERIFICATION_FAILED",
]);

export class PostgresProvisionerError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: PostgresProvisionerErrorCode,
    readonly operation: PostgresProvisionOperation,
    options: ErrorOptions = {},
  ) {
    super(code, options);
    this.name = "PostgresProvisionerError";
    this.retryable = isRetryablePostgresProvisionerError(code);
  }
}

export function isRetryablePostgresProvisionerError(code: PostgresProvisionerErrorCode): boolean {
  return RETRYABLE_ERRORS.has(code);
}

export function assertPostgresDatabaseDeletionPolicy(
  spec: PostgresProvisioningSpec,
  policy: PostgresDatabaseDeletionPolicy,
): void {
  if (
    policy.kind !== "explicit-provider-database-delete" ||
    policy.profileId !== spec.profileId ||
    policy.providerId !== spec.providerId ||
    policy.environment !== spec.environment ||
    policy.databaseName !== spec.databaseName ||
    policy.runtimeRoleName !== spec.runtimeRoleName ||
    policy.reason.trim().length < 8
  ) {
    throw new PostgresProvisionerError("POSTGRES_DELETE_POLICY_REQUIRED", "delete");
  }
}
