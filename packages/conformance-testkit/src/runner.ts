import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import Fastify from "fastify";
import { Pool } from "pg";
import { GrpcAdapterGateway } from "../../adapter-protocol/src/index.js";
import type { AuthorizationContext, Clock } from "../../domain/src/index.js";
import { McpProtocolHandler } from "../../mcp-protocol/src/index.js";
import { OperationRegistry } from "../../operation-registry/src/index.js";
import {
  IdempotencyRepository,
  OperationSnapshotRepository,
  OutboxRepository,
  TaskRepository,
  runMigrations,
} from "../../persistence-postgres/src/index.js";
import {
  DurableCommandDispatcher,
  DurableScheduler,
  TaskEngine,
} from "../../task-engine/src/index.js";

export interface ConformanceOptions {
  language: "typescript" | "python";
  endpoint: string;
  providerId: string;
  databaseUrl: string;
  restartBindingVerified: boolean;
}

export interface ConformanceReport {
  profileVersion: "1.0";
  adapterLanguage: string;
  providerId: string;
  generatedAt: string;
  status: "passed" | "failed";
  scopes: {
    runtimeProfile: ScopeReport;
    adapterProtocol: ScopeReport;
    resourceSpecificSafety: ScopeReport;
  };
  groups: GroupReport[];
}

interface ScopeReport {
  status: "passed" | "failed" | "partial" | "not_claimed";
  basis: string;
}

interface GroupReport {
  id: "P0" | "P1" | "P2" | "P3" | "P4";
  status: "passed" | "failed";
  tests: CaseReport[];
}

interface CaseReport {
  name: string;
  status: "passed" | "failed";
  durationMs: number;
  error?: string;
}

const authorization: AuthorizationContext = {
  hash: "d".repeat(64),
  executionMode: "live",
  simulationId: null,
  correlationId: "conformance",
};

