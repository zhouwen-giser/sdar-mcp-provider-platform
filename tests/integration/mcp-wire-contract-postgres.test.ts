import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolResultSchema,
  CreateTaskResultSchema,
  ErrorCode,
  GetTaskResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type * as grpc from "@grpc/grpc-js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  bindMockAdapter,
  createMockAdapterServer,
} from "../../examples/mock-adapter-typescript/src/server.js";
import { GrpcAdapterGateway } from "../../packages/adapter-protocol/src/index.js";
import type { AuthorizationContext } from "../../packages/domain/src/index.js";
import { McpProtocolHandler } from "../../packages/mcp-protocol/src/index.js";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";
import {
  IdempotencyRepository,
  OperationSnapshotRepository,
  TaskRepository,
  runMigrations,
} from "../../packages/persistence-postgres/src/index.js";
import { TaskEngine } from "../../packages/task-engine/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) throw new Error("TEST_DATABASE_URL is required for H6 wire tests");

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const authorization: AuthorizationContext = {
  hash: "6".repeat(64),
  executionMode: "live",
  simulationId: null,
  correlationId: "h6-wire-contract",
};
let adapter: grpc.Server;
let gateway: GrpcAdapterGateway;
let app: FastifyInstance;
let client: Client;
let mcpUrl: URL;
const DetailedTaskResultSchema = GetTaskResultSchema.extend({
  result: z.record(z.string(), z.unknown()).optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

beforeAll(async () => {
  await pool.query(`DROP TABLE IF EXISTS
    task_input_response_inbox, provider_ops_delivery, runtime_lease, outbox_event, idempotency_record,
    task_command, task_input_request,
    task_observation, provider_task, admission_intent, operation_snapshot,
    runtime_schema_migration CASCADE`);
  await runMigrations(pool);
  adapter = createMockAdapterServer({ providerId: "h6-wire-provider" });
  const adapterPort = await bindMockAdapter(adapter, "127.0.0.1:0");
  gateway = new GrpcAdapterGateway({
    endpoint: `127.0.0.1:${String(adapterPort)}`,
    providerId: "h6-wire-provider",
  });
  const manifest = new OperationRegistry().validate(await gateway.describeProvider());
  const snapshots = await new OperationSnapshotRepository(pool).saveManifest(manifest);
  const engine = new TaskEngine(
    manifest,
    snapshots,
    gateway,
    new TaskRepository(pool),
    new IdempotencyRepository(pool),
  );
  const handler = new McpProtocolHandler(manifest, gateway, engine, {
    resolveAuthorization: () => authorization,
  });
  app = Fastify();
  app.post("/mcp", async (request, reply) => {
    reply.hijack();
    await handler.handle(request.raw, reply.raw, request.body);
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("H6 MCP did not bind");
  mcpUrl = new URL(`http://127.0.0.1:${String(address.port)}/mcp`);
  client = new Client({ name: "rc2-h6-wire", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(mcpUrl) as unknown as Transport);
  await client.listTools();
});

afterAll(async () => {
  await client.close();
  await app.close();
  gateway.close();
  await new Promise<void>((resolve) => adapter.tryShutdown(() => resolve()));
  await pool.query("DROP TABLE IF EXISTS task_input_response_inbox CASCADE");
  await pool.end();
});

describe("H6 MCP wire and result contract", () => {
  it("T-031 publishes schema-valid synchronous, inline and asynchronous success", async () => {
    const synchronous = await client.callTool({
      name: "echo_sync",
      arguments: { message: "schema-valid" },
    });
    expect(synchronous).toMatchObject({
      isError: false,
      structuredContent: { message: "schema-valid" },
    });

    const inline = await client.callTool({
      name: "flex_task",
      arguments: { resourceId: "h6-inline-valid", scenario: "terminal" },
    });
    expect(inline).toMatchObject({
      isError: false,
      structuredContent: { resourceId: "h6-inline-valid", completed: true },
    });

    const asynchronous = await createTask("h6-async-valid");
    expect(asynchronous.task.status).toBe("working");
    expect((await client.experimental.tasks.getTask(asynchronous.task.taskId)).status).toBe(
      "completed",
    );
    await expect(
      client.experimental.tasks.getTaskResult(asynchronous.task.taskId, CallToolResultSchema),
    ).resolves.toMatchObject({
      isError: false,
      structuredContent: { resourceId: "h6-async-valid", completed: true },
    });
  });

  it("T-032 never publishes an Adapter success with an invalid output", async () => {
    await expect(
      client.callTool({ name: "echo_sync", arguments: { message: "__invalid_output__" } }),
    ).rejects.toMatchObject({
      code: ErrorCode.InternalError,
      data: { reasonCode: "ADAPTER_OUTPUT_SCHEMA_MISMATCH" },
    });
    await expect(
      client.callTool({
        name: "flex_task",
        arguments: { resourceId: "h6-inline-invalid", scenario: "terminal_invalid_output" },
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.InternalError,
      data: { reasonCode: "ADAPTER_OUTPUT_SCHEMA_MISMATCH" },
    });

    const asynchronous = await createTask("h6-async-invalid", "output_invalid");
    const failed = await getDetailedTask(asynchronous.task.taskId);
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatchObject({
      code: ErrorCode.InternalError,
      data: { reasonCode: "ADAPTER_OUTPUT_SCHEMA_MISMATCH" },
    });
  });

  it("T-033 validates a partial result payload before publishing its business result", async () => {
    const created = await createTask("h6-partial", "partial_valid");
    expect(created.task.status).toBe("completed");
    await expect(
      client.experimental.tasks.getTaskResult(created.task.taskId, CallToolResultSchema),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        outcome: "partial_completion",
        reasonCode: "PARTIAL_RESULT",
        resourceId: "h6-partial",
        completed: false,
      },
    });

    const invalid = await createTask("h6-partial-invalid", "partial_invalid");
    expect(await getDetailedTask(invalid.task.taskId)).toMatchObject({
      status: "failed",
      error: {
        code: ErrorCode.InternalError,
        data: { reasonCode: "ADAPTER_OUTPUT_SCHEMA_MISMATCH" },
      },
    });
  });

  it("T-034 maps a synchronous technical failure to JSON-RPC Internal Error", async () => {
    await expect(
      client.callTool({ name: "echo_sync", arguments: { message: "__technical_failure__" } }),
    ).rejects.toMatchObject({
      code: ErrorCode.InternalError,
      message: "MCP error -32603: Runtime technical failure.",
      data: { reasonCode: "ADAPTER_RPC_FAILED" },
    });
  });

  it("T-035 represents a published asynchronous technical failure as Task failed", async () => {
    const created = await createTask("h6-async-technical", "technical_failure");
    expect(created.task.status).toBe("failed");
    const failed = await getDetailedTask(created.task.taskId);
    expect(failed).toMatchObject({
      status: "failed",
      error: {
        code: ErrorCode.InternalError,
        message: "Task execution failed.",
        data: { reasonCode: "ADAPTER_EXECUTION_FAILED", retryable: false },
      },
    });
  });

  it("T-036 keeps a business failure completed and returns CallToolResult.isError", async () => {
    const created = await createTask("h6-business", "business_failure");
    expect(created.task.status).toBe("completed");
    await expect(
      client.experimental.tasks.getTaskResult(created.task.taskId, CallToolResultSchema),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        outcome: "business_failure",
        reasonCode: "BUSINESS_RULE_REJECTED",
      },
    });
  });

  it("T-037 returns a stable Invalid Params error for an unknown tool", async () => {
    await expect(client.callTool({ name: "unknown_h6_tool", arguments: {} })).rejects.toMatchObject(
      {
        code: ErrorCode.InvalidParams,
        message: "MCP error -32602: Unknown tool.",
        data: { reasonCode: "UNKNOWN_TOOL" },
      },
    );
  });

  it("T-038 returns stable, non-confusing errors for unknown and expired Tasks", async () => {
    await expect(client.experimental.tasks.getTask(randomUUID())).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
      message: "MCP error -32602: Task not found.",
      data: { reasonCode: "TASK_NOT_FOUND" },
    });

    const created = await createTask("h6-expired", "partial_valid", 1_000);
    await pool.query("UPDATE provider_task SET handle_expires_at='2000-01-01' WHERE task_id=$1", [
      created.task.taskId,
    ]);
    await expect(client.experimental.tasks.getTask(created.task.taskId)).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
      message: "MCP error -32602: Task handle expired.",
      data: { reasonCode: "TASK_EXPIRED" },
    });
  });

  it("T-039 returns a stable capability-not-supported wire error", async () => {
    const created = await client.request(
      {
        method: "tools/call",
        params: {
          name: "flex_task",
          arguments: { resourceId: "h6-no-cancel", scenario: "running" },
        },
      },
      CreateTaskResultSchema,
      { task: { ttl: 60_000 } },
    );
    await expect(client.experimental.tasks.cancelTask(created.task.taskId)).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
      message: "MCP error -32602: Capability not supported.",
      data: { reasonCode: "CANCEL_NOT_SUPPORTED" },
    });
  });

  it("T-040 keeps standard ttl/pollInterval fields and SDAR aliases schema-compatible", async () => {
    const created = await createTask("h6-compat", "hold", 123_456, 250);
    expect(created.task).toMatchObject({ ttl: 123_456, pollInterval: 2_000 });
    expect(created.task).not.toHaveProperty("ttlMs");
    expect(created.task).not.toHaveProperty("pollIntervalMs");

    const task = await getDetailedTask(created.task.taskId);
    expect(task).toMatchObject({ ttl: 123_456, pollInterval: 2_000 });
    expect(task).not.toHaveProperty("ttlMs");
    expect(task).not.toHaveProperty("pollIntervalMs");
    expect(task._meta).toMatchObject({
      "io.sdar/taskExecution": { ttlMs: 123_456, pollIntervalMs: 2_000 },
    });

    for (const ttl of [-1, 1.5, 31_536_000_001]) {
      await expect(createTask(`h6-invalid-ttl-${String(ttl)}`, "hold", ttl)).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
        data: { reasonCode: "INVALID_TASK_TTL" },
      });
    }
    const malformed = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "h6-invalid-ttl-type",
        method: "tools/call",
        params: {
          name: "durable_task",
          arguments: { resourceId: "h6-invalid-ttl-type", scenario: "hold" },
          task: { ttl: "invalid" },
        },
      }),
    });
    const malformedText = await malformed.text();
    const dataLine = malformedText.split(/\r?\n/u).find((line) => line.startsWith("data: "));
    if (dataLine === undefined) throw new Error("malformed wire response did not contain SSE data");
    const malformedBody = JSON.parse(dataLine.slice(6)) as {
      error?: { code?: number; message?: string };
    };
    expect(malformed.status).toBe(200);
    expect(malformedBody.error).toMatchObject({ code: ErrorCode.InvalidParams });
  });

  it("first_update_returns_pending_receipt_without_error", async () => {
    const created = await createTask("h6-task-first-update-receipt", "input_required");
    const taskId = created.task.taskId;
    const firstUpdate = await rawRequest(
      "tasks/update",
      { taskId, inputs: { approval: true } },
      "h6-first-update-wire",
    );
    expect(firstUpdate.error).toBeUndefined();
    if (firstUpdate.result === undefined) throw new Error("Expected successful wire result");
    expectTaskReceipt(firstUpdate.result, {
      commandSequence: 1,
      commandType: "UPDATE",
      commandState: "PENDING",
      durablyAccepted: true,
      duplicate: false,
    });
  });

  it("first_pause_returns_pending_receipt_without_error", async () => {
    const created = await createTask("h6-task-first-pause-receipt");
    const taskId = created.task.taskId;
    const firstPause = await rawRequest(
      "io.sdar/taskExecution/tasks/pause",
      { taskId },
      "h6-first-pause-wire",
    );
    expect(firstPause.error).toBeUndefined();
    if (firstPause.result === undefined) throw new Error("Expected successful wire result");
    expectTaskReceipt(firstPause.result, {
      commandSequence: 1,
      commandType: "PAUSE",
      commandState: "PENDING",
      durablyAccepted: true,
      duplicate: false,
    });
  });

  it("first_resume_returns_pending_receipt_without_error", async () => {
    const created = await createTask("h6-task-first-resume-receipt");
    const taskId = created.task.taskId;
    const firstResume = await rawRequest(
      "io.sdar/taskExecution/tasks/resume",
      { taskId },
      "h6-first-resume-wire",
    );
    expect(firstResume.error).toBeUndefined();
    if (firstResume.result === undefined) throw new Error("Expected successful wire result");
    expectTaskReceipt(firstResume.result, {
      commandSequence: 1,
      commandType: "RESUME",
      commandState: "PENDING",
      durablyAccepted: true,
      duplicate: false,
    });
  });

  it("duplicate_pending_update_returns_command_in_progress", async () => {
    const created = await createTask("h6-task-dupe-pending-update", "input_required");
    const taskId = created.task.taskId;
    await rawRequest(
      "tasks/update",
      { taskId, inputs: { approval: true } },
      "h6-dupe-update-wire-1",
    );
    const duplicate = await rawRequest(
      "tasks/update",
      { taskId, inputs: { approval: true } },
      "h6-dupe-update-wire-2",
    );
    expect(duplicate.error).toMatchObject({
      code: -32009,
      data: {
        reasonCode: "COMMAND_IN_PROGRESS",
        commandSequence: 1,
        commandType: "UPDATE",
        commandState: "PENDING",
      },
    });
    expect((duplicate.error?.data as { retryAfterMs?: unknown }).retryAfterMs).toEqual(
      expect.any(Number),
    );
  });

  it("duplicate_claimed_pause_returns_command_in_progress", async () => {
    const created = await createTask("h6-task-dupe-claimed-pause");
    const taskId = created.task.taskId;
    await rawRequest("io.sdar/taskExecution/tasks/pause", { taskId }, "h6-dupe-claimed-pause-1");
    await pool.query(
      `UPDATE task_command
         SET state='CLAIMED', claim_owner='h6-wire', claim_until=clock_timestamp()+interval '30s'
       WHERE task_id=$1 AND command_type='PAUSE' AND command_sequence=1`,
      [taskId],
    );
    const duplicate = await rawRequest(
      "io.sdar/taskExecution/tasks/pause",
      { taskId },
      "h6-dupe-claimed-pause-2",
    );
    expect(duplicate.error).toMatchObject({
      code: -32009,
      data: {
        reasonCode: "COMMAND_IN_PROGRESS",
        commandSequence: 1,
        commandType: "PAUSE",
        commandState: "CLAIMED",
      },
    });
    expect((duplicate.error?.data as { retryAfterMs?: unknown }).retryAfterMs).toEqual(
      expect.any(Number),
    );
  });

  it("duplicate_retry_wait_resume_returns_command_in_progress", async () => {
    const created = await createTask("h6-task-dupe-retry-wait-resume");
    const taskId = created.task.taskId;
    await rawRequest(
      "io.sdar/taskExecution/tasks/resume",
      { taskId },
      "h6-dupe-retry-wait-resume-1",
    );
    await pool.query(
      `UPDATE task_command
         SET state='RETRY_WAIT', next_attempt_at=clock_timestamp()+interval '1 second',
             claim_owner=NULL, claim_until=NULL
       WHERE task_id=$1 AND command_type='RESUME' AND command_sequence=1`,
      [taskId],
    );
    const duplicate = await rawRequest(
      "io.sdar/taskExecution/tasks/resume",
      { taskId },
      "h6-dupe-retry-wait-resume-2",
    );
    expect(duplicate.error).toMatchObject({
      code: -32009,
      data: {
        reasonCode: "COMMAND_IN_PROGRESS",
        commandSequence: 1,
        commandType: "RESUME",
        commandState: "RETRY_WAIT",
      },
    });
    expect((duplicate.error?.data as { retryAfterMs?: unknown }).retryAfterMs).toEqual(
      expect.any(Number),
    );
  });

  it("cross_type_pending_update_blocks_pause_with_real_blocking_type", async () => {
    const created = await createTask("h6-cross-type-pending-update", "input_required");
    const taskId = created.task.taskId;
    await rawRequest(
      "tasks/update",
      { taskId, inputs: { approval: true } },
      "h6-cross-update-wire-1",
    );
    const duplicate = await rawRequest(
      "io.sdar/taskExecution/tasks/pause",
      { taskId },
      "h6-cross-update-wire-2",
    );
    expect(duplicate.error).toMatchObject({
      code: -32009,
      data: {
        reasonCode: "COMMAND_IN_PROGRESS",
        commandSequence: 1,
        requestedCommandType: "PAUSE",
        blockingCommandType: "UPDATE",
        commandType: "UPDATE",
        commandState: "PENDING",
      },
    });
  });

  it("cross_type_claimed_pause_blocks_resume_with_real_blocking_type", async () => {
    const created = await createTask("h6-cross-type-claimed-pause");
    const taskId = created.task.taskId;
    await rawRequest("io.sdar/taskExecution/tasks/pause", { taskId }, "h6-cross-pause-wire-1");
    await pool.query(
      `UPDATE task_command
         SET state='CLAIMED', claim_owner='h6-wire', claim_until=clock_timestamp()+interval '30s'
       WHERE task_id=$1 AND command_type='PAUSE' AND command_sequence=1`,
      [taskId],
    );
    const duplicate = await rawRequest(
      "io.sdar/taskExecution/tasks/resume",
      { taskId },
      "h6-cross-pause-wire-2",
    );
    expect(duplicate.error).toMatchObject({
      code: -32009,
      data: {
        reasonCode: "COMMAND_IN_PROGRESS",
        commandSequence: 1,
        requestedCommandType: "RESUME",
        blockingCommandType: "PAUSE",
        commandType: "PAUSE",
        commandState: "CLAIMED",
      },
    });
  });

  it("cross_type_retry_wait_resume_blocks_update_with_real_blocking_type", async () => {
    const created = await createTask("h6-cross-type-retry-resume");
    const taskId = created.task.taskId;
    await rawRequest(
      "io.sdar/taskExecution/tasks/resume",
      { taskId },
      "h6-cross-retry-resume-wire-1",
    );
    await pool.query(
      `UPDATE task_command
         SET state='RETRY_WAIT', next_attempt_at=clock_timestamp()+interval '1 second',
             claim_owner=NULL, claim_until=NULL
       WHERE task_id=$1 AND command_type='RESUME' AND command_sequence=1`,
      [taskId],
    );
    const duplicate = await rawRequest(
      "io.sdar/taskExecution/tasks/pause",
      { taskId },
      "h6-cross-retry-resume-wire-2",
    );
    expect(duplicate.error).toMatchObject({
      code: -32009,
      data: {
        reasonCode: "COMMAND_IN_PROGRESS",
        commandSequence: 1,
        requestedCommandType: "PAUSE",
        blockingCommandType: "RESUME",
        commandType: "RESUME",
        commandState: "RETRY_WAIT",
      },
    });
  });

  it("acknowledged_cancel_blocks_new_update_with_protocol", async () => {
    const created = await createTask("h6-wire-update-stop-ack", "input_required");
    const taskId = created.task.taskId;
    await rawRequest("tasks/cancel", { taskId }, "h6-wire-update-stop-cancel");
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

    const duplicate = await rawRequest(
      "tasks/update",
      { taskId, inputs: { approval: true } },
      "h6-wire-update-stop",
    );
    expect(duplicate.error).toMatchObject({
      code: -32009,
      data: {
        reasonCode: "COMMAND_IN_PROGRESS",
        commandSequence: 1,
        commandType: "CANCEL",
        requestedCommandType: "UPDATE",
        blockingCommandType: "CANCEL",
        commandState: "ACKNOWLEDGED",
      },
    });
    expect((duplicate.error?.data as { retryAfterMs?: unknown }).retryAfterMs).toBe(0);
  });

  it("pending_cancel_blocks_new_pause_with_protocol", async () => {
    const created = await createTask("h6-wire-pause-stop-pending");
    const taskId = created.task.taskId;
    await rawRequest("tasks/cancel", { taskId }, "h6-wire-pause-stop-cancel");

    const duplicate = await rawRequest(
      "io.sdar/taskExecution/tasks/pause",
      { taskId },
      "h6-wire-pause-stop",
    );
    expect(duplicate.error).toMatchObject({
      code: -32009,
      data: {
        reasonCode: "COMMAND_IN_PROGRESS",
        commandSequence: 1,
        commandType: "CANCEL",
        requestedCommandType: "PAUSE",
        blockingCommandType: "CANCEL",
        commandState: "PENDING",
      },
    });
    expect((duplicate.error?.data as { retryAfterMs?: unknown }).retryAfterMs).toEqual(
      expect.any(Number),
    );
  });
});

