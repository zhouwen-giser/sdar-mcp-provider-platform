import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  runMigrations,
  SmppDiagnosticRepository,
  TaskRepository,
} from "../../packages/persistence-postgres/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) throw new Error("TEST_DATABASE_URL is required");
const schema = `smpp_uncertainty_${randomUUID().replaceAll("-", "")}`;
const admin = new Pool({ connectionString: databaseUrl, max: 1 });
const pool = new Pool({
  connectionString: databaseUrl,
  max: 3,
  options: `-c search_path=${schema}`,
});
const taskId = randomUUID();

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await runMigrations(pool);
  const snapshotId = randomUUID();
  await pool.query(
    `INSERT INTO operation_snapshot
       (snapshot_id,provider_id,provider_version,operation_name,manifest_hash,definition)
     VALUES ($1,'provider-a','1.0.0','navigate',$2,'{}'::jsonb)`,
    [snapshotId, "a".repeat(64)],
  );
  await pool.query(
    `INSERT INTO admission_intent
       (task_id,provider_id,operation_name,operation_snapshot_id,
        authorization_context_hash,execution_mode,simulation_id,arguments,
        argument_hash,state,accepted_at,not_before,latest_start_at,timing)
     VALUES ($1,'provider-a','navigate',$2,$3,'simulation','sim-1','{}'::jsonb,$4,'PENDING',
             clock_timestamp(),clock_timestamp(),clock_timestamp(),$5::jsonb)`,
    [
      taskId,
      snapshotId,
      "b".repeat(64),
      "c".repeat(64),
      JSON.stringify({ start: { mode: "immediate", startToleranceMs: 0 }, maxElapsedMs: null }),
    ],
  );
});

afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

describe("durable SMPP dispatch uncertainty", () => {
  it("commits a no-redispatch document and legal ProviderOps recovery fact atomically", async () => {
    const repository = new TaskRepository(pool);
    const occurredAt = new Date("2026-08-28T04:00:00.000Z");
    await repository.markAdmissionUncertain(
      taskId,
      "adapter_transport_ambiguous",
      ["adapter.startOperation"],
      occurredAt,
    );
    expect(await new SmppDiagnosticRepository(pool).getDispatchUncertainty(taskId)).toEqual({
      schemaVersion: "sdar.smpp-dispatch-uncertainty/v1",
      taskId,
      operationName: "navigate",
      argumentHash: "c".repeat(64),
      uncertaintyClass: "adapter_transport_ambiguous",
      redispatchAllowed: false,
      occurredAt: occurredAt.toISOString(),
      causalRefs: ["adapter.startOperation"],
    });

    const persisted = await pool.query<{ state: string }>(
      "SELECT state FROM admission_intent WHERE task_id=$1",
      [taskId],
    );
    expect(persisted.rows[0]?.state).toBe("UNCERTAIN");

    const delivery = await pool.query<{
      record_type: string;
      event_category: string;
      record_body: { eventType: string; payload: Record<string, unknown> };
    }>(
      "SELECT record_type,event_category,record_body FROM provider_ops_delivery WHERE aggregate_id=$1",
      [taskId],
    );
    expect(delivery.rows[0]).toMatchObject({
      record_type: "provider.recovery.lifecycle",
      event_category: "recovery.lifecycle",
      record_body: {
        eventType: "dispatch.uncertainty",
        payload: {
          uncertaintyClass: "adapter_transport_ambiguous",
          redispatchAllowed: false,
        },
      },
    });
  });

  it("is idempotent and never rewrites the first causal uncertainty", async () => {
    const repository = new TaskRepository(pool);
    await repository.markAdmissionUncertain(taskId, "unknown", ["duplicate"]);
    const counts = await pool.query<{ uncertainty: string; provider_ops: string }>(
      `SELECT
         (SELECT count(*) FROM smpp_dispatch_uncertainty)::text AS uncertainty,
         (SELECT count(*) FROM provider_ops_delivery WHERE aggregate_id=$1)::text AS provider_ops`,
      [taskId],
    );
    expect(counts.rows[0]).toEqual({ uncertainty: "1", provider_ops: "1" });
    expect(await new SmppDiagnosticRepository(pool).getDispatchUncertainty(taskId)).toMatchObject({
      uncertaintyClass: "adapter_transport_ambiguous",
      causalRefs: ["adapter.startOperation"],
    });
  });
});
