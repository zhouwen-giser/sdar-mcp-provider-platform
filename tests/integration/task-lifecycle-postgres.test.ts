import { createHash, randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolResultSchema,
  CreateTaskResultSchema,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import Fastify from "fastify";
import type * as grpc from "@grpc/grpc-js";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  bindMockAdapter,
  createMockAdapterServer,
} from "../../examples/mock-adapter-typescript/src/server.js";
import { GrpcAdapterGateway } from "../../packages/adapter-protocol/src/index.js";
import type { AuthorizationContext, Clock } from "../../packages/domain/src/index.js";
import { McpProtocolHandler } from "../../packages/mcp-protocol/src/index.js";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";
import {
  OperationSnapshotRepository,
  IdempotencyRepository,
  OutboxRepository,
  TaskRepository,
  runMigrations,
} from "../../packages/persistence-postgres/src/index.js";
import {
  DurableCommandDispatcher,
  OutboxCleaner,
  DurableScheduler,
  TaskEngine,
  TtlCleaner,
} from "../../packages/task-engine/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined)
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration");

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "live",
  simulationId: null,
  traceId: "1".repeat(32),
  rootTraceparent: `00-${"1".repeat(32)}-${"2".repeat(16)}-01`,
  rootTracestate: "vendor=test",
  correlationId: "trace-persistence-test",
};
let adapter: grpc.Server;
let gateway: GrpcAdapterGateway;
let engine: TaskEngine;
let sideEffectCount = 0;
let controlSideEffectCount = 0;
let lastReservationRef: string | undefined;

class FakeClock implements Clock {
  constructor(private value: Date) {}
  now(): Date {
    return new Date(this.value);
  }
  advance(milliseconds: number): void {
    this.value = new Date(this.value.getTime() + milliseconds);
  }
}

beforeAll(async () => {
  await pool.query(`DROP TABLE IF EXISTS
    task_input_response_inbox, provider_ops_delivery, runtime_lease, outbox_event, idempotency_record,
    task_command, task_input_request,
    task_observation, provider_task, admission_intent, operation_snapshot,
    runtime_schema_migration CASCADE`);
  await runMigrations(pool);
  adapter = createMockAdapterServer({
    providerId: "task-provider",
    onStartSideEffect: (_taskId, reservationRef) => {
      sideEffectCount += 1;
      lastReservationRef = reservationRef;
    },
    onControlSideEffect: () => {
      controlSideEffectCount += 1;
    },
  });
  const port = await bindMockAdapter(adapter, "127.0.0.1:0");
  gateway = new GrpcAdapterGateway({
    endpoint: `127.0.0.1:${String(port)}`,
    providerId: "task-provider",
  });
  const manifest = new OperationRegistry().validate(await gateway.describeProvider());
  const snapshots = await new OperationSnapshotRepository(pool).saveManifest(manifest);
  engine = new TaskEngine(
    manifest,
    snapshots,
    gateway,
    new TaskRepository(pool),
    new IdempotencyRepository(pool),
  );
});

