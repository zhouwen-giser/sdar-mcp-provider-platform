import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type QueryResultRow } from "pg";
import {
  RuntimeDatabasePreparationJob,
  type RuntimeDatabasePreparationAuditEvent,
  type RuntimeDatabasePreparationCheckpoint,
  type RuntimeDatabasePreparationStore,
  type RuntimeDatabaseSecretPort,
} from "@sdar/pms-application";
import {
  PostgresDatabaseProfileRepository,
  PostgresRuntimeDeploymentRepository,
} from "@sdar/pms-persistence-postgres";
import {
  PostgresProvisioner,
  type ProvisioningSqlClient,
  type RuntimeDatabaseConnectionFactory,
  type RuntimeCredentialRotationHook,
} from "@sdar/postgres-provisioner";
import { RuntimeMigrationRunner } from "@sdar/runtime-migration-runner";
import { FileSecretStore } from "@sdar/secret-store";
import type {
  PostgresProvisionContext,
  PostgresProvisioningSpec,
  RuntimeDeploymentSnapshot,
} from "@sdar/runtime-deployment";

interface ProvisioningCredentials {
  readonly clusterRef: string;
  readonly adminSecretRef: string;
  readonly adminDatabaseUrl: string;
  readonly runtimePassword: string;
}

interface CheckpointRow extends QueryResultRow {
  result_details: {
    readonly completedSteps?: unknown;
    readonly revision?: unknown;
    readonly lastErrorCode?: unknown;
  };
}

export interface RuntimeDatabasePreparationResources {
  readonly job: RuntimeDatabasePreparationJob;
  readonly provisioner: PostgresProvisioner;
  readonly credentialResolver: RuntimeDatabaseSecretPort;
  readonly migrationRunner: object;
  readonly secretStore: FileSecretStore;
  close(): Promise<void>;
}

export async function createRuntimeDatabasePreparation(
  pool: Pool,
  options: {
    readonly credentialFile: string;
    readonly secretRoot: string;
    readonly workspaceRoot: string;
    readonly migrationTimeoutMs: number;
    readonly supportedRuntimeVersions: readonly string[];
  },
): Promise<RuntimeDatabasePreparationResources> {
  const credentials = await loadProvisioningCredentials(options.credentialFile);
  const admin = new Pool({
    connectionString: credentials.adminDatabaseUrl,
  });
  const connections = new ProvisioningConnections(credentials);
  const secrets = new FileSecretStore(options.secretRoot);
  const store = new PostgresRuntimeDatabasePreparationStore(pool);
  const credentialService = new RuntimeCredentialService(pool, secrets, credentials);
  const provisioner = new PostgresProvisioner(admin, {
    credentialRotation: new RuntimeCredentialRotation(credentials),
    connections,
  });
  const migrations = new PerDeploymentRuntimeMigration(
    pool,
    secrets,
    options.workspaceRoot,
    options.migrationTimeoutMs,
    options.supportedRuntimeVersions,
  );
  return {
    job: new RuntimeDatabasePreparationJob(store, provisioner, credentialService, migrations),
    provisioner,
    credentialResolver: credentialService,
    migrationRunner: migrations,
    secretStore: secrets,
    async close(): Promise<void> {
      await admin.end();
    },
  };
}

class PostgresRuntimeDatabasePreparationStore implements RuntimeDatabasePreparationStore {
  readonly #deployments: PostgresRuntimeDeploymentRepository;
  readonly #profiles: PostgresDatabaseProfileRepository;

  constructor(private readonly pool: Pool) {
    this.#deployments = new PostgresRuntimeDeploymentRepository(pool);
    this.#profiles = new PostgresDatabaseProfileRepository(pool);
  }

  getDeployment(providerId: string, deploymentId: string) {
    return this.#deployments.get(providerId, deploymentId);
  }

  saveDeployment(
    value: RuntimeDeploymentSnapshot,
    precondition: {
      readonly expectedDesiredRevision: number;
      readonly expectedObservedRevision: number;
    },
  ) {
    return this.#deployments.save(value, precondition);
  }

