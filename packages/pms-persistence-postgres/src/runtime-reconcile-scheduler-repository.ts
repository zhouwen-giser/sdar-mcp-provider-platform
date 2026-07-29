import type { Pool, PoolClient, QueryResultRow } from "pg";
import type {
  RuntimeReconcileSchedulerRepository,
  ScheduleRuntimeReconcileJobs,
} from "../../pms-domain/src/index.js";

const RUNTIME_RECONCILE_JOB_TYPE = "runtime_deployment.reconcile";
const ADVISORY_LOCK_NAME = "sdar:pms-worker:runtime-reconcile-scheduler:v1";

interface AdvisoryLockRow extends QueryResultRow {
  acquired: boolean;
}

export class PostgresRuntimeReconcileSchedulerRepository implements RuntimeReconcileSchedulerRepository {
  constructor(private readonly pool: Pool) {}

  async enqueueDue(input: ScheduleRuntimeReconcileJobs): Promise<number> {
    validateInput(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const lock = await client.query<AdvisoryLockRow>(
        "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired",
        [ADVISORY_LOCK_NAME],
      );
      if (lock.rows[0]?.acquired !== true) {
        await client.query("COMMIT");
        return 0;
      }
      const result = await enqueueCandidates(client, input);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function enqueueCandidates(
  client: PoolClient,
  input: ScheduleRuntimeReconcileJobs,
): Promise<number> {
  const result = await client.query(
    `WITH candidates AS (
       SELECT deployment_id,provider_id
         FROM runtime_deployment deployment
        WHERE deployment.status=ANY($1::text[])
          AND deployment.updated_at<=clock_timestamp()-($2::text||' milliseconds')::interval
          AND NOT EXISTS (
            SELECT 1
              FROM job_lease job
             WHERE job.job_type=$4
               AND job.status IN ('pending','leased')
               AND job.payload->>'providerId'=deployment.provider_id
               AND job.payload->>'deploymentId'=deployment.deployment_id
          )
        ORDER BY updated_at,deployment_id
        LIMIT $3
     )
     INSERT INTO job_lease(job_id,job_type,payload,status,available_at)
     SELECT 'runtime-reconcile-periodic:'||gen_random_uuid()::text,
            $4,
            jsonb_build_object(
              'providerId',provider_id,
              'deploymentId',deployment_id,
              'correlationId','runtime-reconcile-periodic:'||deployment_id
            ),
            'pending',
            clock_timestamp()
       FROM candidates`,
    [
      [
        "REQUESTED",
        "DATABASE_PROVISIONING",
        "MIGRATING",
        "CONFIG_PREPARING",
        "STARTING",
        "HEALTH_CHECKING",
        "DISCOVERING",
        "ACTIVE",
        "DRAINING",
        "DEGRADED",
      ],
      input.minimumAgeMs,
      input.limit,
      RUNTIME_RECONCILE_JOB_TYPE,
    ],
  );
  return result.rowCount ?? 0;
}

function validateInput(input: ScheduleRuntimeReconcileJobs): void {
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 500 ||
    !Number.isSafeInteger(input.minimumAgeMs) ||
    input.minimumAgeMs < 0 ||
    input.minimumAgeMs > 300_000
  ) {
    throw new RangeError("PMS_RUNTIME_RECONCILE_SCHEDULER_BOUNDS");
  }
}
