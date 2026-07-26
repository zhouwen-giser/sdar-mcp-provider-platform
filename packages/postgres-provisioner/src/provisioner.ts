import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import {
  PostgresProvisionerError,
  assertPostgresDatabaseDeletionPolicy,
  type PostgresDatabaseDeletionPolicy,
  type PostgresProvisionContext,
  type PostgresProvisionerPort,
  type PostgresProvisioningSpec,
  type PostgresProvisionInspection,
  type PostgresProvisionPlan,
  type PostgresProvisionStepResult,
} from "../../runtime-deployment/src/index.js";

export interface ProvisioningSqlClient {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- callers select the expected row projection.
  query<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[]; readonly rowCount: number | null }>;
}

export interface RuntimeDatabaseConnectionFactory {
  connectRuntime(spec: PostgresProvisioningSpec): Promise<ProvisioningSqlClient>;
  connectDatabase(databaseName: string): Promise<ProvisioningSqlClient>;
  close(client: ProvisioningSqlClient): Promise<void>;
}

export interface RuntimeCredentialRotationHook {
  ensureRuntimeCredential(
    spec: PostgresProvisioningSpec,
    context: PostgresProvisionContext,
    admin: ProvisioningSqlClient,
  ): Promise<{ readonly changed: boolean }>;
}

export interface PostgresProvisionerOptions {
  readonly credentialRotation: RuntimeCredentialRotationHook;
  readonly connections: RuntimeDatabaseConnectionFactory;
}

export class PostgresProvisioner implements PostgresProvisionerPort {
  constructor(
    private readonly admin: ProvisioningSqlClient,
    private readonly options: PostgresProvisionerOptions,
  ) {}

