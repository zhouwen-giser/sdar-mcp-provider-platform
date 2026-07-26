import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../packages/persistence-postgres/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined)
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration");

const schema = `rc1_upgrade_${process.pid.toString()}`;
const adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
const upgradePool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  options: `-c search_path=${schema}`,
});
let rc1Migrations: string;

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  rc1Migrations = await mkdtemp(resolve(tmpdir(), "sdar-rc1-migrations-"));
  const migrations = resolve(process.cwd(), "migrations");
  for (const file of (await readdir(migrations)).filter((name) =>
    /^0(?:0[1-9]|1[01])_.+\.sql$/.test(name),
  )) {
    await copyFile(resolve(migrations, file), resolve(rc1Migrations, file));
  }
});

afterAll(async () => {
  await upgradePool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await adminPool.end();
  await rm(rc1Migrations, { recursive: true, force: true });
});

describe("pre-012 database forward upgrade", () => {
  it("upgrades old idempotency rows and applies the complete rc.3 migration set", async () => {
    await runMigrations(upgradePool, rc1Migrations);
    const pendingTaskId = "00000000-0000-4000-8000-000000000012";
    await upgradePool.query(
      `INSERT INTO idempotency_record (
         authorization_context_hash, operation_name, idempotency_key, argument_hash,
         execution_mode, simulation_key, stable_task_id, state, synchronous_result
       ) VALUES
         (repeat('a', 64), 'upgrade', 'pending', repeat('b', 64), 'LIVE', '', $1, 'PENDING', NULL),
         (repeat('a', 64), 'upgrade', 'complete', repeat('c', 64), 'LIVE', '', NULL, 'COMPLETE',
          '{"upgraded":true}'::jsonb)`,
      [pendingTaskId],
    );

    await runMigrations(upgradePool);

    const rows = await upgradePool.query<{
      idempotency_key: string;
      lease_owner: string | null;
      lease_expires_at: Date | null;
      claim_attempt: number;
      synchronous_result: { upgraded: boolean } | null;
    }>(
      `SELECT idempotency_key, lease_owner, lease_expires_at, claim_attempt, synchronous_result
       FROM idempotency_record ORDER BY idempotency_key`,
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toEqual(
      expect.objectContaining({
        idempotency_key: "complete",
        lease_owner: null,
        lease_expires_at: null,
        claim_attempt: 0,
        synchronous_result: { upgraded: true },
      }),
    );
    expect(rows.rows[1]).toEqual(
      expect.objectContaining({
        idempotency_key: "pending",
        lease_owner: `migration-recovery:${pendingTaskId}`,
        claim_attempt: 1,
        synchronous_result: null,
      }),
    );
    expect(rows.rows[1]?.lease_expires_at).toBeInstanceOf(Date);
    await expect(
      upgradePool.query(
        `UPDATE idempotency_record SET lease_owner = NULL WHERE idempotency_key = 'pending'`,
      ),
    ).rejects.toThrow();
    const applied = await upgradePool.query(
      "SELECT 1 FROM runtime_schema_migration WHERE version = '012_idempotency_claim_lease.sql'",
    );
    expect(applied.rowCount).toBe(1);
    const runtimeRevision = await upgradePool.query<{
      column_name: string;
      is_nullable: string;
    }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_schema=$1 AND table_name='provider_task'
         AND column_name IN ('runtime_revision','runtime_updated_at')
       ORDER BY column_name`,
      [schema],
    );
    expect(runtimeRevision.rows).toEqual([
      { column_name: "runtime_revision", is_nullable: "NO" },
      { column_name: "runtime_updated_at", is_nullable: "NO" },
    ]);
    const current = await upgradePool.query<{ count: string }>(
      "SELECT count(*) FROM runtime_schema_migration",
    );
    expect(current.rows[0]?.count).toBe("24");
  });
});
