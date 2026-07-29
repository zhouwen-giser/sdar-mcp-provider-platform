import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  assertPostgresDatabaseDeletionPolicy,
  type PostgresDatabaseDeletionPolicy,
  type PostgresProvisionContext,
  type PostgresProvisioningSpec,
} from "@sdar/runtime-deployment";
import {
  PostgresProvisioner,
  quotePostgresIdentifier,
  type ProvisioningSqlClient,
  type RuntimeCredentialRotationHook,
  type RuntimeDatabaseConnectionFactory,
} from "../src/index.js";

describe("PostgresProvisioner input safety", () => {
  it.each([
    'runtime"; DROP DATABASE postgres; --',
    "RuntimeUppercase",
    "runtime-name",
    "_runtime",
    "r".repeat(64),
  ])("rejects unsafe SQL identifier %s", (identifier) => {
    expect(() => quotePostgresIdentifier(identifier)).toThrow(
      expect.objectContaining({ code: "POSTGRES_INVALID_SPEC", retryable: false }),
    );
  });

  it("does not execute SQL for an injected spec or dry-run operation", async () => {
    const query = vi.fn();
    const provisioner = new PostgresProvisioner(
      { query },
      {
        credentialRotation: { ensureRuntimeCredential: vi.fn() },
        connections: {
          connectRuntime: vi.fn(),
          connectDatabase: vi.fn(),
          close: vi.fn(),
        },
      },
    );
    const injected = {
      ...baseSpec("unit"),
      databaseName: 'runtime"; DROP DATABASE postgres; --',
    };

    await expect(provisioner.createDatabase(injected, context("unit"))).rejects.toMatchObject({
      code: "POSTGRES_INVALID_SPEC",
    });
    expect(query).not.toHaveBeenCalled();
    expect(await provisioner.createDatabase(baseSpec("unit"), context("unit"))).toMatchObject({
      outcome: "planned",
      changed: false,
    });
    expect(query).not.toHaveBeenCalled();
  });
});

describe("PostgresProvisioner controlled PostgreSQL integration", () => {
  const rootUrl = requiredDatabaseUrl();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const provisionerRole = `sdar_provision_${suffix}`;
  const runtimeSecret = `test_runtime_${suffix}`;
  const provisionerSecret = `test_provision_${suffix}`;
  const spec = baseSpec(suffix);
  const root = new Pool({ connectionString: rootUrl });
  let restricted: Pool | undefined;
  let provisioner: PostgresProvisioner | undefined;

  beforeAll(async () => {
    await root.query(
      `CREATE ROLE ${quotePostgresIdentifier(provisionerRole)}
       LOGIN CREATEDB CREATEROLE NOSUPERUSER NOREPLICATION
       PASSWORD ${quoteLiteral(provisionerSecret)}`,
    );
    restricted = new Pool({
      connectionString: connectionUrl(rootUrl, "postgres", provisionerRole, provisionerSecret),
    });
    const connections = new TestConnections(
      rootUrl,
      provisionerRole,
      provisionerSecret,
      runtimeSecret,
    );
    provisioner = new PostgresProvisioner(poolClient(restricted), {
      connections,
      credentialRotation: new IdempotentCredentialHook(runtimeSecret),
    });
  });

  afterAll(async () => {
    if (provisioner !== undefined) {
      const policy = deletionPolicy(spec);
      await provisioner
        .delete(spec, policy, { ...context("cleanup"), mode: "apply" })
        .catch(() => undefined);
    }
    if (restricted !== undefined) await restricted.end();
    await root.query(`DROP ROLE IF EXISTS ${quotePostgresIdentifier(provisionerRole)}`);
    await root.end();
  });

  it("creates role/database/grants with a restricted admin and replays idempotently", async () => {
    const subject = requireProvisioner(provisioner);
    const apply = { ...context("apply"), mode: "apply" as const };
    expect(await subject.inspect(spec)).toMatchObject({
      databaseExists: false,
      runtimeRoleExists: false,
      runtimeAccessGranted: false,
    });
    const role = await subject.createRole(spec, apply);
    const roleReplay = await subject.createRole(spec, apply);
    const database = await subject.createDatabase(spec, apply);
    const databaseReplay = await subject.createDatabase(spec, apply);
    const grant = await subject.grantRuntimeAccess(spec, apply);
    const grantReplay = await subject.grantRuntimeAccess(spec, apply);
    const verified = await subject.verify(spec, apply);
    const inspection = await subject.inspect(spec);

    expect(role).toMatchObject({ outcome: "created", changed: true });
    expect(roleReplay).toMatchObject({ outcome: "exists", changed: false });
    expect(database).toMatchObject({ outcome: "created", changed: true });
    expect(databaseReplay).toMatchObject({ outcome: "exists", changed: false });
    expect(grant).toMatchObject({ outcome: "updated", changed: true });
    expect(grantReplay).toMatchObject({ outcome: "exists", changed: false });
    expect(verified).toMatchObject({ outcome: "verified", changed: false });
    expect(inspection).toMatchObject({
      databaseExists: true,
      runtimeRoleExists: true,
      runtimeAccessGranted: true,
    });

    const roles = await root.query<{
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
    }>("SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=$1", [
      spec.runtimeRoleName,
    ]);
    expect(roles.rows).toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false }]);
    expect(JSON.stringify({ role, database, grant, verified, inspection })).not.toContain(
      runtimeSecret,
    );
    expect(JSON.stringify(inspection)).not.toContain(provisionerSecret);
  });

  it("requires an exact explicit deletion policy", async () => {
    const subject = requireProvisioner(provisioner);
    const policy = deletionPolicy(spec);
    expect(() => assertPostgresDatabaseDeletionPolicy(spec, policy)).not.toThrow();
    await expect(
      subject.delete(
        spec,
        { ...policy, providerId: "another-provider" },
        { ...context("delete-rejected"), mode: "apply" },
      ),
    ).rejects.toMatchObject({ code: "POSTGRES_DELETE_POLICY_REQUIRED" });
  });
});

