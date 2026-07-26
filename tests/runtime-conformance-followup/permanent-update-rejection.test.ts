import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TaskRepository } from "../../packages/persistence-postgres/src/index.js";
import { authorization, PostgresHarness } from "./postgres-harness.js";

const harness = new PostgresHarness("followup-rejection-provider");

beforeAll(() => harness.start());
beforeEach(() => harness.reset());
afterAll(() => harness.stop());

describe("permanent UPDATE rejection contract", () => {
  it("atomically fails Task, Command and MRTR rows and prevents replay", async () => {
    const taskId = await harness.createInputTask("permanent-reject");
    await harness.engine.updateTaskInputResponses(
      taskId,
      { approval: { action: "accept", content: true } },
      authorization,
    );
    const repository = new TaskRepository(harness.pool);
    expect(await repository.promotePendingInputResponses()).toBe(1);
    const command = (await repository.claimDueCommands(new Date(), "reject-worker", 30_000, 1))[0];
    if (command === undefined) throw new Error("Expected claimed UPDATE command");

    expect(
      await repository.rejectInputResponseAndFailTask(
        command,
        "ADAPTER_PERMANENT_REJECTION",
        "unsafe adapter detail must not escape",
      ),
    ).toBe("failed");

    expect(await repository.getById(taskId)).toMatchObject({
      internalState: "TERMINAL_FAILED",
      mcpStatus: "failed",
      statusMessage: "Input response was rejected.",
      error: {
        code: -32603,
        message: "Input response was rejected.",
        data: { reasonCode: "INPUT_RESPONSE_REJECTED" },
      },
    });
    expect(await repository.listInputRequests(taskId)).toMatchObject([
      { key: "approval", status: "SUPERSEDED" },
    ]);
    expect(
      (
        await harness.pool.query(
          `SELECT command.state AS command_state, command.last_error_code,
                  inbox.state AS inbox_state, inbox.last_error_code AS inbox_error
           FROM task_command command
           JOIN task_input_response_inbox inbox USING (task_id, command_sequence)
           WHERE command.task_id=$1`,
          [taskId],
        )
      ).rows[0],
    ).toMatchObject({
      command_state: "REJECTED",
      last_error_code: "ADAPTER_PERMANENT_REJECTION",
      inbox_state: "FAILED",
      inbox_error: "INPUT_RESPONSE_REJECTED",
    });

    await harness.engine.updateTaskInputResponses(
      taskId,
      { approval: { action: "accept", content: true } },
      authorization,
    );
    expect(await repository.promotePendingInputResponses()).toBe(0);
    expect(
      await harness.pool.query("SELECT 1 FROM task_command WHERE task_id=$1", [taskId]),
    ).toHaveProperty("rowCount", 1);
  });
});
