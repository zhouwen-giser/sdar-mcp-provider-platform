import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresRuntimeReconcileSchedulerRepository, runPmsMigrations } from "../src/index.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");

describe("PostgresRuntimeReconcileSchedulerRepository", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const schema = `runtime_reconcile_scheduler_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    await runPmsMigrations(pool, workspaceRoot);
    await pool.query(
      `INSERT INTO provider_type(provider_type_id,display_name,status)
       VALUES ('test.scheduler.runtime','Scheduler Runtime','active')`,
    );
    await pool.query(
      `INSERT INTO provider(provider_id,provider_type_id,hosting_mode,status)
       VALUES ('provider-scheduler','test.scheduler.runtime','platform_managed','active')`,
    );
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE job_lease,runtime_deployment CASCADE");
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("uses database time and schedules all continuing states but not terminal states", async () => {
    for (const [status, desiredState] of [
      ["REQUESTED", "running"],
      ["ACTIVE", "running"],
      ["DEGRADED", "running"],
      ["DRAINING", "draining"],
      ["STOPPED", "stopped"],
      ["FAILED", "running"],
    ] as const) {
      await insertDeployment(
        pool,
        `deployment-${status.toLowerCase()}`,
        status,
        desiredState,
        -60_000,
      );
    }
    await insertDeployment(pool, "deployment-fresh", "ACTIVE", "running", 60_000);
    const repository = new PostgresRuntimeReconcileSchedulerRepository(pool);

    await expect(repository.enqueueDue({ limit: 20, minimumAgeMs: 1_000 })).resolves.toBe(4);
    const jobs = await pool.query<{
      payload: { deploymentId: string };
      status: string;
      available: boolean;
    }>(
      `SELECT payload,status,available_at<=clock_timestamp() AS available
         FROM job_lease
        ORDER BY payload->>'deploymentId'`,
    );
    expect(jobs.rows).toHaveLength(4);
    expect(jobs.rows.every(({ status, available }) => status === "pending" && available)).toBe(
      true,
    );
    expect(jobs.rows.map(({ payload }) => payload.deploymentId)).toEqual([
      "deployment-active",
      "deployment-degraded",
      "deployment-draining",
      "deployment-requested",
    ]);
  });

  it("serializes concurrent ticks and keeps pending or leased work authoritative", async () => {
    await insertDeployment(pool, "deployment-concurrent", "ACTIVE", "running", -60_000);
    const left = new PostgresRuntimeReconcileSchedulerRepository(pool);
    const right = new PostgresRuntimeReconcileSchedulerRepository(pool);

    const results = await Promise.all([
      left.enqueueDue({ limit: 10, minimumAgeMs: 0 }),
      right.enqueueDue({ limit: 10, minimumAgeMs: 0 }),
    ]);

    expect(results.reduce((total, value) => total + value, 0)).toBe(1);
    await expect(left.enqueueDue({ limit: 10, minimumAgeMs: 0 })).resolves.toBe(0);
    await pool.query(
      `UPDATE job_lease
          SET status='leased',lease_owner='worker',lease_token=gen_random_uuid(),
              lease_expires_at=clock_timestamp()+interval '1 minute'`,
    );
    await expect(right.enqueueDue({ limit: 10, minimumAgeMs: 0 })).resolves.toBe(0);

    await insertDeployment(pool, "deployment-after-active-job", "ACTIVE", "running", -50_000);
    await expect(right.enqueueDue({ limit: 1, minimumAgeMs: 0 })).resolves.toBe(1);
  });

  it("does not let succeeded or failed history block restart recovery", async () => {
    await insertDeployment(pool, "deployment-history", "DEGRADED", "running", -60_000);
    const firstWorker = new PostgresRuntimeReconcileSchedulerRepository(pool);
    await expect(firstWorker.enqueueDue({ limit: 10, minimumAgeMs: 0 })).resolves.toBe(1);
    await pool.query("UPDATE job_lease SET status='succeeded'");

    const restartedWorker = new PostgresRuntimeReconcileSchedulerRepository(pool);
    await expect(restartedWorker.enqueueDue({ limit: 10, minimumAgeMs: 0 })).resolves.toBe(1);
    await pool.query("UPDATE job_lease SET status='failed' WHERE status='pending'");
    await expect(restartedWorker.enqueueDue({ limit: 10, minimumAgeMs: 0 })).resolves.toBe(1);

    const history = await pool.query(
      "SELECT status,count(*)::integer AS count FROM job_lease GROUP BY status ORDER BY status",
    );
    expect(history.rows).toEqual([
      { status: "failed", count: 1 },
      { status: "pending", count: 1 },
      { status: "succeeded", count: 1 },
    ]);
  });

  it("rolls back failed ticks and releases the transaction advisory lock", async () => {
    await insertDeployment(pool, "deployment-rollback", "ACTIVE", "running", -60_000);
    await pool.query(
      `CREATE FUNCTION reject_scheduler_insert() RETURNS trigger
       LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.job_type='runtime_deployment.reconcile' THEN
           RAISE EXCEPTION 'injected scheduler insert failure';
         END IF;
         RETURN NEW;
       END
       $$`,
    );
    await pool.query(
      `CREATE TRIGGER reject_scheduler_insert
       BEFORE INSERT ON job_lease
       FOR EACH ROW EXECUTE FUNCTION reject_scheduler_insert()`,
    );
    const repository = new PostgresRuntimeReconcileSchedulerRepository(pool);

    await expect(repository.enqueueDue({ limit: 10, minimumAgeMs: 0 })).rejects.toThrow(
      "injected scheduler insert failure",
    );
    await pool.query("DROP TRIGGER reject_scheduler_insert ON job_lease");
    await pool.query("DROP FUNCTION reject_scheduler_insert()");
    await expect(repository.enqueueDue({ limit: 10, minimumAgeMs: 0 })).resolves.toBe(1);
  });
});

async function insertDeployment(
  pool: Pool,
  deploymentId: string,
  status: string,
  desiredState: "running" | "stopped" | "draining",
  updatedOffsetMs: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO runtime_deployment(
       deployment_id,provider_id,environment,desired_state,desired_replicas,
       runtime_version,database_profile_id,config_profile_id,status,
       created_at,updated_at
     ) VALUES (
       $1,'provider-scheduler','production',$2,$3,
       '2.0.0-rc.1','database-profile','config-profile',$4,
       clock_timestamp()+($5::text||' milliseconds')::interval,
       clock_timestamp()+($5::text||' milliseconds')::interval
     )`,
    [deploymentId, desiredState, desiredState === "running" ? 1 : 0, status, updatedOffsetMs],
  );
}

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("TEST_DATABASE_URL is required");
  return value;
}
