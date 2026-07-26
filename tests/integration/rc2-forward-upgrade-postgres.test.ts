import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../packages/persistence-postgres/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined)
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration");

const schema = `rc2_upgrade_${process.pid.toString()}`;
const adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  options: `-c search_path=${schema}`,
});
let rc2Migrations: string;

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  rc2Migrations = await mkdtemp(resolve(tmpdir(), "sdar-rc2-migrations-"));
  const migrations = resolve(process.cwd(), "migrations");
  for (const file of await readdir(migrations)) {
    const version = Number.parseInt(file.slice(0, 3), 10);
    if (/^\d{3}[a-z]?_.+\.sql$/.test(file) && version <= 13) {
      await copyFile(resolve(migrations, file), resolve(rc2Migrations, file));
    }
  }
  await runMigrations(pool, rc2Migrations);
  await pool.query(
    `INSERT INTO operation_snapshot
       (snapshot_id, provider_id, provider_version, operation_name, manifest_hash, definition)
     VALUES
       ('00000000-0000-4000-8000-000000000301', 'rc2-upgrade', '1.0.0-rc.2',
        'durable_task', repeat('a',64), '{}'::jsonb)`,
  );
  await pool.query(
    `INSERT INTO provider_task
       (task_id, provider_id, operation_name, operation_snapshot_id,
        authorization_context_hash, execution_mode, arguments, argument_hash,
        external_execution_id, internal_state, mcp_status, substate, accepted_at,
        actual_started_at, latest_start_at, timing, adapter_revision, observation_revision)
     VALUES
       ('00000000-0000-4000-8000-000000000302', 'rc2-upgrade', 'durable_task',
        '00000000-0000-4000-8000-000000000301', repeat('b',64), 'live',
        '{"resourceId":"upgrade"}'::jsonb, repeat('c',64), 'rc2-execution',
        'RUNNING', 'working', 'running', clock_timestamp(), NULL,
        clock_timestamp()+interval '1 minute', '{}'::jsonb, 1, 1)`,
  );
  await pool.query(
    `INSERT INTO task_observation
       (task_id, revision, type, occurred_at, payload, source, adapter_revision)
     VALUES
       ('00000000-0000-4000-8000-000000000302', 1, 'task.started',
        clock_timestamp(), '{}'::jsonb, 'adapter', 1)`,
  );
  await pool.query(
    `INSERT INTO task_command
       (task_id, command_sequence, command_type, request_hash, state, payload,
        claim_owner, claim_until)
     VALUES
       ('00000000-0000-4000-8000-000000000302', 1, 'CANCEL', repeat('d',64),
        'CLAIMED', '{}'::jsonb, 'rc2-runtime', clock_timestamp()+interval '1 minute')`,
  );
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await adminPool.end();
  await rm(rc2Migrations, { recursive: true, force: true });
});

describe("rc.2 database forward upgrade", () => {
  it("applies the rc.3 lease, watchdog, pagination and recovery migrations", async () => {
    await runMigrations(pool);
    const applied = await pool.query<{ version: string }>(
      `SELECT version FROM runtime_schema_migration
       WHERE version = ANY($1::text[]) ORDER BY version`,
      [
        [
          "013_single_claimed_command.sql",
          "014_start_confirmation_watchdog.sql",
          "014_observation_pagination.sql",
          "015_recovery_backoff.sql",
          "016_command_claim_lease_consistency.sql",
          "017_provider_ops_audit_delivery.sql",
          "018_runtime_trace_context.sql",
        ],
      ],
    );
    expect(applied.rows.map((row) => row.version)).toEqual([
      "013_single_claimed_command.sql",
      "014_observation_pagination.sql",
      "014_start_confirmation_watchdog.sql",
      "015_recovery_backoff.sql",
      "016_command_claim_lease_consistency.sql",
      "017_provider_ops_audit_delivery.sql",
      "018_runtime_trace_context.sql",
    ]);
    expect(
      await pool.query(
        `SELECT 1 FROM provider_task
         WHERE task_id='00000000-0000-4000-8000-000000000302'
           AND start_confirmation_deadline=latest_start_at
           AND start_confirmation_attempts=0
           AND next_recovery_at IS NOT NULL
           AND recovery_failure_count=0`,
      ),
    ).toMatchObject({ rowCount: 1 });
    await expect(
      pool.query(
        `INSERT INTO task_command
           (task_id, command_sequence, command_type, request_hash, state, payload,
            claim_owner, claim_until)
         VALUES
           ('00000000-0000-4000-8000-000000000302', 2, 'CANCEL', repeat('e',64),
            'CLAIMED', '{}'::jsonb, 'other-runtime', clock_timestamp()+interval '1 minute')`,
      ),
    ).rejects.toThrow();
    await runMigrations(pool);
  });
});
