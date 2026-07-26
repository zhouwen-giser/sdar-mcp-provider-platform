import { randomUUID } from "node:crypto";
import type * as grpc from "@grpc/grpc-js";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  bindMockAdapter,
  createMockAdapterServer,
} from "../../examples/mock-adapter-typescript/src/server.js";
import { GrpcAdapterGateway } from "../../packages/adapter-protocol/src/index.js";
import type { AuthorizationContext } from "../../packages/domain/src/index.js";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";
import {
  OperationSnapshotRepository,
  TaskRepository,
  runMigrations,
} from "../../packages/persistence-postgres/src/index.js";
import { DurableCommandDispatcher, TaskEngine } from "../../packages/task-engine/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) throw new Error("TEST_DATABASE_URL is required for MRTR recovery");

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "live",
  simulationId: null,
};
let adapter: grpc.Server;
let gateway: GrpcAdapterGateway;
let engine: TaskEngine;

beforeAll(async () => {
  await pool.query(`DROP TABLE IF EXISTS
    task_input_response_inbox, provider_ops_delivery, runtime_lease, outbox_event,
    idempotency_record, task_command, task_input_request, task_observation, provider_task,
    admission_intent, operation_snapshot, runtime_schema_migration CASCADE`);
  await runMigrations(pool);
  adapter = createMockAdapterServer({ providerId: "closure-provider" });
  const port = await bindMockAdapter(adapter, "127.0.0.1:0");
  gateway = new GrpcAdapterGateway({
    endpoint: `127.0.0.1:${String(port)}`,
    providerId: "closure-provider",
  });
  const manifest = new OperationRegistry().validate(await gateway.describeProvider());
  const snapshots = await new OperationSnapshotRepository(pool).saveManifest(manifest);
  engine = new TaskEngine(manifest, snapshots, gateway, new TaskRepository(pool));
});

