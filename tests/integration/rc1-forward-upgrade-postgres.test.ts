import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type * as grpc from "@grpc/grpc-js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bindMockAdapter,
  createMockAdapterServer,
} from "../../examples/mock-adapter-typescript/src/server.js";
import { GrpcAdapterGateway } from "../../packages/adapter-protocol/src/index.js";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";
import {
  IdempotencyRepository,
  OperationSnapshotRepository,
  TaskRepository,
  runMigrations,
} from "../../packages/persistence-postgres/src/index.js";
import {
  DurableCommandDispatcher,
  DurableScheduler,
  RecoveryManager,
  TaskEngine,
} from "../../packages/task-engine/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined)
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration");

const schema = `rc1_full_upgrade_${process.pid.toString()}`;
const providerId = "rc1-upgrade-provider";
const authorizationHash = "a".repeat(64);
const snapshotId = "00000000-0000-4000-8000-000000000100";
const ids = {
  admissionPending: "00000000-0000-4000-8000-000000000101",
  admissionUncertain: "00000000-0000-4000-8000-000000000102",
  working: "00000000-0000-4000-8000-000000000103",
  queued: "00000000-0000-4000-8000-000000000104",
  input: "00000000-0000-4000-8000-000000000105",
  stopping: "00000000-0000-4000-8000-000000000106",
  scheduled: "00000000-0000-4000-8000-000000000107",
  terminal: "00000000-0000-4000-8000-000000000108",
};
const hashes = new Map(
  Object.values(ids).map((id, index) => [id, (index + 1).toString(16).repeat(64)]),
);
const publishedRc1Checksums = {
  "001_operation_snapshot.sql": "fb130bdd77c67e9bcfc37e609a82d4fe67fba17e9058ce709ecb3bfe75a47c28",
  "002_task_lifecycle.sql": "656c286e7b9c9d3a7bc45de56589738b3e15c6f9237065889f2815d194832e78",
  "003_idempotency.sql": "91ef8d20caea9fd321fa8aec0eaab17dd2e741732d7181f36d2256f6b663d5ad",
  "004_durable_timing.sql": "dd5fc0cd4cbfde7c695d6cfe8bef3001076e39a744bb22ab8a251764843782c4",
  "005_task_controls.sql": "4566c30477428c20e375b200ffa3b144ca88617af122e28e5039173b77389516",
  "006_recovery_hardening.sql": "9c613b678a99742201c512cfcb0f42b091ff860bfd0bf73f3cc79a2a58370f47",
} as const;
const adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
const pool = new Pool({
  connectionString: databaseUrl,
  max: 8,
  options: `-c search_path=${schema}`,
});
let rc1Migrations: string;
let adapter: grpc.Server;
let gateway: GrpcAdapterGateway;
let engine: TaskEngine;

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  rc1Migrations = await copyMigrationsThrough(6);
  await runMigrations(pool, rc1Migrations);

  adapter = createMockAdapterServer({ providerId });
  const port = await bindMockAdapter(adapter, "127.0.0.1:0");
  gateway = new GrpcAdapterGateway({ endpoint: `127.0.0.1:${String(port)}`, providerId });
  const manifest = new OperationRegistry().validate(await gateway.describeProvider());
  const snapshots = await new OperationSnapshotRepository(pool).saveManifest(manifest);
  const actualSnapshot = snapshots.get("durable_task");
  if (actualSnapshot === undefined) throw new Error("durable_task snapshot missing");
  await pool.query("UPDATE operation_snapshot SET snapshot_id=$1 WHERE snapshot_id=$2", [
    snapshotId,
    actualSnapshot,
  ]);

  await seedAdapterExecution(ids.admissionUncertain, { resourceId: "admission-uncertain" });
  await seedAdapterExecution(ids.working, { resourceId: "working" });
  await seedAdapterExecution(ids.queued, { resourceId: "queued", scenario: "queued_start" });
  await seedAdapterExecution(ids.input, { resourceId: "input", scenario: "multi_round_input" });
  await seedAdapterExecution(ids.stopping, { resourceId: "stopping" });

  await insertAdmission(ids.admissionPending, "PENDING", { resourceId: "admission-pending" });
  await insertAdmission(ids.admissionUncertain, "UNCERTAIN", {
    resourceId: "admission-uncertain",
  });
  await insertTask(ids.working, "RUNNING", "working", { resourceId: "working" });
  await insertTask(ids.queued, "QUEUED", "working", {
    resourceId: "queued",
    scenario: "queued_start",
  });
  await insertTask(ids.input, "INPUT_REQUIRED", "input_required", {
    resourceId: "input",
    scenario: "multi_round_input",
  });
  await insertTask(ids.stopping, "STOPPING", "working", { resourceId: "stopping" });
  await insertTask(ids.scheduled, "SCHEDULED", "working", { resourceId: "scheduled" });
  await insertTask(ids.terminal, "TERMINAL_COMPLETED", "completed", {
    resourceId: "terminal",
  });
  await pool.query(
    `UPDATE provider_task SET result='{"resourceId":"terminal","completed":true}'::jsonb,
       ttl_ms=60000 WHERE task_id=$1`,
    [ids.terminal],
  );
  await pool.query(
    `INSERT INTO task_input_request(task_id, request_key, schema, status)
     VALUES ($1, 'approval', '{"type":"boolean"}'::jsonb, 'OPEN')`,
    [ids.input],
  );
  await pool.query(
    `INSERT INTO task_command(task_id, command_sequence, command_type, request_hash, state, payload)
     VALUES ($1, 1, 'CANCEL', repeat('c',64), 'PENDING', '{"reason":"USER_REQUESTED"}'::jsonb)`,
    [ids.stopping],
  );
  await pool.query(
    `INSERT INTO task_observation(task_id, revision, type, reason_code, occurred_at, payload)
     VALUES ($1, 7, 'task.progress', 'RUNNING', clock_timestamp(), '{"percent":50}'::jsonb)`,
    [ids.working],
  );
  await pool.query(
    `INSERT INTO outbox_event(event_id, aggregate_id, event_type, payload)
     VALUES ('00000000-0000-4000-8000-000000000109', $1, 'task.progress', '{"percent":50}'::jsonb)`,
    [ids.working],
  );
  await pool.query(
    `INSERT INTO idempotency_record(
       authorization_context_hash, operation_name, idempotency_key, argument_hash,
       execution_mode, simulation_key, stable_task_id, state)
     VALUES (repeat('a',64), 'durable_task', 'rc1-pending', repeat('b',64),
       'LIVE', '', '00000000-0000-4000-8000-000000000110', 'PENDING')`,
  );

  await runMigrations(pool);
  engine = new TaskEngine(
    manifest,
    new Map([["durable_task", snapshotId]]),
    gateway,
    new TaskRepository(pool),
    new IdempotencyRepository(pool),
  );
});