export async function runConformance(options: ConformanceOptions): Promise<ConformanceReport> {
  const pool = new Pool({ connectionString: options.databaseUrl, max: 8 });
  const gateway = new GrpcAdapterGateway({
    endpoint: options.endpoint,
    providerId: options.providerId,
    timeoutMs: 3_000,
  });
  const groups = new Map<GroupReport["id"], GroupReport>();
  for (const id of ["P0", "P1", "P2", "P3", "P4"] as const) {
    groups.set(id, { id, status: "passed", tests: [] });
  }
  try {
    await resetDatabase(pool);
    await runMigrations(pool);
    const manifest = new OperationRegistry().validate(await gateway.describeProvider());
    assert(manifest.providerId === options.providerId, "providerId mismatch");
    const snapshots = await new OperationSnapshotRepository(pool).saveManifest(manifest);
    const repository = new TaskRepository(pool);
    const engine = new TaskEngine(
      manifest,
      snapshots,
      gateway,
      repository,
      new IdempotencyRepository(pool),
    );

    await test(groups, "P0", "P0 protocol/catalog and synchronous Tool", async () => {
      assert(manifest.operations.length === 3, "expected three operation definitions");
      const result = await engine.callOperation(
        operation(engine, "echo_sync"),
        { message: "cross-language" },
        authorization,
      );
      assert(result.kind === "result", "synchronous operation returned a Task");
      assert(result.result.isError === false, "synchronous result isError mismatch");
      await mcpRoundTrip(engine, gateway);
    });

    await test(groups, "P0", "P0 persisted task_required lifecycle and terminal read", async () => {
      const created = await engine.callOperation(
        operation(engine, "durable_task"),
        { resourceId: `${options.language}-p0` },
        authorization,
      );
      assert(created.kind === "task", "task_required did not return a Task");
      const completed = await engine.getTask(String(created.task.taskId), authorization);
      assert(completed.status === "completed", "Task did not complete");
    });

    await test(groups, "P1", "P1 checkAvailability four states, risk and windows", async () => {
      const availability = await engine.checkAvailability(
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
          {
            requestId: "unknown",
            operationName: "durable_task",
            arguments: { state: "complete", value: { resourceId: "d", scenario: "unknown" } },
          },
        ],
        authorization,
      );
      assert(
        availability.results.map((item) => item.availability).join(",") ===
          "available,restricted,disabled,unknown",
        "availability state mismatch",
      );
      const restricted = availability.results[1];
      assert(restricted?.riskLevel === "high", "restricted risk level mismatch");
      assert(restricted.validUntil !== undefined, "restricted validUntil missing");
      assert(restricted.earliestStartTime !== undefined, "restricted earliest start missing");
      assert(restricted.nextAvailableWindows?.length === 1, "restricted window missing");
    });

    await test(groups, "P2", "P2 scheduled start is durable and never early", async () => {
      const clock = new FakeClock(new Date("2031-01-01T00:00:00Z"));
      const timedEngine = new TaskEngine(
        manifest,
        snapshots,
        gateway,
        repository,
        new IdempotencyRepository(pool),
        clock,
      );
      const scheduler = new DurableScheduler(manifest, gateway, repository, clock, "conformance");
      const created = await timedEngine.callOperation(
        operation(engine, "durable_task"),
        { resourceId: `${options.language}-scheduled` },
        authorization,
        undefined,
        `scheduled-${options.language}`,
        {
          start: {
            mode: "scheduled",
            scheduledAt: "2031-01-01T00:00:01Z",
            startToleranceMs: 1_000,
          },
          maxElapsedMs: null,
        },
      );
      assert(created.kind === "task", "scheduled call did not publish a Task");
      assert((await scheduler.tick()).started === 0, "scheduled work started early");
      clock.advance(1_000);
      assert((await scheduler.tick()).started === 1, "scheduled work did not start once");
    });

    await test(
      groups,
      "P2",
      "P2 retryable start rejection has a bounded retry identity",
      async () => {
        const taskId = randomUUID();
        const argumentHash = "8".repeat(64);
        const argumentsValue = {
          resourceId: `${options.language}-retryable-start`,
          scenario: "scheduled_retry_once",
        };
        const first = await gateway.startOperation("durable_task", argumentsValue, {
          taskId,
          argumentHash,
          invocationAttempt: 1,
        });
        assert(first.rejected?.retryable === true, "first start was not retryably rejected");
        const second = await gateway.startOperation("durable_task", argumentsValue, {
          taskId,
          argumentHash,
          invocationAttempt: 2,
        });
        assert(second.accepted !== undefined, "bounded retry was not accepted");
      },
    );

    await test(
      groups,
      "P3",
      "P3 restricted arbitration accepts or rejects without ambiguity",
      async () => {
        const accepted = await engine.callOperation(
          operation(engine, "durable_task"),
          { resourceId: `${options.language}-restricted-accepted`, scenario: "restricted" },
          authorization,
        );
        assert(accepted.kind === "task", "accepted restricted call did not publish a Task");
        const before = await pool.query<{ count: string }>("SELECT count(*) FROM provider_task");
        const rejected = await engine.callOperation(
          operation(engine, "durable_task"),
          {
            resourceId: `${options.language}-restricted-rejected`,
            scenario: "scheduled_permanent_reject",
          },
          authorization,
        );
        assert(
          rejected.kind === "result" &&
            JSON.stringify(rejected.result).includes("START_NOT_PERMITTED"),
          "rejected arbitration result was not explicit",
        );
        const after = await pool.query<{ count: string }>("SELECT count(*) FROM provider_task");
        assert(before.rows[0]?.count === after.rows[0]?.count, "rejected call published a Task");
      },
    );

    await test(
      groups,
      "P3",
      "P3 pause/resume acknowledgements preserve a working execution",
      async () => {
        const taskId = randomUUID();
        const argumentHash = "9".repeat(64);
        const started = await gateway.startOperation(
          "durable_task",
          { resourceId: `${options.language}-pause-resume` },
          { taskId, argumentHash },
        );
        const externalExecutionId = started.accepted?.externalExecutionId;
        assert(externalExecutionId !== undefined, "pause/resume seed was not accepted");
        const identity = {
          taskId,
          operationName: "durable_task",
          argumentHash,
          commandSequence: 1,
        };
        const paused = await gateway.pauseExecution(identity, { externalExecutionId });
        assert(paused.accepted, "pause was rejected");
        assert(
          (await gateway.getExecution(taskId, externalExecutionId)).state === "PAUSED",
          "pause did not preserve a working paused state",
        );
        const resumed = await gateway.resumeExecution(
          { ...identity, commandSequence: 2 },
          { externalExecutionId },
        );
        assert(resumed.accepted, "resume was rejected");
      },
    );

    await test(groups, "P4", "P4 input_required and multi-round update", async () => {
      const created = await engine.callOperation(
        operation(engine, "durable_task"),
        { resourceId: `${options.language}-input`, scenario: "multi_round_input" },
        authorization,
      );
      assert(created.kind === "task", "input operation did not return Task");
      const taskId = String(created.task.taskId);
      const dispatcher = new DurableCommandDispatcher(gateway, repository);
      await engine.updateTask(taskId, { approval: true }, authorization);
      assert((await dispatcher.tick()).acknowledged === 1, "first input update was not dispatched");
      const second = await engine.getTask(taskId, authorization);
      assert(second.status === "input_required", "second input round missing");
      await engine.updateTask(taskId, { comment: "approved" }, authorization);
      assert(
        (await dispatcher.tick()).acknowledged === 1,
        "second input update was not dispatched",
      );
      assert(
        (await engine.getTask(taskId, authorization)).status === "completed",
        "input Task incomplete",
      );
    });

    await test(
      groups,
      "P4",
      "P4 cancel Ack, safe stop proof and duplicate idempotency",
      async () => {
        const created = await engine.callOperation(
          operation(engine, "durable_task"),
          { resourceId: `${options.language}-cancel` },
          authorization,
        );
        assert(created.kind === "task", "cancel operation did not return Task");
        const taskId = String(created.task.taskId);
        assert(
          (await engine.cancelTask(taskId, authorization)).status === "working",
          "cancel was terminal early",
        );
        await engine.cancelTask(taskId, authorization);
        await new DurableCommandDispatcher(gateway, repository).tick();
        assert(
          (await engine.getTask(taskId, authorization)).status === "cancelled",
          "cancel proof missing",
        );
      },
    );

    await test(groups, "P4", "P4 invocation idempotency duplicate and conflict", async () => {
      const key = `conformance-${options.language}`;
      const first = await engine.callOperation(
        operation(engine, "durable_task"),
        { resourceId: `${options.language}-idempotent` },
        authorization,
        undefined,
        key,
      );
      const second = await engine.callOperation(
        operation(engine, "durable_task"),
        { resourceId: `${options.language}-idempotent` },
        authorization,
        undefined,
        key,
      );
      assert(first.kind === "task" && second.kind === "task", "idempotent calls were not Tasks");
      assert(first.task.taskId === second.task.taskId, "duplicate taskId mismatch");
      await expectFailure(
        engine.callOperation(
          operation(engine, "durable_task"),
          { resourceId: "conflicting" },
          authorization,
          undefined,
          key,
        ),
        "IDEMPOTENCY_KEY_CONFLICT",
      );
    });

    await test(
      groups,
      "P4",
      "P4 frozen reservation reference is bound to Start identity",
      async () => {
        const taskId = randomUUID();
        const argumentHash = "7".repeat(64);
        const argumentsValue = { resourceId: `${options.language}-reservation` };
        const first = await gateway.startOperation("durable_task", argumentsValue, {
          taskId,
          argumentHash,
          reservationRef: "reservation-conformance",
        });
        assert(first.accepted !== undefined, "reserved start was not accepted");
        const duplicate = await gateway.startOperation("durable_task", argumentsValue, {
          taskId,
          argumentHash,
          reservationRef: "reservation-conformance",
        });
        assert(duplicate.accepted !== undefined, "reserved duplicate was not idempotent");
        await expectFailure(
          gateway.startOperation("durable_task", argumentsValue, {
            taskId,
            argumentHash,
            reservationRef: "reservation-conflict",
          }),
          "conflict",
        );
      },
    );

    await test(groups, "P4", "P4 frozen MRTR request and keyed response", async () => {
      const created = await engine.callFrozenOperation(
        operation(engine, "durable_task"),
        { resourceId: `${options.language}-frozen-input`, scenario: "input_required_frozen" },
        authorization,
      );
      const taskId = String(created.taskId);
      assert(taskId.length > 0, "frozen input Task was not published");
      assert(
        !("inputRequests" in created) && !("result" in created) && !("error" in created),
        "CreateTaskResult leaked DetailedTask payload",
      );
      const inputRequired = await engine.getFrozenTask(taskId, authorization);
      assert(
        JSON.stringify(inputRequired).includes("elicitation/create"),
        "frozen MRTR request missing from tasks/get",
      );
      await engine.updateTaskInputResponses(
        taskId,
        { approval: { action: "accept", content: true } },
        authorization,
      );
      assert(
        (await new DurableCommandDispatcher(gateway, repository).tick()).acknowledged === 1,
        "frozen MRTR response was not acknowledged",
      );
      await engine.getTask(taskId, authorization);
      assert(
        (await engine.getFrozenTask(taskId, authorization)).status === "completed",
        "frozen MRTR Task did not complete",
      );
    });

    await test(groups, "P4", "P4 frozen type-only Evidence projection", async () => {
      const created = await engine.callFrozenOperation(
        operation(engine, "durable_task"),
        { resourceId: `${options.language}-evidence`, scenario: "evidence_success" },
        authorization,
      );
      const taskId = String(created.taskId);
      await engine.getTask(taskId, authorization);
      const completed = await engine.getFrozenTask(taskId, authorization);
      const serialized = JSON.stringify(completed);
      assert(serialized.includes("io.sdar/evidence"), "frozen Evidence missing");
      assert(!serialized.includes("requirementId"), "Evidence leaked requirementId");
    });

    await test(groups, "P4", "P4 response-loss Reconcile without duplicate identity", async () => {
      const key = `response-loss-${options.language}`;
      await expectFailure(
        engine.callOperation(
          operation(engine, "durable_task"),
          { resourceId: `${options.language}-response-loss`, scenario: "response_loss" },
          authorization,
          undefined,
          key,
        ),
        "response loss",
      );
      const recovered = await engine.callOperation(
        operation(engine, "durable_task"),
        { resourceId: `${options.language}-response-loss`, scenario: "response_loss" },
        authorization,
        undefined,
        key,
      );
      assert(recovered.kind === "task", "response loss did not reconcile to Task");
    });

    await test(groups, "P4", "P4 Adapter task/argument identity conflict", async () => {
      const taskId = randomUUID();
      await gateway.startOperation(
        "durable_task",
        { resourceId: `${options.language}-binding` },
        { taskId, argumentHash: "1".repeat(64) },
      );
      await expectFailure(
        gateway.startOperation(
          "durable_task",
          { resourceId: `${options.language}-other-binding` },
          { taskId, argumentHash: "2".repeat(64) },
        ),
        "conflict",
      );
      const reconciled = await gateway.reconcileExecution(taskId, "durable_task", "2".repeat(64));
      assert(reconciled.status === "CONFLICT", "Reconcile did not report identity conflict");
    });

    await test(groups, "P4", "P4 Adapter output mismatch becomes a failed Task", async () => {
      const created = await engine.callOperation(
        operation(engine, "durable_task"),
        { resourceId: `${options.language}-invalid-output`, scenario: "output_invalid" },
        authorization,
      );
      assert(created.kind === "task", "output mismatch did not return its durable Task");
      const failed = await engine.getTask(String(created.task.taskId), authorization);
      assert(failed.status === "failed", "invalid Adapter output was published as success");
    });

    await test(groups, "P4", "P4 command sequence mismatch is observable", async () => {
      const taskId = randomUUID();
      const argumentHash = "6".repeat(64);
      const started = await gateway.startOperation(
        "durable_task",
        {
          resourceId: `${options.language}-command-sequence`,
          scenario: "command_sequence_mismatch",
        },
        { taskId, argumentHash },
      );
      const externalExecutionId = started.accepted?.externalExecutionId;
      assert(externalExecutionId !== undefined, "command sequence seed was not accepted");
      const ack = await gateway.requestCancel(
        taskId,
        "durable_task",
        argumentHash,
        "USER_REQUESTED",
        1,
        { externalExecutionId },
      );
      assert(Number(ack.commandSequence) === 2, "Adapter did not expose sequence mismatch");
    });

    await test(
      groups,
      "P4",
      "P4 safe-stop permanent, retryable and transport rejection",
      async () => {
        const retryId = randomUUID();
        const retryHash = "5".repeat(64);
        const retryStart = await gateway.startOperation(
          "durable_task",
          { resourceId: `${options.language}-cancel-retry`, scenario: "cancel_retryable_reject" },
          { taskId: retryId, argumentHash: retryHash },
        );
        const retryExternal = retryStart.accepted?.externalExecutionId;
        assert(retryExternal !== undefined, "retryable cancel seed missing");
        const rejected = await gateway.requestCancel(
          retryId,
          "durable_task",
          retryHash,
          "DEADLINE_REACHED",
          1,
          { externalExecutionId: retryExternal },
        );
        assert(
          !rejected.accepted && rejected.reasonCode === "TRANSIENT_UNAVAILABLE",
          "retryable cancel rejection missing",
        );
        const accepted = await gateway.requestCancel(
          retryId,
          "durable_task",
          retryHash,
          "DEADLINE_REACHED",
          1,
          { externalExecutionId: retryExternal },
        );
        assert(accepted.accepted, "retryable cancel did not converge to an Ack");
        assert(
          (await gateway.getExecution(retryId, retryExternal)).state === "CANCELLED",
          "safe stop Ack lacked cancelled resource proof",
        );

        const permanentId = randomUUID();
        const permanentHash = "4".repeat(64);
        const permanentStart = await gateway.startOperation(
          "durable_task",
          {
            resourceId: `${options.language}-cancel-permanent`,
            scenario: "cancel_permanent_reject",
          },
          { taskId: permanentId, argumentHash: permanentHash },
        );
        const permanentExternal = permanentStart.accepted?.externalExecutionId;
        assert(permanentExternal !== undefined, "permanent cancel seed missing");
        const permanentAck = await gateway.requestCancel(
          permanentId,
          "durable_task",
          permanentHash,
          "DEADLINE_REACHED",
          1,
          { externalExecutionId: permanentExternal },
        );
        assert(!permanentAck.accepted, "permanent safe-stop rejection was hidden");

        const transportId = randomUUID();
        const transportHash = "3".repeat(64);
        const transportStart = await gateway.startOperation(
          "durable_task",
          {
            resourceId: `${options.language}-cancel-transport`,
            scenario: "cancel_transport_failure",
          },
          { taskId: transportId, argumentHash: transportHash },
        );
        const transportExternal = transportStart.accepted?.externalExecutionId;
        assert(transportExternal !== undefined, "transport cancel seed missing");
        await expectFailure(
          gateway.requestCancel(transportId, "durable_task", transportHash, "DEADLINE_REACHED", 1, {
            externalExecutionId: transportExternal,
          }),
          "cancel transport failure",
        );
      },
    );

    await test(groups, "P4", "P4 Adapter process restart retains execution binding", async () => {
      const verified = await Promise.resolve(options.restartBindingVerified);
      assert(verified, "external restart binding proof was not supplied");
    });

    await test(
      groups,
      "P4",
      "P4 terminal irreversibility and observation/outbox idempotency",
      async () => {
        const created = await engine.callOperation(
          operation(engine, "durable_task"),
          { resourceId: `${options.language}-terminal` },
          authorization,
        );
        assert(created.kind === "task", "terminal test Task missing");
        const taskId = String(created.task.taskId);
        await engine.getTask(taskId, authorization);
        const unchanged = await repository.applySnapshot(taskId, 999, {
          internalState: "RUNNING",
          mcpStatus: "working",
          substate: "running",
          statusMessage: "illegal regression",
          result: null,
          error: null,
          terminal: false,
          observationType: "task.progress",
        });
        assert(unchanged.mcpStatus === "completed", "terminal state regressed");
        const outbox = new OutboxRepository(pool);
        const event = (await outbox.pending(1))[0];
        assert(event !== undefined, "outbox event missing");
        assert(
          (await outbox.markPublished([event.eventId])) === 1,
          "first delivery did not publish",
        );
        assert(
          (await outbox.markPublished([event.eventId])) === 0,
          "duplicate delivery was not idempotent",
        );
      },
    );
  } finally {
    gateway.close();
    await pool.end();
  }
  const groupReports = [...groups.values()];
  const passed = groupReports.every((group) => group.status === "passed");
  return {
    profileVersion: "1.0",
    adapterLanguage: options.language,
    providerId: options.providerId,
    generatedAt: new Date().toISOString(),
    status: passed ? "passed" : "failed",
    scopes: {
      runtimeProfile: {
        status: passed ? "partial" : "failed",
        basis:
          "P0-P4 clauses exercised here plus the repository T-001..T-047 matrix; resource-specific qualification remains external.",
      },
      adapterProtocol: {
        status: passed ? "passed" : "failed",
        basis:
          "Manifest, identity, command sequencing, response loss, retry/reject, output, input and restart scenarios.",
      },
      resourceSpecificSafety: {
        status: "not_claimed",
        basis: "Reference Mock Adapters have no real external resource safety qualification.",
      },
    },
    groups: groupReports,
  };
}

