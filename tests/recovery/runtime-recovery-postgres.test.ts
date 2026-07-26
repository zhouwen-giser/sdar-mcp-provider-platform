import type * as grpc from "@grpc/grpc-js";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { createRuntime } from "../../apps/runtime/src/runtime.js";
import {
  bindMockAdapter,
  createMockAdapterServer,
} from "../../examples/mock-adapter-typescript/src/server.js";
import {
  GrpcAdapterGateway,
  jsonToProtoStruct,
} from "../../packages/adapter-protocol/src/index.js";
import type { AuthorizationContext } from "../../packages/domain/src/index.js";
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
if (databaseUrl === undefined) throw new Error("TEST_DATABASE_URL is required for recovery tests");

const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const authorization: AuthorizationContext = {
  hash: "c".repeat(64),
  executionMode: "live",
  simulationId: null,
};
let adapter: grpc.Server;
let gateway: GrpcAdapterGateway;
let engine: TaskEngine;
let controlSideEffects = 0;
let adapterEndpoint: string;

beforeAll(async () => {
  await pool.query(`DROP TABLE IF EXISTS
    task_input_response_inbox, provider_ops_delivery, runtime_lease, outbox_event, idempotency_record,
    task_command, task_input_request,
    task_observation, provider_task, admission_intent, operation_snapshot,
    runtime_schema_migration CASCADE`);
  await runMigrations(pool);
  adapter = createMockAdapterServer({
    providerId: "recovery-provider",
    onControlSideEffect: () => {
      controlSideEffects += 1;
    },
  });
  const port = await bindMockAdapter(adapter, "127.0.0.1:0");
  adapterEndpoint = `127.0.0.1:${String(port)}`;
  gateway = new GrpcAdapterGateway({
    endpoint: adapterEndpoint,
    providerId: "recovery-provider",
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
  await pool.query(`TRUNCATE TABLE
    task_input_response_inbox, provider_ops_delivery, runtime_lease, outbox_event, idempotency_record,
    task_command, task_input_request,
    task_observation, provider_task, admission_intent
    RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  gateway.close();
  await shutdown(adapter);
  await pool.end();
});

describe("Runtime startup and fault recovery", () => {
  it("recovery_event_uses_envelope", async () => {
    await expect(
      engine.callOperation(
        requiredOperation("durable_task"),
        { resourceId: "startup-response-loss", scenario: "response_loss" },
        authorization,
      ),
    ).rejects.toThrow("injected StartOperation response loss");

    const repository = new TaskRepository(pool);
    const recovery = new RecoveryManager(engine, repository);
    const scan = await recovery.scan();
    expect(scan.admissionsRecovered).toBe(1);
    const recovered = await pool.query<{ task_id: string; recovery_attempts: number }>(
      `SELECT provider_task.task_id, recovery_attempts FROM provider_task
       JOIN admission_intent USING (task_id)
       WHERE provider_task.arguments->>'resourceId'='startup-response-loss'`,
    );
    expect(recovered.rows[0]?.recovery_attempts).toBeGreaterThanOrEqual(1);
    expect(await engine.getTask(String(recovered.rows[0]?.task_id), authorization)).toMatchObject({
      status: "completed",
    });
    const events = await pool.query<{ record_type: string; payload: Record<string, unknown> }>(
      `SELECT record_type,record_body->'payload' AS payload FROM provider_ops_delivery
       WHERE aggregate_id=$1 AND record_type='provider.recovery.lifecycle'`,
      [String(recovered.rows[0]?.task_id)],
    );
    expect(events.rows[0]).toMatchObject({
      record_type: "provider.recovery.lifecycle",
      payload: { event: "reconcile", outcome: "success" },
    });
  });

  it("does not execute control commands while recovering pending normal Commands", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "recovery-pending-update", scenario: "input_required" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected recovery task");
    const taskId = String(created.task.taskId);

    const before = controlSideEffects;
    await engine.updateTask(taskId, { approval: true }, authorization);
    const pendingUpdate = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM task_command
       WHERE task_id=$1 AND command_type='UPDATE' AND state='PENDING'`,
      [taskId],
    );
    expect(pendingUpdate.rows[0]?.count).toBe("1");

    const scan = await new RecoveryManager(engine, new TaskRepository(pool)).scan();

    expect(scan.tasksReconciled).toBeGreaterThanOrEqual(1);
    expect(controlSideEffects - before).toBe(0);
    const stillPending = await pool.query<{ state: string }>(
      `SELECT state FROM task_command
       WHERE task_id=$1 AND command_type='UPDATE'
       ORDER BY command_sequence DESC LIMIT 1`,
      [taskId],
    );
    expect(stillPending.rows[0]?.state).toBe("PENDING");
  });

  it("dispatches a recovered cancel command without repeating the Adapter side effect", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "pending-cancel", scenario: "cancel_response_loss" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected recoverable task");
    const taskId = String(created.task.taskId);
    const before = controlSideEffects;
    expect(await engine.cancelTask(taskId, authorization)).toMatchObject({ status: "working" });
    expect(controlSideEffects - before).toBe(0);
    expect(
      (
        await pool.query<{ state: string }>(
          "SELECT state FROM task_command WHERE task_id=$1 AND command_type='CANCEL'",
          [taskId],
        )
      ).rows[0]?.state,
    ).toBe("PENDING");

    const dispatcher = new DurableCommandDispatcher(gateway, new TaskRepository(pool));
    expect(await dispatcher.tick()).toMatchObject({ retried: 1 });
    expect(controlSideEffects - before).toBe(1);
    await pool.query(
      "UPDATE task_command SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE task_id=$1",
      [taskId],
    );
    expect(await dispatcher.tick()).toMatchObject({ acknowledged: 1 });
    expect(controlSideEffects - before).toBe(1);
    expect(await engine.getTask(taskId, authorization)).toMatchObject({ status: "cancelled" });
  });

  it("enforces user and execution-mode isolation for get, update, and cancel", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "mode-isolation" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected isolated task");
    const taskId = String(created.task.taskId);
    const simulation: AuthorizationContext = {
      hash: authorization.hash,
      executionMode: "simulation",
      simulationId: "sim-1",
    };
    await expect(engine.getTask(taskId, simulation)).rejects.toThrow("TASK_NOT_FOUND");
    await expect(engine.updateTask(taskId, {}, simulation)).rejects.toThrow("TASK_NOT_FOUND");
    await expect(engine.cancelTask(taskId, simulation)).rejects.toThrow("TASK_NOT_FOUND");
    expect(await engine.getTask(taskId, authorization)).toMatchObject({ status: "completed" });
  });

  it("makes an Adapter restart with lost execution explicit instead of silently dropping a Task", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "adapter-restart-loss" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected task before Adapter restart");
    const taskId = String(created.task.taskId);

    const restartedAdapter = createMockAdapterServer({ providerId: "recovery-provider" });
    const port = await bindMockAdapter(restartedAdapter, "127.0.0.1:0");
    const restartedGateway = new GrpcAdapterGateway({
      endpoint: `127.0.0.1:${String(port)}`,
      providerId: "recovery-provider",
    });
    const restartedEngine = new TaskEngine(
      engine.manifest,
      engine.operationSnapshotIds,
      restartedGateway,
      new TaskRepository(pool),
    );
    try {
      const scan = await new RecoveryManager(restartedEngine, new TaskRepository(pool)).scan();
      expect(scan.notFound).toBeGreaterThanOrEqual(1);
      expect(await new TaskRepository(pool).getById(taskId)).toMatchObject({
        mcpStatus: "failed",
        internalState: "TERMINAL_FAILED",
      });
    } finally {
      restartedGateway.close();
      await shutdown(restartedAdapter);
    }
  });

  it("retains confirmed tasks across a temporary database connection failure", async () => {
    const before = await pool.query<{ count: string }>("SELECT count(*) FROM provider_task");
    const unavailablePool = new Pool({
      connectionString: "postgresql://sdar:sdar@127.0.0.1:1/unavailable",
      connectionTimeoutMillis: 100,
      max: 1,
    });
    try {
      await expect(
        new RecoveryManager(engine, new TaskRepository(unavailablePool)).scan(),
      ).rejects.toThrow();
    } finally {
      await unavailablePool.end();
    }
    const after = await pool.query<{ count: string }>("SELECT count(*) FROM provider_task");
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it("T-017 schedules an old Task from its snapshot after Manifest v2 removes the operation", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "snapshot-v1-removed-operation" },
      authorization,
      undefined,
      undefined,
      {
        start: {
          mode: "scheduled",
          scheduledAt: new Date().toISOString(),
          startToleranceMs: 30_000,
        },
        maxElapsedMs: null,
      },
    );
    if (created.kind !== "task") throw new Error("Expected old scheduled Task");
    const taskId = String(created.task.taskId);
    await expect(
      engine.callOperation(
        requiredOperation("durable_task"),
        { resourceId: "snapshot-v1-response-loss", scenario: "response_loss" },
        authorization,
      ),
    ).rejects.toThrow("injected StartOperation response loss");
    const raw = await gateway.describeProvider();
    const manifestV2 = new OperationRegistry().validate({
      ...raw,
      providerVersion: "2.0.0",
      operations: raw.operations.filter((operation) => operation.name !== "durable_task"),
    });
    const snapshotIdsV2 = await new OperationSnapshotRepository(pool).saveManifest(manifestV2);
    const repository = new TaskRepository(pool);
    const restarted = new TaskEngine(manifestV2, snapshotIdsV2, gateway, repository);
    expect((await new RecoveryManager(restarted, repository).scan()).admissionsRecovered).toBe(1);
    await new DurableScheduler(manifestV2, gateway, repository).tick();
    expect(await repository.getById(taskId)).toMatchObject({
      operationName: "durable_task",
      internalState: "RUNNING",
    });
    expect(
      restarted.manifest.operations.some((operation) => operation.name === "durable_task"),
    ).toBe(false);
    const recovered = await pool.query<{ operation_snapshot_id: string }>(
      "SELECT operation_snapshot_id FROM provider_task WHERE arguments->>'resourceId'='snapshot-v1-response-loss'",
    );
    expect(recovered.rows[0]?.operation_snapshot_id).toBe(
      engine.operationSnapshotIds.get("durable_task"),
    );
  });

  it("T-018 keeps old input capability/schema while new calls use Manifest v2 schema", async () => {
    const created = await engine.callOperation(
      requiredOperation("durable_task"),
      { resourceId: "snapshot-v1-input", scenario: "input_required" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected old input Task");
    const taskId = String(created.task.taskId);
    const raw = await gateway.describeProvider();
    const manifestV2 = new OperationRegistry().validate({
      ...raw,
      providerVersion: "2.1.0",
      operations: raw.operations.map((operation) =>
        operation.name === "durable_task"
          ? {
              ...operation,
              inputSchema: jsonToProtoStruct({
                type: "object",
                properties: { replacement: { type: "string" } },
                required: ["replacement"],
                additionalProperties: false,
              }),
              capabilities: { ...operation.capabilities, inputRequired: false },
            }
          : operation,
      ),
    });
    const snapshotsV2 = await new OperationSnapshotRepository(pool).saveManifest(manifestV2);
    const restarted = new TaskEngine(manifestV2, snapshotsV2, gateway, new TaskRepository(pool));
    await restarted.updateTask(taskId, { approval: true }, authorization);
    await new DurableCommandDispatcher(gateway, new TaskRepository(pool)).tick();
    expect(await restarted.getTask(taskId, authorization)).toMatchObject({ status: "completed" });
    const newOperation = manifestV2.operations.find(
      (operation) => operation.name === "durable_task",
    );
    if (newOperation === undefined) throw new Error("Expected v2 operation");
    await expect(
      restarted.callOperation(newOperation, { resourceId: "old-shape" }, authorization),
    ).rejects.toThrow("INVALID_TOOL_ARGUMENTS");
  });

  it("gates readiness on startup recovery and exposes auth, rate, and metrics endpoints", async () => {
    const runtime = createRuntime(
      loadRuntimeConfig({
        DATABASE_URL: databaseUrl,
        PROVIDER_ID: "recovery-provider",
        ADAPTER_ENDPOINT: adapterEndpoint,
        AUTH_MODE: "trusted_headers",
        RATE_LIMIT_MAX: "2",
        RATE_LIMIT_WINDOW_MS: "60000",
      }),
    );
    try {
      expect((await runtime.app.inject({ method: "GET", url: "/health/ready" })).statusCode).toBe(
        503,
      );
      await runtime.initialize();
      const ready = await runtime.app.inject({ method: "GET", url: "/health/ready" });
      expect(ready.statusCode).toBe(200);
      expect(ready.json()).toMatchObject({
        dependencies: { database: "ready", adapter: "ready", recovery: "ready" },
      });
      const metrics = await runtime.app.inject({ method: "GET", url: "/metrics" });
      expect(metrics.statusCode).toBe(200);
      expect(metrics.body).toContain("sdar_recovery_total");
      expect(metrics.body).toContain("sdar_outbox_pending");
      expect(
        (await runtime.app.inject({ method: "POST", url: "/mcp/legacy", payload: {} })).statusCode,
      ).toBe(404);

      const unauthenticated = await runtime.app.inject({
        method: "POST",
        url: "/mcp",
        payload: { jsonrpc: "2.0", method: "tools/list", id: 1 },
      });
      expect(unauthenticated.statusCode).toBe(401);
      expect((await runtime.app.inject({ method: "GET", url: "/mcp" })).statusCode).toBe(405);
      expect((await runtime.app.inject({ method: "GET", url: "/mcp" })).statusCode).toBe(429);
    } finally {
      await runtime.app.close();
    }
  });
});

function requiredOperation(name: string) {
  const operation = engine.manifest.operations.find((candidate) => candidate.name === name);
  if (operation === undefined) throw new Error(`Operation ${name} is missing`);
  return operation;
}

function shutdown(server: grpc.Server): Promise<void> {
  return new Promise((resolve) => server.tryShutdown(() => resolve()));
}