beforeEach(async () => {
  lastReservationRef = undefined;
  await pool.query(`TRUNCATE TABLE
    task_input_response_inbox, provider_ops_delivery, runtime_lease, outbox_event, idempotency_record,
    task_command, task_input_request,
    task_observation, provider_task, admission_intent
    RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  gateway.close();
  await new Promise<void>((resolve) => adapter.tryShutdown(() => resolve()));
  await pool.query("DROP TABLE IF EXISTS task_input_response_inbox CASCADE");
  await pool.end();
});

describe("durable task lifecycle", () => {
  it("task_trace_context_survives_restart", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "trace-context" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected durable task");
    const restored = await new TaskRepository(pool).getById(String(created.task.taskId));
    expect(restored).toMatchObject({
      traceId: "1".repeat(32),
      rootTraceparent: `00-${"1".repeat(32)}-${"2".repeat(16)}-01`,
      rootTracestate: "vendor=test",
      correlationId: "trace-persistence-test",
    });
  });

  it("C-038 C-039 publishes before returning and remains queryable across Runtime/SDAR restart", async () => {
    const operation = requiredOperation("durable_task");
    const created = await engine.callOperation(
      operation,
      { resourceId: "resource-1" },
      authorization,
    );
    expect(created.kind).toBe("task");
    if (created.kind !== "task") throw new Error("Expected task result");
    expect(created.task.status).toBe("working");
    const taskId = String(created.task.taskId);
    const repository = new TaskRepository(pool);
    const initiallyCommitted = await repository.getById(taskId);
    expect(initiallyCommitted?.runtimeRevision).toBe("1");

    const visible = await pool.query<{ state: string }>(
      `SELECT admission_intent.state FROM provider_task
       JOIN admission_intent USING (task_id) WHERE provider_task.task_id=$1`,
      [taskId],
    );
    expect(visible.rows[0]?.state).toBe("PUBLISHED");

    const restarted = new TaskEngine(
      engine.manifest,
      engine.operationSnapshotIds,
      gateway,
      new TaskRepository(pool),
    );
    const completed = await restarted.getTask(taskId, authorization);
    expect(completed).toMatchObject({ taskId, status: "completed" });
    expect(completed.result).toMatchObject({
      isError: false,
      structuredContent: { resourceId: "resource-1", completed: true },
    });

    const finallyCommitted = await repository.getById(taskId);
    expect(BigInt(finallyCommitted?.runtimeRevision ?? "0")).toBeGreaterThan(1n);
    expect(finallyCommitted?.runtimeUpdatedAt.toISOString()).toBe(
      finallyCommitted?.updatedAt.toISOString(),
    );
    const unchanged = await repository.applySnapshot(taskId, 99, {
      internalState: "RUNNING",
      mcpStatus: "working",
      substate: "running",
      statusMessage: "late nonterminal snapshot",
      result: null,
      error: null,
      terminal: false,
      observationType: "task.progress",
    });
    expect(unchanged.mcpStatus).toBe("completed");
    await expect(
      restarted.getTask(taskId, { ...authorization, hash: "b".repeat(64) }),
    ).rejects.toThrow("TASK_NOT_FOUND");
  });

  it("returns a committed Task without re-borrowing the only PoolClient", async () => {
    const singleConnectionPool = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
      const snapshots = await new OperationSnapshotRepository(singleConnectionPool).saveManifest(
        engine.manifest,
      );
      const singleConnectionEngine = new TaskEngine(
        engine.manifest,
        snapshots,
        gateway,
        new TaskRepository(singleConnectionPool),
      );
      const created = await Promise.race([
        singleConnectionEngine.callOperation(
          requiredOperation("durable_task"),
          { resourceId: "rc2-pool-one-publication" },
          authorization,
        ),
        rejectAfter(2_000, "Task publication re-borrowed its checked-out PoolClient"),
      ]);
      expect(created).toMatchObject({ kind: "task", task: { status: "working" } });
      expect(singleConnectionPool.waitingCount).toBe(0);
    } finally {
      await singleConnectionPool.end();
    }
  });

  it("persists and dispatches frozen MRTR inputResponses over the additive Adapter fields", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "frozen-mrtr", scenario: "input_required_frozen" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected frozen MRTR Task");
    const taskId = String(created.task.taskId);
    const repository = new TaskRepository(pool);
    expect(await repository.listInputRequests(taskId)).toMatchObject([
      {
        key: "approval",
        status: "OPEN",
        requestJson: {
          method: "elicitation/create",
          params: { mode: "form", message: "Approve the reference operation." },
        },
      },
    ]);

    const before = controlSideEffectCount;
    await engine.updateTaskInputResponses(
      taskId,
      { approval: { action: "accept", content: true }, unknown: { action: "decline" } },
      authorization,
    );
    expect(controlSideEffectCount).toBe(before);
    await new DurableCommandDispatcher(gateway, repository).tick();
    expect(controlSideEffectCount).toBe(before + 1);
    expect(await repository.listInputRequests(taskId)).toMatchObject([
      {
        key: "approval",
        status: "ANSWERED",
        responseJson: { action: "accept", content: true },
      },
    ]);
    expect(await engine.getTask(taskId, authorization)).toMatchObject({ status: "completed" });
  });

  it("records cooperative cancellation when the Adapter cannot stop", async () => {
    const created = await engine.callOperation(
      requiredOperation("flex_task"),
      { resourceId: "cooperative-cancel", scenario: "running" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected task-capable Task");
    const taskId = String(created.task.taskId);
    const repository = new TaskRepository(pool);
    const before = await repository.getById(taskId);

    await engine.cancelTaskCooperatively(taskId, authorization);

    const after = await repository.getById(taskId);
    expect(after).toMatchObject({
      cancelRequested: true,
      stopReason: "USER_REQUESTED",
      mcpStatus: "working",
    });
    expect(after?.internalState).not.toBe("STOPPING");
    expect(BigInt(after?.runtimeRevision ?? "0")).toBeGreaterThan(
      BigInt(before?.runtimeRevision ?? "0"),
    );
    expect(
      await pool.query("SELECT 1 FROM task_command WHERE task_id=$1", [taskId]),
    ).toHaveProperty("rowCount", 0);
  });

  it("maps Adapter Evidence into completed frozen CallToolResult without requirementId", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "evidence-resource", scenario: "evidence_success" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected Evidence Task");
    const taskId = String(created.task.taskId);
    await engine.getTask(taskId, authorization);
    const frozen = await engine.getFrozenTask(taskId, authorization);
    expect(frozen).toMatchObject({
      status: "completed",
      result: {
        resultType: "complete",
        _meta: {
          "io.sdar/evidence": {
            profileVersion: "1.0",
            items: [
              {
                evidenceType: "resource.completion",
                payloadRef: { kind: "structured_content", jsonPointer: "/resourceId" },
              },
            ],
          },
        },
      },
    });
    expect(JSON.stringify(frozen)).not.toContain("requirementId");
  });

  it("returns flat frozen CreateTaskResult and immediately consistent tasks/get", async () => {
    const created = await engine.callFrozenOperation(
      requiredOperation("durable_task"),
      { resourceId: "flat-frozen-task", scenario: "queued_start" },
      authorization,
      "flat-frozen-idempotency",
      undefined,
      "reservation-flat-frozen",
    );
    expect(created).toMatchObject({
      resultType: "task",
      status: "working",
      _meta: { "io.sdar/taskExecution": { runtimeRevision: "1" } },
    });
    expect(typeof created.ttlMs).toBe("number");
    expect(created).not.toHaveProperty("task");
    expect(created).not.toHaveProperty("ttl");
    expect(created).not.toHaveProperty("pollInterval");
    expect(lastReservationRef).toBe("reservation-flat-frozen");
    const taskId = String(created.taskId);
    const queried = await engine.getFrozenTask(taskId, authorization);
    expect(queried).toMatchObject({
      resultType: "complete",
      taskId,
      _meta: { "io.sdar/taskExecution": { runtimeRevision: "1" } },
    });
  });

  it("C-019 ignores an unknown frozen input response key", async () => {
    const created = await engine.callFrozenOperation(
      requiredOperation("durable_task"),
      { resourceId: "frozen-input-unknown", scenario: "input_required_frozen" },
      authorization,
    );
    const taskId = String(created.taskId);
    await engine.updateTaskInputResponses(
      taskId,
      { unknown: { action: "accept", content: true } },
      authorization,
    );
    const commands = await pool.query<{ count: string }>(
      "SELECT count(*) FROM task_command WHERE task_id=$1 AND command_type='UPDATE'",
      [taskId],
    );
    expect(commands.rows[0]?.count).toBe("0");
  });

  it("C-020 accepts an identical repeat of an answered frozen input key", async () => {
    const created = await engine.callFrozenOperation(
      requiredOperation("durable_task"),
      { resourceId: "frozen-input-repeat", scenario: "input_required_frozen" },
      authorization,
    );
    const taskId = String(created.taskId);
    const response = { approval: { action: "accept" as const, content: true } };
    await engine.updateTaskInputResponses(taskId, response, authorization);
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
    await expect(
      engine.updateTaskInputResponses(taskId, response, authorization),
    ).resolves.toBeUndefined();
    const commands = await pool.query<{ count: string }>(
      "SELECT count(*) FROM task_command WHERE task_id=$1 AND command_type='UPDATE'",
      [taskId],
    );
    expect(commands.rows[0]?.count).toBe("1");
  });

  it("C-021 detects and ignores reuse of an answered frozen input key", async () => {
    const created = await engine.callFrozenOperation(
      requiredOperation("durable_task"),
      { resourceId: "frozen-input-conflict", scenario: "input_required_frozen" },
      authorization,
    );
    const taskId = String(created.taskId);
    await engine.updateTaskInputResponses(
      taskId,
      { approval: { action: "accept", content: true } },
      authorization,
    );
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
    await expect(
      engine.updateTaskInputResponses(
        taskId,
        { approval: { action: "accept", content: false } },
        authorization,
      ),
    ).resolves.toBeUndefined();
    const commands = await pool.query<{ count: string }>(
      "SELECT count(*) FROM task_command WHERE task_id=$1 AND command_type='UPDATE'",
      [taskId],
    );
    expect(commands.rows[0]?.count).toBe("1");
  });

  it("returns an inline result for terminal task-capable admission", async () => {
    const before = await pool.query<{ count: string }>("SELECT count(*) FROM provider_task");
    const result = await engine.callOperation(
      requiredOperation("flex_task"),
      { resourceId: "resource-inline", scenario: "terminal" },
      authorization,
    );
    expect(result).toMatchObject({
      kind: "result",
      result: { structuredContent: { resourceId: "resource-inline", completed: true } },
    });
    const after = await pool.query<{ count: string }>("SELECT count(*) FROM provider_task");
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it("uses official MCP task requests for immediate query and completion", async () => {
    const handler = new McpProtocolHandler(engine.manifest, gateway, engine);
    const app = Fastify();
    app.post("/mcp", async (request, reply) => {
      reply.hijack();
      await handler.handle(request.raw, reply.raw, request.body);
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === "string") throw new Error("MCP did not bind");
    const client = new Client({ name: "r3-integration", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${String(address.port)}/mcp`),
      ) as unknown as Transport,
    );
    try {
      const availability = await client.request(
        {
          method: "io.sdar/taskExecution/checkAvailability",
          params: {
            checks: [
              {
                requestId: "mcp-availability",
                operationName: "durable_task",
                arguments: { resourceId: "resource-mcp" },
              },
            ],
          },
        },
        z.object({
          profileVersion: z.literal("1.0"),
          checkedAt: z.string(),
          checks: z.array(z.object({ availability: z.string() }).loose()),
        }),
      );
      expect(availability.checks[0]?.availability).toBe("available");

      const created = await client.request(
        {
          method: "tools/call",
          params: { name: "durable_task", arguments: { resourceId: "resource-mcp" } },
        },
        CreateTaskResultSchema,
        { task: { ttl: 60_000 } },
      );
      expect(created.task.status).toBe("working");
      const completed = await client.experimental.tasks.getTask(created.task.taskId);
      expect(completed.status).toBe("completed");
      expect(
        await client.experimental.tasks.getTaskResult(created.task.taskId, CallToolResultSchema),
      ).toMatchObject({ isError: false });

      const beforeIdempotentMcp = sideEffectCount;
      const idempotentParams = {
        name: "durable_task",
        arguments: { resourceId: "resource-mcp-idempotent" },
        _meta: {
          "io.sdar/taskExecution": { idempotencyKey: "mcp-idempotency-key" },
        },
      };
      const idempotentFirst = await client.request(
        { method: "tools/call", params: idempotentParams },
        CreateTaskResultSchema,
        { task: { ttl: 60_000 } },
      );
      const idempotentDuplicate = await client.request(
        { method: "tools/call", params: idempotentParams },
        CreateTaskResultSchema,
        { task: { ttl: 60_000 } },
      );
      expect(idempotentDuplicate.task.taskId).toBe(idempotentFirst.task.taskId);
      expect(sideEffectCount - beforeIdempotentMcp).toBe(1);

      const beforeScheduledMcp = sideEffectCount;
      const scheduled = await client.request(
        {
          method: "tools/call",
          params: {
            name: "durable_task",
            arguments: { resourceId: "resource-mcp-scheduled" },
            _meta: {
              "io.sdar/taskExecution": {
                idempotencyKey: "mcp-scheduled-key",
                timing: {
                  start: {
                    mode: "scheduled",
                    scheduledAt: "2030-01-01T00:00:00Z",
                    startToleranceMs: 30_000,
                  },
                  maxElapsedMs: null,
                },
              },
            },
          },
        },
        CreateTaskResultSchema,
        { task: { ttl: 60_000 } },
      );
      expect(scheduled.task.status).toBe("working");
      expect(sideEffectCount).toBe(beforeScheduledMcp);

      const inputTask = await client.request(
        {
          method: "tools/call",
          params: {
            name: "durable_task",
            arguments: { resourceId: "resource-mcp-input", scenario: "input_required" },
          },
        },
        CreateTaskResultSchema,
        { task: { ttl: 60_000 } },
      );
      expect(inputTask.task.status).toBe("input_required");
      await client.request(
        {
          method: "tasks/update",
          params: { taskId: inputTask.task.taskId, inputs: { approval: true } },
        },
        z.object({}).loose(),
      );
      await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
      expect((await client.experimental.tasks.getTask(inputTask.task.taskId)).status).toBe(
        "completed",
      );

      const cancelTask = await client.request(
        {
          method: "tools/call",
          params: { name: "durable_task", arguments: { resourceId: "resource-mcp-cancel" } },
        },
        CreateTaskResultSchema,
        { task: { ttl: 60_000 } },
      );
      expect((await client.experimental.tasks.cancelTask(cancelTask.task.taskId)).status).toBe(
        "working",
      );
      await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
      expect((await client.experimental.tasks.getTask(cancelTask.task.taskId)).status).toBe(
        "cancelled",
      );
    } finally {
      await client.close();
      await app.close();
    }
  });

  it("leaves an uncertain durable intent if publication fails after Adapter acceptance", async () => {
    await pool.query(`CREATE OR REPLACE FUNCTION fail_task_publish() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected task publish failure'; END $$`);
    await pool.query(`CREATE TRIGGER fail_task_publish BEFORE INSERT ON provider_task
      FOR EACH ROW EXECUTE FUNCTION fail_task_publish()`);
    try {
      await expect(
        engine.callOperation(
          requiredOperation("durable_task"),
          { resourceId: "resource-crash-window" },
          authorization,
        ),
      ).rejects.toThrow("injected task publish failure");
      const intent = await pool.query<{ state: string }>(
        `SELECT state FROM admission_intent
         WHERE arguments->>'resourceId'='resource-crash-window'`,
      );
      expect(intent.rows[0]?.state).toBe("UNCERTAIN");
      const leaked = await pool.query<{ count: string }>(
        `SELECT count(*) FROM provider_task
         WHERE arguments->>'resourceId'='resource-crash-window'`,
      );
      expect(leaked.rows[0]?.count).toBe("0");
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS fail_task_publish ON provider_task");
      await pool.query("DROP FUNCTION IF EXISTS fail_task_publish()");
    }
  });

  it("leaves an uncertain durable intent when the StartOperation response is lost", async () => {
    const unavailableGateway = new GrpcAdapterGateway({
      endpoint: "127.0.0.1:1",
      providerId: "task-provider",
      timeoutMs: 250,
    });
    const uncertainEngine = new TaskEngine(
      engine.manifest,
      engine.operationSnapshotIds,
      unavailableGateway,
      new TaskRepository(pool),
    );
    try {
      await expect(
        uncertainEngine.callOperation(
          requiredOperation("durable_task"),
          { resourceId: "resource-response-loss" },
          authorization,
        ),
      ).rejects.toThrow();
      const intent = await pool.query<{ state: string }>(
        `SELECT state FROM admission_intent
         WHERE arguments->>'resourceId'='resource-response-loss'`,
      );
      expect(intent.rows[0]?.state).toBe("UNCERTAIN");
    } finally {
      unavailableGateway.close();
    }
  });

  it("serializes concurrent idempotent calls and restores task/result across restart", async () => {
    const before = sideEffectCount;
    const operation = requiredOperation("durable_task");
    const secondRuntime = new TaskEngine(
      engine.manifest,
      engine.operationSnapshotIds,
      gateway,
      new TaskRepository(pool),
      new IdempotencyRepository(pool),
    );
    const [first, duplicate] = await Promise.all([
      engine.callOperation(
        operation,
        { resourceId: "resource-idempotent" },
        authorization,
        undefined,
        "same-task-key",
      ),
      secondRuntime.callOperation(
        operation,
        { resourceId: "resource-idempotent" },
        authorization,
        undefined,
        "same-task-key",
      ),
    ]);
    expect(first.kind).toBe("task");
    expect(duplicate.kind).toBe("task");
    if (first.kind !== "task" || duplicate.kind !== "task") throw new Error("Expected tasks");
    expect(duplicate.task.taskId).toBe(first.task.taskId);
    expect(sideEffectCount - before).toBe(1);

    await expect(
      engine.callOperation(
        operation,
        { resourceId: "different-arguments" },
        authorization,
        undefined,
        "same-task-key",
      ),
    ).rejects.toThrow("IDEMPOTENCY_KEY_CONFLICT");

    const syncBefore = sideEffectCount;
    const sync = requiredOperation("echo_sync");
    const syncFirst = await engine.callOperation(
      sync,
      { message: "deduplicated" },
      authorization,
      undefined,
      "same-sync-key",
    );
    const syncAgain = await secondRuntime.callOperation(
      sync,
      { message: "deduplicated" },
      authorization,
      undefined,
      "same-sync-key",
    );
    expect(syncAgain).toEqual(syncFirst);
    expect(sideEffectCount - syncBefore).toBe(1);
  });

  it("recovers a pending idempotent admission through Reconcile", async () => {
    const before = sideEffectCount;
    const operation = requiredOperation("durable_task");
    await expect(
      engine.callOperation(
        operation,
        { resourceId: "resource-reconcile", scenario: "response_loss" },
        authorization,
        undefined,
        "response-loss-key",
      ),
    ).rejects.toThrow("injected StartOperation response loss");

    const recovered = await engine.callOperation(
      operation,
      { resourceId: "resource-reconcile", scenario: "response_loss" },
      authorization,
      undefined,
      "response-loss-key",
    );
    expect(recovered.kind).toBe("task");
    expect(sideEffectCount - before).toBe(1);
    const rows = await pool.query<{ state: string }>(
      `SELECT state FROM idempotency_record WHERE idempotency_key='response-loss-key'`,
    );
    expect(rows.rows[0]?.state).toBe("COMPLETE");
  });

  it("maps batched Availability and returns unknown on Adapter transport failure", async () => {
    const response = await engine.checkAvailability(
      [
        {
          requestId: "available",
          operationName: "durable_task",
          arguments: { state: "complete", value: { resourceId: "a" } },
        },
        {
          requestId: "restricted",
          operationName: "durable_task",
          arguments: { state: "complete", value: { resourceId: "b", scenario: "restricted" } },
        },
        {
          requestId: "disabled",
          operationName: "durable_task",
          arguments: { state: "complete", value: { resourceId: "c", scenario: "disabled" } },
        },
      ],
      authorization,
    );
    expect(response.results.map((check) => check.availability)).toEqual([
      "available",
      "restricted",
      "disabled",
    ]);

    const unavailable = new GrpcAdapterGateway({
      endpoint: "127.0.0.1:1",
      providerId: "task-provider",
      timeoutMs: 250,
    });
    try {
      const fallbackEngine = new TaskEngine(
        engine.manifest,
        engine.operationSnapshotIds,
        unavailable,
        new TaskRepository(pool),
      );
      const fallback = await fallbackEngine.checkAvailability(
        [
          {
            requestId: "unknown",
            operationName: "durable_task",
            arguments: { state: "complete", value: { resourceId: "u" } },
          },
        ],
        authorization,
      );
      expect(fallback.results[0]).toMatchObject({
        availability: "unknown",
        reasonCode: "ADAPTER_TRANSIENT_UNAVAILABLE",
      });
    } finally {
      unavailable.close();
    }
  });

  it("scheduler_decision_uses_envelope", async () => {
    const clock = new FakeClock(new Date("2026-07-16T12:00:00Z"));
    const scheduledEngine = new TaskEngine(
      engine.manifest,
      engine.operationSnapshotIds,
      gateway,
      new TaskRepository(pool),
      new IdempotencyRepository(pool),
      clock,
    );
    const repository = new TaskRepository(pool);
    const schedulerEvents: [string, number][] = [];
    const firstWorker = new DurableScheduler(
      engine.manifest,
      gateway,
      repository,
      clock,
      "worker-1",
      undefined,
      undefined,
      { onEvent: (event, amount) => schedulerEvents.push([event, amount]) },
    );
    const secondWorker = new DurableScheduler(
      engine.manifest,
      gateway,
      new TaskRepository(pool),
      clock,
      "worker-2",
      undefined,
      undefined,
      { onEvent: (event, amount) => schedulerEvents.push([event, amount]) },
    );
    const before = sideEffectCount;
    const created = await scheduledEngine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-scheduled" },
      authorization,
      undefined,
      "scheduled-idempotency",
      {
        start: {
          mode: "scheduled",
          scheduledAt: "2026-07-16T12:00:01Z",
          startToleranceMs: 1_000,
        },
        maxElapsedMs: 5_000,
      },
      "reservation-scheduled",
    );
    expect(created.kind).toBe("task");
    if (created.kind !== "task") throw new Error("Expected scheduled task");
    expect(created.task).toMatchObject({ status: "working" });
    expect(sideEffectCount).toBe(before);
    expect(await firstWorker.tick()).toMatchObject({ started: 0 });
    expect(sideEffectCount).toBe(before);

    clock.advance(1_000);
    const claims = await Promise.all([firstWorker.tick(), secondWorker.tick()]);
    expect(claims.reduce((sum, tick) => sum + tick.started, 0)).toBe(1);
    expect(sideEffectCount - before).toBe(1);
    expect(lastReservationRef).toBe("reservation-scheduled");
    expect(schedulerEvents).toEqual([
      ["scheduled", 1],
      ["claimed", 1],
      ["started", 1],
    ]);
    const task = await scheduledEngine.getTask(String(created.task.taskId), authorization);
    expect(task.status).toBe("completed");
    const decisions = await pool.query<{ event_type: string }>(
      `SELECT record_body->>'eventType' AS event_type FROM provider_ops_delivery
       WHERE aggregate_id=$1 AND record_type='provider.scheduler.decision'
       ORDER BY created_at`,
      [String(created.task.taskId)],
    );
    expect(decisions.rows.map((row) => row.event_type)).toEqual(
      expect.arrayContaining(["claimed", "started"]),
    );
  });

  it("T-013 reconciles a response-lost scheduled start without a duplicate side effect", async () => {
    const clock = new FakeClock(new Date("2026-07-16T12:30:00Z"));
    const repository = new TaskRepository(pool);
    const scheduledEngine = new TaskEngine(
      engine.manifest,
      engine.operationSnapshotIds,
      gateway,
      repository,
      undefined,
      clock,
    );
    const before = sideEffectCount;
    const created = await scheduledEngine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-scheduled-response-loss", scenario: "response_loss" },
      authorization,
      undefined,
      undefined,
      {
        start: {
          mode: "scheduled",
          scheduledAt: clock.now().toISOString(),
          startToleranceMs: 5_000,
        },
        maxElapsedMs: null,
      },
    );
    if (created.kind !== "task") throw new Error("Expected scheduled Task");
    const taskId = String(created.task.taskId);
    const first = new DurableScheduler(
      engine.manifest,
      gateway,
      repository,
      clock,
      "response-loss-1",
    );
    expect(await first.tick()).toMatchObject({ deferred: 1, started: 0 });
    expect(sideEffectCount - before).toBe(1);
    expect(await repository.getById(taskId)).toMatchObject({
      internalState: "STARTING",
      invocationAttempt: 1,
      externalExecutionId: null,
    });
    clock.advance(1_000);
    const outcomes = await Promise.all([
      first.tick(),
      new DurableScheduler(
        engine.manifest,
        gateway,
        new TaskRepository(pool),
        clock,
        "response-loss-2",
      ).tick(),
    ]);
    expect(outcomes.reduce((sum, tick) => sum + tick.reconciled, 0)).toBe(1);
    expect(sideEffectCount - before).toBe(1);
    const recovered = await repository.getById(taskId);
    expect(recovered).toMatchObject({
      internalState: "RUNNING",
      invocationAttempt: 1,
    });
    expect(typeof recovered?.externalExecutionId).toBe("string");
  });

  it("completes a missed start window without invoking the Adapter", async () => {
    const clock = new FakeClock(new Date("2099-07-16T13:00:00Z"));
    const scheduledEngine = new TaskEngine(
      engine.manifest,
      engine.operationSnapshotIds,
      gateway,
      new TaskRepository(pool),
      undefined,
      clock,
    );
    const scheduler = new DurableScheduler(
      engine.manifest,
      gateway,
      new TaskRepository(pool),
      clock,
      "miss-worker",
    );
    const before = sideEffectCount;
    const created = await scheduledEngine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-window-missed" },
      authorization,
      undefined,
      undefined,
      {
        start: {
          mode: "scheduled",
          scheduledAt: "2099-07-16T13:00:01Z",
          startToleranceMs: 500,
        },
        maxElapsedMs: null,
      },
    );
    if (created.kind !== "task") throw new Error("Expected scheduled task");
    clock.advance(2_000);
    expect(await scheduler.tick()).toMatchObject({ missed: 1, started: 0 });
    expect(sideEffectCount).toBe(before);
    const completed = await scheduledEngine.getTask(String(created.task.taskId), authorization);
    expect(completed).toMatchObject({
      status: "completed",
      result: { isError: true, structuredContent: { outcome: "start_window_missed" } },
    });
  });

  it("T-007 safely stops an immediate queued task before publishing start_window_missed", async () => {
    const clock = new FakeClock(new Date("2026-07-16T18:00:00Z"));
    const repository = new TaskRepository(pool);
    const timedEngine = new TaskEngine(
      engine.manifest,
      engine.operationSnapshotIds,
      gateway,
      repository,
      undefined,
      clock,
    );
    const created = await timedEngine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-immediate-queued", scenario: "queued_start" },
      authorization,
      undefined,
      undefined,
      { start: { mode: "immediate", startToleranceMs: 1_000 }, maxElapsedMs: null },
    );
    if (created.kind !== "task") throw new Error("Expected queued Task");
    const taskId = String(created.task.taskId);
    expect(await repository.getById(taskId)).toMatchObject({
      internalState: "QUEUED",
      actualStartedAt: null,
    });
    clock.advance(1_001);
    expect(
      await new DurableScheduler(
        engine.manifest,
        gateway,
        repository,
        clock,
        "immediate-watchdog",
      ).tick(),
    ).toMatchObject({ watchdogStops: 1 });
    expect(await repository.getById(taskId)).toMatchObject({
      internalState: "STOPPING",
      stopReason: "START_WINDOW_MISSED",
    });
    await new DurableCommandDispatcher(gateway, repository, clock, "immediate-stop").tick();
    expect(await timedEngine.getTask(taskId, authorization)).toMatchObject({
      status: "completed",
      result: { isError: true, structuredContent: { outcome: "start_window_missed" } },
    });
  });

  it("T-008 compensates an immediate StartOperation response that arrives after the window", async () => {
    const clock = new FakeClock(new Date("2026-07-16T19:00:00Z"));
    const repository = new TaskRepository(pool);
    const lateGateway = {
      startOperation: async (...args: Parameters<GrpcAdapterGateway["startOperation"]>) => {
        const response = await gateway.startOperation(...args);
        clock.advance(1_001);
        return response;
      },
    } as unknown as GrpcAdapterGateway;
    const lateEngine = new TaskEngine(
      engine.manifest,
      engine.operationSnapshotIds,
      lateGateway,
      repository,
      undefined,
      clock,
    );
    const created = await lateEngine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-immediate-late-response" },
      authorization,
      undefined,
      undefined,
      { start: { mode: "immediate", startToleranceMs: 1_000 }, maxElapsedMs: null },
    );
    if (created.kind !== "task") throw new Error("Expected compensated Task");
    const taskId = String(created.task.taskId);
    expect(created.task).toMatchObject({ status: "working" });
    expect(await repository.getById(taskId)).toMatchObject({
      internalState: "STOPPING",
      stopReason: "START_WINDOW_MISSED",
    });
    await new DurableCommandDispatcher(gateway, repository, clock, "late-response-stop").tick();
    const reader = new TaskEngine(
      engine.manifest,
      engine.operationSnapshotIds,
      gateway,
      repository,
      undefined,
      clock,
    );
    expect(await reader.getTask(taskId, authorization)).toMatchObject({
      status: "completed",
      result: { structuredContent: { outcome: "start_window_missed" } },
    });
  });

  it("T-009 records actualStartedAt and does not stop an on-time immediate execution", async () => {
    const clock = new FakeClock(new Date("2026-07-16T20:00:00Z"));
    const repository = new TaskRepository(pool);
    const timedEngine = new TaskEngine(
      engine.manifest,
      engine.operationSnapshotIds,
      gateway,
      repository,
      undefined,
      clock,
    );
    const created = await timedEngine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-immediate-on-time" },
      authorization,
      undefined,
      undefined,
      { start: { mode: "immediate", startToleranceMs: 1_000 }, maxElapsedMs: null },
    );
    if (created.kind !== "task") throw new Error("Expected running Task");
    const taskId = String(created.task.taskId);
    expect((await repository.getById(taskId))?.actualStartedAt?.toISOString()).toBe(
      clock.now().toISOString(),
    );
    clock.advance(2_000);
    expect(
      await new DurableScheduler(
        engine.manifest,
        gateway,
        repository,
        clock,
        "on-time-watchdog",
      ).tick(),
    ).toMatchObject({ watchdogStops: 0 });
    expect(await repository.getById(taskId)).toMatchObject({ internalState: "RUNNING" });
  });

  it("T-010 retries a retryable scheduled rejection inside the window and starts once", async () => {
    const clock = new FakeClock(new Date("2026-07-16T21:00:00Z"));
    const repository = new TaskRepository(pool);
    const scheduledEngine = new TaskEngine(
      engine.manifest,
      engine.operationSnapshotIds,
      gateway,
      repository,
      undefined,
      clock,
    );
    const before = sideEffectCount;
    const created = await scheduledEngine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-scheduled-retry-success", scenario: "scheduled_retry_once" },
      authorization,
      undefined,
      undefined,
      {
        start: {
          mode: "scheduled",
          scheduledAt: clock.now().toISOString(),
          startToleranceMs: 3_000,
        },
        maxElapsedMs: null,
      },
    );
    if (created.kind !== "task") throw new Error("Expected scheduled Task");
    const taskId = String(created.task.taskId);
    const scheduler = new DurableScheduler(
      engine.manifest,
      gateway,
      repository,
      clock,
      "scheduled-retry-success",
    );
    expect(await scheduler.tick()).toMatchObject({ deferred: 1, started: 0 });
    expect(await repository.getById(taskId)).toMatchObject({
      internalState: "SCHEDULED",
      invocationAttempt: 1,
    });
    clock.advance(1_000);
    expect(await scheduler.tick()).toMatchObject({ started: 1 });
    expect(await repository.getById(taskId)).toMatchObject({
      invocationAttempt: 2,
      internalState: "RUNNING",
    });
    expect(sideEffectCount - before).toBe(1);
  });

  it("T-011 ends repeated retryable scheduled rejection at the window without a late start", async () => {
    const clock = new FakeClock(new Date("2026-07-16T22:00:00Z"));
    const repository = new TaskRepository(pool);
    const scheduledEngine = new TaskEngine(
      engine.manifest,
      engine.operationSnapshotIds,
      gateway,
      repository,
      undefined,
      clock,
    );
    const before = sideEffectCount;
    const created = await scheduledEngine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-scheduled-window-end", scenario: "scheduled_retry_always" },
      authorization,
      undefined,
      undefined,
      {
        start: {
          mode: "scheduled",
          scheduledAt: clock.now().toISOString(),
          startToleranceMs: 500,
        },
        maxElapsedMs: null,
      },
    );
    if (created.kind !== "task") throw new Error("Expected scheduled Task");
    const taskId = String(created.task.taskId);
    const scheduler = new DurableScheduler(
      engine.manifest,
      gateway,
      repository,
      clock,
      "scheduled-window-end",
    );
    expect(await scheduler.tick()).toMatchObject({ deferred: 1 });
    clock.advance(501);
    expect(await scheduler.tick()).toMatchObject({ missed: 1, started: 0 });
    expect(await repository.getById(taskId)).toMatchObject({
      internalState: "TERMINAL_COMPLETED",
      invocationAttempt: 1,
      result: { structuredContent: { outcome: "start_window_missed" } },
    });
    expect(sideEffectCount).toBe(before);
  });

  it("T-012 publishes a nonretryable scheduled rejection with observation and outbox", async () => {
    const clock = new FakeClock(new Date("2026-07-16T23:00:00Z"));
    const repository = new TaskRepository(pool);
    const scheduledEngine = new TaskEngine(
      engine.manifest,
      engine.operationSnapshotIds,
      gateway,
      repository,
      undefined,
      clock,
    );
    const created = await scheduledEngine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-scheduled-permanent", scenario: "scheduled_permanent_reject" },
      authorization,
      undefined,
      undefined,
      {
        start: {
          mode: "scheduled",
          scheduledAt: clock.now().toISOString(),
          startToleranceMs: 1_000,
        },
        maxElapsedMs: null,
      },
    );
    if (created.kind !== "task") throw new Error("Expected scheduled Task");
    const taskId = String(created.task.taskId);
    await new DurableScheduler(
      engine.manifest,
      gateway,
      repository,
      clock,
      "scheduled-permanent",
    ).tick();
    expect(await repository.getById(taskId)).toMatchObject({
      internalState: "TERMINAL_COMPLETED",
      result: { structuredContent: { outcome: "admission_rejected", retryable: false } },
    });
    expect(await repository.listObservations(taskId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "task.completed",
          reasonCode: "START_NOT_PERMITTED",
          source: "runtime",
        }),
      ]),
    );
    const event = await pool.query<{ count: string }>(
      "SELECT count(*) FROM outbox_event WHERE aggregate_id=$1 AND event_type='task.completed'",
      [taskId],
    );
    expect(event.rows[0]?.count).toBe("1");
  });

  it("requests safe stop at maxElapsed and publishes deadline only after Adapter proof", async () => {
    const clock = new FakeClock(new Date("2026-07-16T14:00:00Z"));
    const timedEngine = new TaskEngine(
      engine.manifest,
      engine.operationSnapshotIds,
      gateway,
      new TaskRepository(pool),
      undefined,
      clock,
    );
    const scheduler = new DurableScheduler(
      engine.manifest,
      gateway,
      new TaskRepository(pool),
      clock,
      "deadline-worker",
    );
    const created = await timedEngine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-deadline" },
      authorization,
      undefined,
      undefined,
      {
        start: { mode: "immediate", startToleranceMs: 1_000 },
        maxElapsedMs: 2_000,
      },
    );
    if (created.kind !== "task") throw new Error("Expected timed task");
    clock.advance(2_001);
    expect(await scheduler.tick()).toMatchObject({ deadlineStops: 1 });
    const stopping = await new TaskRepository(pool).getById(String(created.task.taskId));
    expect(stopping).toMatchObject({ mcpStatus: "working", internalState: "STOPPING" });
    await new DurableCommandDispatcher(
      gateway,
      new TaskRepository(pool),
      clock,
      "deadline-proof-dispatcher",
    ).tick();
    const completed = await timedEngine.getTask(String(created.task.taskId), authorization);
    expect(completed).toMatchObject({
      status: "completed",
      result: { structuredContent: { outcome: "deadline_reached" } },
    });
  });

  it("persists stable input requests and applies idempotent validated updates", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-input", scenario: "input_required" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected input task");
    expect(created.task).toMatchObject({
      status: "input_required",
      inputRequests: [{ key: "approval", required: true }],
    });
    const taskId = String(created.task.taskId);
    const repeated = await engine.getTask(taskId, authorization);
    expect(repeated).toMatchObject({
      status: "input_required",
      inputRequests: [{ key: "approval" }],
    });

    const before = controlSideEffectCount;
    await expect(engine.updateTask(taskId, { unknown: true }, authorization)).rejects.toThrow(
      "UNKNOWN_INPUT_REQUEST_KEY",
    );
    expect(controlSideEffectCount).toBe(before);
    const firstUpdate = await engine.updateTask(taskId, { approval: true }, authorization);
    expectCommandReceipt(firstUpdate, {
      commandType: "UPDATE",
      commandState: "PENDING",
      durablyAccepted: true,
      duplicate: false,
    });
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
    await engine.updateTask(taskId, { approval: true }, authorization);
    expect(controlSideEffectCount - before).toBe(1);
    const completed = await engine.getTask(taskId, authorization);
    expect(completed.status).toBe("completed");
    await expect(engine.updateTask(taskId, { approval: false }, authorization)).rejects.toThrow(
      "INPUT_ANSWER_CONFLICT",
    );
  });

  it("first_update_returns_pending_receipt_without_error", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-first-update-receipt", scenario: "input_required" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected input task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    const firstUpdate = await engine.updateTask(taskId, { approval: true }, authorization);
    expectCommandReceipt(firstUpdate, {
      commandSequence: 1,
      commandType: "UPDATE",
      commandState: "PENDING",
      durablyAccepted: true,
      duplicate: false,
    });
    expect(await commandAttempts(taskId, "UPDATE")).toBe("1");
    expect(controlSideEffectCount).toBe(before);
  });

  it("duplicate_pending_update_returns_command_in_progress", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-update-pending-duplicate", scenario: "input_required" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected input task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    await engine.updateTask(taskId, { approval: true }, authorization);
    let duplicateError: unknown;
    try {
      await engine.updateTask(taskId, { approval: true }, authorization);
    } catch (error) {
      duplicateError = error;
    }
    expect(duplicateError).toMatchObject({
      commandSequence: 1,
      commandType: "UPDATE",
      commandState: "PENDING",
    });
    expect((duplicateError as { retryAfterMs?: unknown }).retryAfterMs).toEqual(expect.any(Number));
    expect(await commandAttempts(taskId, "UPDATE")).toBe("1");
    expect(controlSideEffectCount).toBe(before);
  });

  it("first_pause_returns_pending_receipt_without_error", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-first-pause-receipt" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    const firstPause = await engine.controlTask(taskId, "PAUSE", authorization);
    expectCommandReceipt(firstPause, {
      commandSequence: 1,
      commandType: "PAUSE",
      commandState: "PENDING",
      durablyAccepted: true,
      duplicate: false,
    });
    expect(await commandAttempts(taskId, "PAUSE")).toBe("1");
    expect(controlSideEffectCount).toBe(before);
  });

  it("duplicate_claimed_pause_returns_command_in_progress", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-pause-claimed-duplicate" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    await engine.controlTask(taskId, "PAUSE", authorization);
    await pool.query(
      `UPDATE task_command
         SET state='CLAIMED', claim_owner='runtime-1', claim_until=clock_timestamp()+interval '30s'
       WHERE task_id=$1 AND command_type='PAUSE' AND command_sequence=1`,
      [taskId],
    );
    let duplicateError: unknown;
    try {
      await engine.controlTask(taskId, "PAUSE", authorization);
    } catch (error) {
      duplicateError = error;
    }
    expect(duplicateError).toMatchObject({
      reasonCode: "COMMAND_IN_PROGRESS",
      commandSequence: 1,
      commandType: "PAUSE",
      commandState: "CLAIMED",
    });
    expect((duplicateError as { retryAfterMs?: unknown }).retryAfterMs).toEqual(expect.any(Number));
    expect(await commandAttempts(taskId, "PAUSE")).toBe("1");
    expect(controlSideEffectCount).toBe(before);
  });

  it("first_resume_returns_pending_receipt_without_error", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-first-resume-receipt" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    const firstResume = await engine.controlTask(taskId, "RESUME", authorization);
    expectCommandReceipt(firstResume, {
      commandSequence: 1,
      commandType: "RESUME",
      commandState: "PENDING",
      durablyAccepted: true,
      duplicate: false,
    });
    expect(await commandAttempts(taskId, "RESUME")).toBe("1");
    expect(controlSideEffectCount).toBe(before);
  });

  it("duplicate_retry_wait_resume_returns_command_in_progress", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-resume-retry-wait-duplicate" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    await engine.controlTask(taskId, "RESUME", authorization);
    await pool.query(
      `UPDATE task_command
         SET state='RETRY_WAIT', next_attempt_at=clock_timestamp()+interval '1 second',
             claim_owner=NULL, claim_until=NULL
       WHERE task_id=$1 AND command_type='RESUME' AND command_sequence=1`,
      [taskId],
    );
    let duplicateError: unknown;
    try {
      await engine.controlTask(taskId, "RESUME", authorization);
    } catch (error) {
      duplicateError = error;
    }
    expect(duplicateError).toMatchObject({
      reasonCode: "COMMAND_IN_PROGRESS",
      commandSequence: 1,
      commandType: "RESUME",
      commandState: "RETRY_WAIT",
    });
    expect((duplicateError as { retryAfterMs?: unknown }).retryAfterMs).toEqual(expect.any(Number));
    expect(await commandAttempts(taskId, "RESUME")).toBe("1");
    expect(controlSideEffectCount).toBe(before);
  });

  it("retryable_update_ack_after_cancel_is_exhausted", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-retryable-update-ack-after-cancel", scenario: "input_required" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected input task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    await engine.updateTask(taskId, { approval: true }, authorization);
    const release = createDeferred();
    const repository = new TaskRepository(pool);
    const originalUpdateExecution = (
      gateway as unknown as {
        updateExecution: GrpcAdapterGateway["updateExecution"];
      }
    ).updateExecution;
    await withTemporaryGatewayMethod(
      gateway,
      "updateExecution",
      async (...args: unknown[]) => {
        const identity = args[0] as { taskId?: string; commandSequence?: number };
        if (identity.taskId !== taskId)
          return originalUpdateExecution(
            ...(args as Parameters<GrpcAdapterGateway["updateExecution"]>),
          );
        await release.promise;
        return {
          accepted: false,
          reasonCode: "TRANSIENT_UNAVAILABLE",
          message: "Transient update failure.",
          commandSequence: identity.commandSequence ?? 0,
          identity,
        };
      },
      async () => {
        const dispatcher = new DurableCommandDispatcher(
          gateway,
          repository,
          undefined,
          "retryable-update-dispatcher",
        );
        const pending = dispatcher.tick();
        await waitForClaimedCommand(taskId, "UPDATE");
        await engine.cancelTask(taskId, authorization);
        release.resolve();
        await pending;
      },
    );

    const cancelAfter = await pool.query<{
      command_type: "UPDATE" | "CANCEL";
      state: string;
      last_error_code: string | null;
    }>(
      `SELECT command_type, state, last_error_code FROM task_command
       WHERE task_id=$1 ORDER BY command_sequence`,
      [taskId],
    );
    const normalCommand = cancelAfter.rows.find((row) => row.command_type === "UPDATE");
    const cancelCommand = cancelAfter.rows.find((row) => row.command_type === "CANCEL");
    expect(normalCommand).toMatchObject({
      state: "EXHAUSTED",
      last_error_code: "SUPERSEDED_BY_SAFE_STOP",
    });
    if (cancelCommand !== undefined) {
      expect(cancelCommand.state).toBe("PENDING");
    }

    await new DurableCommandDispatcher(
      gateway,
      repository,
      undefined,
      "retryable-update-dispatcher-followup",
    ).tick();
    const finalRows = await pool.query<{
      command_type: "UPDATE" | "CANCEL";
      state: string;
    }>(`SELECT command_type, state FROM task_command WHERE task_id=$1 ORDER BY command_sequence`, [
      taskId,
    ]);
    expect(finalRows.rows.find((row) => row.command_type === "CANCEL")?.state).toBe("ACKNOWLEDGED");
    expect(controlSideEffectCount - before).toBe(1);
    expect(await commandAttempts(taskId, "UPDATE")).toBe("1");
  });

  it("retryable_pause_ack_after_cancel_is_exhausted", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-retryable-pause-ack-after-cancel" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    await engine.controlTask(taskId, "PAUSE", authorization);
    const repository = new TaskRepository(pool);
    const release = createDeferred();
    const originalPauseExecution = (
      gateway as unknown as {
        pauseExecution: GrpcAdapterGateway["pauseExecution"];
      }
    ).pauseExecution;
    await withTemporaryGatewayMethod(
      gateway,
      "pauseExecution",
      async (...args: unknown[]) => {
        const identity = args[0] as { taskId?: string; commandSequence?: number };
        if (identity.taskId !== taskId) {
          return originalPauseExecution.call(
            gateway,
            ...(args as Parameters<GrpcAdapterGateway["pauseExecution"]>),
          );
        }
        await release.promise;
        const original = await originalPauseExecution.call(
          gateway,
          ...(args as Parameters<GrpcAdapterGateway["pauseExecution"]>),
        );
        return {
          ...original,
          accepted: false,
          reasonCode: "TRANSIENT_UNAVAILABLE",
          message: "Transient pause failure.",
          commandSequence: identity.commandSequence,
        };
      },
      async () => {
        const dispatcher = new DurableCommandDispatcher(
          gateway,
          repository,
          undefined,
          "retryable-pause-dispatcher",
        );
        const pending = dispatcher.tick();
        await waitForClaimedCommand(taskId, "PAUSE");
        await engine.cancelTask(taskId, authorization);
        release.resolve();
        await pending;
      },
    );

    const cancelAfter = await repository.getById(taskId);
    expect(cancelAfter).toMatchObject({ internalState: "STOPPING" });

    const rows = await pool.query<{
      command_type: "UPDATE" | "PAUSE" | "CANCEL";
      state: string;
      last_error_code: string | null;
    }>(`SELECT command_type, state, last_error_code FROM task_command WHERE task_id=$1`, [taskId]);
    expect(rows.rows.find((row) => row.command_type === "PAUSE")).toMatchObject({
      state: "EXHAUSTED",
      last_error_code: "SUPERSEDED_BY_SAFE_STOP",
    });
    expect(await commandAttempts(taskId, "PAUSE")).toBe("1");
    await new DurableCommandDispatcher(
      gateway,
      repository,
      undefined,
      "retryable-pause-dispatcher-followup",
    ).tick();
    expect(controlSideEffectCount - before).toBe(2);
    const finalCancel = await pool.query<{ state: string }>(
      `SELECT state FROM task_command WHERE task_id=$1 AND command_type='CANCEL'`,
      [taskId],
    );
    expect(finalCancel.rows[0]?.state).toBe("ACKNOWLEDGED");
  });

  it("retryable_resume_ack_after_cancel_is_exhausted", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-retryable-resume-ack-after-cancel" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    await engine.controlTask(taskId, "RESUME", authorization);
    const repository = new TaskRepository(pool);
    const release = createDeferred();
    const originalResumeExecution = (
      gateway as unknown as {
        resumeExecution: GrpcAdapterGateway["resumeExecution"];
      }
    ).resumeExecution;
    await withTemporaryGatewayMethod(
      gateway,
      "resumeExecution",
      async (...args: unknown[]) => {
        const identity = args[0] as { taskId?: string; commandSequence?: number };
        if (identity.taskId !== taskId)
          return originalResumeExecution(
            ...(args as Parameters<GrpcAdapterGateway["resumeExecution"]>),
          );
        await release.promise;
        return {
          accepted: false,
          reasonCode: "TRANSIENT_UNAVAILABLE",
          message: "Transient resume failure.",
          commandSequence: identity.commandSequence ?? 0,
          identity,
        };
      },
      async () => {
        const dispatcher = new DurableCommandDispatcher(
          gateway,
          repository,
          undefined,
          "retryable-resume-dispatcher",
        );
        const pending = dispatcher.tick();
        await waitForClaimedCommand(taskId, "RESUME");
        await engine.cancelTask(taskId, authorization);
        release.resolve();
        await pending;
      },
    );

    await new DurableCommandDispatcher(
      gateway,
      repository,
      undefined,
      "retryable-resume-dispatcher-followup",
    ).tick();

    const rows = await pool.query<{
      command_type: "PAUSE" | "RESUME" | "CANCEL";
      state: string;
      last_error_code: string | null;
    }>(
      `SELECT command_type, state, last_error_code FROM task_command WHERE task_id=$1 ORDER BY command_sequence`,
      [taskId],
    );
    expect(rows.rows.find((row) => row.command_type === "RESUME")).toMatchObject({
      state: "EXHAUSTED",
      last_error_code: "SUPERSEDED_BY_SAFE_STOP",
    });
    expect(rows.rows.find((row) => row.command_type === "CANCEL")).toMatchObject({
      state: "ACKNOWLEDGED",
    });
    expect(controlSideEffectCount - before).toBe(1);
  });

  it("transient_update_exception_after_cancel_is_exhausted", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      {
        resourceId: "resource-transient-update-exception-after-cancel",
        scenario: "input_required",
      },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected input task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    await engine.updateTask(taskId, { approval: true }, authorization);
    const release = createDeferred();
    const repository = new TaskRepository(pool);
    const originalUpdateExecution = (
      gateway as unknown as {
        updateExecution: GrpcAdapterGateway["updateExecution"];
      }
    ).updateExecution;
    await withTemporaryGatewayMethod(
      gateway,
      "updateExecution",
      async (...args: unknown[]) => {
        const identity = args[0] as { taskId?: string; commandSequence?: number };
        if (identity.taskId !== taskId)
          return originalUpdateExecution(
            ...(args as Parameters<GrpcAdapterGateway["updateExecution"]>),
          );
        await release.promise;
        throw new Error("simulated transient failure");
      },
      async () => {
        const dispatcher = new DurableCommandDispatcher(
          gateway,
          repository,
          undefined,
          "transient-update-dispatcher",
        );
        const pending = dispatcher.tick();
        await waitForClaimedCommand(taskId, "UPDATE");
        await engine.cancelTask(taskId, authorization);
        release.resolve();
        await pending;
      },
    );

    const rows = await pool.query<{ state: string; last_error_code: string | null }>(
      `SELECT state, last_error_code FROM task_command WHERE task_id=$1 AND command_type='UPDATE'`,
      [taskId],
    );
    expect(rows.rows[0]).toMatchObject({
      state: "EXHAUSTED",
      last_error_code: "SUPERSEDED_BY_SAFE_STOP",
    });
    expect(await commandAttempts(taskId, "UPDATE")).toBe("1");
    await new DurableCommandDispatcher(
      gateway,
      repository,
      undefined,
      "transient-update-dispatcher-followup",
    ).tick();
    expect(controlSideEffectCount - before).toBe(1);
  });

  it("transient_pause_exception_after_cancel_is_exhausted", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-transient-pause-exception-after-cancel" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    await engine.controlTask(taskId, "PAUSE", authorization);
    const release = createDeferred();
    const repository = new TaskRepository(pool);
    const originalPauseExecution = (
      gateway as unknown as {
        pauseExecution: GrpcAdapterGateway["pauseExecution"];
      }
    ).pauseExecution;
    await withTemporaryGatewayMethod(
      gateway,
      "pauseExecution",
      async (...args: unknown[]) => {
        const identity = args[0] as { taskId?: string; commandSequence?: number };
        if (identity.taskId !== taskId)
          return originalPauseExecution(
            ...(args as Parameters<GrpcAdapterGateway["pauseExecution"]>),
          );
        await release.promise;
        throw new Error("simulated transient failure");
      },
      async () => {
        const dispatcher = new DurableCommandDispatcher(
          gateway,
          repository,
          undefined,
          "transient-pause-dispatcher",
        );
        const pending = dispatcher.tick();
        await waitForClaimedCommand(taskId, "PAUSE");
        await engine.cancelTask(taskId, authorization);
        release.resolve();
        await pending;
      },
    );

    const rows = await pool.query<{ state: string; last_error_code: string | null }>(
      `SELECT state, last_error_code FROM task_command WHERE task_id=$1 AND command_type='PAUSE'`,
      [taskId],
    );
    expect(rows.rows[0]).toMatchObject({
      state: "EXHAUSTED",
      last_error_code: "SUPERSEDED_BY_SAFE_STOP",
    });
    await new DurableCommandDispatcher(
      gateway,
      repository,
      undefined,
      "transient-pause-dispatcher-followup",
    ).tick();
    expect(controlSideEffectCount - before).toBe(1);
  });

  it("transient_resume_exception_after_cancel_is_exhausted", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-transient-resume-exception-after-cancel" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    await engine.controlTask(taskId, "RESUME", authorization);
    const release = createDeferred();
    const repository = new TaskRepository(pool);
    const originalResumeExecution = (
      gateway as unknown as {
        resumeExecution: GrpcAdapterGateway["resumeExecution"];
      }
    ).resumeExecution;
    await withTemporaryGatewayMethod(
      gateway,
      "resumeExecution",
      async (...args: unknown[]) => {
        const identity = args[0] as { taskId?: string; commandSequence?: number };
        if (identity.taskId !== taskId)
          return originalResumeExecution(
            ...(args as Parameters<GrpcAdapterGateway["resumeExecution"]>),
          );
        await release.promise;
        throw new Error("simulated transient failure");
      },
      async () => {
        const dispatcher = new DurableCommandDispatcher(
          gateway,
          repository,
          undefined,
          "transient-resume-dispatcher",
        );
        const pending = dispatcher.tick();
        await waitForClaimedCommand(taskId, "RESUME");
        await engine.cancelTask(taskId, authorization);
        release.resolve();
        await pending;
      },
    );

    const rows = await pool.query<{ state: string; last_error_code: string | null }>(
      `SELECT state, last_error_code FROM task_command WHERE task_id=$1 AND command_type='RESUME'`,
      [taskId],
    );
    expect(rows.rows[0]).toMatchObject({
      state: "EXHAUSTED",
      last_error_code: "SUPERSEDED_BY_SAFE_STOP",
    });
    await new DurableCommandDispatcher(
      gateway,
      repository,
      undefined,
      "transient-resume-dispatcher-followup",
    ).tick();
    expect(controlSideEffectCount - before).toBe(1);
  });

  it("acknowledged_duplicate_returns_original_success", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-update-acknowledged", scenario: "input_required" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected input task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    await engine.updateTask(taskId, { approval: true }, authorization);
    await new DurableCommandDispatcher(
      gateway,
      new TaskRepository(pool),
      undefined,
      "ack-update-dup-dispatcher",
    ).tick();
    const beforeDuplicate = controlSideEffectCount;

    const duplicate = await engine.updateTask(taskId, { approval: true }, authorization);
    expectCommandReceipt(duplicate, {
      commandSequence: 1,
      commandType: "UPDATE",
      commandState: "ACKNOWLEDGED",
      duplicate: true,
      durablyAccepted: true,
    });
    expect(await commandAttempts(taskId, "UPDATE")).toBe("1");
    expect(controlSideEffectCount).toBe(beforeDuplicate);
    expect(controlSideEffectCount - before).toBe(1);
  });

  it("rejected_duplicate_returns_original_rejection", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-update-rejected", scenario: "input_required" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected input task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    await engine.updateTask(taskId, { approval: true }, authorization);
    const originalUpdateExecution = (
      gateway as unknown as {
        updateExecution: GrpcAdapterGateway["updateExecution"];
      }
    ).updateExecution;
    await withTemporaryGatewayMethod(
      gateway,
      "updateExecution",
      async (...args: unknown[]) => {
        const identity = args[0] as { taskId?: string; commandSequence?: number };
        if (identity.taskId !== taskId) {
          return originalUpdateExecution.call(
            gateway,
            ...(args as Parameters<GrpcAdapterGateway["updateExecution"]>),
          );
        }
        const original = await originalUpdateExecution.call(
          gateway,
          ...(args as Parameters<GrpcAdapterGateway["updateExecution"]>),
        );
        return {
          ...original,
          accepted: false,
          reasonCode: "INPUT_REJECTED",
          message: "Input rejected.",
        };
      },
      async () => {
        await new DurableCommandDispatcher(
          gateway,
          new TaskRepository(pool),
          undefined,
          "rejected-update-dup-dispatcher",
        ).tick();
      },
    );

    const beforeDuplicate = controlSideEffectCount;
    const duplicate = await engine.updateTask(taskId, { approval: true }, authorization);
    expect(duplicate).toMatchObject({
      isError: true,
      structuredContent: {
        outcome: "command_rejected",
        reasonCode: "INPUT_REJECTED",
      },
    });
    expect(await commandAttempts(taskId, "UPDATE")).toBe("1");
    expect(controlSideEffectCount).toBe(beforeDuplicate);
    expect(controlSideEffectCount - before).toBe(1);
  });

  it("exhausted_duplicate_returns_original_failure", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-update-exhausted", scenario: "input_required" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected input task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;
    const repository = new TaskRepository(pool);
    const release = createDeferred();
    const originalUpdateExecution = (
      gateway as unknown as {
        updateExecution: GrpcAdapterGateway["updateExecution"];
      }
    ).updateExecution;
    await engine.updateTask(taskId, { approval: true }, authorization);
    await withTemporaryGatewayMethod(
      gateway,
      "updateExecution",
      async (...args: unknown[]) => {
        const identity = args[0] as { taskId?: string; commandSequence?: number };
        if (identity.taskId !== taskId) {
          return originalUpdateExecution(
            ...(args as Parameters<GrpcAdapterGateway["updateExecution"]>),
          );
        }
        await release.promise;
        return {
          accepted: false,
          reasonCode: "TRANSIENT_UNAVAILABLE",
          message: "Temporary issue while applying input.",
          commandSequence: identity.commandSequence ?? 0,
          identity,
        };
      },
      async () => {
        const dispatcher = new DurableCommandDispatcher(
          gateway,
          repository,
          undefined,
          "exhausted-update-dispatcher",
        );
        const pending = dispatcher.tick();
        await waitForClaimedCommand(taskId, "UPDATE");
        await engine.cancelTask(taskId, authorization);
        release.resolve();
        await pending;
      },
    );

    await new DurableCommandDispatcher(
      gateway,
      repository,
      undefined,
      "exhausted-update-dispatcher-followup",
    ).tick();
    const baseline = controlSideEffectCount;
    const duplicate = await engine.updateTask(taskId, { approval: true }, authorization);
    expect(duplicate).toMatchObject({
      isError: true,
      structuredContent: {
        outcome: "command_exhausted",
        reasonCode: "SUPERSEDED_BY_SAFE_STOP",
      },
    });
    expect(await commandAttempts(taskId, "UPDATE")).toBe("1");
    expect(await commandAttempts(taskId, "CANCEL")).toBe("1");
    const duplicateAgain = await engine.updateTask(taskId, { approval: true }, authorization);
    expect(duplicateAgain).toMatchObject({
      isError: true,
      structuredContent: {
        outcome: "command_exhausted",
        reasonCode: "SUPERSEDED_BY_SAFE_STOP",
      },
    });
    expect(controlSideEffectCount).toBe(baseline);
    expect(controlSideEffectCount - before).toBe(1);
  });

  it("input_update_invariants_are_reflected_in_database_state", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-update-invariant-db", scenario: "input_required" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected input task");
    const taskId = String(created.task.taskId);
    const repository = new TaskRepository(pool);
    const before = controlSideEffectCount;

    await engine.updateTask(taskId, { approval: true }, authorization);
    await new DurableCommandDispatcher(
      gateway,
      repository,
      undefined,
      "invariant-update-dispatcher",
    ).tick();
    expect(controlSideEffectCount - before).toBe(1);

    const duplicate = await engine.updateTask(taskId, { approval: true }, authorization);
    expectCommandReceipt(duplicate, {
      commandType: "UPDATE",
      commandState: "ACKNOWLEDGED",
      duplicate: true,
      durablyAccepted: true,
    });

    const openInputs = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM task_input_request
       WHERE task_id=$1 AND status='OPEN'`,
      [taskId],
    );
    expect(openInputs.rows[0]?.count).toBe("0");

    const acknowledgedCount = await pool.query<{ count: string; request_hash: string }>(
      `SELECT count(*)::text AS count, MIN(request_hash) AS request_hash
       FROM task_command
       WHERE task_id=$1 AND command_type='UPDATE' AND state='ACKNOWLEDGED'`,
      [taskId],
    );
    const requestHash = acknowledgedCount.rows[0]?.request_hash;
    if (requestHash === undefined) throw new Error("Expected acknowledged command request hash");
    const sameHashCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM task_command
       WHERE task_id=$1 AND command_type='UPDATE' AND request_hash=$2`,
      [taskId, requestHash],
    );
    expect(acknowledgedCount.rows[0]?.count).toBe("1");
    expect(sameHashCount.rows[0]?.count).toBe("1");

    const activeNormal = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM task_command
       WHERE task_id=$1 AND command_type IN ('UPDATE','PAUSE','RESUME')
         AND state IN ('PENDING','RETRY_WAIT')`,
      [taskId],
    );
    expect(activeNormal.rows[0]?.count).toBe("0");

    const claimedNormal = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM task_command
       WHERE task_id=$1 AND command_type IN ('UPDATE','PAUSE','RESUME')
         AND state='CLAIMED'`,
      [taskId],
    );
    expect(Number(claimedNormal.rows[0]?.count ?? "0")).toBeLessThanOrEqual(1);

    const cancelCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM task_command WHERE task_id=$1 AND command_type='CANCEL'`,
      [taskId],
    );
    expect(Number(cancelCount.rows[0]?.count ?? "0")).toBeLessThanOrEqual(1);
  });

  it("stopping_task_does_not_create_new_normal_commands", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-stop-no-normal-commands", scenario: "input_required" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected input task");
    const taskId = String(created.task.taskId);
    const repository = new TaskRepository(pool);
    const before = controlSideEffectCount;

    await engine.updateTask(taskId, { approval: true }, authorization);
    await new DurableCommandDispatcher(
      gateway,
      repository,
      undefined,
      "stop-invariant-update-dispatcher",
    ).tick();
    expect(controlSideEffectCount - before).toBe(1);

    await engine.cancelTask(taskId, authorization);
    const inStop = await repository.getById(taskId);
    expect(inStop).toMatchObject({
      cancelRequested: true,
      stopReason: "USER_REQUESTED",
      internalState: "STOPPING",
    });

    const beforePauseAttempts = await commandAttempts(taskId, "PAUSE");
    const beforeResumeAttempts = await commandAttempts(taskId, "RESUME");
    const beforeCancelAttempts = await commandAttempts(taskId, "CANCEL");
    try {
      await engine.controlTask(taskId, "PAUSE", authorization);
      throw new Error("Expected COMMAND_IN_PROGRESS while stopping");
    } catch (error) {
      expect((error as { blockingCommandType?: string }).blockingCommandType).toBe("CANCEL");
      expect((error as { reasonCode?: string }).reasonCode).toBe("COMMAND_IN_PROGRESS");
    }
    try {
      await engine.controlTask(taskId, "RESUME", authorization);
      throw new Error("Expected COMMAND_IN_PROGRESS while stopping");
    } catch (error) {
      expect((error as { blockingCommandType?: string }).blockingCommandType).toBe("CANCEL");
      expect((error as { reasonCode?: string }).reasonCode).toBe("COMMAND_IN_PROGRESS");
    }

    expect(await commandAttempts(taskId, "PAUSE")).toBe(beforePauseAttempts);
    expect(await commandAttempts(taskId, "RESUME")).toBe(beforeResumeAttempts);
    expect(await commandAttempts(taskId, "CANCEL")).toBe(beforeCancelAttempts);

    const activeNormal = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM task_command
       WHERE task_id=$1 AND command_type IN ('UPDATE','PAUSE','RESUME')
         AND state IN ('PENDING','RETRY_WAIT')`,
      [taskId],
    );
    expect(activeNormal.rows[0]?.count).toBe("0");

    const claimedNormal = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM task_command
       WHERE task_id=$1 AND command_type IN ('UPDATE','PAUSE','RESUME')
         AND state='CLAIMED'`,
      [taskId],
    );
    expect(Number(claimedNormal.rows[0]?.count ?? "0")).toBeLessThanOrEqual(1);
  });

  it("pending_update_then_cancel_creates_cancel", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-update-pending-cancel", scenario: "input_required" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected input task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    await engine.updateTask(taskId, { approval: true }, authorization);
    const result = await engine.cancelTask(taskId, authorization);
    expect(result).toMatchObject({ status: "working" });
    const commands = await pool.query<{
      command_type: "UPDATE" | "CANCEL";
      state: string;
      last_error_code: string | null;
      command_sequence: string;
    }>(
      `SELECT command_type, state, last_error_code, command_sequence
       FROM task_command WHERE task_id=$1 ORDER BY command_sequence`,
      [taskId],
    );
    expect(commands.rows).toHaveLength(2);
    expect(commands.rows[0]).toMatchObject({
      command_type: "UPDATE",
      state: "EXHAUSTED",
      last_error_code: "SUPERSEDED_BY_SAFE_STOP",
    });
    expect(commands.rows[1]).toMatchObject({
      command_type: "CANCEL",
      state: "PENDING",
    });
    expect(await new TaskRepository(pool).getById(taskId)).toMatchObject({
      internalState: "STOPPING",
      cancelRequested: true,
      stopReason: "USER_REQUESTED",
    });
    expect(controlSideEffectCount).toBe(before);
  });

  it("acknowledged_cancel_blocks_new_update", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-update-stop-ack-block", scenario: "input_required" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected input task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    await engine.cancelTask(taskId, authorization);
    await pool.query(
      `UPDATE task_command
         SET state='ACKNOWLEDGED', claim_owner=NULL, claim_until=NULL,
             adapter_ack=$2::jsonb
       WHERE task_id=$1 AND command_type='CANCEL' AND command_sequence=1`,
      [
        taskId,
        JSON.stringify({
          accepted: true,
          reasonCode: "STOP_ACCEPTED",
          message: "Safe stop accepted.",
        }),
      ],
    );

    let requestError: unknown;
    try {
      await engine.updateTask(taskId, { approval: true }, authorization);
    } catch (error) {
      requestError = error;
    }
    expect(requestError).toMatchObject({
      commandSequence: 1,
      commandType: "CANCEL",
      requestedCommandType: "UPDATE",
      blockingCommandType: "CANCEL",
      commandState: "ACKNOWLEDGED",
    });
    expect((requestError as { retryAfterMs?: unknown }).retryAfterMs).toEqual(expect.any(Number));
    expect(await commandAttempts(taskId, "UPDATE")).toBe("0");
    expect(controlSideEffectCount).toBe(before);
  });

  it("acknowledged_cancel_blocks_new_pause", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-pause-stop-ack-block" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    await engine.cancelTask(taskId, authorization);
    await pool.query(
      `UPDATE task_command
         SET state='ACKNOWLEDGED', claim_owner=NULL, claim_until=NULL,
             adapter_ack=$2::jsonb
       WHERE task_id=$1 AND command_type='CANCEL' AND command_sequence=1`,
      [
        taskId,
        JSON.stringify({
          accepted: true,
          reasonCode: "STOP_ACCEPTED",
          message: "Safe stop accepted.",
        }),
      ],
    );

    let requestError: unknown;
    try {
      await engine.controlTask(taskId, "PAUSE", authorization);
    } catch (error) {
      requestError = error;
    }
    expect(requestError).toMatchObject({
      commandSequence: 1,
      commandType: "CANCEL",
      requestedCommandType: "PAUSE",
      blockingCommandType: "CANCEL",
      commandState: "ACKNOWLEDGED",
    });
    expect((requestError as { retryAfterMs?: unknown }).retryAfterMs).toEqual(expect.any(Number));
    expect(await commandAttempts(taskId, "PAUSE")).toBe("0");
    expect(controlSideEffectCount).toBe(before);
  });

  it("acknowledged_cancel_blocks_new_resume", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-resume-stop-ack-block" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    await engine.cancelTask(taskId, authorization);
    await pool.query(
      `UPDATE task_command
         SET state='ACKNOWLEDGED', claim_owner=NULL, claim_until=NULL,
             adapter_ack=$2::jsonb
       WHERE task_id=$1 AND command_type='CANCEL' AND command_sequence=1`,
      [
        taskId,
        JSON.stringify({
          accepted: true,
          reasonCode: "STOP_ACCEPTED",
          message: "Safe stop accepted.",
        }),
      ],
    );

    let requestError: unknown;
    try {
      await engine.controlTask(taskId, "RESUME", authorization);
    } catch (error) {
      requestError = error;
    }
    expect(requestError).toMatchObject({
      commandSequence: 1,
      commandType: "CANCEL",
      requestedCommandType: "RESUME",
      blockingCommandType: "CANCEL",
      commandState: "ACKNOWLEDGED",
    });
    expect((requestError as { retryAfterMs?: unknown }).retryAfterMs).toEqual(expect.any(Number));
    expect(await commandAttempts(taskId, "RESUME")).toBe("0");
    expect(controlSideEffectCount).toBe(before);
  });

  it("pending_cancel_blocks_new_update", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-update-stop-pending-block", scenario: "input_required" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected input task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    await engine.cancelTask(taskId, authorization);
    let requestError: unknown;
    try {
      await engine.updateTask(taskId, { approval: true }, authorization);
    } catch (error) {
      requestError = error;
    }
    expect(requestError).toMatchObject({
      commandSequence: 1,
      commandType: "CANCEL",
      requestedCommandType: "UPDATE",
      blockingCommandType: "CANCEL",
      commandState: "PENDING",
    });
    expect((requestError as { retryAfterMs?: unknown }).retryAfterMs).toEqual(expect.any(Number));
    expect(await commandAttempts(taskId, "UPDATE")).toBe("0");
    expect(controlSideEffectCount).toBe(before);
  });

  it("claimed_cancel_blocks_new_pause", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-pause-claimed-stop-block" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    await engine.cancelTask(taskId, authorization);
    await pool.query(
      `UPDATE task_command
         SET state='CLAIMED', claim_owner='h6-stop-claimed', claim_until=clock_timestamp()+interval '30s'
       WHERE task_id=$1 AND command_type='CANCEL' AND command_sequence=1`,
      [taskId],
    );

    let requestError: unknown;
    try {
      await engine.controlTask(taskId, "PAUSE", authorization);
    } catch (error) {
      requestError = error;
    }
    expect(requestError).toMatchObject({
      commandSequence: 1,
      commandType: "CANCEL",
      requestedCommandType: "PAUSE",
      blockingCommandType: "CANCEL",
      commandState: "CLAIMED",
    });
    expect((requestError as { retryAfterMs?: unknown }).retryAfterMs).toEqual(expect.any(Number));
    expect(await commandAttempts(taskId, "PAUSE")).toBe("0");
    expect(controlSideEffectCount).toBe(before);
  });

  it("stopping_task_never_creates_normal_command", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-stop-no-cancel", scenario: "input_required" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected input task");
    const taskId = String(created.task.taskId);
    await pool.query(
      `UPDATE provider_task
         SET internal_state='STOPPING', mcp_status='working', substate='stopping',
             cancel_requested=true, stop_reason='USER_REQUESTED', updated_at=clock_timestamp()
       WHERE task_id=$1`,
      [taskId],
    );

    let requestError: unknown;
    try {
      await engine.updateTask(taskId, { approval: true }, authorization);
    } catch (error) {
      requestError = error;
    }
    expect(requestError).toMatchObject({ message: "STOP_IN_PROGRESS_WITHOUT_COMMAND" });
    expect(await commandAttempts(taskId, "UPDATE")).toBe("0");
  });

  it("stopping_without_cancel_command_fails_closed", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-stop-without-cancel" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected task");
    const taskId = String(created.task.taskId);
    await pool.query(
      `UPDATE provider_task
         SET internal_state='STOPPING', mcp_status='working', substate='stopping',
             cancel_requested=true, stop_reason='USER_REQUESTED', updated_at=clock_timestamp()
       WHERE task_id=$1`,
      [taskId],
    );

    let requestError: unknown;
    try {
      await engine.controlTask(taskId, "RESUME", authorization);
    } catch (error) {
      requestError = error;
    }
    expect(requestError).toMatchObject({ message: "STOP_IN_PROGRESS_WITHOUT_COMMAND" });
    expect(await commandAttempts(taskId, "RESUME")).toBe("0");
  });

  it("pending_pause_then_cancel_creates_cancel", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-pause-pending-cancel" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    await engine.controlTask(taskId, "PAUSE", authorization);
    const result = await engine.cancelTask(taskId, authorization);
    expect(result).toMatchObject({ status: "working" });
    const commands = await pool.query<{
      command_type: "UPDATE" | "PAUSE" | "CANCEL";
      state: string;
      last_error_code: string | null;
      command_sequence: string;
    }>(
      `SELECT command_type, state, last_error_code, command_sequence
       FROM task_command WHERE task_id=$1 ORDER BY command_sequence`,
      [taskId],
    );
    expect(commands.rows.find((row) => row.command_type === "PAUSE")).toMatchObject({
      state: "EXHAUSTED",
      last_error_code: "SUPERSEDED_BY_SAFE_STOP",
    });
    expect(commands.rows.find((row) => row.command_type === "CANCEL")).toMatchObject({
      state: "PENDING",
    });
    expect(await new TaskRepository(pool).getById(taskId)).toMatchObject({
      internalState: "STOPPING",
      cancelRequested: true,
      stopReason: "USER_REQUESTED",
    });
    expect(controlSideEffectCount).toBe(before);
  });

  it("retry_wait_resume_then_cancel_creates_cancel", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-resume-retry-wait-cancel" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;

    await engine.controlTask(taskId, "RESUME", authorization);
    await pool.query(
      `UPDATE task_command
         SET state='RETRY_WAIT', next_attempt_at=clock_timestamp()+interval '1 second',
             claim_owner=NULL, claim_until=NULL
       WHERE task_id=$1 AND command_type='RESUME' AND command_sequence=1`,
      [taskId],
    );
    const result = await engine.cancelTask(taskId, authorization);
    expect(result).toMatchObject({ status: "working" });
    const commands = await pool.query<{
      command_type: string;
      state: string;
      last_error_code: string | null;
      command_sequence: string;
    }>(
      `SELECT command_type, state, last_error_code, command_sequence
       FROM task_command WHERE task_id=$1 ORDER BY command_sequence`,
      [taskId],
    );
    expect(commands.rows.find((row) => row.command_type === "RESUME")).toMatchObject({
      state: "EXHAUSTED",
      last_error_code: "SUPERSEDED_BY_SAFE_STOP",
    });
    expect(commands.rows.find((row) => row.command_type === "CANCEL")).toMatchObject({
      state: "PENDING",
    });
    expect(await new TaskRepository(pool).getById(taskId)).toMatchObject({
      internalState: "STOPPING",
      cancelRequested: true,
      stopReason: "USER_REQUESTED",
    });
    expect(controlSideEffectCount).toBe(before);
  });

  it("claimed_update_then_cancel_queues_cancel", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-update-claimed-cancel", scenario: "input_required" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected input task");
    const taskId = String(created.task.taskId);
    await engine.updateTask(taskId, { approval: true }, authorization);
    await pool.query(
      `UPDATE task_command
         SET state='CLAIMED', claim_owner='claim-holder', claim_until=clock_timestamp()+interval '30s'
       WHERE task_id=$1 AND command_type='UPDATE' AND command_sequence=1`,
      [taskId],
    );
    const result = await engine.cancelTask(taskId, authorization);
    expect(result).toMatchObject({ status: "working" });
    const commands = await pool.query<{
      command_type: string;
      state: string;
      command_sequence: string;
    }>(
      `SELECT command_type, state, command_sequence
       FROM task_command WHERE task_id=$1 ORDER BY command_sequence`,
      [taskId],
    );
    expect(commands.rows.find((row) => row.command_type === "UPDATE")?.state).toBe("CLAIMED");
    expect(commands.rows.find((row) => row.command_type === "CANCEL")?.state).toBe("PENDING");
    expect(await new TaskRepository(pool).getById(taskId)).toMatchObject({
      internalState: "STOPPING",
    });

    const dispatcher = new DurableCommandDispatcher(gateway, new TaskRepository(pool));
    await dispatcher.tick();
    const claimedCommand = await pool.query<{ state: string }>(
      `SELECT state FROM task_command WHERE task_id=$1 AND command_type='CANCEL'`,
      [taskId],
    );
    expect(claimedCommand.rows[0]?.state).toBe("PENDING");
  });

  it("claimed_pause_then_cancel_waits_for_claim_completion", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-pause-claimed-cancel" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected task");
    const taskId = String(created.task.taskId);
    await engine.controlTask(taskId, "PAUSE", authorization);
    await pool.query(
      `UPDATE task_command
         SET state='CLAIMED', claim_owner='claim-holder', claim_until=clock_timestamp()+interval '30s'
       WHERE task_id=$1 AND command_type='PAUSE' AND command_sequence=1`,
      [taskId],
    );
    await engine.cancelTask(taskId, authorization);
    const firstTick = await new DurableCommandDispatcher(
      gateway,
      new TaskRepository(pool),
      undefined,
      "pause-claimed-cancel",
    ).tick();
    expect(firstTick).toMatchObject({ claimed: 0 });

    await pool.query(
      `UPDATE task_command
         SET state='ACKNOWLEDGED', claim_owner=NULL, claim_until=NULL
       WHERE task_id=$1 AND command_type='PAUSE' AND command_sequence=1`,
      [taskId],
    );
    const secondTick = await new DurableCommandDispatcher(
      gateway,
      new TaskRepository(pool),
      undefined,
      "pause-claimed-cancel-after-complete",
    ).tick();
    expect(secondTick.acknowledged).toBeGreaterThan(0);
    expect(await commandAttempts(taskId, "CANCEL")).toBe("1");
    const finalTask = await new TaskRepository(pool).getById(taskId);
    expect(finalTask?.internalState).toBe("STOPPING");
  });

  it("claimed_resume_lease_expiry_allows_cancel", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-resume-claimed-expiry-cancel" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected task");
    const taskId = String(created.task.taskId);
    await engine.controlTask(taskId, "RESUME", authorization);
    await pool.query(
      `UPDATE task_command
         SET state='CLAIMED', claim_owner='claim-holder', claim_until=clock_timestamp()+interval '30s'
       WHERE task_id=$1 AND command_type='RESUME' AND command_sequence=1`,
      [taskId],
    );
    await engine.cancelTask(taskId, authorization);

    const firstTick = await new DurableCommandDispatcher(
      gateway,
      new TaskRepository(pool),
      undefined,
      "resume-claimed-cancel-first",
    ).tick();
    expect(firstTick).toMatchObject({ claimed: 0 });

    await pool.query(
      `UPDATE task_command
         SET claim_until=clock_timestamp()-interval '1 second'
       WHERE task_id=$1 AND command_type='RESUME' AND command_sequence=1`,
      [taskId],
    );
    const secondTick = await new DurableCommandDispatcher(
      gateway,
      new TaskRepository(pool),
      undefined,
      "resume-claimed-cancel-second",
    ).tick();
    expect(
      secondTick.acknowledged + secondTick.rejected + secondTick.exhausted + secondTick.retried,
    ).toBe(1);
    const commands = await pool.query<{
      command_type: string;
      state: string;
    }>(`SELECT command_type, state FROM task_command WHERE task_id=$1 ORDER BY command_sequence`, [
      taskId,
    ]);
    expect(commands.rows.find((row) => row.command_type === "RESUME")?.state).toBe("EXHAUSTED");
    expect(commands.rows.find((row) => row.command_type === "CANCEL")?.state).toBe("ACKNOWLEDGED");
  });

  it("duplicate_cancel_reuses_existing_cancel", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-duplicate-cancel-reuse" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected task");
    const taskId = String(created.task.taskId);
    const first = await engine.cancelTask(taskId, authorization);
    expect(first).toMatchObject({ status: "working" });
    const second = await engine.cancelTask(taskId, authorization);
    expect(second).toMatchObject({ status: "working" });
    const commands = await pool.query<{ count: string }>(
      `SELECT count(*) FROM task_command WHERE task_id=$1 AND command_type='CANCEL'`,
      [taskId],
    );
    expect(commands.rows[0]?.count).toBe("1");
  });

  it("duplicate_cancel_never_reuses_update", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-duplicate-cancel-never-reuse-update", scenario: "input_required" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected input task");
    const taskId = String(created.task.taskId);

    await engine.updateTask(taskId, { approval: true }, authorization);
    await engine.cancelTask(taskId, authorization);
    await engine.cancelTask(taskId, authorization);
    const commandTypes = await pool.query<{ command_type: string }>(
      `SELECT DISTINCT command_type FROM task_command WHERE task_id=$1`,
      [taskId],
    );
    expect(commandTypes.rows.map((row) => row.command_type)).toContain("CANCEL");
    expect(commandTypes.rows.find((row) => row.command_type === "UPDATE")).toBeDefined();
    expect(await commandAttempts(taskId, "CANCEL")).toBe("1");
  });

  it.each(["PAUSE", "RESUME"] as const)("duplicate_cancel_never_reuses_$1", async (commandType) => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: `resource-duplicate-cancel-never-reuse-${commandType.toLowerCase()}` },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected task");
    const taskId = String(created.task.taskId);
    await engine.controlTask(taskId, commandType, authorization);
    await engine.cancelTask(taskId, authorization);
    await engine.cancelTask(taskId, authorization);
    const commandTypes = await pool.query<{ command_type: string }>(
      `SELECT DISTINCT command_type FROM task_command WHERE task_id=$1`,
      [taskId],
    );
    expect(commandTypes.rows.map((row) => row.command_type)).toContain("CANCEL");
    expect(commandTypes.rows.find((row) => row.command_type === commandType)).toBeDefined();
    expect(await commandAttempts(taskId, "CANCEL")).toBe("1");
  });

  it("outbox_retention_defaults_to_24_hours", async () => {
    const repository = new TaskRepository(pool);
    const cleaner = new OutboxCleaner(repository);
    const now = new Date("2026-07-17T00:00:00Z");
    const recent = randomUUID();
    const stale = randomUUID();
    const aggregate = randomUUID();
    await pool.query(
      `INSERT INTO outbox_event
         (event_id, event_key, aggregate_id, event_type, payload, published_at)
       VALUES
         ($1::uuid,$1::text,$3,'task.completed',$4::jsonb,$5::timestamptz),
         ($2::uuid,$2::text,$3,'task.completed',$6::jsonb,$7::timestamptz)`,
      [
        recent,
        stale,
        aggregate,
        JSON.stringify({ type: "recent" }),
        new Date(now.getTime() - 1_000 * 60 * 60 * 12),
        JSON.stringify({ type: "stale" }),
        new Date(now.getTime() - 24 * 60 * 60 * 1000 - 1),
      ],
    );

    const result = await cleaner.tick(now);
    expect(result.removed).toBe(1);
    const remaining = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM outbox_event WHERE event_id = ANY($1::uuid[])",
      [[recent, stale]],
    );
    expect(remaining.rows[0]).toMatchObject({ count: "1" });
  });

  it("outbox_retention_config_is_passed_to_cleaner", async () => {
    const repository = new TaskRepository(pool);
    const cleaner = new OutboxCleaner(repository, { publishedRetentionMs: 5000 });
    const now = new Date("2026-07-17T00:00:00Z");
    const aggregate = randomUUID();
    const retained = randomUUID();
    const deleted = randomUUID();
    await pool.query(
      `INSERT INTO outbox_event
         (event_id, event_key, aggregate_id, event_type, payload, published_at)
       VALUES
         ($1::uuid,$1::text,$3,'task.completed',$4::jsonb,$5::timestamptz),
         ($2::uuid,$2::text,$3,'task.completed',$6::jsonb,$7::timestamptz)`,
      [
        retained,
        deleted,
        aggregate,
        JSON.stringify({ type: "retained" }),
        new Date(now.getTime() - 4_000),
        JSON.stringify({ type: "deleted" }),
        new Date(now.getTime() - 6_000),
      ],
    );
    const result = await cleaner.tick(now);
    expect(result.removed).toBe(1);
    const remaining = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM outbox_event WHERE event_id = ANY($1::uuid[])",
      [[retained, deleted]],
    );
    expect(remaining.rows[0]).toMatchObject({ count: "1" });
  });

  it("published_outbox_not_deleted_before_configured_retention", async () => {
    const repository = new TaskRepository(pool);
    const cleaner = new OutboxCleaner(repository, { publishedRetentionMs: 5_000 });
    const now = new Date("2026-07-17T00:00:00Z");
    const aggregate = randomUUID();
    const eventId = randomUUID();
    await pool.query(
      `INSERT INTO outbox_event
         (event_id, event_key, aggregate_id, event_type, payload, published_at)
       VALUES
         ($1::uuid,$1::text,$2,'task.completed',$3::jsonb,$4::timestamptz)`,
      [
        eventId,
        aggregate,
        JSON.stringify({ type: "still-valid" }),
        new Date(now.getTime() - 4_000),
      ],
    );
    const result = await cleaner.tick(now);
    expect(result.removed).toBe(0);
    const remaining = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM outbox_event WHERE event_id=$1::uuid",
      [eventId],
    );
    expect(remaining.rows[0]).toMatchObject({ count: "1" });
  });

  it("published_outbox_deleted_after_configured_retention", async () => {
    const repository = new TaskRepository(pool);
    const cleaner = new OutboxCleaner(repository, { publishedRetentionMs: 2_000 });
    const now = new Date("2026-07-17T00:00:00Z");
    const aggregate = randomUUID();
    const eventId = randomUUID();
    await pool.query(
      `INSERT INTO outbox_event
         (event_id, event_key, aggregate_id, event_type, payload, published_at)
       VALUES
         ($1::uuid,$1::text,$2,'task.completed',$3::jsonb,$4::timestamptz)`,
      [eventId, aggregate, JSON.stringify({ type: "expired" }), new Date(now.getTime() - 3_000)],
    );
    const result = await cleaner.tick(now);
    expect(result.removed).toBe(1);
    const remaining = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM outbox_event WHERE event_id=$1::uuid",
      [eventId],
    );
    expect(remaining.rows[0]).toMatchObject({ count: "0" });
  });

  it("three_runtime_replicas_create_one_command", async () => {
    const commandTypes = ["UPDATE", "PAUSE", "RESUME"] as const;
    for (const commandType of commandTypes) {
      const created = await engine.callOperation(
        requiredOperation("durable_task"),
        {
          resourceId: `resource-replicas-command-${commandType.toLowerCase()}`,
          ...(commandType === "UPDATE" ? { scenario: "input_required" } : {}),
        },
        authorization,
      );
      if (created.kind !== "task") throw new Error(`Expected ${commandType} task`);
      const taskId = String(created.task.taskId);
      const replicas: [TaskEngine, TaskEngine, TaskEngine] = [
        engine,
        new TaskEngine(
          engine.manifest,
          engine.operationSnapshotIds,
          gateway,
          new TaskRepository(pool),
          new IdempotencyRepository(pool),
        ),
        new TaskEngine(
          engine.manifest,
          engine.operationSnapshotIds,
          gateway,
          new TaskRepository(pool),
          new IdempotencyRepository(pool),
        ),
      ];
      const [firstReplica, secondReplica, thirdReplica] = replicas;
      const commandRequests =
        commandType === "UPDATE"
          ? [
              firstReplica.updateTask(taskId, { approval: true }, authorization),
              secondReplica.updateTask(taskId, { approval: true }, authorization),
              thirdReplica.updateTask(taskId, { approval: true }, authorization),
            ]
          : [
              firstReplica.controlTask(taskId, commandType, authorization),
              secondReplica.controlTask(taskId, commandType, authorization),
              thirdReplica.controlTask(taskId, commandType, authorization),
            ];
      const settled = await Promise.allSettled(commandRequests);
      expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = settled.filter((result) => result.status === "rejected");
      expect(rejected).toHaveLength(2);
      for (const result of rejected) {
        const reason = result.reason as {
          reasonCode?: string;
          commandType?: string;
          blockingCommandType?: string;
          requestedCommandType?: string;
        };
        expect(reason).toMatchObject({
          reasonCode: "COMMAND_IN_PROGRESS",
          requestedCommandType: commandType,
          blockingCommandType: commandType,
          commandType: commandType,
        });
      }
      expect(await commandAttempts(taskId, commandType)).toBe("1");
    }
  });

  it("three_runtime_replicas_create_one_adapter_side_effect", async () => {
    const commandTypes = ["UPDATE", "PAUSE", "RESUME"] as const;

    for (const commandType of commandTypes) {
      const created = await engine.callOperation(
        requiredOperation("durable_task"),
        {
          resourceId: `resource-replicas-side-effect-${commandType.toLowerCase()}`,
          ...(commandType === "UPDATE" ? { scenario: "input_required" } : {}),
        },
        authorization,
      );
      if (created.kind !== "task") throw new Error(`Expected ${commandType} task`);
      const taskId = String(created.task.taskId);
      const replicas: [TaskEngine, TaskEngine, TaskEngine] = [
        engine,
        new TaskEngine(
          engine.manifest,
          engine.operationSnapshotIds,
          gateway,
          new TaskRepository(pool),
          new IdempotencyRepository(pool),
        ),
        new TaskEngine(
          engine.manifest,
          engine.operationSnapshotIds,
          gateway,
          new TaskRepository(pool),
          new IdempotencyRepository(pool),
        ),
      ];

      const before = controlSideEffectCount;
      const [firstReplica, secondReplica, thirdReplica] = replicas;
      const commandRequests =
        commandType === "UPDATE"
          ? [
              firstReplica.updateTask(taskId, { approval: true }, authorization),
              secondReplica.updateTask(taskId, { approval: true }, authorization),
              thirdReplica.updateTask(taskId, { approval: true }, authorization),
            ]
          : [
              firstReplica.controlTask(taskId, commandType, authorization),
              secondReplica.controlTask(taskId, commandType, authorization),
              thirdReplica.controlTask(taskId, commandType, authorization),
            ];
      const firstAttempt = await Promise.allSettled(commandRequests);
      expect(firstAttempt.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = firstAttempt.filter((result) => result.status === "rejected");
      expect(rejected).toHaveLength(2);
      for (const result of rejected) {
        const reason = result.reason as {
          reasonCode?: string;
          commandType?: string;
          blockingCommandType?: string;
          requestedCommandType?: string;
        };
        expect(reason).toMatchObject({
          reasonCode: "COMMAND_IN_PROGRESS",
          requestedCommandType: commandType,
          blockingCommandType: commandType,
          commandType: commandType,
        });
      }

      expect(await commandAttempts(taskId, commandType)).toBe("1");

      await new DurableCommandDispatcher(
        gateway,
        new TaskRepository(pool),
        undefined,
        `replica-${commandType.toLowerCase()}-dispatcher`,
      ).tick();

      const secondAttempts =
        commandType === "UPDATE"
          ? [
              firstReplica.updateTask(taskId, { approval: true }, authorization),
              secondReplica.updateTask(taskId, { approval: true }, authorization),
              thirdReplica.updateTask(taskId, { approval: true }, authorization),
            ]
          : [
              firstReplica.controlTask(taskId, commandType, authorization),
              secondReplica.controlTask(taskId, commandType, authorization),
              thirdReplica.controlTask(taskId, commandType, authorization),
            ];
      const settledSecond = await Promise.allSettled(secondAttempts);
      expect(settledSecond.filter((result) => result.status === "fulfilled")).toHaveLength(3);
      expect(controlSideEffectCount - before).toBe(1);
      expect(await commandAttempts(taskId, commandType)).toBe("1");
    }
  });

  it("supports multiple durable input_required rounds with stable unique keys", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-multi-input", scenario: "multi_round_input" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected multi-round input task");
    const taskId = String(created.task.taskId);
    expect(created.task).toMatchObject({
      status: "input_required",
      inputRequests: [{ key: "approval" }],
    });

    await engine.updateTask(taskId, { approval: true }, authorization);
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
    const secondRound = await engine.getTask(taskId, authorization);
    expect(secondRound).toMatchObject({
      status: "input_required",
      inputRequests: [{ key: "comment" }],
    });
    await engine.updateTask(taskId, { comment: "approved after review" }, authorization);
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
    expect(await engine.getTask(taskId, authorization)).toMatchObject({ status: "completed" });

    const requests = await new TaskRepository(pool).listInputRequests(taskId);
    expect(requests.map(({ key, status }) => ({ key, status }))).toEqual([
      { key: "approval", status: "ANSWERED" },
      { key: "comment", status: "ANSWERED" },
    ]);
  });

  it("C-023 C-024 C-025 keeps cancel Ack-only and preserves cancelled/completed outcomes", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-cancel" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected cancellable task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffectCount;
    const acknowledged = await engine.cancelTask(taskId, authorization);
    expect(acknowledged).toMatchObject({ status: "working" });
    expect(
      (acknowledged._meta as Record<string, Record<string, unknown>>)["io.sdar/taskExecution"],
    ).toMatchObject({ substate: "stopping" });
    await engine.cancelTask(taskId, authorization);
    expect(controlSideEffectCount - before).toBe(0);
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
    expect(controlSideEffectCount - before).toBe(1);
    expect(await engine.getTask(taskId, authorization)).toMatchObject({ status: "cancelled" });

    const race = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-natural-race", scenario: "natural_completion" },
      authorization,
    );
    if (race.kind !== "task") throw new Error("Expected race task");
    const raceId = String(race.task.taskId);
    expect(await engine.cancelTask(raceId, authorization)).toMatchObject({ status: "working" });
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
    expect(await engine.getTask(raceId, authorization)).toMatchObject({
      status: "completed",
      result: {
        structuredContent: { resourceId: "resource-natural-race", completed: true },
      },
    });

    const deadlineClock = new FakeClock(new Date("2026-07-16T15:00:00Z"));
    const deadlineEngine = new TaskEngine(
      engine.manifest,
      engine.operationSnapshotIds,
      gateway,
      new TaskRepository(pool),
      undefined,
      deadlineClock,
    );
    const deadlineTask = await deadlineEngine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-deadline-cancel-race" },
      authorization,
      undefined,
      undefined,
      {
        start: { mode: "immediate", startToleranceMs: 0 },
        maxElapsedMs: 1_000,
      },
    );
    if (deadlineTask.kind !== "task") throw new Error("Expected deadline race task");
    deadlineClock.advance(1_001);
    const deadlineScheduler = new DurableScheduler(
      engine.manifest,
      gateway,
      new TaskRepository(pool),
      deadlineClock,
      "deadline-race-worker",
    );
    await deadlineScheduler.tick();
    await new DurableCommandDispatcher(
      gateway,
      new TaskRepository(pool),
      deadlineClock,
      "deadline-dispatcher",
    ).tick();
    const controlsBeforeDuplicate = controlSideEffectCount;
    await deadlineEngine.cancelTask(String(deadlineTask.task.taskId), authorization);
    expect(controlSideEffectCount).toBe(controlsBeforeDuplicate);
    expect(
      await deadlineEngine.getTask(String(deadlineTask.task.taskId), authorization),
    ).toMatchObject({
      status: "completed",
      result: { structuredContent: { outcome: "deadline_reached" } },
    });
  });

  it("records pause/resume observations without changing Workflow status", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "resource-pause" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected pausable task");
    const taskId = String(created.task.taskId);
    const paused = await engine.controlTask(taskId, "PAUSE", authorization);
    expect(paused).toMatchObject({ status: "working" });
    expectCommandReceipt(paused, {
      commandType: "PAUSE",
      commandState: "PENDING",
      durablyAccepted: true,
      duplicate: false,
    });
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
    const pausedSnapshot = await engine.getTask(taskId, authorization);
    expect(
      (pausedSnapshot._meta as Record<string, Record<string, unknown>>)["io.sdar/taskExecution"],
    ).toMatchObject({ substate: "paused" });
    const resumed = await engine.controlTask(taskId, "RESUME", authorization);
    expect(resumed.status).toBe("working");
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
    const resumedSnapshot = await engine.getTask(taskId, authorization);
    expect(
      (resumedSnapshot._meta as Record<string, Record<string, unknown>>)["io.sdar/taskExecution"],
    ).toMatchObject({ substate: "resuming" });
    const completed = await engine.getTask(taskId, authorization);
    expect(completed.status).toBe("completed");
    const observations = ((completed._meta as Record<string, Record<string, unknown>>)[
      "io.sdar/taskExecution"
    ]?.observations ?? []) as { revision: number; type: string }[];
    expect(observations.map((observation) => observation.revision)).toEqual(
      [...new Set(observations.map((observation) => observation.revision))].sort((a, b) => b - a),
    );
    expect(observations.some((observation) => observation.type === "task.paused")).toBe(true);

    const outbox = new OutboxRepository(pool);
    const pending = await outbox.pending(1);
    const event = pending[0];
    if (event === undefined) throw new Error("Expected a pending outbox event");
    expect(await outbox.markPublished([event.eventId])).toBe(1);
    expect((await outbox.pending()).some((candidate) => candidate.eventId === event.eventId)).toBe(
      false,
    );
  });

  it("T-001/T-029/T-030 persists cancel before transport failure and retries after restart", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-cancel-transport", scenario: "cancel_transport_failure" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected cancellable task");
    const taskId = String(created.task.taskId);
    const started = performance.now();
    expect(await engine.cancelTask(taskId, authorization)).toMatchObject({ status: "working" });
    expect(performance.now() - started).toBeLessThan(100);
    const repository = new TaskRepository(pool);
    expect(await repository.getById(taskId)).toMatchObject({
      internalState: "STOPPING",
      cancelRequested: true,
    });
    expect(await new DurableCommandDispatcher(gateway, repository).tick()).toMatchObject({
      retried: 1,
    });
    const first = await pool.query<{ state: string; attempt_count: number }>(
      "SELECT state, attempt_count FROM task_command WHERE task_id=$1",
      [taskId],
    );
    expect(first.rows[0]).toMatchObject({ state: "RETRY_WAIT", attempt_count: 1 });
    await pool.query(
      "UPDATE task_command SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE task_id=$1",
      [taskId],
    );
    expect(
      await new DurableCommandDispatcher(
        gateway,
        new TaskRepository(pool),
        undefined,
        "restart",
      ).tick(),
    ).toMatchObject({ retried: 1 });
    expect(await repository.getById(taskId)).toMatchObject({ internalState: "STOPPING" });
  });

  it("command_started_is_emitted_before_rpc", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-cancel-no-db-connection" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected cancellable task");
    const taskId = String(created.task.taskId);
    await engine.cancelTask(taskId, authorization);
    await pool.query(
      "UPDATE task_command SET next_attempt_at='2099-01-01T00:00:00Z' WHERE task_id<>$1 AND state IN ('PENDING','RETRY_WAIT')",
      [taskId],
    );

    const singleConnectionPool = new Pool({ connectionString: databaseUrl, max: 1 });
    let releaseRpc!: () => void;
    let notifyRpcStarted!: () => void;
    const rpcStarted = new Promise<void>((resolve) => {
      notifyRpcStarted = resolve;
    });
    const rpcRelease = new Promise<void>((resolve) => {
      releaseRpc = resolve;
    });
    const slowGateway = {
      requestCancel: async () => {
        notifyRpcStarted();
        await rpcRelease;
        return { accepted: true, commandSequence: "1", reasonCode: "", message: "accepted" };
      },
    } as unknown as GrpcAdapterGateway;
    const dispatch = new DurableCommandDispatcher(
      slowGateway,
      new TaskRepository(singleConnectionPool),
      undefined,
      "single-connection-worker",
    ).tick();
    await rpcStarted;
    try {
      await expectCommandLifecycle(taskId, "task.command.started", {
        currentState: "CLAIMED",
        adapterRpcStatus: "started",
      });
      await expect(
        Promise.race([
          singleConnectionPool.query("SELECT 1 AS ready"),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("DATABASE_CONNECTION_HELD_DURING_RPC")), 500),
          ),
        ]),
      ).resolves.toBeDefined();
    } finally {
      releaseRpc();
      await dispatch;
      await singleConnectionPool.end();
    }
  });

  it("T-002 retries a retryable cancel rejection and completes from safe-stop proof", async () => {
    const clock = new FakeClock(new Date("2026-07-16T16:00:00Z"));
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-cancel-retry", scenario: "cancel_retryable_reject" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected cancellable task");
    const taskId = String(created.task.taskId);
    await engine.cancelTask(taskId, authorization);
    await pool.query(
      "UPDATE task_command SET next_attempt_at='2099-01-01T00:00:00Z' WHERE task_id<>$1 AND state='RETRY_WAIT'",
      [taskId],
    );
    const dispatcher = new DurableCommandDispatcher(
      gateway,
      new TaskRepository(pool),
      clock,
      "retry-worker",
    );
    expect(await dispatcher.tick()).toMatchObject({ retried: 1 });
    clock.advance(250);
    expect(await dispatcher.tick()).toMatchObject({ acknowledged: 1 });
    expect(await engine.getTask(taskId, authorization)).toMatchObject({ status: "cancelled" });
  });

  it("cancel_rejected_emits_task_and_command_events", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-cancel-rejected", scenario: "cancel_permanent_reject" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected cancellable task");
    const taskId = String(created.task.taskId);
    await engine.cancelTask(taskId, authorization);
    expect(
      await new DurableCommandDispatcher(
        gateway,
        new TaskRepository(pool),
        undefined,
        "reject",
      ).tick(),
    ).toMatchObject({ rejected: 1 });
    expect(await new TaskRepository(pool).getById(taskId)).toMatchObject({
      internalState: "RUNNING",
      cancelRequested: false,
      stopReason: null,
    });
    const first = await pool.query<{ command_sequence: string; state: string }>(
      "SELECT command_sequence, state FROM task_command WHERE task_id=$1",
      [taskId],
    );
    expect(first.rows[0]).toMatchObject({ command_sequence: "1", state: "REJECTED" });
    await expectCommandLifecycle(taskId, "task.command.rejected", {
      currentState: "REJECTED",
      adapterRpcStatus: "rejected",
    });
    const taskAudit = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM provider_ops_delivery
       WHERE aggregate_id=$1 AND record_type='provider.task.lifecycle'
         AND record_body->>'eventType'='task.cancel_rejected'`,
      [taskId],
    );
    expect(taskAudit.rows[0]?.count).toBe("1");
    await engine.cancelTask(taskId, authorization);
    const commands = await pool.query<{ command_sequence: string }>(
      "SELECT command_sequence FROM task_command WHERE task_id=$1 ORDER BY command_sequence",
      [taskId],
    );
    expect(commands.rows.map((row) => row.command_sequence)).toEqual(["1", "2"]);
    await pool.query(
      "UPDATE task_command SET state='EXHAUSTED' WHERE task_id=$1 AND state='PENDING'",
      [taskId],
    );
  });

  it("safe_stop_unconfirmed_emits_exhausted_command", async () => {
    const clock = new FakeClock(new Date("2026-07-16T17:00:00Z"));
    const deadlineEngine = new TaskEngine(
      engine.manifest,
      engine.operationSnapshotIds,
      gateway,
      new TaskRepository(pool),
      undefined,
      clock,
    );
    const create = async (resourceId: string, scenario: string) => {
      const invocation = await deadlineEngine.callOperation(
        requiredOperation("durable_task"),
        { resourceId, scenario },
        authorization,
        undefined,
        undefined,
        { start: { mode: "immediate", startToleranceMs: 0 }, maxElapsedMs: 1_000 },
      );
      if (invocation.kind !== "task") throw new Error("Expected deadline task");
      return String(invocation.task.taskId);
    };
    const transientId = await create("rc2-deadline-transient", "cancel_transport_failure");
    const rejectedId = await create("rc2-deadline-rejected", "cancel_permanent_reject");
    await pool.query(
      "UPDATE task_command SET next_attempt_at='2099-01-01T00:00:00Z' WHERE task_id NOT IN ($1,$2) AND state='RETRY_WAIT'",
      [transientId, rejectedId],
    );
    clock.advance(1_001);
    const repository = new TaskRepository(pool);
    expect(
      await new DurableScheduler(engine.manifest, gateway, repository, clock, "deadline-h1").tick(),
    ).toMatchObject({ deadlineStops: 2 });
    const dispatched = await new DurableCommandDispatcher(
      gateway,
      repository,
      clock,
      "deadline-h1-dispatch",
    ).tick();
    expect(dispatched).toMatchObject({ retried: 1, exhausted: 1 });
    expect(await repository.getById(transientId)).toMatchObject({ internalState: "STOPPING" });
    expect(await repository.getById(rejectedId)).toMatchObject({
      internalState: "TERMINAL_FAILED",
      error: { data: { reasonCode: "SAFE_STOP_UNCONFIRMED" } },
    });
    await expectCommandLifecycle(rejectedId, "task.command.exhausted", {
      currentState: "EXHAUSTED",
      reasonCode: "SAFE_STOP_UNCONFIRMED",
    });
  });

  it("duplicate_request_is_diagnostic_not_lifecycle", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-cancel-concurrent" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected cancellable task");
    const taskId = String(created.task.taskId);
    await Promise.all([
      engine.cancelTask(taskId, authorization),
      engine.cancelTask(taskId, authorization),
      engine.cancelTask(taskId, authorization),
    ]);
    const commands = await pool.query<{ count: string }>(
      "SELECT count(*) FROM task_command WHERE task_id=$1 AND command_type='CANCEL'",
      [taskId],
    );
    expect(commands.rows[0]?.count).toBe("1");
    const lifecycle = await pool.query<{ event_type: string }>(
      `SELECT record_body->>'eventType' AS event_type FROM provider_ops_delivery
       WHERE aggregate_id=$1 AND record_type='provider.command.lifecycle'
       ORDER BY event_type`,
      [taskId],
    );
    expect(lifecycle.rows).toEqual([{ event_type: "task.command.created" }]);
  });

  it("task_terminal_exhausts_and_emits_each_command", async () => {
    const taskId = await createTwoPendingCommands("terminal-command-audit");
    await new TaskRepository(pool).applySnapshot(taskId, 2, {
      internalState: "TERMINAL_COMPLETED",
      mcpStatus: "completed",
      substate: null,
      statusMessage: "done",
      result: { isError: false, structuredContent: { outcome: "success" } },
      error: null,
      terminal: true,
      observationType: "task.completed",
    });
    const exhausted = await pool.query<{ sequence: string }>(
      `SELECT record_body->'payload'->>'commandSequence' AS sequence
       FROM provider_ops_delivery
       WHERE aggregate_id=$1 AND record_type='provider.command.lifecycle'
         AND record_body->>'eventType'='task.command.exhausted'
       ORDER BY sequence`,
      [taskId],
    );
    expect(exhausted.rows).toEqual([{ sequence: "1" }, { sequence: "2" }]);
  });

  it("expired_claim_supersede_emits_command_event", async () => {
    const { taskId, repository } = await createTaskForRepositoryCommand("expired-supersede");
    await repository.beginCommand(taskId, "PAUSE", randomUUID(), {});
    const claimed = await repository.claimDueCommands(new Date(), "expired-owner", 1);
    expect(claimed.some((command) => command.taskId === taskId)).toBe(true);
    await repository.beginCancel(taskId, randomUUID());
    await pool.query(
      "UPDATE task_command SET claim_until=clock_timestamp()-interval '1 second' WHERE task_id=$1 AND command_type='PAUSE'",
      [taskId],
    );
    await repository.claimDueCommands(new Date(), "supersede-observer", 30_000);
    await expectCommandLifecycle(taskId, "task.command.superseded", {
      currentState: "EXHAUSTED",
      reasonCode: "SUPERSEDED_BY_SAFE_STOP",
    });
  });

  it("every_committed_task_transition_has_audit_record", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "task-audit-completeness" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected audited Task");
    const taskId = String(created.task.taskId);
    await engine.getTask(taskId, authorization);
    const committed = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM task_observation WHERE task_id=$1",
      [taskId],
    );
    const audited = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM provider_ops_delivery
       WHERE aggregate_id=$1 AND record_type='provider.task.lifecycle'`,
      [taskId],
    );
    expect(audited.rows[0]?.count).toBe(committed.rows[0]?.count);
  });

  it("every_committed_command_transition_has_audit_record", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "command-audit-completeness" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected audited command Task");
    const taskId = String(created.task.taskId);
    await engine.cancelTask(taskId, authorization);
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
    const events = await pool.query<{ event_type: string }>(
      `SELECT record_body->>'eventType' AS event_type FROM provider_ops_delivery
       WHERE aggregate_id=$1 AND record_type='provider.command.lifecycle'
       ORDER BY created_at`,
      [taskId],
    );
    expect(events.rows.map((row) => row.event_type)).toEqual([
      "task.command.created",
      "task.command.claimed",
      "task.command.started",
      "task.command.acknowledged",
    ]);
  });

  it("T-014/T-015 separates Runtime observation revision and publishes complete idempotent events", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-observation-revision" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected observable task");
    const taskId = String(created.task.taskId);
    const repository = new TaskRepository(pool);

    expect(await repository.getById(taskId)).toMatchObject({
      observationRevision: 1,
      adapterRevision: 1,
    });
    await engine.cancelTask(taskId, authorization);
    expect(await repository.getById(taskId)).toMatchObject({
      observationRevision: 2,
      adapterRevision: 1,
      internalState: "STOPPING",
    });
    await pool.query(
      `UPDATE task_command SET next_attempt_at='2099-01-01T00:00:00Z'
       WHERE task_id<>$1 AND state IN ('PENDING','RETRY_WAIT')`,
      [taskId],
    );
    expect(
      await new DurableCommandDispatcher(
        gateway,
        repository,
        undefined,
        "observation-revision",
      ).tick(),
    ).toMatchObject({ acknowledged: 1 });
    expect(await engine.getTask(taskId, authorization)).toMatchObject({ status: "cancelled" });

    expect(await repository.getById(taskId)).toMatchObject({
      observationRevision: 3,
      adapterRevision: 2,
      internalState: "TERMINAL_CANCELLED",
    });
    await repository.applySnapshot(taskId, 99, {
      internalState: "RUNNING",
      mcpStatus: "working",
      substate: "running",
      statusMessage: "late snapshot",
      result: null,
      error: null,
      terminal: false,
      observationType: "task.progress",
    });
    const observations = await repository.listObservations(taskId);
    expect(observations).toEqual([
      expect.objectContaining({
        revision: 1,
        source: "adapter",
        adapterRevision: 1,
      }),
      expect.objectContaining({
        revision: 2,
        type: "task.cancel_requested",
        reasonCode: "USER_REQUESTED",
        message: "Cancellation requested.",
        substate: "stopping",
        source: "runtime",
        adapterRevision: null,
      }),
      expect.objectContaining({
        revision: 3,
        type: "task.cancelled",
        source: "adapter",
        adapterRevision: 2,
      }),
    ]);
    expect(observations[0]?.message).toBeTruthy();
    expect(observations[2]?.message).toBeTruthy();

    const events = await pool.query<{
      event_key: string;
      event_type: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT event_key, event_type, payload FROM outbox_event
       WHERE aggregate_id=$1 AND event_type NOT LIKE 'task.command.%'
       ORDER BY created_at, event_key`,
      [taskId],
    );
    expect(events.rows).toHaveLength(3);
    expect(new Set(events.rows.map((row) => row.event_key)).size).toBe(3);
    expect(events.rows.map((row) => row.event_type)).toEqual([
      "task.created",
      "task.cancel_requested",
      "task.cancelled",
    ]);
    expect(events.rows[1]?.payload).toMatchObject({
      previousState: "RUNNING",
      currentState: "STOPPING",
      previousSubstate: "running",
      currentSubstate: "stopping",
      reasonCode: "USER_REQUESTED",
      terminal: false,
      resultClass: null,
    });
    expect(events.rows[2]?.payload).toMatchObject({
      previousState: "STOPPING",
      currentState: "TERMINAL_CANCELLED",
      previousSubstate: "stopping",
      currentSubstate: null,
      terminal: true,
      resultClass: "cancelled",
    });
    for (const [index, event] of events.rows.entries()) {
      expect(event.payload).toMatchObject({
        taskId,
        observationRevision: index + 1,
        adapterRevision: index === 2 ? 2 : 1,
      });
      expect(typeof event.payload.status).toBe("string");
    }
    const commandEvents = await pool.query<{
      event_type: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT event_type, payload FROM outbox_event
       WHERE aggregate_id=$1 AND event_type LIKE 'task.command.%'
       ORDER BY created_at, event_key`,
      [taskId],
    );
    expect(commandEvents.rows.map((row) => row.event_type)).toEqual([
      "task.command.created",
      "task.command.claimed",
      "task.command.started",
      "task.command.acknowledged",
    ]);
    expect(commandEvents.rows.map((row) => row.payload)).toEqual([
      expect.objectContaining({
        commandType: "CANCEL",
        currentState: "PENDING",
        attempt: 0,
        adapterRpcStatus: "not_started",
      }),
      expect.objectContaining({
        commandType: "CANCEL",
        previousState: "PENDING",
        currentState: "CLAIMED",
        attempt: 1,
        adapterRpcStatus: "not_started",
      }),
      expect.objectContaining({
        commandType: "CANCEL",
        previousState: "CLAIMED",
        currentState: "CLAIMED",
        attempt: 1,
        adapterRpcStatus: "started",
      }),
      expect.objectContaining({
        commandType: "CANCEL",
        previousState: "CLAIMED",
        currentState: "ACKNOWLEDGED",
        attempt: 1,
        adapterRpcStatus: "success",
      }),
    ]);
  });

  it("T-016 rolls back task, observation, and outbox together on event write failure", async () => {
    const clock = new FakeClock(new Date("2026-07-17T00:00:00Z"));
    const repository = new TaskRepository(pool);
    const scheduledEngine = new TaskEngine(
      engine.manifest,
      engine.operationSnapshotIds,
      gateway,
      repository,
      undefined,
      clock,
    );
    const created = await scheduledEngine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-atomic-transition" },
      authorization,
      undefined,
      undefined,
      {
        start: {
          mode: "scheduled",
          scheduledAt: clock.now().toISOString(),
          startToleranceMs: 1_000,
        },
        maxElapsedMs: null,
      },
    );
    if (created.kind !== "task") throw new Error("Expected scheduled task");
    const taskId = String(created.task.taskId);
    clock.advance(1_001);

    await pool.query(`CREATE OR REPLACE FUNCTION rc2_reject_terminal_outbox()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.aggregate_id='${taskId}' AND NEW.event_type='task.completed' THEN
          RAISE EXCEPTION 'RC2_OUTBOX_FAILURE';
        END IF;
        RETURN NEW;
      END $$`);
    await pool.query(`CREATE TRIGGER rc2_reject_terminal_outbox
      BEFORE INSERT ON outbox_event FOR EACH ROW EXECUTE FUNCTION rc2_reject_terminal_outbox()`);
    try {
      await expect(repository.completeDueStartWindowMisses(clock.now())).rejects.toThrow(
        "RC2_OUTBOX_FAILURE",
      );
      expect(await repository.getById(taskId)).toMatchObject({
        internalState: "SCHEDULED",
        observationRevision: 1,
      });
      expect(await repository.listObservations(taskId)).toHaveLength(1);
      const rolledBackEvents = await pool.query<{ count: string }>(
        "SELECT count(*) FROM outbox_event WHERE aggregate_id=$1",
        [taskId],
      );
      expect(rolledBackEvents.rows[0]?.count).toBe("1");
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS rc2_reject_terminal_outbox ON outbox_event");
      await pool.query("DROP FUNCTION IF EXISTS rc2_reject_terminal_outbox() ");
    }

    expect(await repository.completeDueStartWindowMisses(clock.now())).toBe(1);
    expect(await repository.getById(taskId)).toMatchObject({
      internalState: "TERMINAL_COMPLETED",
      observationRevision: 2,
      adapterRevision: 0,
    });
    expect(await repository.listObservations(taskId)).toHaveLength(2);
    const committedEvents = await pool.query<{ count: string }>(
      "SELECT count(*) FROM outbox_event WHERE aggregate_id=$1",
      [taskId],
    );
    expect(committedEvents.rows[0]?.count).toBe("2");
  });

  it("T-019 rejects a Start Snapshot task identity mismatch before Task publication", async () => {
    await expect(
      engine.callOperation(
        requiredOperation("durable_task"),
        { resourceId: "rc2-start-identity", scenario: "start_task_identity_mismatch" },
        authorization,
      ),
    ).rejects.toThrow("ADAPTER_SNAPSHOT_IDENTITY_MISMATCH");
    const rows = await pool.query<{ state: string; task_count: string }>(
      `SELECT admission_intent.state,
              (SELECT count(*) FROM provider_task WHERE provider_task.task_id=admission_intent.task_id) AS task_count
       FROM admission_intent WHERE arguments->>'resourceId'='rc2-start-identity'`,
    );
    expect(rows.rows[0]).toMatchObject({ state: "UNCERTAIN", task_count: "0" });
  });

  it("T-020 rejects a Get Snapshot external identity mismatch and audits without rebinding", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-get-identity", scenario: "get_external_identity_mismatch" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected identity test Task");
    const taskId = String(created.task.taskId);
    const repository = new TaskRepository(pool);
    const before = await repository.getById(taskId);
    if (before === null) throw new Error("Expected persisted identity test Task");
    await expect(engine.getTask(taskId, authorization)).rejects.toThrow(
      "ADAPTER_SNAPSHOT_IDENTITY_MISMATCH",
    );
    expect(await repository.getById(taskId)).toEqual(before);
    const audit = await pool.query<{ event_type: string; payload: Record<string, unknown> }>(
      `SELECT event_type,payload FROM outbox_event
       WHERE aggregate_id=$1 AND event_type='task.identity_conflict'`,
      [taskId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.event_type).toBe("task.identity_conflict");
    expect(audit.rows[0]?.payload).toMatchObject({
      audit: true,
      reasonCode: "ADAPTER_IDENTITY_MISMATCH",
      observationRevision: before.observationRevision,
      adapterRevision: before.adapterRevision,
    });
  });

  it("identity_mismatch_emits_terminal_command_fact", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-command-identity", scenario: "command_sequence_mismatch" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected command identity Task");
    const taskId = String(created.task.taskId);
    await engine.cancelTask(taskId, authorization);
    await pool.query(
      `UPDATE task_command SET next_attempt_at='2099-01-01T00:00:00Z'
       WHERE task_id<>$1 AND state IN ('PENDING','RETRY_WAIT')`,
      [taskId],
    );
    expect(
      await new DurableCommandDispatcher(
        gateway,
        new TaskRepository(pool),
        undefined,
        "command-identity",
      ).tick(),
    ).toMatchObject({ rejected: 1, retried: 0, acknowledged: 0 });
    const command = await pool.query<{ state: string; last_error_message: string }>(
      "SELECT state,last_error_message FROM task_command WHERE task_id=$1",
      [taskId],
    );
    expect(command.rows[0]).toMatchObject({
      state: "REJECTED",
      last_error_message: "ADAPTER_COMMAND_ACK_IDENTITY_MISMATCH",
    });
    await expectCommandLifecycle(taskId, "task.command.rejected", {
      currentState: "REJECTED",
      reasonCode: "ADAPTER_IDENTITY_MISMATCH",
    });
  });

  it("T-022 rejects Reconcile hash/context identity mismatch without binding it", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-reconcile-identity", scenario: "reconcile_identity_mismatch" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected reconcile identity Task");
    const taskId = String(created.task.taskId);
    const repository = new TaskRepository(pool);
    const before = await repository.getById(taskId);
    if (before === null) throw new Error("Expected persisted Task");
    await expect(engine.reconcileTask(before)).rejects.toThrow(
      "ADAPTER_SNAPSHOT_IDENTITY_MISMATCH",
    );
    expect(await repository.getById(taskId)).toEqual(before);
    const audit = await pool.query<{ count: string }>(
      `SELECT count(*) FROM outbox_event
       WHERE aggregate_id=$1 AND event_type='task.identity_conflict'`,
      [taskId],
    );
    expect(audit.rows[0]?.count).toBe("1");
  });

  it("T-023 renews a finite active Task handle instead of expiring or purging it", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-active-ttl", scenario: "hold" },
      authorization,
      1_000,
    );
    if (created.kind !== "task") throw new Error("Expected active TTL Task");
    const taskId = String(created.task.taskId);
    await pool.query("UPDATE provider_task SET handle_expires_at='2000-01-01' WHERE task_id=$1", [
      taskId,
    ]);
    const ttlEvents: [string, number][] = [];
    const result = await new TtlCleaner(new TaskRepository(pool), {
      purgeGraceMs: 60_000,
      onEvent: (event, amount) => ttlEvents.push([event, amount]),
    }).tick(new Date("2000-01-02T00:00:00Z"));
    expect(result.renewed).toBeGreaterThanOrEqual(1);
    expect(ttlEvents).toContainEqual(["renew", result.renewed]);
    const retained = await new TaskRepository(pool).getById(taskId);
    expect(retained).toMatchObject({ internalState: "RUNNING", expiredAt: null });
    expect(retained?.handleExpiresAt?.getTime()).toBeGreaterThan(
      new Date("2000-01-02T00:00:00Z").getTime(),
    );
  });

  it("T-024 retains a terminal Task result before its TTL expires", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-terminal-retained" },
      authorization,
      60_000,
    );
    if (created.kind !== "task") throw new Error("Expected retained terminal Task");
    const taskId = String(created.task.taskId);
    const completed = await engine.getTask(taskId, authorization);
    expect(completed).toMatchObject({ status: "completed" });
    expect(completed.result).toMatchObject({
      structuredContent: { resourceId: "rc2-terminal-retained" },
    });
    const retained = await new TaskRepository(pool).getById(taskId);
    expect(retained?.terminalAt).not.toBeNull();
    expect(retained?.handleExpiresAt?.getTime()).toBeGreaterThan(
      retained?.terminalAt?.getTime() ?? Number.POSITIVE_INFINITY,
    );

    const defaultCreated = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-terminal-default-retention" },
      authorization,
    );
    if (defaultCreated.kind !== "task") throw new Error("Expected default-retention Task");
    const defaultTaskId = String(defaultCreated.task.taskId);
    await engine.getTask(defaultTaskId, authorization);
    const defaultRetained = await new TaskRepository(pool).getById(defaultTaskId);
    if (defaultRetained?.ttlMs === null || defaultRetained?.ttlMs === undefined) {
      throw new Error("Expected manifest default terminal retention");
    }
    expect(defaultRetained.ttlMs).toBeGreaterThanOrEqual(86_400_000);
    expect(
      (defaultRetained.handleExpiresAt?.getTime() ?? 0) -
        (defaultRetained.terminalAt?.getTime() ?? Number.POSITIVE_INFINITY),
    ).toBe(defaultRetained.ttlMs);
  });

  it("ttl_expire_uses_envelope and ttl_purge_uses_envelope", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-ttl-concurrency" },
      authorization,
      1_000,
      "rc2-ttl-concurrency-key",
    );
    if (created.kind !== "task") throw new Error("Expected TTL concurrency Task");
    const taskId = String(created.task.taskId);
    await engine.getTask(taskId, authorization);
    await pool.query("UPDATE provider_task SET handle_expires_at='2000-01-01' WHERE task_id=$1", [
      taskId,
    ]);
    await pool.query(
      `INSERT INTO task_input_request(
         task_id,request_key,schema,status,description,required,request_json)
       VALUES ($1,'retention-proof','{}'::jsonb,'ANSWERED','retention proof',false,
         '{"method":"elicitation/create","params":{}}'::jsonb)`,
      [taskId],
    );
    await pool.query(
      `INSERT INTO task_command(task_id,command_sequence,command_type,request_hash,state,payload)
       VALUES ($1,99,'UPDATE',$2,'EXHAUSTED','{}'::jsonb)`,
      [taskId, "f".repeat(64)],
    );
    const ttlEvents: [string, number][] = [];
    const cleanerOptions = {
      purgeGraceMs: 60_000,
      onEvent: (event: "renew" | "expire" | "purge" | "blocked", amount: number) =>
        ttlEvents.push([event, amount]),
    };
    const first = new TtlCleaner(new TaskRepository(pool), cleanerOptions);
    const second = new TtlCleaner(new TaskRepository(pool), cleanerOptions);
    const expired = await Promise.all([
      first.tick(new Date("2000-01-02T00:00:00Z")),
      second.tick(new Date("2000-01-02T00:00:00Z")),
    ]);
    expect(expired.reduce((sum, result) => sum + result.expired, 0)).toBe(1);
    expect(ttlEvents).toContainEqual(["expire", 1]);
    const logicallyExpired = await new TaskRepository(pool).getById(taskId);
    expect(logicallyExpired?.expiredAt).not.toBeNull();
    expect(logicallyExpired?.purgeAfter?.getTime()).toBeGreaterThan(
      logicallyExpired?.expiredAt?.getTime() ?? Number.POSITIVE_INFINITY,
    );
    const expiryEvents = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM outbox_event WHERE aggregate_id=$1 AND event_type='task.expired'",
      [taskId],
    );
    expect(expiryEvents.rows[0]?.count).toBe("1");
    const expireEnvelope = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT record_body->'payload' AS payload FROM provider_ops_delivery
       WHERE aggregate_id=$1 AND record_type='provider.ttl.lifecycle'
         AND record_body->>'eventType'='expire'`,
      [taskId],
    );
    expect(expireEnvelope.rows[0]?.payload).toMatchObject({
      event: "expire",
      taskId,
      blockedReason: null,
    });
    await pool.query("UPDATE provider_task SET purge_after='2000-01-02' WHERE task_id=$1", [
      taskId,
    ]);
    const blocked = await first.tick(new Date("2000-01-03T00:00:00Z"));
    expect(blocked.purged).toBe(0);
    await pool.query(
      "UPDATE outbox_event SET published_at=clock_timestamp() WHERE aggregate_id=$1",
      [taskId],
    );
    await pool.query(
      `INSERT INTO runtime_lease(lease_key,owner_id,fencing_token,expires_at)
       VALUES ($1,'other-cleaner',1,clock_timestamp() + interval '1 hour')`,
      [`sdar-recovery:${taskId}`],
    );
    const leaseBlocked = await first.tick(new Date("2000-01-03T00:00:00Z"));
    expect(leaseBlocked.blocked).toBe(1);
    expect(ttlEvents).toContainEqual(["blocked", 1]);
    await pool.query("DELETE FROM runtime_lease WHERE lease_key=$1", [`sdar-recovery:${taskId}`]);
    const purged = await Promise.all([
      first.tick(new Date("2000-01-03T00:00:00Z")),
      second.tick(new Date("2000-01-03T00:00:00Z")),
    ]);
    expect(purged.reduce((sum, result) => sum + result.purged, 0)).toBe(1);
    expect(ttlEvents).toContainEqual(["purge", 1]);
    const purgeEnvelope = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT record_body->'payload' AS payload FROM provider_ops_delivery
       WHERE aggregate_id=$1 AND record_type='provider.ttl.lifecycle'
         AND record_body->>'eventType'='purge'`,
      [taskId],
    );
    expect(purgeEnvelope.rows[0]?.payload).toMatchObject({ event: "purge", taskId });
    const residue = await pool.query<{ count: string }>(
      `SELECT (
         (SELECT count(*) FROM provider_task WHERE task_id=$1) +
         (SELECT count(*) FROM task_observation WHERE task_id=$1) +
         (SELECT count(*) FROM task_input_request WHERE task_id=$1) +
         (SELECT count(*) FROM task_command WHERE task_id=$1) +
         (SELECT count(*) FROM admission_intent WHERE task_id=$1) +
         (SELECT count(*) FROM idempotency_record WHERE task_id=$1)
       )::text AS count`,
      [taskId],
    );
    expect(residue.rows[0]?.count).toBe("0");
    const unpublished = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM outbox_event
       WHERE aggregate_id=$1 AND published_at IS NULL`,
      [taskId],
    );
    expect(unpublished.rows[0]?.count).toBe("0");
  });

  it("T-025 returns an explicit Invalid Params error for an expired Task handle", async () => {
    const handler = new McpProtocolHandler(engine.manifest, gateway, engine, {
      resolveAuthorization: () => authorization,
    });
    const app = Fastify();
    app.post("/mcp", async (request, reply) => {
      reply.hijack();
      await handler.handle(request.raw, reply.raw, request.body);
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === "string") throw new Error("MCP did not bind");
    const client = new Client({ name: "rc2-ttl-wire", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${String(address.port)}/mcp`),
      ) as unknown as Transport,
    );
    try {
      const created = await client.request(
        {
          method: "tools/call",
          params: { name: "durable_task", arguments: { resourceId: "rc2-expired-wire" } },
        },
        CreateTaskResultSchema,
        { task: { ttl: 60_000 } },
      );
      await client.experimental.tasks.getTask(created.task.taskId);
      await pool.query("UPDATE provider_task SET handle_expires_at='2000-01-01' WHERE task_id=$1", [
        created.task.taskId,
      ]);
      await expect(client.experimental.tasks.getTask(created.task.taskId)).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
        data: { reasonCode: "TASK_EXPIRED" },
      });
      await expect(
        client.experimental.tasks.getTaskResult(created.task.taskId, CallToolResultSchema),
      ).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
        data: { reasonCode: "TASK_EXPIRED" },
      });
      await expect(client.experimental.tasks.cancelTask(created.task.taskId)).rejects.toMatchObject(
        {
          code: ErrorCode.InvalidParams,
          data: { reasonCode: "TASK_EXPIRED" },
        },
      );
      await expect(
        client.request(
          {
            method: "tasks/update",
            params: { taskId: created.task.taskId, inputs: { approval: true } },
          },
          z.object({}).loose(),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
        data: { reasonCode: "TASK_EXPIRED" },
      });
      await expect(
        engine.getTask(created.task.taskId, { ...authorization, hash: "b".repeat(64) }),
      ).rejects.toThrow("TASK_NOT_FOUND");
    } finally {
      await client.close();
      await app.close();
    }
  });

  it("T-027 returns persisted state with stale metadata during a transient Adapter outage", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-stale-read", scenario: "get_transient_failure" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected degraded-read Task");
    const taskId = String(created.task.taskId);
    const repository = new TaskRepository(pool);
    const before = await repository.getById(taskId);
    const stale = await engine.getTask(taskId, authorization);
    expect(stale).toMatchObject({ status: "working" });
    const metadata = stale._meta as Record<string, unknown>;
    const profile = metadata["io.sdar/taskExecution"] as Record<string, unknown>;
    expect(profile).toMatchObject({
      snapshotFreshness: "stale",
      degradedReasonCode: "ADAPTER_TRANSIENT_UNAVAILABLE",
    });
    expect(typeof profile.lastConfirmedAt).toBe("string");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(await repository.getById(taskId)).toEqual(before);
  });

  it("T-028 never masks an Adapter identity conflict as a stale read", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "rc2-conflict-not-stale", scenario: "get_external_identity_mismatch" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected identity-conflict Task");
    const taskId = String(created.task.taskId);
    const repository = new TaskRepository(pool);
    const before = await repository.getById(taskId);
    await expect(engine.getTask(taskId, authorization)).rejects.toThrow(
      "ADAPTER_SNAPSHOT_IDENTITY_MISMATCH",
    );
    expect(await repository.getById(taskId)).toEqual(before);
  });

  it("retry_wait_command_not_claimed_before_due", async () => {
    const now = new Date();
    const due = new Date(now.getTime() + 60_000);
    const taskId = await createRetryWaitCommand("PAUSE", due);
    const claimed = await new TaskRepository(pool).claimDueCommands(now, "backoff-before");
    expect(claimed.filter((command) => command.taskId === taskId)).toHaveLength(0);
  });

  it("retry_wait_command_claimed_at_due_time", async () => {
    const now = new Date();
    const due = new Date(now.getTime() + 60_000);
    const taskId = await createRetryWaitCommand("PAUSE", due);
    const claimed = await new TaskRepository(pool).claimDueCommands(due, "backoff-due");
    expect(claimed.filter((command) => command.taskId === taskId)).toEqual([
      expect.objectContaining({ taskId, commandType: "PAUSE", state: "CLAIMED" }),
    ]);
  });

  it("normal_retry_wait_respects_backoff", async () => {
    const now = new Date();
    const due = new Date(now.getTime() + 60_000);
    const taskId = await createRetryWaitCommand("RESUME", due);
    const repository = new TaskRepository(pool);
    expect(
      (await repository.claimDueCommands(now, "normal-before")).filter(
        (command) => command.taskId === taskId,
      ),
    ).toHaveLength(0);
    expect(
      (await repository.claimDueCommands(due, "normal-due")).filter(
        (command) => command.taskId === taskId,
      ),
    ).toEqual([expect.objectContaining({ taskId, commandType: "RESUME" })]);
  });

  it("cancel_retry_wait_respects_backoff", async () => {
    const now = new Date();
    const due = new Date(now.getTime() + 60_000);
    const taskId = await createRetryWaitCommand("CANCEL", due);
    const repository = new TaskRepository(pool);
    expect(
      (await repository.claimDueCommands(now, "cancel-before")).filter(
        (command) => command.taskId === taskId,
      ),
    ).toHaveLength(0);
    expect(
      (await repository.claimDueCommands(due, "cancel-due")).filter(
        (command) => command.taskId === taskId,
      ),
    ).toEqual([expect.objectContaining({ taskId, commandType: "CANCEL" })]);
  });

  it("multiple_ticks_before_due_do_not_call_adapter", async () => {
    const now = new Date();
    const due = new Date(now.getTime() + 60_000);
    await createRetryWaitCommand("PAUSE", due);
    const before = controlSideEffectCount;
    const clock = new FakeClock(now);
    const dispatcher = new DurableCommandDispatcher(
      gateway,
      new TaskRepository(pool),
      clock,
      "backoff-ticks",
    );
    expect(await dispatcher.tick()).toMatchObject({ claimed: 0 });
    expect(await dispatcher.tick()).toMatchObject({ claimed: 0 });
    expect(controlSideEffectCount).toBe(before);
  });

  it("retry_attempt_count_increments_only_when_due", async () => {
    const now = new Date();
    const due = new Date(now.getTime() + 60_000);
    const taskId = await createRetryWaitCommand("PAUSE", due);
    const repository = new TaskRepository(pool);
    await repository.claimDueCommands(now, "attempt-before");
    expect(await commandAttemptCount(taskId, "PAUSE")).toBe(0);
    await repository.claimDueCommands(due, "attempt-due");
    expect(await commandAttemptCount(taskId, "PAUSE")).toBe(1);
  });

  it("update_ack_and_input_completion_are_atomic", async () => {
    const taskId = await createPendingInputUpdate("atomic-success");
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
    await expectAtomicUpdateState(taskId, "ACKNOWLEDGED", "ANSWERED", 1, 1);
  });

  it("update_input_failure_rolls_back_command_ack", async () => {
    await expectAtomicUpdateRollback("input");
  });

  it("update_observation_failure_rolls_back_command_and_input", async () => {
    await expectAtomicUpdateRollback("observation");
  });

  it("update_outbox_failure_rolls_back_all_changes", async () => {
    await expectAtomicUpdateRollback("outbox");
  });

  it("acknowledged_update_never_has_open_input", async () => {
    const taskId = await createPendingInputUpdate("atomic-no-open");
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
    const inconsistent = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM task_command command
       JOIN task_input_request input USING (task_id)
       WHERE command.task_id=$1 AND command.command_type='UPDATE'
         AND command.state='ACKNOWLEDGED' AND input.status='OPEN'`,
      [taskId],
    );
    expect(inconsistent.rows[0]?.count).toBe("0");
  });

  it("atomic_update_failure_leaves_command_recoverable", async () => {
    const taskId = await createPendingInputUpdate("atomic-recoverable");
    await installAtomicFailureTrigger("outbox");
    try {
      await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
      await expectAtomicUpdateState(taskId, "RETRY_WAIT", "OPEN", 0, 0);
    } finally {
      await removeAtomicFailureTrigger("outbox");
    }
    await pool.query("UPDATE task_command SET next_attempt_at=clock_timestamp() WHERE task_id=$1", [
      taskId,
    ]);
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
    await expectAtomicUpdateState(taskId, "ACKNOWLEDGED", "ANSWERED", 1, 1);
  });

  it("expired_claim_replays_update_after_atomic_rollback", async () => {
    const taskId = await createPendingInputUpdate("atomic-expired-claim");
    const repository = new TaskRepository(pool);
    const claimed = await repository.claimDueCommands(new Date(), "expired-atomic", 1);
    expect(claimed.filter((command) => command.taskId === taskId)).toEqual([
      expect.objectContaining({ taskId, commandType: "UPDATE" }),
    ]);
    await pool.query(
      "UPDATE task_command SET claim_until=clock_timestamp() - interval '1 second' WHERE task_id=$1",
      [taskId],
    );
    await new DurableCommandDispatcher(gateway, repository).tick();
    await expectAtomicUpdateState(taskId, "ACKNOWLEDGED", "ANSWERED", 1, 1);
  });

  it("exact_exhausted_update_retry_returns_original_failure_during_stop", async () => {
    await expectExactCommandPrecedesBlocker("EXHAUSTED", true);
  });

  it("exact_rejected_update_retry_returns_original_rejection", async () => {
    await expectExactCommandPrecedesBlocker("REJECTED", false);
  });

  it("exact_acknowledged_update_retry_returns_original_receipt", async () => {
    await expectExactCommandPrecedesBlocker("ACKNOWLEDGED", true);
  });

  it("new_update_during_stop_is_blocked_by_cancel", async () => {
    const { taskId, repository } = await createTaskForRepositoryCommand("new-stop-block");
    await repository.beginCancel(taskId, "cancel-new-stop-block");
    const result = await repository.beginCommand(taskId, "UPDATE", "new-update-hash", {
      answers: { approval: true },
    });
    expect(result).toMatchObject({ commandType: "CANCEL", disposition: "existing" });
  });

  it("exact_retry_is_resolved_before_cross_type_blocker", async () => {
    await expectExactCommandPrecedesBlocker("REJECTED", false);
  });

  it("mixed_answered_and_open_inputs_dispatch_only_open_values", async () => {
    const taskId = await createMixedInputUpdate("mixed-payload");
    const command = await pool.query<{ payload: { answers: Record<string, unknown> } }>(
      `SELECT payload FROM task_command
       WHERE task_id=$1 AND command_type='UPDATE' ORDER BY command_sequence DESC LIMIT 1`,
      [taskId],
    );
    expect(command.rows[0]?.payload.answers).toEqual({ comment: "approved" });
  });

  it("repeated_answer_plus_new_answer_succeeds", async () => {
    const taskId = await createMixedInputUpdate("mixed-success");
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
    const command = await pool.query<{ state: string }>(
      `SELECT state FROM task_command
       WHERE task_id=$1 AND command_type='UPDATE' ORDER BY command_sequence DESC LIMIT 1`,
      [taskId],
    );
    expect(command.rows[0]?.state).toBe("ACKNOWLEDGED");
  });

  it("mixed_update_does_not_touch_answered_input", async () => {
    const taskId = await createMixedInputUpdate("mixed-preserve");
    const before = await inputAnswerHash(taskId, "approval");
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
    expect(await inputAnswerHash(taskId, "approval")).toBe(before);
  });

  it("mixed_update_creates_one_observation", async () => {
    const taskId = await createMixedInputUpdate("mixed-observation");
    const before = await aggregateEventCount("task_observation", taskId, "task.input_answered");
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
    expect(await aggregateEventCount("task_observation", taskId, "task.input_answered")).toBe(
      before + 1,
    );
  });

  it("mixed_update_creates_one_outbox_event", async () => {
    const taskId = await createMixedInputUpdate("mixed-outbox");
    const before = await aggregateEventCount("outbox_event", taskId, "task.input_answered");
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
    expect(await aggregateEventCount("outbox_event", taskId, "task.input_answered")).toBe(
      before + 1,
    );
  });

  it("mixed_update_duplicate_uses_full_request_hash", async () => {
    const taskId = await createMixedInputUpdate("mixed-duplicate");
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
    const duplicate = await engine.updateTask(
      taskId,
      { approval: true, comment: "approved" },
      authorization,
    );
    expectCommandReceipt(duplicate, {
      commandSequence: 2,
      commandType: "UPDATE",
      commandState: "ACKNOWLEDGED",
      durablyAccepted: true,
      duplicate: true,
    });
    expect(await commandAttempts(taskId, "UPDATE")).toBe("2");
  });

  it("identity_conflict_outbox_uses_task_lock", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: `identity-lock-${randomUUID()}` },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected identity lock Task");
    const taskId = String(created.task.taskId);
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT task_id FROM provider_task WHERE task_id=$1 FOR UPDATE", [taskId]);
    let completed = false;
    const recording = new TaskRepository(pool)
      .recordIdentityConflict(taskId, "lock-test")
      .then(() => {
        completed = true;
      });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(completed).toBe(false);
    await blocker.query("ROLLBACK");
    blocker.release();
    await recording;
    expect(completed).toBe(true);
  });

  it("database_rejects_two_claimed_commands_for_same_task", async () => {
    const taskId = await createTwoPendingCommands("unique-claimed");
    await expect(
      pool.query(
        `UPDATE task_command
         SET state='CLAIMED', claim_owner='unique-claim-test',
             claim_until=clock_timestamp()+interval '30 seconds'
         WHERE task_id=$1`,
        [taskId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("two_dispatchers_claim_only_one_command", async () => {
    const taskId = await createTwoPendingCommands("two-dispatchers");
    const claims = await Promise.all([
      new TaskRepository(pool).claimDueCommands(new Date(), "claim-worker-a", 30_000, 1),
      new TaskRepository(pool).claimDueCommands(new Date(), "claim-worker-b", 30_000, 1),
    ]);
    expect(claims.flat().filter((command) => command.taskId === taskId)).toHaveLength(1);
  });

  it("unique_claim_conflict_does_not_fail_whole_tick", async () => {
    const taskId = await createTwoPendingCommands("claim-conflict-tick");
    const results = await Promise.allSettled([
      new TaskRepository(pool).claimDueCommands(new Date(), "conflict-a", 30_000, 1),
      new TaskRepository(pool).claimDueCommands(new Date(), "conflict-b", 30_000, 1),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(await claimedCommandCount(taskId)).toBe(1);
  });

  it("single_task_has_at_most_one_claimed_command", async () => {
    const taskId = await createTwoPendingCommands("single-claimed-invariant");
    await Promise.all([
      new TaskRepository(pool).claimDueCommands(new Date(), "invariant-a", 30_000, 1),
      new TaskRepository(pool).claimDueCommands(new Date(), "invariant-b", 30_000, 1),
    ]);
    expect(await claimedCommandCount(taskId)).toBeLessThanOrEqual(1);
  });
});

function requiredOperation(name: string) {
  const operation = engine.manifest.operations.find((candidate) => candidate.name === name);
  if (operation === undefined) throw new Error(`Operation ${name} is missing`);
  return operation;
}

function rejectAfter(milliseconds: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    timer.unref();
  });
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((newResolve, newReject) => {
    resolve = newResolve;
    reject = newReject;
  });
  return { promise, resolve, reject };
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), milliseconds);
    timer.unref();
  });
}

