import type { Pool } from "pg";
import {
  scopePredicate,
  deviceScopePredicate,
} from "../../gowm-shared-storage-adapter/src/scope.js";
/** Point-in-time read-only counts. A count is not a fencing token or proof of physical idle. */
export async function readZmqHandoffState(runtime: Pool, provider: Pool, providerId: string) {
  const counts = async (pool: Pool, queries: readonly string[]) => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN READ ONLY");
      await c.query("SET LOCAL statement_timeout='2000ms'");
      const result = [];
      for (const sql of queries) {
        const r = await c.query<{ count: string }>(sql, [providerId]);
        result.push(Number(r.rows[0]?.count ?? -1));
      }
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  };
  const [runtimeActive, unresolvedAdmissions] = await counts(runtime, [
    `SELECT count(*)::text count FROM provider_task WHERE (${scopePredicate(runtime, "provider_task", "provider_task")}) AND provider_id=$1 AND internal_state NOT LIKE 'TERMINAL_%'`,
    `SELECT count(*)::text count FROM admission_intent WHERE (${scopePredicate(runtime, "admission_intent", "admission_intent")}) AND provider_id=$1 AND state IN ('PENDING','ACCEPTED','UNCERTAIN')`,
  ]);
  const [providerActive, unresolvedNativeOccupancy] = await counts(provider, [
    `SELECT count(*)::text count FROM ugv_execution WHERE (${scopePredicate(provider, "ugv_execution", "ugv_execution")}) AND payload->>'providerId'=$1 AND state NOT IN ('SUCCEEDED','BUSINESS_FAILED','CANCELLED','TECHNICAL_FAILED')`,
    `SELECT count(*)::text count FROM ugv_execution WHERE (${deviceScopePredicate(provider, "ugv_execution")}) AND ($1::text IS NOT NULL) AND payload->'zmqControl'->>'occupancy'='held'`,
  ]);
  return {
    schemaVersion: "ugv.zmq-handoff-snapshot/1",
    observedAt: new Date().toISOString(),
    providerId,
    runtimeActive,
    unresolvedAdmissions,
    providerActive,
    unresolvedNativeOccupancy,
    databaseIdle: [
      runtimeActive,
      unresolvedAdmissions,
      providerActive,
      unresolvedNativeOccupancy,
    ].every((v) => v === 0),
    switchAuthorized: false,
    missingEvidence: [
      "ADMISSION_DRAIN_FENCE_REQUIRED",
      "OLD_WRITER_STOP_CONFIRMATION_REQUIRED",
      "QUALIFIED_SOURCE_IDLE_REQUIRED",
    ],
    authority: "read_only_point_in_time_not_a_handoff_lease",
  } as const;
}