afterAll(async () => {
  gateway.close();
  await new Promise<void>((done) => adapter.tryShutdown(() => done()));
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await adminPool.end();
  await rm(rc1Migrations, { recursive: true, force: true });
});

describe("T-047 rc.1 full-state database forward migration", () => {
  it("preserves and backfills every required rc.1 fixture", async () => {
    for (const [file, expected] of Object.entries(publishedRc1Checksums)) {
      const source = (
        await readFile(resolve(process.cwd(), "migrations", file), "utf8")
      ).replaceAll("\r\n", "\n");
      expect(createHash("sha256").update(source).digest("hex")).toBe(expected);
      expect(
        (
          await pool.query<{ checksum: string }>(
            "SELECT checksum FROM runtime_schema_migration WHERE version=$1",
            [file],
          )
        ).rows[0]?.checksum,
      ).toBe(expected);
    }
    expect(
      (
        await pool.query<{ count: string }>(
          "SELECT count(*) FROM provider_task WHERE task_id = ANY($1::uuid[])",
          [Object.values(ids).slice(2)],
        )
      ).rows[0]?.count,
    ).toBe("6");
    expect(
      await pool.query(
        `SELECT 1 FROM provider_task WHERE task_id=$1 AND observation_revision=7
         AND last_confirmed_at IS NOT NULL`,
        [ids.working],
      ),
    ).toMatchObject({ rowCount: 1 });
    expect(
      await pool.query(
        `SELECT 1 FROM provider_task WHERE task_id=$1 AND terminal_at IS NOT NULL
         AND handle_expires_at=terminal_at + interval '60 seconds'`,
        [ids.terminal],
      ),
    ).toMatchObject({ rowCount: 1 });
    expect(
      await pool.query(
        `SELECT 1 FROM task_command WHERE task_id=$1 AND stop_reason='USER_REQUESTED'
         AND priority=10 AND state='PENDING'`,
        [ids.stopping],
      ),
    ).toMatchObject({ rowCount: 1 });
    expect(
      await pool.query(
        "SELECT 1 FROM outbox_event WHERE aggregate_id=$1 AND event_key=event_id::text",
        [ids.working],
      ),
    ).toMatchObject({ rowCount: 1 });
    expect(
      await pool.query(
        `SELECT 1 FROM idempotency_record WHERE idempotency_key='rc1-pending'
         AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND claim_attempt=1`,
      ),
    ).toMatchObject({ rowCount: 1 });
    expect(
      (await pool.query<{ count: string }>("SELECT count(*) FROM runtime_schema_migration")).rows[0]
        ?.count,
    ).toBe("24");
    expect(
      await pool.query(
        `SELECT 1 FROM provider_task WHERE task_id=$1
         AND next_recovery_at IS NOT NULL AND recovery_failure_count=0`,
        [ids.working],
      ),
    ).toMatchObject({ rowCount: 1 });
    await runMigrations(pool);
  });

  it("continues recovery, dispatch and scheduling in the required order", async () => {
    const repository = new TaskRepository(pool);
    const recovery = await new RecoveryManager(engine, repository).scan();
    expect(recovery.admissionsRecovered).toBe(2);
    expect(recovery.tasksReconciled).toBeGreaterThanOrEqual(3);

    const dispatcher = await new DurableCommandDispatcher(gateway, repository).tick();
    expect(dispatcher.acknowledged).toBe(1);
    const scheduler = await new DurableScheduler(engine.manifest, gateway, repository).tick();
    expect(scheduler.started).toBe(1);
    await pool.query(
      "UPDATE provider_task SET updated_at=clock_timestamp()-interval '1 minute' WHERE task_id=ANY($1::uuid[])",
      [[ids.scheduled, ids.stopping]],
    );

    expect(await engine.getTask(ids.terminal, authorization())).toMatchObject({
      status: "completed",
    });
    expect(await engine.getTask(ids.scheduled, authorization())).toMatchObject({
      status: "completed",
    });
    expect(await engine.getTask(ids.stopping, authorization())).toMatchObject({
      status: "cancelled",
    });
    expect(await repository.getById(ids.input)).not.toBeNull();
  });
});