async function waitForClaimedCommand(taskId: string, commandType: "UPDATE" | "PAUSE" | "RESUME") {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await pool.query<{
      state: string;
      claim_owner: string | null;
      command_sequence: string;
    }>(
      `SELECT command_type, state, claim_owner, command_sequence FROM task_command
       WHERE task_id=$1 AND command_type=$2
       ORDER BY command_sequence DESC LIMIT 1`,
      [taskId, commandType],
    );
    const command = result.rows[0];
    if (command?.state === "CLAIMED" && command.claim_owner !== null) {
      return;
    }
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${commandType} command CLAIMED state`);
}

async function withTemporaryGatewayMethod(
  gateway: GrpcAdapterGateway,
  method: "updateExecution" | "pauseExecution" | "resumeExecution",
  replacement: (...args: unknown[]) => Promise<unknown>,
  action: () => Promise<void>,
) {
  const gatewayRecord = gateway as unknown as Record<string, unknown>;
  const original = gatewayRecord[method] as (...args: unknown[]) => Promise<unknown>;
  gatewayRecord[method] = replacement;
  try {
    await action();
  } finally {
    gatewayRecord[method] = original;
  }
}

function expectCommandReceipt(
  response: Record<string, unknown>,
  expected: {
    commandSequence?: number;
    commandType: "UPDATE" | "PAUSE" | "RESUME";
    commandState: string;
    durablyAccepted: boolean;
    duplicate: boolean;
  },
) {
  const profile = (response._meta as Record<string, Record<string, unknown>> | undefined)?.[
    "io.sdar/taskExecution"
  ];
  const receipt = profile?.receipt as Record<string, unknown> | undefined;
  if (receipt === undefined) throw new Error("Expected command receipt");
  if (expected.commandSequence !== undefined)
    expect(receipt.commandSequence).toBe(expected.commandSequence);
  expect(receipt.commandType).toBe(expected.commandType);
  expect(receipt.commandState).toBe(expected.commandState);
  expect(receipt.duplicate).toBe(expected.duplicate);
  expect(receipt.durablyAccepted).toBe(expected.durablyAccepted);
  expect(typeof receipt.acceptedAt).toBe("string");
}

async function commandAttempts(
  taskId: string,
  commandType: "UPDATE" | "PAUSE" | "RESUME" | "CANCEL",
) {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM task_command WHERE task_id=$1 AND command_type=$2`,
    [taskId, commandType],
  );
  return result.rows[0]?.count ?? "0";
}

