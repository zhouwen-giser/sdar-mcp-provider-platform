import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { InvalidParamsError } from "../../packages/domain/src/index.js";
import { TaskRepository } from "../../packages/persistence-postgres/src/index.js";
import { DurableCommandDispatcher } from "../../packages/task-engine/src/index.js";
import { authorization, PostgresHarness } from "./postgres-harness.js";

const harness = new PostgresHarness("followup-lock-provider");

beforeAll(() => harness.start());
beforeEach(() => harness.reset());
afterAll(() => harness.stop());

describe("MRTR canonical lock order", () => {
  it("validates against a schema committed while acceptance waits on the Task lock", async () => {
    const taskId = await harness.createInputTask("schema-race");
    const blocker = await lockTask(taskId);
    await blocker.query(
      `UPDATE task_input_request SET schema='{"type":"number"}'::jsonb
       WHERE task_id=$1 AND request_key='approval'`,
      [taskId],
    );
    const accepting = new TaskRepository(harness.pool).acceptMcpInputResponses(
      taskId,
      authorization,
      { approval: { action: "accept", content: "invalid" } },
      (request, response) => {
        expect(request.schema).toEqual({ type: "number" });
        if (typeof response.content !== "number") {
          throw new InvalidParamsError("INVALID_INPUT_RESPONSE");
        }
      },
    );
    await waitForBlockedTaskQuery();
    await blocker.query("COMMIT");
    blocker.release();

    await expect(accepting).rejects.toMatchObject({ kind: "invalid_params" });
    expect(
      await harness.pool.query("SELECT 1 FROM task_input_response_inbox WHERE task_id=$1", [
        taskId,
      ]),
    ).toHaveProperty("rowCount", 0);
  });

  it("ignores a response when SUPERSEDED commits before its lock is acquired", async () => {
    const taskId = await harness.createInputTask("superseded-race");
    const blocker = await lockTask(taskId);
    await blocker.query("UPDATE task_input_request SET status='SUPERSEDED' WHERE task_id=$1", [
      taskId,
    ]);
    const accepting = new TaskRepository(harness.pool).acceptMcpInputResponses(
      taskId,
      authorization,
      { approval: { action: "accept", content: true } },
      () => {
        throw new Error("VALIDATOR_MUST_NOT_RUN");
      },
    );
    await waitForBlockedTaskQuery();
    await blocker.query("COMMIT");
    blocker.release();

    await expect(accepting).resolves.toMatchObject({
      acceptedKeys: [],
      ignoredSupersededKeys: ["approval"],
    });
  });

  it("allows only one UPDATE promotion and one Adapter side effect across replicas", async () => {
    const taskId = await harness.createInputTask("two-promoters");
    await harness.engine.updateTaskInputResponses(
      taskId,
      { approval: { action: "accept", content: true } },
      authorization,
    );
    const first = new TaskRepository(harness.pool);
    const second = new TaskRepository(harness.pool);
    const promoted = await Promise.all([
      first.promotePendingInputResponses(),
      second.promotePendingInputResponses(),
    ]);
    expect(promoted.reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(
      await harness.pool.query(
        "SELECT 1 FROM task_command WHERE task_id=$1 AND command_type='UPDATE'",
        [taskId],
      ),
    ).toHaveProperty("rowCount", 1);

    const results = await Promise.all([
      new DurableCommandDispatcher(harness.gateway, first, undefined, "dispatcher-a").tick(),
      new DurableCommandDispatcher(harness.gateway, second, undefined, "dispatcher-b").tick(),
    ]);
    expect(results.reduce((sum, result) => sum + result.acknowledged, 0)).toBe(1);
    expect(
      (
        await harness.pool.query("SELECT state FROM task_input_response_inbox WHERE task_id=$1", [
          taskId,
        ])
      ).rows[0],
    ).toEqual({ state: "ACKNOWLEDGED" });
  });
});

async function lockTask(taskId: string): Promise<PoolClient> {
  const client = await harness.pool.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout='3s'");
  await client.query("SET LOCAL statement_timeout='10s'");
  await client.query("SELECT 1 FROM provider_task WHERE task_id=$1 FOR UPDATE", [taskId]);
  return client;
}

async function waitForBlockedTaskQuery(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await harness.pool.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity
         WHERE datname=current_database() AND pid <> pg_backend_pid()
           AND wait_event_type='Lock' AND query LIKE '%provider_task%'
       ) AS blocked`,
    );
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("EXPECTED_BLOCKED_TASK_QUERY");
}
