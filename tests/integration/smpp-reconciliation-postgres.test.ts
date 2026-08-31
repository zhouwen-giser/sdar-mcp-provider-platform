import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ValidatedManifest,
  ValidatedOperation,
} from "../../packages/operation-registry/src/index.js";
import {
  runMigrations,
  SmppDiagnosticRepository,
  TaskRepository,
} from "../../packages/persistence-postgres/src/index.js";
import type { TaskAdapterGateway } from "../../packages/task-engine/src/index.js";
import { TaskEngine } from "../../packages/task-engine/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) throw new Error("TEST_DATABASE_URL is required");
const schema = `smpp_reconcile_${randomUUID().replaceAll("-", "")}`;
const admin = new Pool({ connectionString: databaseUrl, max: 1 });
const pool = new Pool({
  connectionString: databaseUrl,
  max: 3,
  options: `-c search_path=${schema}`,
});
const taskId = randomUUID();
const snapshotId = randomUUID();

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await runMigrations(pool);
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
     VALUES ($1,'provider-a','navigate',$2,$3,'simulation','sim-1','{}'::jsonb,$4,'UNCERTAIN',
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

describe("exact SMPP reconciliation audit", () => {
  it("fails UNCERTAIN + NOT_FOUND closed without a physical redispatch", async () => {
    let physicalStarts = 0;
    const gateway = {
      reconcileExecution: () =>
        Promise.resolve({ status: "NOT_FOUND", externalExecutionId: "", message: "not found" }),
      startOperation: () => {
        physicalStarts += 1;
        return Promise.reject(new Error("START_MUST_NOT_RUN"));
      },
      checkAvailability: () => Promise.reject(new Error("unused")),
      getExecution: () => Promise.reject(new Error("unused")),
    } as unknown as TaskAdapterGateway;
    const repository = new TaskRepository(pool);
    const engine = new TaskEngine(
      { providerId: "provider-a" } as ValidatedManifest,
      new Map([["navigate", snapshotId]]),
      gateway,
      repository,
    );
    const admission = await repository.getAdmission(taskId);
    if (admission === null) throw new Error("fixture admission missing");
    const operation = {
      name: "navigate",
      execution: "TASK_REQUIRED",
      validateArguments: () => undefined,
    } as unknown as ValidatedOperation;

    await expect(engine.recoverAdmission(admission, operation)).rejects.toThrow(
      "ADAPTER_RECONCILE_NOT_FOUND_UNCERTAIN",
    );
    expect(physicalStarts).toBe(0);
    expect(await new SmppDiagnosticRepository(pool).listReconciliationResults(taskId)).toEqual([
      expect.objectContaining({
        taskId,
        attempt: 1,
        status: "not_found",
        identityValidated: false,
      }),
    ]);
  });

  it("allocates ordered attempts and emits causal ProviderOps facts", async () => {
    const repository = new TaskRepository(pool);
    await repository.recordReconciliationResult(taskId, "transient_unavailable", null, false);
    await repository.recordReconciliationResult(taskId, "conflict", "external-conflict", false);
    await repository.recordReconciliationResult(taskId, "found", "external-original", true);
    const results = await new SmppDiagnosticRepository(pool).listReconciliationResults(taskId);
    expect(results.map(({ attempt, status }) => ({ attempt, status }))).toEqual([
      { attempt: 1, status: "not_found" },
      { attempt: 2, status: "transient_unavailable" },
      { attempt: 3, status: "conflict" },
      { attempt: 4, status: "found" },
    ]);
    expect(results.at(-1)).toMatchObject({
      externalExecutionId: "external-original",
      identityValidated: true,
    });
    const deliveries = await pool.query<{ count: string; events: string[] }>(
      `SELECT count(*)::text AS count,
              array_agg(record_body->>'eventType' ORDER BY record_body->'payload'->>'attempt') AS events
       FROM provider_ops_delivery WHERE aggregate_id=$1`,
      [taskId],
    );
    expect(deliveries.rows[0]).toEqual({
      count: "4",
      events: [
        "task.reconciliation",
        "task.reconciliation",
        "task.reconciliation",
        "task.reconciliation",
      ],
    });
  });
});
