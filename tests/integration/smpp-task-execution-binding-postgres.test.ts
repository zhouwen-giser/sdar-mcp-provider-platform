import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  insertCommittedTaskEvent,
  runMigrations,
  SmppDiagnosticRepository,
  TaskRepository,
} from "../../packages/persistence-postgres/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) throw new Error("TEST_DATABASE_URL is required");

const schema = `smpp_binding_${randomUUID().replaceAll("-", "")}`;
const admin = new Pool({ connectionString: databaseUrl, max: 1 });
const pool = new Pool({
  connectionString: databaseUrl,
  max: 3,
  options: `-c search_path=${schema}`,
});
const snapshotId = randomUUID();

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await runMigrations(pool);
  await pool.query(
    `INSERT INTO operation_snapshot
       (snapshot_id,provider_id,provider_version,operation_name,manifest_hash,definition)
     VALUES ($1,'provider-a','1.0.0','navigate',$2,$3::jsonb)`,
    [
      snapshotId,
      "a".repeat(64),
      JSON.stringify({
        resourceBinding: {
          mode: "ARGUMENT_REFERENCE",
          resourceIdJsonPointer: "/target/id",
        },
      }),
    ],
  );
});

beforeEach(async () => {
  await pool.query(
    "TRUNCATE provider_ops_delivery,outbox_event,provider_task,admission_intent CASCADE",
  );
});

afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

describe("SmppTaskExecutionBindingV1", () => {
  it("projects an unbound admission without duplicating task authority", async () => {
    const taskId = await insertAdmission("PENDING");
    const binding = await new SmppDiagnosticRepository(pool).getTaskExecutionBinding(taskId);
    expect(binding).toMatchObject({
      schemaVersion: "sdar.smpp-task-execution-binding/v1",
      taskId,
      providerId: "provider-a",
      operationName: "navigate",
      executionMode: "simulation",
      simulationId: "sim-1",
      externalExecutionId: null,
      resourceRef: "vehicle-7",
      adapterRevision: null,
      bindingStatus: "unbound",
    });
    expect(binding?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("projects durable uncertainty as unresolved", async () => {
    const taskId = await insertAdmission("UNCERTAIN");
    expect(await new SmppDiagnosticRepository(pool).getTaskExecutionBinding(taskId)).toMatchObject({
      taskId,
      bindingStatus: "unresolved",
      externalExecutionId: null,
    });
  });

  it("projects the exact Adapter execution identity from provider_task", async () => {
    const taskId = await insertAdmission("PUBLISHED");
    await insertTask(taskId, "RUNNING", "external-42");
    const first = await new SmppDiagnosticRepository(pool).getTaskExecutionBinding(taskId);
    const second = await new SmppDiagnosticRepository(pool).getTaskExecutionBinding(taskId);
    expect(first).toMatchObject({
      taskId,
      externalExecutionId: "external-42",
      adapterRevision: 3,
      bindingStatus: "bound",
    });
    expect(second?.contentHash).toBe(first?.contentHash);
  });

  it("fails the projection closed after a durable identity conflict", async () => {
    const taskId = await insertAdmission("PUBLISHED");
    await insertTask(taskId, "RUNNING", "external-42");
    await new TaskRepository(pool).recordIdentityConflict(taskId, "wrong external execution");
    expect(await new SmppDiagnosticRepository(pool).getTaskExecutionBinding(taskId)).toMatchObject({
      taskId,
      bindingStatus: "conflict",
    });
  });

  it("returns terminal without claiming Goal success", async () => {
    const taskId = await insertAdmission("PUBLISHED");
    await insertTask(taskId, "TERMINAL_COMPLETED", "external-42");
    const binding = await new SmppDiagnosticRepository(pool).getTaskExecutionBinding(taskId);
    expect(binding).toMatchObject({ bindingStatus: "terminal" });
    expect(binding).not.toHaveProperty("goalAchieved");
  });

  it("emits the four committed terminal axes through legal task ProviderOps", async () => {
    const taskId = await insertAdmission("PUBLISHED");
    await insertTask(taskId, "TERMINAL_COMPLETED", "external-terminal");
    await pool.query(`UPDATE provider_task SET result=$2::jsonb WHERE task_id=$1`, [
      taskId,
      JSON.stringify({ isError: true, structuredContent: { reasonCode: "NO_ROUTE" } }),
    ]);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await insertCommittedTaskEvent(client, taskId, "task.completed", {}, `${taskId}:terminal`);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const delivery = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT record_body->'payload' AS payload FROM provider_ops_delivery
       WHERE aggregate_id=$1 AND record_type='provider.task.lifecycle'`,
      [taskId],
    );
    expect(delivery.rows[0]?.payload).toMatchObject({
      transportStatus: "completed",
      mcpTaskStatus: "completed",
      businessStatus: "failed",
      providerExecutionStatus: "completed",
      isError: true,
    });
    expect(delivery.rows[0]?.payload).not.toHaveProperty("goalAchieved");
  });
});

async function insertAdmission(state: string): Promise<string> {
  const taskId = randomUUID();
  await pool.query(
    `INSERT INTO admission_intent
       (task_id,provider_id,operation_name,operation_snapshot_id,
        authorization_context_hash,execution_mode,simulation_id,arguments,
        argument_hash,state,accepted_at,not_before,latest_start_at,timing)
     VALUES ($1,'provider-a','navigate',$2,$3,'simulation','sim-1',$4::jsonb,$5,$6,
             clock_timestamp(),clock_timestamp(),clock_timestamp(),$7::jsonb)`,
    [
      taskId,
      snapshotId,
      "b".repeat(64),
      JSON.stringify({ target: { id: "vehicle-7" } }),
      "c".repeat(64),
      state,
      JSON.stringify({ start: { mode: "immediate", startToleranceMs: 0 }, maxElapsedMs: null }),
    ],
  );
  return taskId;
}

async function insertTask(
  taskId: string,
  internalState: string,
  externalId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO provider_task
       (task_id,provider_id,operation_name,operation_snapshot_id,
        authorization_context_hash,execution_mode,simulation_id,arguments,argument_hash,
        external_execution_id,internal_state,mcp_status,substate,status_message,
        adapter_revision,accepted_at,timing,not_before,latest_start_at,invocation_attempt,
        terminal_at,handle_expires_at)
     SELECT task_id,provider_id,operation_name,operation_snapshot_id,
            authorization_context_hash,execution_mode,simulation_id,arguments,argument_hash,
            $2,$3,$4,$5,'fixture',3,accepted_at,timing,not_before,latest_start_at,1,
            CASE WHEN $3 LIKE 'TERMINAL_%' THEN clock_timestamp() ELSE NULL END,
            CASE WHEN $3 LIKE 'TERMINAL_%' THEN clock_timestamp() + interval '1 day' ELSE NULL END
     FROM admission_intent WHERE task_id=$1`,
    [
      taskId,
      externalId,
      internalState,
      internalState === "TERMINAL_COMPLETED" ? "completed" : "working",
      internalState === "TERMINAL_COMPLETED" ? null : "running",
    ],
  );
}
