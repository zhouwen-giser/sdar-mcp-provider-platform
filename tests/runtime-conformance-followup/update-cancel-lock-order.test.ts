import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TaskRepository } from "../../packages/persistence-postgres/src/index.js";
import type { PendingCommandRecord } from "../../packages/persistence-postgres/src/index.js";
import { authorization, PostgresHarness } from "./postgres-harness.js";

const harness = new PostgresHarness("followup-safe-stop-provider");

beforeAll(() => harness.start());
beforeEach(() => harness.reset());
afterAll(() => harness.stop());

describe("UPDATE acknowledgement and safe-stop lock order", () => {
  it.each(["acknowledge", "reject", "delivery"] as const)(
    "lets safe stop win against %s",
    async (operation) => {
      const { taskId, command, repository } = await claimedUpdate(operation);
      const blocker = await establishSafeStop(taskId);
      const racing =
        operation === "acknowledge"
          ? repository.acknowledgeUpdateAndCompleteInputAnswers(command, { accepted: true }, [
              {
                key: "approval",
                answerHash: "b".repeat(64),
                value: true,
                response: { action: "accept", content: true },
              },
            ])
          : operation === "reject"
            ? repository.rejectInputResponseAndFailTask(
                command,
                "ADAPTER_REJECTED",
                "Adapter rejected input.",
              )
            : repository.failInputResponseDelivery(command, "Adapter unavailable.");
      await waitForBlockedTaskQuery();
      await blocker.query("COMMIT");
      blocker.release();
      await racing;

      expect(await repository.getById(taskId)).toMatchObject({
        internalState: "STOPPING",
        cancelRequested: true,
      });
      expect(
        (
          await harness.pool.query(
            `SELECT command.state AS command_state, command.last_error_code,
                    inbox.state AS inbox_state, request.status AS request_status
             FROM task_command command
             JOIN task_input_response_inbox inbox USING (task_id, command_sequence)
             JOIN task_input_request request USING (task_id, request_key)
             WHERE command.task_id=$1`,
            [taskId],
          )
        ).rows[0],
      ).toMatchObject({
        command_state: "EXHAUSTED",
        last_error_code: "SUPERSEDED_BY_SAFE_STOP",
        inbox_state: "IGNORED",
        request_status: "SUPERSEDED",
      });
    },
  );
});

async function claimedUpdate(label: string): Promise<{
  taskId: string;
  command: PendingCommandRecord;
  repository: TaskRepository;
}> {
  const taskId = await harness.createInputTask(`safe-stop-${label}`);
  await harness.engine.updateTaskInputResponses(
    taskId,
    { approval: { action: "accept", content: true } },
    authorization,
  );
  const repository = new TaskRepository(harness.pool);
  await repository.promotePendingInputResponses();
  const command = (await repository.claimDueCommands(new Date(), `${label}-worker`, 30_000, 1))[0];
  if (command === undefined) throw new Error("Expected claimed UPDATE command");
  return { taskId, command, repository };
}

async function establishSafeStop(taskId: string): Promise<PoolClient> {
  const client = await harness.pool.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout='3s'");
  await client.query("SET LOCAL statement_timeout='10s'");
  await client.query(
    `UPDATE provider_task
     SET cancel_requested=true, stop_reason='USER_CANCELLED', internal_state='STOPPING',
         mcp_status='working', substate='stopping'
     WHERE task_id=$1`,
    [taskId],
  );
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
