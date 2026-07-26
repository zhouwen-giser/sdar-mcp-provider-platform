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
  "job_lease",
  "pms_schema_migration",
  "provider",
  "provider_package",
  "provider_resource_binding",
  "provider_type",
  "resource",
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
});

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined || value.length === 0) {
    throw new Error("TEST_DATABASE_URL is required");
  }
  return value;
}