async function createRetryWaitCommand(
  commandType: "CANCEL" | "PAUSE" | "RESUME",
  nextAttemptAt: Date,
): Promise<string> {
  const created = await engine.callOperation(
    requiredOperation("durable_task"),
    { resourceId: `backoff-${commandType.toLowerCase()}-${randomUUID()}` },
    authorization,
  );
  if (created.kind !== "task") throw new Error("Expected backoff Task");
  const taskId = String(created.task.taskId);
  if (commandType === "CANCEL") {
    await engine.cancelTask(taskId, authorization);
  } else {
    await engine.controlTask(taskId, commandType, authorization);
  }
  await pool.query(
    `UPDATE task_command
       SET state='RETRY_WAIT', next_attempt_at=$3, claim_owner=NULL, claim_until=NULL
     WHERE task_id=$1 AND command_type=$2`,
    [taskId, commandType, nextAttemptAt],
  );
  return taskId;
}

async function commandAttemptCount(
  taskId: string,
  commandType: "CANCEL" | "UPDATE" | "PAUSE" | "RESUME",
): Promise<number> {
  const result = await pool.query<{ attempt_count: number }>(
    `SELECT attempt_count FROM task_command WHERE task_id=$1 AND command_type=$2`,
    [taskId, commandType],
  );
  return result.rows[0]?.attempt_count ?? -1;
}