  async inspect(spec: PostgresProvisioningSpec): Promise<PostgresProvisionInspection> {
    validateSpec(spec);
    try {
      const [database, role] = await Promise.all([
        this.admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [spec.databaseName]),
        this.admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [spec.runtimeRoleName]),
      ]);
      const databaseExists = database.rows.length === 1;
      const runtimeRoleExists = role.rows.length === 1;
      const access =
        databaseExists && runtimeRoleExists
          ? await this.admin.query<{ allowed: boolean }>(
              "SELECT has_database_privilege($1,$2,'CONNECT') AS allowed",
              [spec.runtimeRoleName, spec.databaseName],
            )
          : undefined;
      return Object.freeze({
        profileId: spec.profileId,
        databaseExists,
        runtimeRoleExists,
        runtimeAccessGranted:
          databaseExists && runtimeRoleExists && access?.rows[0]?.allowed === true,
        verified: false,
      });
    } catch (error) {
      throw mappedError(error, "inspect");
    }
  }

  plan(spec: PostgresProvisioningSpec): Promise<PostgresProvisionPlan> {
    validateSpec(spec);
    return Promise.resolve(
      Object.freeze({
        profileId: spec.profileId,
        mode: "dry_run",
        operations: Object.freeze([
          "create_role",
          "create_database",
          "grant_runtime_access",
          "verify",
        ] as const),
      }),
    );
  }

  async createRole(
    spec: PostgresProvisioningSpec,
    context: PostgresProvisionContext,
  ): Promise<PostgresProvisionStepResult> {
    validate(spec, context);
    const roleName = quotePostgresIdentifier(spec.runtimeRoleName);
    if (context.mode === "dry_run") return step(spec, context, "create_role", "planned", false);
    try {
      const existing = await this.admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [
        spec.runtimeRoleName,
      ]);
      let created = false;
      if (existing.rows.length === 0) {
        await this.admin.query(
          `CREATE ROLE ${roleName} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
        );
        created = true;
      }
      const rotated = await this.options.credentialRotation.ensureRuntimeCredential(
        spec,
        context,
        this.admin,
      );
      return step(
        spec,
        context,
        "create_role",
        created ? "created" : rotated.changed ? "updated" : "exists",
        created || rotated.changed,
      );
    } catch (error) {
      throw mappedError(error, "create_role");
    }
  }

  async createDatabase(
    spec: PostgresProvisioningSpec,
    context: PostgresProvisionContext,
  ): Promise<PostgresProvisionStepResult> {
    validate(spec, context);
    const databaseName = quotePostgresIdentifier(spec.databaseName);
    if (context.mode === "dry_run") {
      return step(spec, context, "create_database", "planned", false);
    }
    try {
      const existing = await this.admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [
        spec.databaseName,
      ]);
      if (existing.rows.length === 1) {
        return step(spec, context, "create_database", "exists", false);
      }
      if (spec.databaseMode === "preexisting") {
        throw new PostgresProvisionerError("POSTGRES_RESOURCE_CONFLICT", "create_database");
      }
      await this.admin.query(`CREATE DATABASE ${databaseName}`);
      return step(spec, context, "create_database", "created", true);
    } catch (error) {
      throw mappedError(error, "create_database");
    }
  }

  async grantRuntimeAccess(
    spec: PostgresProvisioningSpec,
    context: PostgresProvisionContext,
  ): Promise<PostgresProvisionStepResult> {
    validate(spec, context);
    if (context.mode === "dry_run") {
      return step(spec, context, "grant_runtime_access", "planned", false);
    }
    const databaseName = quotePostgresIdentifier(spec.databaseName);
    const roleName = quotePostgresIdentifier(spec.runtimeRoleName);
    let database: ProvisioningSqlClient | undefined;
    try {
      database = await this.options.connections.connectDatabase(spec.databaseName);
      const [databaseAccess, schemaAccess] = await Promise.all([
        this.admin.query<{ allowed: boolean }>(
          "SELECT has_database_privilege($1,$2,'CONNECT') AS allowed",
          [spec.runtimeRoleName, spec.databaseName],
        ),
        database.query<{ allowed: boolean }>(
          "SELECT has_schema_privilege($1,'public','USAGE') AND has_schema_privilege($1,'public','CREATE') AS allowed",
          [spec.runtimeRoleName],
        ),
      ]);
      const alreadyGranted =
        databaseAccess.rows[0]?.allowed === true && schemaAccess.rows[0]?.allowed === true;
      await this.admin.query(`GRANT CONNECT ON DATABASE ${databaseName} TO ${roleName}`);
      await database.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
      await database.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${roleName}`);
      return step(
        spec,
        context,
        "grant_runtime_access",
        alreadyGranted ? "exists" : "updated",
        !alreadyGranted,
      );
    } catch (error) {
      throw mappedError(error, "grant_runtime_access");
    } finally {
      if (database !== undefined) await this.options.connections.close(database);
    }
  }

  async verify(
    spec: PostgresProvisioningSpec,
    context: PostgresProvisionContext,
  ): Promise<PostgresProvisionStepResult> {
    validate(spec, context);
    if (context.mode === "dry_run") return step(spec, context, "verify", "planned", false);
    const probeName = quotePostgresIdentifier(
      `sdar_verify_${createHash("sha256").update(context.operationId).digest("hex").slice(0, 16)}`,
    );
    let runtime: ProvisioningSqlClient | undefined;
    try {
      runtime = await this.options.connections.connectRuntime(spec);
      const identity = await runtime.query<{ database_name: string; role_name: string }>(
        "SELECT current_database() AS database_name,current_user AS role_name",
      );
      if (
        identity.rows[0]?.database_name !== spec.databaseName ||
        identity.rows[0].role_name !== spec.runtimeRoleName
      ) {
        throw new PostgresProvisionerError("POSTGRES_VERIFICATION_FAILED", "verify");
      }
      await runtime.query(`CREATE TABLE public.${probeName}(probe integer NOT NULL)`);
      await runtime.query(`INSERT INTO public.${probeName}(probe) VALUES (1)`);
      await runtime.query(`SELECT probe FROM public.${probeName} WHERE probe=1`);
      await runtime.query(`DROP TABLE public.${probeName}`);
      return step(spec, context, "verify", "verified", false);
    } catch (error) {
      throw mappedError(error, "verify");
    } finally {
      if (runtime !== undefined) await this.options.connections.close(runtime);
    }
  }

  async delete(
    spec: PostgresProvisioningSpec,
    policy: PostgresDatabaseDeletionPolicy,
    context: PostgresProvisionContext,
  ): Promise<PostgresProvisionStepResult> {
    validate(spec, context);
    assertPostgresDatabaseDeletionPolicy(spec, policy);
    if (context.mode === "dry_run") return step(spec, context, "delete", "planned", false);
    try {
      await this.admin.query(
        `DROP DATABASE IF EXISTS ${quotePostgresIdentifier(spec.databaseName)}`,
      );
      await this.admin.query(
        `DROP ROLE IF EXISTS ${quotePostgresIdentifier(spec.runtimeRoleName)}`,
      );
      return step(spec, context, "delete", "deleted", true);
    } catch (error) {
      throw mappedError(error, "delete");
    }
  }
}

