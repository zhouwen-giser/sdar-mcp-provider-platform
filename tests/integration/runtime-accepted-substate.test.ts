import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SnapshotTransition, TaskExecutionTiming } from "../../packages/domain/src/index.js";
import { runMigrations } from "../../packages/persistence-postgres/src/index.js";
import { TaskRepository } from "../../packages/persistence-postgres/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined)
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration");

const schema = `accepted_substate_${randomUUID().replaceAll("-", "")}`;
const adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  options: `-c search_path=${schema}`,
});

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await adminPool.end();
});

describe("Runtime accepted Task substate", () => {
  it("persists the Adapter ACCEPTED snapshot without violating the lifecycle constraint", async () => {
    const snapshotId = randomUUID();
    const taskId = randomUUID();
    await pool.query(
      `INSERT INTO operation_snapshot
         (snapshot_id,provider_id,provider_version,operation_name,manifest_hash,definition)
       VALUES ($1,'accepted-substate-provider','1.0.0','accepted_task',repeat('a',64),'{}'::jsonb)`,
      [snapshotId],
    );
    await pool.query(
      `INSERT INTO provider_task
         (task_id,provider_id,operation_name,operation_snapshot_id,authorization_context_hash,
          execution_mode,simulation_id,arguments,argument_hash,external_execution_id,
          internal_state,mcp_status,substate,accepted_at,timing,adapter_revision,observation_revision,
          trace_id,root_traceparent,root_tracestate,correlation_id)
       VALUES ($1,'accepted-substate-provider','accepted_task',$2,repeat('b',64),'simulation','sim-accepted',
          '{}'::jsonb,repeat('c',64),'accepted-execution','QUEUED','working','accepted',clock_timestamp(),
          '{}'::jsonb,0,0,repeat('d',32),
          '00-dddddddddddddddddddddddddddddddd-eeeeeeeeeeeeeeee-01','vendor=accepted','accepted-correlation')`,
      [taskId, snapshotId],
    );
    const result = await pool.query<{ substate: string; internal_state: string }>(
      "SELECT substate, internal_state FROM provider_task WHERE task_id = $1",
      [taskId],
    );
    expect(result.rows[0]).toEqual({ substate: "accepted", internal_state: "QUEUED" });
  });

  it("converges concurrent accepted publications on the Task ID", async () => {
    const snapshotId = randomUUID();
    const taskId = randomUUID();
    await pool.query(
      `INSERT INTO operation_snapshot
         (snapshot_id,provider_id,provider_version,operation_name,manifest_hash,definition)
       VALUES ($1,'accepted-concurrency-provider','1.0.0','accepted_task',repeat('e',64),'{}'::jsonb)`,
      [snapshotId],
    );
    const timing: TaskExecutionTiming = {
      start: { mode: "immediate", startToleranceMs: 0 },
      maxElapsedMs: null,
    };
    const transition: SnapshotTransition = {
      internalState: "QUEUED",
      mcpStatus: "working",
      substate: "accepted",
      statusMessage: "accepted",
      result: null,
      error: null,
      terminal: false,
      observationType: "task.accepted",
    };
    const input = {
      taskId,
      providerId: "accepted-concurrency-provider",
      operationName: "accepted_task",
      operationSnapshotId: snapshotId,
      authorization: {
        hash: "f".repeat(64),
        executionMode: "simulation" as const,
        simulationId: "sim-concurrent",
        correlationId: "accepted-concurrency",
      },
      arguments: {},
      argumentHash: "1".repeat(64),
      externalExecutionId: "accepted-concurrent-execution",
      transition,
      adapterRevision: 1,
      adapterResponse: { result: "accepted" },
      acceptedAt: new Date(),
      notBefore: new Date(),
      latestStartAt: new Date(Date.now() + 60_000),
      deadlineAt: null,
      ttlMs: 60_000,
      timing,
      reservationRef: null,
    };
    const repository = new TaskRepository(pool);
    const tasks = await Promise.all([
      repository.publishAccepted(input),
      repository.publishAccepted(input),
    ]);
    expect(tasks.map((task) => task.taskId)).toEqual([taskId, taskId]);
    const count = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM provider_task WHERE task_id=$1",
      [taskId],
    );
    expect(count.rows[0]?.count).toBe("1");
  });

  it("fails closed when concurrent accepted publications reuse a Task ID with different arguments", async () => {
    const snapshotId = randomUUID();
    const taskId = randomUUID();
    await pool.query(
      `INSERT INTO operation_snapshot
         (snapshot_id,provider_id,provider_version,operation_name,manifest_hash,definition)
       VALUES ($1,'accepted-conflict-provider','1.0.0','accepted_task',repeat('2',64),'{}'::jsonb)`,
      [snapshotId],
    );
    const timing: TaskExecutionTiming = {
      start: { mode: "immediate", startToleranceMs: 0 },
      maxElapsedMs: null,
    };
    const transition: SnapshotTransition = {
      internalState: "QUEUED",
      mcpStatus: "working",
      substate: "accepted",
      statusMessage: "accepted",
      result: null,
      error: null,
      terminal: false,
      observationType: "task.accepted",
    };
    const baseInput = {
      taskId,
      providerId: "accepted-conflict-provider",
      operationName: "accepted_task",
      operationSnapshotId: snapshotId,
      authorization: {
        hash: "3".repeat(64),
        executionMode: "simulation" as const,
        simulationId: "sim-conflict",
        correlationId: "accepted-conflict",
      },
      arguments: { power: "on" },
      argumentHash: "4".repeat(64),
      externalExecutionId: "accepted-conflict-execution",
      transition,
      adapterRevision: 1,
      adapterResponse: { result: "accepted" },
      acceptedAt: new Date(),
      notBefore: new Date(),
      latestStartAt: new Date(Date.now() + 60_000),
      deadlineAt: null,
      ttlMs: 60_000,
      timing,
      reservationRef: null,
    };
    const repository = new TaskRepository(pool);
    const outcomes = await Promise.allSettled([
      repository.publishAccepted(baseInput),
      repository.publishAccepted({
        ...baseInput,
        arguments: { power: "off" },
        argumentHash: "5".repeat(64),
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status !== "rejected")
      throw new Error("EXPECTED_CONCURRENT_PUBLICATION_REJECTION");
    const rejectionReason: unknown = rejected.reason;
    expect(rejectionReason).toBeInstanceOf(Error);
    expect((rejectionReason as Error).message).toBe("TASK_ACCEPTED_IDENTITY_CONFLICT");
    const persisted = await repository.getById(taskId);
    expect(persisted).not.toBeNull();
    expect(["4".repeat(64), "5".repeat(64)]).toContain(persisted?.argumentHash);
  });
});