async function createPendingInputUpdate(label: string): Promise<string> {
  const created = await engine.callOperation(
    requiredOperation("durable_task"),
    { resourceId: `${label}-${randomUUID()}`, scenario: "input_required" },
    authorization,
  );
  if (created.kind !== "task") throw new Error("Expected input Task");
  const taskId = String(created.task.taskId);
  await engine.updateTask(taskId, { approval: true }, authorization);
  return taskId;
}

async function expectAtomicUpdateState(
  taskId: string,
  commandState: string,
  inputState: string,
  observationCount: number,
  outboxCount: number,
): Promise<void> {
  const state = await pool.query<{
    command_state: string;
    input_state: string;
    observations: string;
    events: string;
  }>(
    `SELECT command.state AS command_state, input.status AS input_state,
       (SELECT count(*)::text FROM task_observation
        WHERE task_id=$1 AND type='task.input_answered') AS observations,
       (SELECT count(*)::text FROM outbox_event
        WHERE aggregate_id=$1 AND event_type='task.input_answered') AS events
     FROM task_command command
     JOIN task_input_request input USING (task_id)
     WHERE command.task_id=$1 AND command.command_type='UPDATE'`,
    [taskId],
  );
  expect(state.rows[0]).toMatchObject({
    command_state: commandState,
    input_state: inputState,
    observations: String(observationCount),
    events: String(outboxCount),
  });
}