export function quotePostgresIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) {
    throw new PostgresProvisionerError("POSTGRES_INVALID_SPEC", "inspect");
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function validate(spec: PostgresProvisioningSpec, context: PostgresProvisionContext): void {
  validateSpec(spec);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(context.operationId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(context.idempotencyKey)
  ) {
    throw new PostgresProvisionerError("POSTGRES_INVALID_SPEC", "inspect");
  }
}

function validateSpec(spec: PostgresProvisioningSpec): void {
  for (const value of [spec.profileId, spec.providerId, spec.clusterRef]) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) invalidSpec();
  }
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(spec.environment)) invalidSpec();
  if (
    !/^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(spec.host) ||
    spec.host.includes("..")
  ) {
    invalidSpec();
  }
  if (!Number.isSafeInteger(spec.port) || spec.port < 1 || spec.port > 65_535) invalidSpec();
  quotePostgresIdentifier(spec.databaseName);
  quotePostgresIdentifier(spec.runtimeRoleName);
  if (
    typeof spec.adminSecretRef.secretRef !== "string" ||
    typeof spec.runtimeSecretRef.secretRef !== "string" ||
    spec.adminSecretRef.secretRef === spec.runtimeSecretRef.secretRef
  ) {
    invalidSpec();
  }
}

function invalidSpec(): never {
  throw new PostgresProvisionerError("POSTGRES_INVALID_SPEC", "inspect");
}

function step(
  spec: PostgresProvisioningSpec,
  context: PostgresProvisionContext,
  operation: PostgresProvisionStepResult["operation"],
  outcome: PostgresProvisionStepResult["outcome"],
  changed: boolean,
): PostgresProvisionStepResult {
  return Object.freeze({
    operationId: context.operationId,
    operation,
    outcome,
    changed,
    databaseName: spec.databaseName,
    runtimeRoleName: spec.runtimeRoleName,
  });
}

function mappedError(
  error: unknown,
  operation: PostgresProvisionStepResult["operation"],
): PostgresProvisionerError {
  if (error instanceof PostgresProvisionerError) return error;
  const code = databaseErrorCode(error);
  if (code === "42501")
    return new PostgresProvisionerError("POSTGRES_AUTHORIZATION_DENIED", operation);
  if (code === "28P01" || code === "28000") {
    return new PostgresProvisionerError("POSTGRES_AUTHENTICATION_FAILED", operation);
  }
  if (code === "55P03" || code === "57014") {
    return new PostgresProvisionerError("POSTGRES_LOCK_TIMEOUT", operation);
  }
  if (code === "42P04" || code === "42710" || code === "55006") {
    return new PostgresProvisionerError("POSTGRES_RESOURCE_CONFLICT", operation);
  }
  return new PostgresProvisionerError("POSTGRES_CONNECTION_FAILED", operation);
}

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}
