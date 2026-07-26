import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProviderOpsEnvelope } from "../../packages/observability/src/index.js";
import {
  captureProviderOpsDelivery,
  ProviderOpsDeliveryRepository,
  runMigrations,
} from "../../packages/persistence-postgres/src/index.js";
import {
  DurableProviderOpsPublisher,
  type ProviderOpsAuditExporter,
} from "../../packages/task-engine/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration");
}

const schema = `provider_ops_${randomUUID().replaceAll("-", "")}`;
const adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
const pool = new Pool({
  connectionString: databaseUrl,
  max: 6,
  options: `-c search_path=${schema}`,
});

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  await runMigrations(pool);
});

beforeEach(async () => {
  await pool.query("TRUNCATE provider_ops_delivery");
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await adminPool.end();
});

describe("durable Provider Ops audit delivery", () => {
  it("captures audit records on commit and removes them on rollback", async () => {
    const committed = envelope("commit");
    const committedClient = await pool.connect();
    try {
      await committedClient.query("BEGIN");
      await captureProviderOpsDelivery(committedClient, {
        envelope: committed,
        eventKey: "event:commit",
        aggregateType: "task",
        aggregateId: "task-1",
      });
      await committedClient.query("COMMIT");
    } finally {
      committedClient.release();
    }

    const rolledBack = envelope("rollback");
    const rolledBackClient = await pool.connect();
    try {
      await rolledBackClient.query("BEGIN");
      await captureProviderOpsDelivery(rolledBackClient, {
        envelope: rolledBack,
        eventKey: "event:rollback",
        aggregateType: "task",
        aggregateId: "task-1",
      });
      await rolledBackClient.query("ROLLBACK");
    } finally {
      rolledBackClient.release();
    }

    const rows = await pool.query<{ event_key: string }>(
      "SELECT event_key FROM provider_ops_delivery ORDER BY event_key",
    );
    expect(rows.rows).toEqual([{ event_key: "event:commit" }]);
  });

  it("allows two replicas to race without duplicate delivery", async () => {
    await capture("race");
    const exported: string[] = [];
    const exporter: ProviderOpsAuditExporter = {
      export: (records) => {
        exported.push(...records.map((record) => record.recordId));
        return Promise.resolve();
      },
    };
    const repository = new ProviderOpsDeliveryRepository(pool);
    const first = new DurableProviderOpsPublisher(repository, exporter, "replica-a");
    const second = new DurableProviderOpsPublisher(repository, exporter, "replica-b");

    const results = await Promise.all([first.tick(), second.tick()]);

    expect(results.reduce((sum, result) => sum + result.claimed, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.delivered, 0)).toBe(1);
    expect(exported).toHaveLength(1);
    expect(await stateOf("event:race")).toBe("DELIVERED");
  });

  it("audit_retry_increments_retry_counter", async () => {
    const original = await capture("retry");
    const repository = new ProviderOpsDeliveryRepository(pool);
    const events: [string, number][] = [];
    const failing = new DurableProviderOpsPublisher(
      repository,
      { export: async () => Promise.reject(new Error("collector unavailable")) },
      "replica-a",
      { onEvent: (event, amount) => events.push([event, amount]) },
    );

    expect(await failing.tick()).toMatchObject({ claimed: 1, retried: 1, delivered: 0 });
    expect(await stateOf("event:retry")).toBe("RETRY_WAIT");
    expect(events).toContainEqual(["retry", 1]);
    await pool.query(
      "UPDATE provider_ops_delivery SET next_attempt_at=clock_timestamp()-interval '1 second'",
    );

    const exported: string[] = [];
    const succeeding = new DurableProviderOpsPublisher(
      repository,
      {
        export: (records) => {
          exported.push(...records.map((record) => record.recordId));
          return Promise.resolve();
        },
      },
      "replica-b",
    );
    expect(await succeeding.tick()).toMatchObject({ claimed: 1, delivered: 1 });
    expect(exported).toEqual([original.recordId]);
  });

  it("reclaims an expired lease without letting the old owner acknowledge it", async () => {
    await capture("expired");
    const repository = new ProviderOpsDeliveryRepository(pool);
    const now = new Date(Date.now() + 1_000);
    const first = await repository.claimDue("replica-a", 100, 1, now);
    const second = await repository.claimDue("replica-b", 100, 1, new Date(now.getTime() + 101));

    expect(first).toHaveLength(1);
    expect(second.map((record) => record.recordId)).toEqual([first[0]?.recordId]);
    const recordId = first[0]?.recordId;
    if (recordId === undefined) throw new Error("CLAIMED_RECORD_MISSING");
    expect(await repository.markDelivered(recordId, "replica-a")).toBe(false);
    expect(await repository.markDelivered(recordId, "replica-b")).toBe(true);
  });
});

async function capture(identity: string) {
  const record = envelope(identity);
  const client = await pool.connect();
  try {
    await captureProviderOpsDelivery(client, {
      envelope: record,
      eventKey: `event:${identity}`,
      aggregateType: "task",
      aggregateId: "task-1",
    });
  } finally {
    client.release();
  }
  return record;
}

function envelope(identity: string) {
  return createProviderOpsEnvelope({
    recordType: "provider.task.lifecycle",
    eventCategory: "task.lifecycle",
    deliveryClass: "audit",
    providerId: "provider-1",
    runtimeVersion: "1.1.0",
    instanceId: "capture-instance",
    taskId: "task-1",
    stableAggregateIdentity: "task-1",
    eventIdentity: `event:${identity}`,
    revision: 1,
    occurredAt: "2026-01-01T00:00:00.000Z",
    attributes: { source: "test" },
    payload: { currentState: "RUNNING" },
  });
}

async function stateOf(eventKey: string): Promise<string | undefined> {
  const result = await pool.query<{ state: string }>(
    "SELECT state FROM provider_ops_delivery WHERE event_key=$1",
    [eventKey],
  );
  return result.rows[0]?.state;
}
