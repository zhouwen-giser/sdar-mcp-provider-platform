import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OutboxRepository, runMigrations } from "../../packages/persistence-postgres/src/index.js";
import type { ProviderOpsEnvelope } from "../../packages/observability/src/index.js";
import {
  InternalNoopOutboxSink,
  OutboxPublisher,
  ProviderOpsOutboxSink,
} from "../../packages/task-engine/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration");
}

const schema = `telemetry_commit_${process.pid.toString()}`;
const adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
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

describe("PostgreSQL telemetry commit boundary", () => {
  it("emits the committed lifecycle fact and never emits the rolled-back fact", async () => {
    const committedTaskId = randomUUID();
    const rolledBackTaskId = randomUUID();
    const committed = await pool.connect();
    try {
      await committed.query("BEGIN");
      await insertEvent(committed, committedTaskId);
      await committed.query("COMMIT");
    } finally {
      committed.release();
    }
    const rolledBack = await pool.connect();
    try {
      await rolledBack.query("BEGIN");
      await insertEvent(rolledBack, rolledBackTaskId);
      await rolledBack.query("ROLLBACK");
    } finally {
      rolledBack.release();
    }

    const emitter = new RecordingEmitter();
    const publisher = new OutboxPublisher(
      new OutboxRepository(pool),
      new ProviderOpsOutboxSink(new InternalNoopOutboxSink(), emitter, {
        providerId: "provider-test",
        runtimeVersion: "1.1.0",
        instanceId: "runtime-a",
      }),
    );

    await expect(publisher.tick()).resolves.toEqual({ selected: 1, published: 1 });
    expect(emitter.envelopes.map((event) => event.taskId)).toEqual([committedTaskId]);
    expect(emitter.envelopes.map((event) => event.taskId)).not.toContain(rolledBackTaskId);
  });
});

class RecordingEmitter {
  readonly envelopes: ProviderOpsEnvelope[] = [];
  emitEnvelope(envelope: ProviderOpsEnvelope): void {
    this.envelopes.push(envelope);
  }
}

async function insertEvent(client: PoolClient, taskId: string): Promise<void> {
  await client.query(
    `INSERT INTO outbox_event(event_id,event_key,aggregate_id,event_type,payload)
     VALUES ($1,$2,$3,'task.completed',$4::jsonb)`,
    [
      randomUUID(),
      `${taskId}:completed`,
      taskId,
      JSON.stringify({
        taskId,
        internalState: "TERMINAL_COMPLETED",
        status: "completed",
        observationRevision: 2,
      }),
    ],
  );
}