async function copyMigrationsThrough(maximum: number): Promise<string> {
  const target = await mkdtemp(resolve(tmpdir(), "sdar-rc1-full-migrations-"));
  const source = resolve(process.cwd(), "migrations");
  for (const file of await readdir(source)) {
    const version = Number.parseInt(file.slice(0, 3), 10);
    if (/^\d{3}_.+\.sql$/.test(file) && version <= maximum) {
      await copyFile(resolve(source, file), resolve(target, file));
    }
  }
  return target;
}

async function seedAdapterExecution(taskId: string, argumentsValue: Record<string, unknown>) {
  await gateway.startOperation("durable_task", argumentsValue, {
    taskId,
    argumentHash: requiredHash(taskId),
    authorizationContextHash: authorizationHash,
    executionMode: "live",
  });
}

async function insertAdmission(
  taskId: string,
  state: "PENDING" | "UNCERTAIN",
  argumentsValue: Record<string, unknown>,
) {
  await pool.query(
    `INSERT INTO admission_intent(
       task_id, provider_id, operation_name, operation_snapshot_id,
       authorization_context_hash, execution_mode, arguments, argument_hash, state,
       not_before, latest_start_at)
     VALUES ($1,$2,'durable_task',$3,$4,'live',$5,$6,$7,clock_timestamp(),
       clock_timestamp()+interval '1 minute')`,
    [
      taskId,
      providerId,
      snapshotId,
      authorizationHash,
      argumentsValue,
      requiredHash(taskId),
      state,
    ],
  );
}

async function insertTask(
  taskId: string,
  internalState: string,
  mcpStatus: string,
  argumentsValue: Record<string, unknown>,
) {
  const scheduled = internalState === "SCHEDULED";
  await pool.query(
    `INSERT INTO provider_task(
       task_id, provider_id, operation_name, operation_snapshot_id,
       authorization_context_hash, execution_mode, arguments, argument_hash,
       external_execution_id, internal_state, mcp_status, substate, accepted_at,
       actual_started_at, not_before, latest_start_at, timing, adapter_revision)
     VALUES ($1,$2,'durable_task',$3,$4,'live',$5,$6,$7,$8,$9,$10,
       clock_timestamp()-interval '1 minute',
       CASE WHEN $11 THEN NULL ELSE clock_timestamp()-interval '1 minute' END,
       CASE WHEN $11 THEN clock_timestamp()-interval '1 second' ELSE NULL END,
       CASE WHEN $11 THEN clock_timestamp()+interval '1 minute' ELSE NULL END,
       CASE WHEN $11 THEN
         jsonb_build_object('start',jsonb_build_object('mode','scheduled','scheduledAt',
           to_char(clock_timestamp()-interval '1 second','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'startToleranceMs',61000),'maxElapsedMs',NULL)
         ELSE '{}'::jsonb END,
       CASE WHEN $11 THEN 0 WHEN $8='TERMINAL_COMPLETED' THEN 2 ELSE 1 END)`,
    [
      taskId,
      providerId,
      snapshotId,
      authorizationHash,
      argumentsValue,
      requiredHash(taskId),
      scheduled ? null : `task-${taskId}`,
      internalState,
      mcpStatus,
      substate(internalState),
      scheduled,
    ],
  );
}

function requiredHash(taskId: string): string {
  const value = hashes.get(taskId);
  if (value === undefined) throw new Error(`missing hash for ${taskId}`);
  return value;
}

function substate(state: string): string | null {
  if (state === "SCHEDULED") return "scheduled";
  if (state === "QUEUED") return "queued";
  if (state === "RUNNING") return "running";
  if (state === "STOPPING") return "stopping";
  return null;
}

function authorization() {
  return { hash: authorizationHash, executionMode: "live" as const, simulationId: null };
}