async function expectAtomicUpdateRollback(
  target: "input" | "observation" | "outbox",
): Promise<void> {
  const taskId = await createPendingInputUpdate(`atomic-${target}-failure`);
  await installAtomicFailureTrigger(target);
  try {
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
    await expectAtomicUpdateState(taskId, "RETRY_WAIT", "OPEN", 0, 0);
  } finally {
    await removeAtomicFailureTrigger(target);
  }
}

async function installAtomicFailureTrigger(
  target: "input" | "observation" | "outbox",
): Promise<void> {
  const table =
    target === "input"
      ? "task_input_request"
      : target === "observation"
        ? "task_observation"
        : "outbox_event";
  const operation = target === "input" ? "UPDATE" : "INSERT";
  const predicate =
    target === "input"
      ? "NEW.status='ANSWERED'"
      : target === "observation"
        ? "NEW.type='task.input_answered'"
        : "NEW.event_type='task.input_answered'";
  await pool.query(`CREATE OR REPLACE FUNCTION atomic_fail_${target}()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF ${predicate} THEN RAISE EXCEPTION 'ATOMIC_${target.toUpperCase()}_FAILURE'; END IF;
      RETURN NEW;
    END $$`);
  await pool.query(`CREATE TRIGGER atomic_fail_${target}
    BEFORE ${operation} ON ${table} FOR EACH ROW EXECUTE FUNCTION atomic_fail_${target}()`);
}

