import { createHash, randomUUID } from "node:crypto";
import type * as grpc from "@grpc/grpc-js";
import Fastify from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  bindMockAdapter,
  createMockAdapterServer,
} from "../../examples/mock-adapter-typescript/src/server.js";
import { GrpcAdapterGateway } from "../../packages/adapter-protocol/src/index.js";
import type { Clock, TaskExecutionTiming } from "../../packages/domain/src/index.js";
import { Sep2663ProtocolHandler } from "../../packages/mcp-protocol/src/index.js";
import { createAuthorizationResolver } from "../../packages/mcp-protocol/src/security.js";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";
import {
  IdempotencyRepository,
  OperationSnapshotRepository,
  TaskRepository,
  runMigrations,
} from "../../packages/persistence-postgres/src/index.js";
import { ProviderTelemetryIngress } from "../../packages/provider-telemetry/src/index.js";
import { TaskEngine } from "../../packages/task-engine/src/index.js";
import type { IncomingMessage } from "node:http";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) throw new Error("TEST_DATABASE_URL is required for WI080");

// The Run Controller supplies a disposable database; this file owns only this schema.
const schema = `wi080_identity_${randomUUID().replaceAll("-", "")}`;
const admin = new Pool({ connectionString: databaseUrl, max: 1 });
const pool = new Pool({
  connectionString: databaseUrl,
  max: 5,
  options: `-c search_path=${schema}`,
});
const providerId = "wi080-provider";
const instanceA = "wi080-admission-owner";
const instanceB = "wi080-replacement-process";
const headers = {
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
  "mcp-protocol-version": "2026-07-28",
  "x-sdar-execution-mode": "simulation",
  "x-sdar-simulation-id": "wi080-local-adapter",
  "x-correlation-id": "wi080-correlation",
};
const authorization = createAuthorizationResolver({ mode: "development" })({
  headers,
} as unknown as IncomingMessage);
let adapter: grpc.Server;
let gateway: GrpcAdapterGateway;
let first: TaskEngine;
let sideEffects = 0;

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await runMigrations(pool);
  adapter = createMockAdapterServer({
    providerId,
    onStartSideEffect: () => {
      sideEffects += 1;
    },
  });
  const port = await bindMockAdapter(adapter, "127.0.0.1:0");
  gateway = new GrpcAdapterGateway({ providerId, endpoint: `127.0.0.1:${String(port)}` });
  const manifest = new OperationRegistry().validate(await gateway.describeProvider());
  const snapshots = await new OperationSnapshotRepository(pool).saveManifest(manifest);
  first = new TaskEngine(
    manifest,
    snapshots,
    gateway,
    new TaskRepository(pool),
    instanceA,
    new IdempotencyRepository(pool),
  );
});

afterAll(async () => {
  gateway?.close();
  if (adapter !== undefined)
    await new Promise<void>((resolve) => adapter.tryShutdown(() => resolve()));
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

function replacement(repository = new TaskRepository(pool), clock?: Clock): TaskEngine {
  return new TaskEngine(
    first.manifest,
    first.operationSnapshotIds,
    gateway,
    repository,
    instanceB,
    new IdempotencyRepository(pool),
    clock,
  );
}

async function rpc(engine: TaskEngine, method: string, params: Record<string, unknown>) {
  const handler = new Sep2663ProtocolHandler(engine.manifest, undefined, engine);
  const app = Fastify();
  app.post("/mcp", async (request, reply) => {
    reply.hijack();
    await handler.handle(request.raw, reply.raw, request.body);
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        ...headers,
        "mcp-method": method,
        "mcp-name": String(method === "tools/call" ? params.name : params.taskId),
      },
      payload: {
        jsonrpc: "2.0",
        id: randomUUID(),
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { name: "wi080", version: "1.0" },
            "io.modelcontextprotocol/clientCapabilities": {
              extensions: { "io.modelcontextprotocol/tasks": {} },
            },
            ...(method === "tools/call"
              ? {
                  "io.sdar/taskExecution": {
                    profileVersion: "1.0",
                    idempotencyKey: String(
                      params.arguments && (params.arguments as Record<string, unknown>).resourceId,
                    ),
                  },
                }
              : {}),
          },
        },
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ result: Record<string, unknown> }>().result;
  } finally {
    await app.close();
  }
}

function identity(task: Record<string, unknown>): unknown {
  return (task._meta as Record<string, unknown>)["io.sdar/providerIdentity"];
}

function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error("WI080_EXPECTED_COMMITTED_VALUE");
  return value;
}