beforeEach(async () => {
  await pool.query(`TRUNCATE TABLE
    task_input_response_inbox, provider_ops_delivery, runtime_lease, outbox_event,
    idempotency_record, task_command, task_input_request, task_observation, provider_task,
    admission_intent RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  gateway.close();
  await new Promise<void>((resolve) => adapter.tryShutdown(() => resolve()));
  await pool.end();
});

describe("MRTR durable recovery", () => {
  it("exposes durable response promotion independently from beginCommand", () => {
    expect(typeof TaskRepository.prototype.promotePendingInputResponses).toBe("function");
  });

  it("R-001 R-002 survives active PAUSE arbitration and a restarted dispatcher", async () => {
    const taskId = await createInputTask("active-command");
    const repository = new TaskRepository(pool);
    await repository.beginCommand(taskId, "PAUSE", randomUUID(), {});

    await engine.updateTaskInputResponses(
      taskId,
      { approval: { action: "accept", content: true } },
      authorization,
    );
    expect(await inboxState(taskId)).toBe("PENDING");

    await new DurableCommandDispatcher(gateway, repository).tick();
    expect(await inboxState(taskId)).toBe("ASSIGNED");
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();

    expect(await inboxState(taskId)).toBe("ACKNOWLEDGED");
    expect(await repository.listInputRequests(taskId)).toMatchObject([
      { key: "approval", status: "ANSWERED" },
    ]);
  });

  it("marks accepted input ignored when a Task is stopping", async () => {
    const taskId = await createInputTask("stopping");
    await engine.updateTaskInputResponses(
      taskId,
      { approval: { action: "accept", content: true } },
      authorization,
    );
    await pool.query(
      `UPDATE provider_task SET cancel_requested=true, internal_state='STOPPING', substate='stopping'
       WHERE task_id=$1`,
      [taskId],
    );

    expect(await new TaskRepository(pool).promotePendingInputResponses()).toBe(0);
    expect(await inboxState(taskId)).toBe("IGNORED");
    expect(
      await pool.query("SELECT 1 FROM task_command WHERE task_id=$1 AND command_type='UPDATE'", [
        taskId,
      ]),
    ).toHaveProperty("rowCount", 0);
  });

  it("R-003 R-004 ignores unknown, ANSWERED, and SUPERSEDED keys independently", async () => {
    const answeredTask = await createInputTask("answered");
    const supersededTask = await createInputTask("superseded");
    await pool.query(
      `UPDATE task_input_request
       SET status='ANSWERED', answer_hash=$2, answer='true'::jsonb,
           response_hash=$2, response_json='{"action":"accept","content":true}'::jsonb,
           answered_at=clock_timestamp()
       WHERE task_id=$1 AND request_key='approval'`,
      [answeredTask, "b".repeat(64)],
    );
    await pool.query(
      `UPDATE task_input_request SET status='SUPERSEDED'
       WHERE task_id=$1 AND request_key='approval'`,
      [supersededTask],
    );
    const repository = new TaskRepository(pool);

    expect(
      await repository.acceptMcpInputResponses(answeredTask, authorization, {
        approval: { action: "decline" },
        unknown: { action: "cancel" },
      }),
    ).toMatchObject({
      acceptedKeys: [],
      ignoredAnsweredKeys: ["approval"],
      ignoredUnknownKeys: ["unknown"],
    });
    expect(
      await repository.acceptMcpInputResponses(supersededTask, authorization, {
        approval: { action: "decline" },
      }),
    ).toMatchObject({ acceptedKeys: [], ignoredSupersededKeys: ["approval"] });
  });

  it("records permanent Adapter rejection on the assigned Inbox row", async () => {
    const taskId = await createInputTask("rejected");
    await engine.updateTaskInputResponses(
      taskId,
      { approval: { action: "accept", content: true } },
      authorization,
    );
    const repository = new TaskRepository(pool);
    await repository.promotePendingInputResponses();
    const commands = await repository.claimDueCommands(new Date(), "reject-worker", 30_000, 1);
    const command = commands[0];
    if (command === undefined) throw new Error("Expected promoted UPDATE command");

    await repository.rejectInputResponseAndFailTask(
      command,
      "ADAPTER_REJECTED",
      "Adapter rejected the input response.",
    );

    expect(await inboxRecord(taskId)).toMatchObject({
      state: "FAILED",
      last_error_code: "INPUT_RESPONSE_REJECTED",
    });
    expect(await repository.listInputRequests(taskId)).toMatchObject([
      { key: "approval", status: "SUPERSEDED" },
    ]);
    expect(await repository.getById(taskId)).toMatchObject({
      internalState: "TERMINAL_FAILED",
      mcpStatus: "failed",
      error: { code: -32603, data: { reasonCode: "INPUT_RESPONSE_REJECTED" } },
    });
  });

  it("fails the Task after bounded input-response delivery exhaustion", async () => {
    const taskId = await createInputTask("delivery-exhausted");
    await engine.updateTaskInputResponses(
      taskId,
      { approval: { action: "accept", content: true } },
      authorization,
    );
    const unavailableGateway = {
      updateMcpTaskExecution: () => Promise.reject(new Error("adapter unavailable")),
    } as unknown as GrpcAdapterGateway;
    const repository = new TaskRepository(pool);
    const dispatcher = new DurableCommandDispatcher(
      unavailableGateway,
      repository,
      undefined,
      "exhaust-worker",
      undefined,
      undefined,
      undefined,
      { maxInputResponseAttempts: 1 },
    );

    expect(await dispatcher.tick()).toMatchObject({ exhausted: 1 });
    expect(await inboxRecord(taskId)).toMatchObject({
      state: "FAILED",
      last_error_code: "INPUT_RESPONSE_DELIVERY_EXHAUSTED",
    });
    expect(await repository.getById(taskId)).toMatchObject({
      internalState: "TERMINAL_FAILED",
      mcpStatus: "failed",
      error: { data: { reasonCode: "INPUT_RESPONSE_DELIVERY_EXHAUSTED" } },
    });
  });
});

async function createInputTask(label: string): Promise<string> {
  const operation = engine.manifest.operations.find(
    (candidate) => candidate.name === "durable_task",
  );
  if (operation === undefined) throw new Error("durable_task operation is missing");
  const created = await engine.callOperation(
    operation,
    { resourceId: `${label}-${randomUUID()}`, scenario: "input_required_frozen" },
    authorization,
  );
  if (created.kind !== "task") throw new Error("Expected input-required Task");
  return String(created.task.taskId);
}

async function inboxState(taskId: string): Promise<string | undefined> {
  const result = await pool.query<{ state: string }>(
    "SELECT state FROM task_input_response_inbox WHERE task_id=$1 AND request_key='approval'",
    [taskId],
  );
  return result.rows[0]?.state;
}

async function inboxRecord(taskId: string): Promise<
  | {
      state: string;
      last_error_code: string | null;
    }
  | undefined
> {
  const result = await pool.query<{ state: string; last_error_code: string | null }>(
    `SELECT state, last_error_code FROM task_input_response_inbox
     WHERE task_id=$1 AND request_key='approval'`,
    [taskId],
  );
  return result.rows[0];
}