class IdempotentCredentialHook implements RuntimeCredentialRotationHook {
  readonly #completed = new Set<string>();

  constructor(private readonly runtimeSecret: string) {}

  async ensureRuntimeCredential(
    spec: PostgresProvisioningSpec,
    request: PostgresProvisionContext,
    admin: ProvisioningSqlClient,
  ) {
    if (this.#completed.has(request.idempotencyKey)) return { changed: false };
    await admin.query(
      `ALTER ROLE ${quotePostgresIdentifier(spec.runtimeRoleName)}
       PASSWORD ${quoteLiteral(this.runtimeSecret)}`,
    );
    this.#completed.add(request.idempotencyKey);
    return { changed: true };
  }
}

class TestConnections implements RuntimeDatabaseConnectionFactory {
  constructor(
    private readonly rootUrl: string,
    private readonly provisionerRole: string,
    private readonly provisionerSecret: string,
    private readonly runtimeSecret: string,
  ) {}

  connectDatabase(databaseName: string): Promise<ProvisioningSqlClient> {
    return Promise.resolve(
      poolClient(
        new Pool({
          connectionString: connectionUrl(
            this.rootUrl,
            databaseName,
            this.provisionerRole,
            this.provisionerSecret,
          ),
        }),
      ),
    );
  }

  connectRuntime(spec: PostgresProvisioningSpec): Promise<ProvisioningSqlClient> {
    return Promise.resolve(
      poolClient(
        new Pool({
          connectionString: connectionUrl(
            this.rootUrl,
            spec.databaseName,
            spec.runtimeRoleName,
            this.runtimeSecret,
          ),
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

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ) {
    return this.pool.query<Row>(sql, values === undefined ? [] : [...values]);
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

function poolClient(pool: Pool): ProvisioningSqlClient {
  return new PoolClientAdapter(pool);
}

function baseSpec(suffix: string): PostgresProvisioningSpec {
  return {
    profileId: `database-profile-${suffix}`,
    providerId: `provider:${suffix}`,
    environment: "production",
    clusterRef: "postgres-primary",
    host: "127.0.0.1",
    port: 5432,
    databaseMode: "provisioned",
    databaseName: `sdar_rt_${suffix}`,
    runtimeRoleName: `sdar_rt_${suffix}_app`,
    sslMode: "disable",
    adminSecretRef: { secretRef: "test/postgres/provisioner" },
    runtimeSecretRef: { secretRef: `test/runtime/${suffix}` },
  };
}

function context(suffix: string): PostgresProvisionContext {
  return {
    operationId: `operation-${suffix}`,
    idempotencyKey: `provision:${suffix}`,
    mode: "dry_run",
  };
}

function deletionPolicy(spec: PostgresProvisioningSpec): PostgresDatabaseDeletionPolicy {
  return {
    kind: "explicit-provider-database-delete",
    profileId: spec.profileId,
    providerId: spec.providerId,
    environment: spec.environment,
    databaseName: spec.databaseName,
    runtimeRoleName: spec.runtimeRoleName,
    reason: "integration test cleanup",
  };
}

function connectionUrl(source: string, databaseName: string, user: string, secret: string): string {
  const value = new URL(source);
  value.pathname = `/${databaseName}`;
  value.username = user;
  value.password = secret;
  return value.toString();
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("TEST_DATABASE_URL is required");
  return value;
}

function requireProvisioner(value: PostgresProvisioner | undefined): PostgresProvisioner {
  if (value === undefined) throw new Error("POSTGRES_PROVISIONER_TEST_SETUP_INCOMPLETE");
  return value;
}