async function removeAtomicFailureTrigger(
  target: "input" | "observation" | "outbox",
): Promise<void> {
  const table =
    target === "input"
      ? "task_input_request"
      : target === "observation"
        ? "task_observation"
        : "outbox_event";
  await pool.query(`DROP TRIGGER IF EXISTS atomic_fail_${target} ON ${table}`);
  await pool.query(`DROP FUNCTION IF EXISTS atomic_fail_${target}()`);
}

async function createTaskForRepositoryCommand(label: string): Promise<{
  taskId: string;
  repository: TaskRepository;
}> {
  const created = await engine.callOperation(
    requiredOperation("durable_task"),
    { resourceId: `${label}-${randomUUID()}`, scenario: "input_required" },
    authorization,
  );
  if (created.kind !== "task") throw new Error("Expected repository command Task");
  return { taskId: String(created.task.taskId), repository: new TaskRepository(pool) };
}

async function expectExactCommandPrecedesBlocker(
  state: "ACKNOWLEDGED" | "REJECTED" | "EXHAUSTED",
  stop: boolean,
): Promise<void> {
  const { taskId, repository } = await createTaskForRepositoryCommand(`exact-${state}`);
  const requestHash = createHash("sha256").update(`exact-${state}`).digest("hex");
  await repository.beginCommand(taskId, "UPDATE", requestHash, {
    answers: { approval: true },
  });
  await pool.query(
    `UPDATE task_command SET state=$2, last_error_code=$3, last_error_message=$4
     WHERE task_id=$1 AND command_type='UPDATE'`,
    [
      taskId,
      state,
      state === "ACKNOWLEDGED" ? null : `ORIGINAL_${state}`,
      state === "ACKNOWLEDGED" ? null : `Original ${state.toLowerCase()} result.`,
    ],
  );
  if (stop) {
    await repository.beginCancel(
      taskId,
      createHash("sha256").update(`cancel-${state}`).digest("hex"),
    );
    await pool.query(
      `UPDATE task_command SET state='ACKNOWLEDGED'
       WHERE task_id=$1 AND command_type='CANCEL'`,
      [taskId],
    );
  } else {
    await repository.beginCommand(
      taskId,
      "PAUSE",
      createHash("sha256").update(`pause-${state}`).digest("hex"),
      {},
    );
  }
  expect(
    await repository.beginCommand(taskId, "UPDATE", requestHash, {
      answers: { approval: true },
    }),
  ).toMatchObject({ commandType: "UPDATE", state, disposition: "existing", duplicate: true });
}

