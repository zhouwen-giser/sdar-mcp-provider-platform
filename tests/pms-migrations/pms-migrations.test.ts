import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveMigrationSet } from "../../packages/database-migration-runner/src/index.js";

const EXPECTED_TABLES = [
  "audit",
  "config_ack",
  "config_definition",
  "config_revision",
  "database_profile",
  "job_lease",
  "pms_schema_migration",
  "provider",
  "provider_package",
  "provider_resource_binding",
  "provider_type",
  "resource",
  "runtime_deployment",
  "runtime_deployment_action",
  "runtime_process",
] as const;

const RUNTIME_TABLES = [
  "provider_task",
  "task_command",
  "task_input_request",
  "task_observation",
  "admission_intent",
  "operation_snapshot",
  "outbox_event",
  "runtime_schema_migration",
] as const;

describe("PMS control-plane migration set", () => {
  const pool = new Pool({ connectionString: requiredDatabaseUrl() });
  const schema = `pms_migration_${randomUUID().replaceAll("-", "")}`;
  let client: PoolClient;

  beforeAll(async () => {
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
  });

  afterAll(async () => {
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
    await pool.end();
  });

  it("resolves only the append-only PMS migration set", async () => {
    const files = await resolveMigrationSet(process.cwd(), "pms");

    expect(files.map(({ filename }) => filename)).toEqual([
      "001_control_plane_foundation.sql",
      "002_provider_package_source_projection.sql",
      "003_audit_append_only.sql",
      "004_config_revision_history_guard.sql",
      "005_runtime_deployment.sql",
      "006_database_profile.sql",
    ]);
    expect(files.every(({ relativePath }) => relativePath.startsWith("migrations/pms/"))).toBe(
      true,
    );
  });

  it("creates an empty schema and is safe to apply repeatedly", async () => {
    const files = await resolveMigrationSet(process.cwd(), "pms");
    const sql = await Promise.all(files.map(({ absolutePath }) => readFile(absolutePath, "utf8")));

    for (const migration of sql) await client.query(migration);
    for (const migration of sql) await client.query(migration);

    const tables = await client.query<{ tablename: string }>(
      `SELECT tablename
         FROM pg_tables
        WHERE schemaname = $1
        ORDER BY tablename`,
      [schema],
    );
    expect(tables.rows.map(({ tablename }) => tablename)).toEqual(EXPECTED_TABLES);
  });

  it("upgrades an existing migration-004 PMS schema without losing control-plane rows", async () => {
    const upgradeSchema = `pms_upgrade_${randomUUID().replaceAll("-", "")}`;
    const files = await resolveMigrationSet(process.cwd(), "pms");
    const sql = await Promise.all(files.map(({ absolutePath }) => readFile(absolutePath, "utf8")));

    await client.query(`CREATE SCHEMA ${upgradeSchema}`);
    try {
      await client.query(`SET search_path TO ${upgradeSchema}`);
      for (const migration of sql.slice(0, 4)) await client.query(migration);
      await client.query(
        `INSERT INTO provider_type(provider_type_id, display_name, status)
         VALUES ('isr.vehicle.ugv', 'UGV', 'active')`,
      );
      await client.query(
        `INSERT INTO provider(provider_id, provider_type_id, hosting_mode, status)
         VALUES ('provider:upgrade', 'isr.vehicle.ugv', 'vendor_managed', 'active')`,
      );

      const runtimeDeploymentMigration = sql[4];
      if (runtimeDeploymentMigration === undefined) {
        throw new Error("runtime deployment migration is missing");
      }
      await client.query(runtimeDeploymentMigration);

      const result = await client.query<{ provider_id: string }>(
        `SELECT provider_id FROM provider WHERE provider_id = 'provider:upgrade'`,
      );
      expect(result.rows).toEqual([{ provider_id: "provider:upgrade" }]);
      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = $1
            AND table_name = ANY($2::text[])
          ORDER BY table_name`,
        [upgradeSchema, ["runtime_deployment", "runtime_process", "runtime_deployment_action"]],
      );
      expect(tables.rows.map(({ table_name }) => table_name)).toEqual([
        "runtime_deployment",
        "runtime_deployment_action",
        "runtime_process",
      ]);
    } finally {
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`DROP SCHEMA IF EXISTS ${upgradeSchema} CASCADE`);
    }
  });

  it("contains no Runtime Task Authority business tables", async () => {
    const result = await client.query<{ tablename: string }>(
      `SELECT tablename
         FROM pg_tables
        WHERE schemaname = $1
          AND tablename = ANY($2::text[])`,
      [schema, RUNTIME_TABLES],
    );

    expect(result.rows).toEqual([]);
  });

  it("enforces UUID, checksum, JSON object, and lease-shape constraints", async () => {
    await client.query(
      `INSERT INTO provider_type(provider_type_id, display_name, status)
       VALUES ('isr.vehicle.ugv', 'UGV', 'active')`,
    );

    await expect(
      client.query(
        `INSERT INTO provider_package(
           package_id, package_version, provider_type_id, hosting_modes,
           adapter_entry, config_schema, qualification, checksum, status
         ) VALUES (
           'builtin.isr.vehicle.ugv', '1.0.0', 'isr.vehicle.ugv',
           ARRAY['vendor_managed'], '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
           repeat('a', 64), 'available'
         )`,
      ),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      client.query(
        `INSERT INTO audit(
           audit_event_id, action, actor_id, correlation_id, subject_type, subject_id
         ) VALUES (
           'not-a-uuid', 'provider.created', 'admin', 'request-1', 'provider', 'provider-1'
         )`,
      ),
    ).rejects.toMatchObject({ code: "22P02" });

    await expect(
      client.query(
        `INSERT INTO job_lease(job_id, job_type, payload, status)
         VALUES ('job-1', 'config.publish', '{}'::jsonb, 'leased')`,
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("enforces RuntimeDeployment provider, revision, identity, port, and action constraints", async () => {
    await client.query(
      `INSERT INTO provider(
         provider_id, provider_type_id, hosting_mode, status
       ) VALUES (
         'provider:ugv1', 'isr.vehicle.ugv', 'vendor_managed', 'active'
       ) ON CONFLICT (provider_id) DO NOTHING`,
    );

    await expect(
      client.query(
        `INSERT INTO runtime_deployment(
           deployment_id, provider_id, environment, desired_state, desired_replicas,
           runtime_version, database_profile_id, config_profile_id, status
         ) VALUES (
           'deployment-missing-provider', 'provider:missing', 'production', 'running', 1,
           '2.0.0-rc.1', 'db-profile-1', 'config-profile-1', 'REQUESTED'
         )`,
      ),
    ).rejects.toMatchObject({ code: "23503" });

    await expect(
      client.query(
        `INSERT INTO runtime_deployment(
           deployment_id, provider_id, environment, desired_state, desired_replicas,
           runtime_version, database_profile_id, config_profile_id, status
         ) VALUES (
           'deployment-invalid-replicas', 'provider:ugv1', 'production', 'running', 0,
           '2.0.0-rc.1', 'db-profile-1', 'config-profile-1', 'REQUESTED'
         )`,
      ),
    ).rejects.toMatchObject({ code: "23514" });

    await client.query(
      `INSERT INTO runtime_deployment(
         deployment_id, provider_id, environment, desired_state, desired_replicas,
         runtime_version, database_profile_id, config_profile_id, status
       ) VALUES (
         'deployment-1', 'provider:ugv1', 'production', 'running', 1,
         '2.0.0-rc.1', 'db-profile-1', 'config-profile-1', 'REQUESTED'
       )`,
    );
    await client.query(
      `INSERT INTO runtime_process(
         runtime_instance_id, deployment_id, environment, pm2_name, pid, port,
         process_state, liveness_state, readiness_state, registration_state,
         catalog_state, config_state
       ) VALUES (
         'instance-01', 'deployment-1', 'production', 'sdar-runtime-production-ugv-01',
         101, 30001, 'online', 'live', 'ready', 'registered', 'valid', 'current'
       )`,
    );

    await expect(
      client.query(
        `INSERT INTO runtime_process(
           runtime_instance_id, deployment_id, environment, pm2_name, port,
           process_state, liveness_state, readiness_state, registration_state,
           catalog_state, config_state
         ) VALUES (
           'instance-02', 'deployment-1', 'production', 'sdar-runtime-production-ugv-01',
           30002, 'starting', 'unknown', 'unknown', 'unregistered', 'unknown', 'unknown'
         )`,
      ),
    ).rejects.toMatchObject({ code: "23505" });

    await client.query(
      `INSERT INTO runtime_deployment_action(
         action_id, deployment_id, runtime_instance_id, action_type, idempotency_key,
         status, expected_revision, resulting_revision, actor_id, correlation_id, completed_at
       ) VALUES (
         '11111111-1111-4111-8111-111111111111', 'deployment-1', 'instance-01',
         'START', 'start-revision-0', 'succeeded', 0, 1, 'admin-1', 'request-1',
         clock_timestamp()
       )`,
    );
    await expect(
      client.query(
        `INSERT INTO runtime_deployment_action(
           action_id, deployment_id, action_type, idempotency_key,
           status, actor_id, correlation_id, completed_at
         ) VALUES (
           '22222222-2222-4222-8222-222222222222', 'deployment-1',
           'START', 'start-revision-0', 'noop', 'admin-1', 'request-2',
           clock_timestamp()
         )`,
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("enforces scoped SecretRef-only DatabaseProfile and audited result constraints", async () => {
    await client.query(
      `INSERT INTO provider_type(provider_type_id,display_name,status)
       VALUES ('isr.vehicle.ugv','UGV','active')
       ON CONFLICT (provider_type_id) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO provider(
         provider_id,provider_type_id,hosting_mode,status
       ) VALUES (
         'provider:ugv1','isr.vehicle.ugv','vendor_managed','active'
       ) ON CONFLICT (provider_id) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO audit(
         audit_event_id,action,actor_id,correlation_id,subject_type,subject_id
       ) VALUES (
         '31111111-1111-4111-8111-111111111111','database_profile.created',
         'admin-1','database-profile-1','database_profile','database-profile-1'
       )`,
    );
    await client.query(
      `INSERT INTO database_profile(
         profile_id,provider_id,environment,cluster_ref,host,port,database_mode,
         database_name,runtime_role_name,ssl_mode,admin_secret_ref,runtime_secret_ref,
         created_audit_event_id,last_audit_event_id
       ) VALUES (
         'database-profile-1','provider:ugv1','production','postgres-primary',
         'postgres.internal',5432,'provisioned','sdar_rt_provider_ugv1_111111111111',
         'sdar_rt_provider_ugv1_111111111111_app','verify-full',
         'vault/postgres/provisioner','vault/runtime/provider-ugv1',
         '31111111-1111-4111-8111-111111111111',
         '31111111-1111-4111-8111-111111111111'
       )`,
    );

    await expect(
      client.query(
        `INSERT INTO database_profile(
           profile_id,provider_id,environment,cluster_ref,host,port,database_mode,
           database_name,runtime_role_name,ssl_mode,admin_secret_ref,runtime_secret_ref,
           created_audit_event_id,last_audit_event_id
         ) VALUES (
           'database-profile-duplicate','provider:ugv1','production','postgres-primary',
           'postgres.internal',5432,'provisioned','sdar_rt_provider_ugv1_222222222222',
           'sdar_rt_provider_ugv1_222222222222_app','verify-full',
           'vault/postgres/provisioner','vault/runtime/provider-ugv1-duplicate',
           '31111111-1111-4111-8111-111111111111',
           '31111111-1111-4111-8111-111111111111'
         )`,
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      client.query(
        `UPDATE database_profile
            SET provision_status='failed',last_error_code=NULL
          WHERE profile_id='database-profile-1'`,
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      client.query(
        `UPDATE database_profile
            SET last_audit_event_id='39999999-9999-4999-8999-999999999999'
          WHERE profile_id='database-profile-1'`,
      ),
    ).rejects.toMatchObject({ code: "23503" });

    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema=$1 AND table_name='database_profile'
        ORDER BY ordinal_position`,
      [schema],
    );
    expect(columns.rows.map(({ column_name }) => column_name)).toEqual(
      expect.arrayContaining([
        "provider_id",
        "environment",
        "admin_secret_ref",
        "runtime_secret_ref",
        "last_audit_event_id",
      ]),
    );
    expect(
      columns.rows
        .map(({ column_name }) => column_name)
        .filter((name) => /password|credential|connection|database_url/i.test(name)),
    ).toEqual([]);
  });
});

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined || value.length === 0) {
    throw new Error("TEST_DATABASE_URL is required");
  }
  return value;
}