function createTask(resourceId: string, scenario?: string, ttl = 60_000, pollInterval?: number) {
  return client.request(
    {
      method: "tools/call",
      params: {
        name: "durable_task",
        arguments: { resourceId, ...(scenario === undefined ? {} : { scenario }) },
      },
    },
    CreateTaskResultSchema,
    { task: { ttl, ...(pollInterval === undefined ? {} : { pollInterval }) } },
  );
}

function getDetailedTask(taskId: string) {
  return client.request({ method: "tasks/get", params: { taskId } }, DetailedTaskResultSchema);
}

async function rawRequest(method: string, params: Record<string, unknown>, id: string) {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
  });
  const bodyText = await response.text();
  const dataLine = bodyText.split(/\r?\n/u).find((line) => line.startsWith("data: "));
  if (dataLine === undefined) throw new Error("wire response did not contain SSE data");
  const body = JSON.parse(dataLine.slice(6)) as {
    jsonrpc?: string;
    id?: string;
    result?: Record<string, unknown>;
    error?: {
      code: number;
      message?: string;
      data?: Record<string, unknown>;
    };
  };
  expect(response.status).toBe(200);
  expect(body.jsonrpc).toBe("2.0");
  expect(body.id).toBe(id);
  return body;
}

function expectTaskReceipt(
  result: Record<string, unknown>,
  expected: {
    commandSequence: number;
    commandType: "UPDATE" | "PAUSE" | "RESUME";
    commandState: string;
    durablyAccepted: boolean;
    duplicate: boolean;
  },
) {
  const profile = (result._meta as Record<string, Record<string, unknown>> | undefined)?.[
    "io.sdar/taskExecution"
  ];
  const receipt = profile?.receipt as Record<string, unknown> | undefined;
  if (receipt === undefined) throw new Error("Expected command receipt");
  expect(receipt.commandSequence).toBe(expected.commandSequence);
  expect(receipt.commandType).toBe(expected.commandType);
  expect(receipt.commandState).toBe(expected.commandState);
  expect(receipt.duplicate).toBe(expected.duplicate);
  expect(receipt.durablyAccepted).toBe(expected.durablyAccepted);
  expect(typeof receipt.acceptedAt).toBe("string");
  expect(receipt).not.toHaveProperty("adapterAck");
}