async function createMixedInputUpdate(label: string): Promise<string> {
  const created = await engine.callOperation(
    requiredOperation("durable_task"),
    { resourceId: `${label}-${randomUUID()}`, scenario: "multi_round_input" },
    authorization,
  );
  if (created.kind !== "task") throw new Error("Expected multi-round input Task");
  const taskId = String(created.task.taskId);
  await engine.updateTask(taskId, { approval: true }, authorization);
  await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
  await engine.getTask(taskId, authorization);
  await engine.updateTask(taskId, { approval: true, comment: "approved" }, authorization);
  return taskId;
}

async function inputAnswerHash(taskId: string, key: string): Promise<string | null> {
  const result = await pool.query<{ answer_hash: string | null }>(
    "SELECT answer_hash FROM task_input_request WHERE task_id=$1 AND request_key=$2",
    [taskId, key],
  );
  return result.rows[0]?.answer_hash ?? null;
}

async function aggregateEventCount(
  table: "task_observation" | "outbox_event",
  taskId: string,
  type: string,
): Promise<number> {
  const result =
    table === "task_observation"
      ? await pool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM task_observation WHERE task_id=$1 AND type=$2",
          [taskId, type],
        )
      : await pool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM outbox_event WHERE aggregate_id=$1 AND event_type=$2",
          [taskId, type],
        );
  return Number(result.rows[0]?.count ?? 0);
}

async function createTwoPendingCommands(label: string): Promise<string> {
  const created = await engine.callOperation(
    requiredOperation("durable_task"),
    { resourceId: `${label}-${randomUUID()}` },
    authorization,
  );
  if (created.kind !== "task") throw new Error("Expected claim invariant Task");
  const taskId = String(created.task.taskId);
  await pool.query(
    `INSERT INTO task_command
       (task_id, command_sequence, command_type, request_hash, state, payload, next_attempt_at)
     VALUES ($1,1,'UPDATE',$2,'PENDING','{}'::jsonb,clock_timestamp()-interval '1 second'),
            ($1,2,'PAUSE',$3,'PENDING','{}'::jsonb,clock_timestamp()-interval '1 second')`,
    [
      taskId,
      createHash("sha256").update(`${label}-1`).digest("hex"),
      createHash("sha256").update(`${label}-2`).digest("hex"),
    ],
  );
  await pool.query("UPDATE provider_task SET next_command_sequence=2 WHERE task_id=$1", [taskId]);
  return taskId;
}

async function claimedCommandCount(taskId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM task_command WHERE task_id=$1 AND state='CLAIMED'",
    [taskId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function expectCommandLifecycle(
  taskId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const result = await pool.query<{ record_body: { payload?: Record<string, unknown> } }>(
    `SELECT record_body FROM provider_ops_delivery
     WHERE aggregate_id=$1 AND record_type='provider.command.lifecycle'
       AND record_body->>'eventType'=$2`,
    [taskId, eventType],
  );
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]?.record_body.payload).toMatchObject(payload);
}