describe("WI080 committed Provider task identity", () => {
  it("returns committed identity without auth and preserves it for retry/get/notification after restart", async () => {
    const before = sideEffects;
    const params = { name: "durable_task", arguments: { resourceId: "wi080-stable" } };
    const created = await rpc(first, "tools/call", params);
    const taskId = String(created.taskId);
    const expected = { profileVersion: "1.0", providerId, providerInstanceId: instanceA };
    expect(identity(created)).toEqual(expected);
    const rows = await pool.query<{ external_execution_id: string }>(
      `SELECT t.provider_id, t.provider_instance_id, i.provider_instance_id AS admission_instance,
              i.state, t.external_execution_id
       FROM provider_task t JOIN admission_intent i USING(task_id) WHERE t.task_id=$1`,
      [taskId],
    );
    expect(rows.rows[0]).toMatchObject({
      provider_id: providerId,
      provider_instance_id: instanceA,
      admission_instance: instanceA,
      state: "PUBLISHED",
    });
    expect(rows.rows[0]?.external_execution_id).toEqual(expect.any(String));
    const restarted = replacement();
    const replay = await rpc(restarted, "tools/call", params);
    expect(replay.taskId).toBe(taskId);
    expect(identity(replay)).toEqual(expected);
    const read = await rpc(restarted, "tasks/get", { taskId });
    expect(identity(read)).toEqual(expected);
    expect(read._meta).toEqual(created._meta);
    const notification = (await restarted.getFrozenTasks([taskId], authorization)).get(taskId);
    expect(notification).toBeDefined();
    expect(identity(required(notification))).toEqual(expected);
    expect(sideEffects - before).toBe(1);
  });

  it("publicly retries an interrupted admission with the original owner, deadline and context", async () => {
    const repository = new TaskRepository(pool);
    const acceptedAt = new Date();
    let now = acceptedAt;
    const clock = { now: () => now };
    const original = new TaskEngine(
      first.manifest,
      first.operationSnapshotIds,
      gateway,
      repository,
      instanceA,
      new IdempotencyRepository(pool),
      clock,
    );
    const operation = required(
      first.manifest.operations.find((value) => value.name === "durable_task"),
    );
    const before = sideEffects;
    const args = { resourceId: "wi080-interrupted" };
    const key = "wi080-interrupted-key";
    const timing: TaskExecutionTiming = {
      start: { mode: "immediate", startToleranceMs: 30_000 },
      maxElapsedMs: 60_000,
    };
    const failure = vi
      .spyOn(repository, "publishAccepted")
      .mockRejectedValueOnce(new Error("WI080_PUBLISH_INTERRUPTED"));
    try {
      await expect(
        original.callOperation(
          operation,
          args,
          authorization,
          600_000,
          key,
          timing,
          "wi080-original-reservation",
        ),
      ).rejects.toThrow("WI080_PUBLISH_INTERRUPTED");
    } finally {
      failure.mockRestore();
    }
    const pending = await pool.query<{ task_id: string }>(
      "SELECT task_id FROM admission_intent WHERE arguments->>'resourceId'='wi080-interrupted'",
    );
    const taskId = required(pending.rows[0]).task_id;
    const admission = await repository.getAdmission(taskId);
    expect(admission).toMatchObject({ providerInstanceId: instanceA, state: "UNCERTAIN" });
    now = new Date(acceptedAt.getTime() + 5_000);
    const restarted = replacement(repository, clock);
    const missingTaskId = randomUUID();
    await expect(
      restarted.recoverAdmission({ ...required(admission), taskId: missingTaskId }),
    ).rejects.toThrow("ADMISSION_INTENT_MISSING");
    expect(await repository.getAdmission(missingTaskId)).toBeNull();
    const reconciliation = vi.spyOn(gateway, "reconcileExecution");
    let recovered;
    try {
      recovered = await restarted.callFrozenOperation(
        operation,
        args,
        { ...authorization, correlationId: "wi080-retry-correlation" },
        key,
      );
      expect(reconciliation).toHaveBeenCalledWith(
        taskId,
        operation.name,
        required(admission).argumentHash,
        {
          authorizationContextHash: authorization.hash,
          executionMode: authorization.executionMode,
          simulationId: authorization.simulationId,
          correlationId: authorization.correlationId,
        },
      );
    } finally {
      reconciliation.mockRestore();
    }
    expect(recovered.taskId).toBe(taskId);
    expect(identity(recovered)).toEqual({
      profileVersion: "1.0",
      providerId,
      providerInstanceId: instanceA,
    });
    expect(await repository.getById(taskId)).toMatchObject({
      providerInstanceId: instanceA,
      acceptedAt,
      notBefore: acceptedAt,
      latestStartAt: new Date(acceptedAt.getTime() + 30_000),
      deadlineAt: new Date(acceptedAt.getTime() + 60_000),
      // The new observation stays at its actual controlled test-clock time.
      actualStartedAt: now,
      ttlMs: 600_000,
      reservationRef: "wi080-original-reservation",
      correlationId: "wi080-correlation",
      timing,
    });
    expect(sideEffects - before).toBe(1);
  });

  it("rejects public pending-idempotency retry when its durable intent is missing", async () => {
    const repository = new TaskRepository(pool);
    const original = new TaskEngine(
      first.manifest,
      first.operationSnapshotIds,
      gateway,
      repository,
      instanceA,
      new IdempotencyRepository(pool),
    );
    const operation = required(
      first.manifest.operations.find((value) => value.name === "durable_task"),
    );
    const args = { resourceId: "wi080-missing-intent" };
    const key = "wi080-missing-intent-key";
    const before = sideEffects;
    const failure = vi
      .spyOn(repository, "publishAccepted")
      .mockRejectedValueOnce(new Error("WI080_PUBLISH_INTERRUPTED"));
    try {
      await expect(
        original.callFrozenOperation(operation, args, authorization, key),
      ).rejects.toThrow("WI080_PUBLISH_INTERRUPTED");
    } finally {
      failure.mockRestore();
    }
    const pending = await pool.query<{ stable_task_id: string; state: string }>(
      "SELECT stable_task_id,state FROM idempotency_record WHERE idempotency_key=$1",
      [key],
    );
    const taskId = required(pending.rows[0]).stable_task_id;
    expect(required(pending.rows[0]).state).toBe("PENDING");
    expect(await repository.getAdmission(taskId)).toMatchObject({
      providerInstanceId: instanceA,
      state: "UNCERTAIN",
    });
    // Exact test-owned corruption: retain the PENDING key and Adapter execution.
    await pool.query("DELETE FROM admission_intent WHERE task_id=$1", [taskId]);
    const reconciliation = vi.spyOn(gateway, "reconcileExecution");
    const dispatch = vi.spyOn(gateway, "startOperation");
    try {
      await expect(
        replacement(repository).callFrozenOperation(operation, args, authorization, key),
      ).rejects.toThrow("ADMISSION_INTENT_MISSING");
      expect(reconciliation).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      reconciliation.mockRestore();
      dispatch.mockRestore();
    }
    expect(await repository.getAdmission(taskId)).toBeNull();
    expect(await repository.getById(taskId)).toBeNull();
    expect(
      (await pool.query("SELECT state FROM idempotency_record WHERE stable_task_id=$1", [taskId]))
        .rows[0],
    ).toEqual({ state: "PENDING" });
    expect(sideEffects - before).toBe(1);
  });

  it("keeps scheduled admission timing and correlation when public retry omits timing", async () => {
    const repository = new TaskRepository(pool);
    const acceptedAt = new Date();
    let now = acceptedAt;
    const clock = { now: () => now };
    const original = new TaskEngine(
      first.manifest,
      first.operationSnapshotIds,
      gateway,
      repository,
      instanceA,
      new IdempotencyRepository(pool),
      clock,
    );
    const operation = required(
      first.manifest.operations.find((value) => value.name === "durable_task"),
    );
    const args = { resourceId: "wi080-scheduled-retry" };
    const key = "wi080-scheduled-key";
    const notBefore = new Date(acceptedAt.getTime() + 60_000);
    const timing: TaskExecutionTiming = {
      start: { mode: "scheduled", scheduledAt: notBefore.toISOString(), startToleranceMs: 30_000 },
      maxElapsedMs: 120_000,
    };
    const before = sideEffects;
    const failure = vi
      .spyOn(repository, "publishScheduled")
      .mockRejectedValueOnce(new Error("WI080_SCHEDULED_PUBLISH_INTERRUPTED"));
    try {
      await expect(
        original.callFrozenOperation(
          operation,
          args,
          authorization,
          key,
          timing,
          "wi080-scheduled-reservation",
        ),
      ).rejects.toThrow("WI080_SCHEDULED_PUBLISH_INTERRUPTED");
    } finally {
      failure.mockRestore();
    }
    now = new Date(acceptedAt.getTime() + 10_000);
    const publicationFloor = required(
      (await pool.query<{ observed_at: Date }>("SELECT clock_timestamp() AS observed_at")).rows[0],
    ).observed_at;
    const created = await replacement(repository, clock).callFrozenOperation(
      operation,
      args,
      { ...authorization, correlationId: "wi080-scheduled-retry-correlation" },
      key,
    );
    const taskId = String(created.taskId);
    expect(identity(created)).toEqual({
      profileVersion: "1.0",
      providerId,
      providerInstanceId: instanceA,
    });
    expect(await repository.getById(taskId)).toMatchObject({
      providerInstanceId: instanceA,
      internalState: "SCHEDULED",
      externalExecutionId: null,
      actualStartedAt: null,
      acceptedAt,
      notBefore,
      latestStartAt: new Date(notBefore.getTime() + 30_000),
      deadlineAt: new Date(notBefore.getTime() + 120_000),
      correlationId: "wi080-correlation",
      reservationRef: "wi080-scheduled-reservation",
      timing,
    });
    expect(await repository.getAdmission(taskId)).toMatchObject({
      providerInstanceId: instanceA,
      authorization,
      timing,
      state: "PUBLISHED",
    });
    const observation = required(
      (
        await pool.query<{ occurred_at: Date }>(
          "SELECT occurred_at FROM task_observation WHERE task_id=$1 AND type='task.scheduled'",
          [taskId],
        )
      ).rows[0],
    );
    expect(observation.occurred_at.getTime()).toBeGreaterThanOrEqual(publicationFloor.getTime());
    const facts = await pool.query<{ correlation: Record<string, unknown> }>(
      "SELECT record_body->'attributes'->'correlation' AS correlation FROM provider_ops_delivery WHERE record_body->>'taskId'=$1",
      [taskId],
    );
    expect(facts.rows.length).toBeGreaterThan(0);
    expect(
      facts.rows.every(({ correlation }) => correlation.correlationId === "wi080-correlation"),
    ).toBe(true);
    expect(sideEffects - before).toBe(0);
  });

  it("keeps command IDs and task-linked ProviderOps owner/canonical claims after process replacement", async () => {
    const created = await rpc(first, "tools/call", {
      name: "durable_task",
      arguments: { resourceId: "wi080-ops" },
    });
    const taskId = String(created.taskId);
    const repository = new TaskRepository(pool);
    const task = required(await repository.getById(taskId));
    const commandHash = createHash("sha256").update("cancel:wi080").digest("hex");
    const command = await repository.beginCancel(taskId, commandHash);
    const duplicate = await new TaskRepository(pool).beginCancel(taskId, commandHash);
    expect(duplicate.sequence).toBe(command.sequence);
    const ingress = new ProviderTelemetryIngress(pool, { providerId, instanceId: instanceB });
    const now = Date.now();
    const event = {
      providerEventId: "wi080-event",
      providerEventSequence: "1",
      eventType: "EXECUTION_PROGRESS" as const,
      occurredAt: { seconds: String(Math.floor(now / 1000)), nanos: (now % 1000) * 1_000_000 },
      taskId,
      externalExecutionId: required(task.externalExecutionId),
      operationName: task.operationName,
      resourceId: "resource-wi080",
      resourceType: "test",
      traceparent: "",
      tracestate: "",
      attributes: { correlation: { originTaskIds: ["deliberately-unrelated-claim"] } },
      payload: { percentage: 50 },
    };
    const request = { providerId, events: [event] };
    expect((await ingress.emit(providerId, request)).results[0]).toMatchObject({
      accepted: true,
      duplicate: false,
    });
    expect((await ingress.emit(providerId, request)).results[0]).toMatchObject({
      accepted: true,
      duplicate: true,
    });
    const facts = await pool.query<{ record_body: Record<string, unknown> }>(
      "SELECT record_body FROM provider_ops_delivery WHERE record_body->>'taskId'=$1",
      [taskId],
    );
    expect(facts.rows.length).toBeGreaterThan(1);
    for (const { record_body: fact } of facts.rows) {
      expect(fact).toMatchObject({
        taskId,
        providerId,
        instanceId: instanceA,
        externalExecutionId: task.externalExecutionId,
        attributes: { correlation: { correlationId: "wi080-correlation" } },
      });
      expect(fact).not.toHaveProperty("correlationId");
      expect(fact).not.toHaveProperty("traceId");
      expect(fact).not.toHaveProperty("spanId");
    }
    const providerEvent = required(
      facts.rows.find(({ record_body: fact }) => fact.providerEventId === event.providerEventId),
    ).record_body;
    expect(providerEvent).toMatchObject({
      attributes: { correlation: { originTaskIds: ["deliberately-unrelated-claim"] } },
    });
    const resourceEvent = {
      ...event,
      providerEventId: "wi080-resource-without-correlation",
      eventType: "RESOURCE_STATE" as const,
      taskId: "",
      externalExecutionId: "",
      operationName: "",
      attributes: { region: "test", nested: { healthy: true } },
      payload: { state: "ready", reasonCode: "RESOURCE_READY" },
    };
    expect(
      (await ingress.emit(providerId, { providerId, events: [resourceEvent] })).results[0],
    ).toMatchObject({ accepted: true });
    const resource = await pool.query<{ attributes: Record<string, unknown> }>(
      "SELECT record_body->'attributes' AS attributes FROM provider_ops_delivery WHERE record_body->>'providerEventId'=$1",
      [resourceEvent.providerEventId],
    );
    expect(required(resource.rows[0]).attributes).toEqual(resourceEvent.attributes);
    expect((await replacement().providerLocalTaskIdentity(taskId))?.providerInstanceId).toBe(
      instanceA,
    );
  });
});
