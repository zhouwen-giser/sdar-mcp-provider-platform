import { randomUUID } from "node:crypto";
import type * as grpc from "@grpc/grpc-js";
import { Pool } from "pg";
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
import { TaskEngine } from "../../packages/task-engine/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) throw new Error("TEST_DATABASE_URL is required for follow-up tests");

export const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "live",
  simulationId: null,
};

export class PostgresHarness {
  readonly pool = new Pool({ connectionString: databaseUrl, max: 10 });
  adapter!: grpc.Server;
  gateway!: GrpcAdapterGateway;
  engine!: TaskEngine;

  constructor(readonly providerId: string) {}

  async start(): Promise<void> {
    await this.pool.query(`DROP TABLE IF EXISTS
      task_input_response_inbox, provider_ops_delivery, runtime_lease, outbox_event,
      idempotency_record, task_command, task_input_request, task_observation, provider_task,
      admission_intent, operation_snapshot, runtime_schema_migration CASCADE`);
    await runMigrations(this.pool);
    this.adapter = createMockAdapterServer({ providerId: this.providerId });
    const port = await bindMockAdapter(this.adapter, "127.0.0.1:0");
    this.gateway = new GrpcAdapterGateway({
      endpoint: `127.0.0.1:${String(port)}`,
      providerId: this.providerId,
    });
    const manifest = new OperationRegistry().validate(await this.gateway.describeProvider());
    const snapshots = await new OperationSnapshotRepository(this.pool).saveManifest(manifest);
    this.engine = new TaskEngine(manifest, snapshots, this.gateway, new TaskRepository(this.pool));
  }

  async reset(): Promise<void> {
    await this.pool.query(`TRUNCATE TABLE
      task_input_response_inbox, provider_ops_delivery, runtime_lease, outbox_event,
      idempotency_record, task_command, task_input_request, task_observation, provider_task,
      admission_intent RESTART IDENTITY CASCADE`);
  }

  async stop(): Promise<void> {
    this.gateway.close();
    await new Promise<void>((resolve) => this.adapter.tryShutdown(() => resolve()));
    await this.pool.end();
  }

  async createInputTask(label: string): Promise<string> {
    const operation = this.engine.manifest.operations.find(
      (candidate) => candidate.name === "durable_task",
    );
    if (operation === undefined) throw new Error("durable_task operation is missing");
    const created = await this.engine.callOperation(
      operation,
      { resourceId: `${label}-${randomUUID()}`, scenario: "input_required_frozen" },
      authorization,
    );
    if (created.kind !== "task") throw new Error("Expected input-required Task");
    return String(created.task.taskId);
  }
}
