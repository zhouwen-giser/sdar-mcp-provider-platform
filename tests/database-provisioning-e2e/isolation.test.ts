import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresProvisioner,
  quotePostgresIdentifier,
  type ProvisioningSqlClient,
  type RuntimeCredentialRotationHook,
  type RuntimeDatabaseConnectionFactory,
} from "../../packages/postgres-provisioner/src/index.js";
import type {
  PostgresProvisionContext,
  PostgresProvisioningSpec,
} from "../../packages/runtime-deployment/src/index.js";
import { RuntimeMigrationRunner } from "../../packages/runtime-migration-runner/src/index.js";

describe("Runtime database credential isolation E2E", () => {
  const rootUrl = requiredDatabaseUrl();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const provisionerRole = `sdar_e2e_provision_${suffix}`;
  const pmsRole = `sdar_e2e_pms_${suffix}`;
  const provisionerSecret = `provision_${suffix}`;
  const pmsSecret = `pms_${suffix}`;
  const runtimeSecrets = {
    a: `runtime_a_${suffix}`,
    b: `runtime_b_${suffix}`,
  };
  const specs = {
    a: spec("a", suffix),
    b: spec("b", suffix),
  };
  const root = new Pool({ connectionString: rootUrl });
  let restricted: Pool;
  let provisioner: PostgresProvisioner;
  let completed = false;

  beforeAll(async () => {
    await root.query(
      `CREATE ROLE ${quotePostgresIdentifier(provisionerRole)}
       LOGIN CREATEDB CREATEROLE NOSUPERUSER NOREPLICATION
       PASSWORD ${quoteLiteral(provisionerSecret)}`,
    );
    await root.query(
      `CREATE ROLE ${quotePostgresIdentifier(pmsRole)}
       LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
       PASSWORD ${quoteLiteral(pmsSecret)}`,
    );
    restricted = new Pool({
      connectionString: connectionUrl(rootUrl, "postgres", provisionerRole, provisionerSecret),
    });
    provisioner = new PostgresProvisioner(poolClient(restricted), {
      connections: new TestConnections(rootUrl, provisionerRole, provisionerSecret, runtimeSecrets),
      credentialRotation: new RuntimeCredentialHook(runtimeSecrets),
    });
  });

  afterAll(async () => {
    await restricted.end().catch(() => undefined);
    for (const value of Object.values(specs)) {
      await root
        .query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
            WHERE datname=$1 AND pid <> pg_backend_pid()`,
          [value.databaseName],
        )
        .catch(() => undefined);
      await root
        .query(`DROP DATABASE IF EXISTS ${quotePostgresIdentifier(value.databaseName)}`)
        .catch(() => undefined);
      await root
        .query(`DROP ROLE IF EXISTS ${quotePostgresIdentifier(value.runtimeRoleName)}`)
        .catch(() => undefined);
    }
    await root
      .query(`DROP ROLE IF EXISTS ${quotePostgresIdentifier(pmsRole)}`)
      .catch(() => undefined);
    await root
      .query(`DROP ROLE IF EXISTS ${quotePostgresIdentifier(provisionerRole)}`)
      .catch(() => undefined);
    const resources = await root.query<{ databases: number; roles: number }>(
      `SELECT
         (SELECT count(*)::int FROM pg_database WHERE datname = ANY($1::text[])) AS databases,
         (SELECT count(*)::int FROM pg_roles WHERE rolname = ANY($2::text[])) AS roles`,
      [
        Object.values(specs).map(({ databaseName }) => databaseName),
        [
          provisionerRole,
          pmsRole,
          ...Object.values(specs).map(({ runtimeRoleName }) => runtimeRoleName),
        ],
      ],
    );
    const resourcesRow = resources.rows.at(0);
    if (resourcesRow === undefined) throw new Error("CLEANUP_VERIFICATION_MISSING");
    const cleanupVerified = resourcesRow.databases === 0 && resourcesRow.roles === 0;
    await writeEvidence(completed && cleanupVerified, cleanupVerified);
    await root.end();
  });

  it("isolates Provider A/B and PMS while allowing runtime-owned migrations", async () => {
    for (const [provider, value] of Object.entries(specs) as [
      keyof typeof specs,
      PostgresProvisioningSpec,
    ][]) {
      const apply = context(`provider-${provider}`);
      await provisioner.createRole(value, apply);
      await provisioner.createDatabase(value, apply);
      await provisioner.grantRuntimeAccess(value, apply);
      await provisioner.verify(value, apply);
      const runtime = new Pool({
        connectionString: connectionUrl(
          rootUrl,
          value.databaseName,
          value.runtimeRoleName,
          runtimeSecrets[provider],
        ),
      });
      try {
        const evidence = await new RuntimeMigrationRunner(runtime, {
          supportedRuntimeVersions: ["2.0.0-rc.1"],
          timeoutMs: 10_000,
          workspaceRoot: resolve(import.meta.dirname, "../.."),
        }).run({
          deploymentId: `deployment-${provider}`,
          providerId: `provider-${provider}`,
          runtimeVersion: "2.0.0-rc.1",
          migrationSet: "runtime",
        });
        expect(evidence).toMatchObject({ status: "PASS", migrationSet: "runtime" });
        expect(evidence.migrations).toHaveLength(25);
      } finally {
        await runtime.end();
      }
    }

    const runtimeAOnB = new Pool({
      connectionString: connectionUrl(
        rootUrl,
        specs.b.databaseName,
        specs.a.runtimeRoleName,
        runtimeSecrets.a,
      ),
    });
    const pmsOnA = new Pool({
      connectionString: connectionUrl(rootUrl, specs.a.databaseName, pmsRole, pmsSecret),
    });
    try {
      await expect(
        runtimeAOnB.query("SELECT * FROM operation_snapshot LIMIT 1"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(pmsOnA.query("SELECT * FROM operation_snapshot LIMIT 1")).rejects.toMatchObject({
        code: "42501",
      });
      await expect(
        pmsOnA.query("CREATE TABLE public.pms_must_not_create(marker integer)"),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await runtimeAOnB.end();
      await pmsOnA.end();
    }

    const runtimeRoles = await root.query<{
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolsuper: boolean;
    }>("SELECT rolcreatedb,rolcreaterole,rolsuper FROM pg_roles WHERE rolname = ANY($1::text[])", [
      Object.values(specs).map(({ runtimeRoleName }) => runtimeRoleName),
    ]);
    expect(runtimeRoles.rows).toHaveLength(2);
    expect(
      runtimeRoles.rows.every(
        ({ rolcreatedb, rolcreaterole, rolsuper }) => !rolcreatedb && !rolcreaterole && !rolsuper,
      ),
    ).toBe(true);
    completed = true;
  });
});

class RuntimeCredentialHook implements RuntimeCredentialRotationHook {
  constructor(private readonly secrets: Readonly<Record<"a" | "b", string>>) {}

  async ensureRuntimeCredential(
    spec: PostgresProvisioningSpec,
    _context: PostgresProvisionContext,
    admin: ProvisioningSqlClient,
  ): Promise<{ readonly changed: boolean }> {
    const provider = spec.providerId.endsWith("-a") ? "a" : "b";
    await admin.query(
      `ALTER ROLE ${quotePostgresIdentifier(spec.runtimeRoleName)}
       PASSWORD ${quoteLiteral(this.secrets[provider])}`,
    );
    return { changed: true };
  }
}

class TestConnections implements RuntimeDatabaseConnectionFactory {
  constructor(
    private readonly rootUrl: string,
    private readonly provisionerRole: string,
    private readonly provisionerSecret: string,
    private readonly runtimeSecrets: Readonly<Record<"a" | "b", string>>,
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

  connectRuntime(specification: PostgresProvisioningSpec): Promise<ProvisioningSqlClient> {
    const provider = specification.providerId.endsWith("-a") ? "a" : "b";
    return Promise.resolve(
      poolClient(
        new Pool({
          connectionString: connectionUrl(
            this.rootUrl,
            specification.databaseName,
            specification.runtimeRoleName,
            this.runtimeSecrets[provider],
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

function spec(provider: "a" | "b", suffix: string): PostgresProvisioningSpec {
  return {
    profileId: `profile-${provider}-${suffix}`,
    providerId: `provider-${provider}`,
    environment: "production",
    clusterRef: "postgres-e2e",
    host: "127.0.0.1",
    port: 5432,
    databaseMode: "provisioned",
    databaseName: `sdar_e2e_${provider}_${suffix}`,
    runtimeRoleName: `sdar_e2e_${provider}_${suffix}_app`,
    sslMode: "disable",
    adminSecretRef: { secretRef: "test/provisioner" },
    runtimeSecretRef: { secretRef: `test/runtime/${provider}` },
  };
}

function context(provider: string): PostgresProvisionContext {
  return {
    operationId: `e2e-${provider}`,
    idempotencyKey: `e2e-${provider}`,
    mode: "apply",
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

async function writeEvidence(pass: boolean, cleanupVerified: boolean): Promise<void> {
  const report = {
    schemaVersion: 1,
    taskId: "G2-P2-B08",
    status: pass ? "PASS" : "FAIL",
    verificationKind: "local-postgresql-e2e",
    assertions: {
      providerDatabasesProvisioned: pass,
      providerACannotReadProviderB: pass,
      pmsCannotReadOrCreateInRuntimeDatabase: pass,
      runtimeMigrationsApplied: pass,
      secretsRedacted: true,
      cleanupVerified,
    },
    secretOutput: "<redacted>",
  };
  const directory = resolve(import.meta.dirname, "../../reports/evidence");
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "G2-P2-B08-database-isolation.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
}