export async function seedAndVerifyAdapterBinding(
  endpoint: string,
  providerId: string,
  taskId: string = randomUUID(),
): Promise<{ taskId: string; argumentHash: string }> {
  const gateway = new GrpcAdapterGateway({ endpoint, providerId, timeoutMs: 3_000 });
  const argumentHash = "e".repeat(64);
  try {
    const response = await gateway.startOperation(
      "durable_task",
      { resourceId: "restart-binding" },
      { taskId, argumentHash },
    );
    assert(response.accepted !== undefined, "restart seed was not accepted");
    return { taskId, argumentHash };
  } finally {
    gateway.close();
  }
}

export async function verifyAdapterBinding(
  endpoint: string,
  providerId: string,
  binding: { taskId: string; argumentHash: string },
): Promise<void> {
  const gateway = new GrpcAdapterGateway({ endpoint, providerId, timeoutMs: 3_000 });
  try {
    const reconciled = await gateway.reconcileExecution(
      binding.taskId,
      "durable_task",
      binding.argumentHash,
    );
    assert(reconciled.status === "FOUND", "durable Adapter binding was lost across restart");
  } finally {
    gateway.close();
  }
}

async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS
    task_input_response_inbox, provider_ops_delivery, runtime_lease, outbox_event, idempotency_record,
    task_command, task_input_request,
    task_observation, provider_task, admission_intent, operation_snapshot,
    runtime_schema_migration CASCADE`);
}

function operation(engine: TaskEngine, name: string) {
  const value = engine.manifest.operations.find((candidate) => candidate.name === name);
  if (value === undefined) throw new Error(`missing operation ${name}`);
  return value;
}

async function test(
  groups: Map<GroupReport["id"], GroupReport>,
  id: GroupReport["id"],
  name: string,
  run: () => Promise<void>,
): Promise<void> {
  const started = performance.now();
  const group = groups.get(id);
  if (group === undefined) throw new Error(`missing group ${id}`);
  try {
    await run();
    group.tests.push({ name, status: "passed", durationMs: performance.now() - started });
  } catch (error) {
    group.status = "failed";
    group.tests.push({
      name,
      status: "failed",
      durationMs: performance.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectFailure(promise: Promise<unknown>, messageFragment: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes(messageFragment.toLowerCase())
    ) {
      return;
    }
    throw error;
  }
  throw new Error(`expected failure containing ${messageFragment}`);
}

class FakeClock implements Clock {
  constructor(private value: Date) {}
  now(): Date {
    return new Date(this.value);
  }
  advance(milliseconds: number): void {
    this.value = new Date(this.value.getTime() + milliseconds);
  }
}

async function mcpRoundTrip(engine: TaskEngine, gateway: GrpcAdapterGateway): Promise<void> {
  const app = Fastify();
  const handler = new McpProtocolHandler(engine.manifest, gateway, engine);
  app.post("/mcp", async (request, reply) => {
    reply.hijack();
    await handler.handle(request.raw, reply.raw, request.body);
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("MCP server did not bind");
  const client = new Client({ name: "conformance", version: "1.0.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${String(address.port)}/mcp`),
      ) as unknown as Transport,
    );
    const tools = await client.listTools();
    assert(tools.tools.length === 3, "MCP Tool catalog mismatch");
    const result = await client.callTool({ name: "echo_sync", arguments: { message: "mcp" } });
    assert(result.isError !== true, "MCP synchronous call failed");
  } finally {
    await client.close();
    await app.close();
  }
}