  async getDatabaseProfile(providerId: string, environment: string) {
    return (await this.#profiles.get(providerId, environment))?.profile ?? null;
  }

  async getCheckpoint(deploymentId: string): Promise<RuntimeDatabasePreparationCheckpoint | null> {
    const result = await this.pool.query<CheckpointRow>(
      `SELECT result_details
         FROM runtime_deployment_action
        WHERE deployment_id=$1 AND action_type='RUNTIME_DATABASE_PREPARATION_CHECKPOINT'
        ORDER BY resulting_revision DESC,occurred_at DESC
        LIMIT 1`,
      [deploymentId],
    );
    const details = result.rows[0]?.result_details;
    if (
      details === undefined ||
      !Array.isArray(details.completedSteps) ||
      !Number.isSafeInteger(details.revision)
    ) {
      return null;
    }
    return Object.freeze({
      deploymentId,
      completedSteps: Object.freeze(details.completedSteps.map(String)) as never,
      revision: details.revision as number,
      ...(typeof details.lastErrorCode === "string"
        ? { lastErrorCode: details.lastErrorCode as never }
        : {}),
    });
  }

  async saveCheckpoint(
    checkpoint: RuntimeDatabasePreparationCheckpoint,
    expectedRevision: number,
  ): Promise<void> {
    if (checkpoint.revision !== expectedRevision + 1) {
      throw new Error("RUNTIME_DATABASE_CHECKPOINT_REVISION_CONFLICT");
    }
    const result = await this.pool.query(
      `INSERT INTO runtime_deployment_action(
         action_id,deployment_id,action_type,idempotency_key,status,
         expected_revision,resulting_revision,result_details,actor_id,correlation_id,
         occurred_at,completed_at
       )
       SELECT $1,$2,'RUNTIME_DATABASE_PREPARATION_CHECKPOINT',$3,'succeeded',
              $4,$5,$6::jsonb,'pms-worker',$3,clock_timestamp(),clock_timestamp()
         FROM runtime_deployment
        WHERE deployment_id=$2
          AND NOT EXISTS (
            SELECT 1 FROM runtime_deployment_action
             WHERE deployment_id=$2
               AND action_type='RUNTIME_DATABASE_PREPARATION_CHECKPOINT'
               AND resulting_revision>$4
          )
       ON CONFLICT (deployment_id,idempotency_key) DO NOTHING`,
      [
        randomUUID(),
        checkpoint.deploymentId,
        `database-checkpoint:${checkpoint.deploymentId}:${String(checkpoint.revision)}`,
        expectedRevision,
        checkpoint.revision,
        JSON.stringify({
          completedSteps: checkpoint.completedSteps,
          revision: checkpoint.revision,
          ...(checkpoint.lastErrorCode === undefined
            ? {}
            : { lastErrorCode: checkpoint.lastErrorCode }),
        }),
      ],
    );
    if (result.rowCount !== 1) {
      const replay = await this.getCheckpoint(checkpoint.deploymentId);
      if (replay?.revision !== checkpoint.revision) {
        throw new Error("RUNTIME_DATABASE_CHECKPOINT_REVISION_CONFLICT");
      }
    }
  }

  async appendAudit(event: RuntimeDatabasePreparationAuditEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit(
         audit_event_id,action,actor_id,correlation_id,subject_type,subject_id,metadata
       ) VALUES ($1,$2,'pms-worker',$3,'runtime_deployment',$4,$5::jsonb)`,
      [
        randomUUID(),
        event.action,
        event.operationId,
        event.deploymentId,
        JSON.stringify({
          providerId: event.providerId,
          ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
        }),
      ],
    );
  }
}

class RuntimeCredentialService implements RuntimeDatabaseSecretPort {
  readonly #deployments: PostgresRuntimeDeploymentRepository;
  readonly #profiles: PostgresDatabaseProfileRepository;

  constructor(
    private readonly pool: Pool,
    private readonly secrets: FileSecretStore,
    private readonly credentials: ProvisioningCredentials,
  ) {
    this.#deployments = new PostgresRuntimeDeploymentRepository(pool);
    this.#profiles = new PostgresDatabaseProfileRepository(pool);
  }

  async ensureRuntimeCredential(input: {
    readonly deploymentId: string;
    readonly instanceId: "database";
    readonly secretRef: string;
    readonly operationId: string;
  }): Promise<{ readonly secretRef: string }> {
    const provider = await this.pool.query<{ provider_id: string }>(
      "SELECT provider_id FROM runtime_deployment WHERE deployment_id=$1",
      [input.deploymentId],
    );
    const providerId = provider.rows[0]?.provider_id;
    if (providerId === undefined) throw new Error("RUNTIME_DATABASE_DEPLOYMENT_NOT_FOUND");
    const deployment = await this.#deployments.get(providerId, input.deploymentId);
    if (deployment === null) throw new Error("RUNTIME_DATABASE_DEPLOYMENT_NOT_FOUND");
    const profile = await this.#profiles.get(
      String(deployment.snapshot.providerId),
      String(deployment.snapshot.environment),
    );
    if (profile === null) throw new Error("RUNTIME_DATABASE_PROFILE_NOT_FOUND");
    assertCredentialAuthority(profile.profile, this.credentials);
    const expectedSecretRef = `file/v1/${input.deploymentId}/${input.instanceId}/runtime`;
    if (input.secretRef !== expectedSecretRef) {
      throw new Error("RUNTIME_DATABASE_SECRET_REF_MISMATCH");
    }
    const written = await this.secrets.write({
      deploymentId: input.deploymentId,
      instanceId: input.instanceId,
      name: "runtime",
      content: runtimeDatabaseUrl(profile.profile, this.credentials.runtimePassword),
    });
    if (written.secretRef !== expectedSecretRef) {
      throw new Error("RUNTIME_DATABASE_SECRET_REF_MISMATCH");
    }
    return written;
  }
}

class RuntimeCredentialRotation implements RuntimeCredentialRotationHook {
  constructor(private readonly credentials: ProvisioningCredentials) {}

  async ensureRuntimeCredential(
    spec: PostgresProvisioningSpec,
    _context: PostgresProvisionContext,
    admin: ProvisioningSqlClient,
  ): Promise<{ readonly changed: boolean }> {
    assertCredentialAuthority(spec, this.credentials);
    const command = await admin.query<{ statement: string }>(
      "SELECT format('ALTER ROLE %I PASSWORD %L',$1,$2) AS statement",
      [spec.runtimeRoleName, this.credentials.runtimePassword],
    );
    const statement = command.rows[0]?.statement;
    if (statement === undefined) throw new Error("POSTGRES_CREDENTIAL_ROTATION_FAILED");
    await admin.query(statement);
    return { changed: true };
  }
}

class ProvisioningConnections implements RuntimeDatabaseConnectionFactory {
  constructor(private readonly credentials: ProvisioningCredentials) {}

  connectDatabase(databaseName: string): Promise<ProvisioningSqlClient> {
    return Promise.resolve(
      new PoolClientAdapter(
        new Pool({
          connectionString: replaceDatabase(this.credentials.adminDatabaseUrl, databaseName),
        }),
      ),
    );
  }

  connectRuntime(spec: PostgresProvisioningSpec): Promise<ProvisioningSqlClient> {
    return Promise.resolve(
      new PoolClientAdapter(
        new Pool({
          connectionString: runtimeDatabaseUrl(spec, this.credentials.runtimePassword),
        }),
      ),
    );
  }

  async close(client: ProvisioningSqlClient): Promise<void> {
    await (client as PoolClientAdapter).close();
  }
}

class PoolClientAdapter implements ProvisioningSqlClient {
  constructor(private readonly pool: Pool) {}

  query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]) {
    return this.pool.query<Row>(sql, values === undefined ? [] : [...values]);
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

class PerDeploymentRuntimeMigration {
  readonly #deployments: PostgresRuntimeDeploymentRepository;

  constructor(
    pool: Pool,
    private readonly secrets: FileSecretStore,
    private readonly workspaceRoot: string,
    private readonly timeoutMs: number,
    private readonly supportedRuntimeVersions: readonly string[],
  ) {
    this.#deployments = new PostgresRuntimeDeploymentRepository(pool);
  }

  async run(input: {
    readonly deploymentId: string;
    readonly providerId: string;
    readonly runtimeVersion: string;
    readonly migrationSet: "runtime";
  }): Promise<unknown> {
    const deployment = await this.#deployments.get(input.providerId, input.deploymentId);
    if (deployment === null) throw new Error("RUNTIME_DATABASE_DEPLOYMENT_NOT_FOUND");
    const secret = await this.secrets.read({
      secretRef: `file/v1/${input.deploymentId}/database/runtime`,
    });
    const url = Buffer.from(secret).toString("utf8");
    secret.fill(0);
    const runtimePool = new Pool({ connectionString: url });
    try {
      return await new RuntimeMigrationRunner(runtimePool, {
        supportedRuntimeVersions: this.supportedRuntimeVersions,
        timeoutMs: this.timeoutMs,
        workspaceRoot: this.workspaceRoot,
      }).run(input);
    } finally {
      await runtimePool.end();
    }
  }
}

async function loadProvisioningCredentials(path: string): Promise<ProvisioningCredentials> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error("PMS_POSTGRES_PROVISIONING_CREDENTIAL_INVALID", { cause: error });
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("adminDatabaseUrl" in value) ||
    typeof value.adminDatabaseUrl !== "string" ||
    !("adminSecretRef" in value) ||
    typeof value.adminSecretRef !== "string" ||
    !("clusterRef" in value) ||
    typeof value.clusterRef !== "string" ||
    !("runtimePassword" in value) ||
    typeof value.runtimePassword !== "string" ||
    value.runtimePassword.length < 16 ||
    value.clusterRef.trim().length === 0 ||
    value.adminSecretRef.trim().length === 0 ||
    Object.keys(value).some(
      (key) =>
        !["clusterRef", "adminSecretRef", "adminDatabaseUrl", "runtimePassword"].includes(key),
    )
  ) {
    throw new Error("PMS_POSTGRES_PROVISIONING_CREDENTIAL_INVALID");
  }
  const url = new URL(value.adminDatabaseUrl);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("PMS_POSTGRES_PROVISIONING_CREDENTIAL_INVALID");
  }
  return Object.freeze({
    clusterRef: value.clusterRef,
    adminSecretRef: value.adminSecretRef,
    adminDatabaseUrl: url.toString(),
    runtimePassword: value.runtimePassword,
  });
}

function assertCredentialAuthority(
  profile: {
    readonly clusterRef: string;
    readonly adminSecretRef: { readonly secretRef: string };
    readonly host: string;
    readonly port: number;
  },
  credentials: ProvisioningCredentials,
): void {
  const admin = new URL(credentials.adminDatabaseUrl);
  const port = admin.port.length === 0 ? 5432 : Number(admin.port);
  if (
    profile.clusterRef !== credentials.clusterRef ||
    profile.adminSecretRef.secretRef !== credentials.adminSecretRef ||
    profile.host !== admin.hostname ||
    profile.port !== port
  ) {
    throw new Error("PMS_POSTGRES_PROVISIONING_AUTHORITY_MISMATCH");
  }
}

function runtimeDatabaseUrl(
  profile: {
    readonly host: string;
    readonly port: number;
    readonly databaseName: string;
    readonly runtimeRoleName: string;
    readonly sslMode: string;
  },
  password: string,
): string {
  const url = new URL("postgresql://localhost");
  url.hostname = profile.host;
  url.port = String(profile.port);
  url.pathname = `/${encodeURIComponent(profile.databaseName)}`;
  url.username = profile.runtimeRoleName;
  url.password = password;
  url.searchParams.set("sslmode", profile.sslMode);
  return url.toString();
}

function replaceDatabase(source: string, databaseName: string): string {
  const url = new URL(source);
  url.pathname = `/${encodeURIComponent(databaseName)}`;
  return url.toString();
}
