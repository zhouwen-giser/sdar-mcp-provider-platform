import { describe, expect, it } from "vitest";
import type { OutboxRecord } from "../../packages/persistence-postgres/src/index.js";
import { commandEnvelope } from "../../packages/task-engine/src/index.js";

const context = {
  providerId: "provider-test",
  runtimeVersion: "1.1.0",
  instanceId: "runtime-a",
};

describe("command dispatch telemetry envelope", () => {
  it.each([
    ["task.command.claimed", "CLAIMED"],
    ["task.command.retry_scheduled", "RETRY_WAIT"],
    ["task.command.acknowledged", "ACKNOWLEDGED"],
    ["task.command.rejected", "REJECTED"],
    ["task.command.superseded", "EXHAUSTED"],
    ["task.command.duplicate", "PENDING"],
  ])("maps %s without command payload content", (eventType, commandState) => {
    const envelope = commandEnvelope(event(eventType, commandState), context);
    expect(envelope).toMatchObject({
      recordType: "provider.command.lifecycle",
      eventCategory: "command.dispatch",
      attributes: { commandEvent: eventType },
      taskId: "task-1",
      commandSequence: 3,
      payload: {
        commandType: "UPDATE",
        previousState: "CLAIMED",
        currentState: commandState,
        attempt: 2,
        adapterRpcStatus: "success",
      },
    });
    expect(JSON.stringify(envelope)).not.toContain("secret-answer");
  });
});

function event(eventType: string, commandState: string): OutboxRecord {
  return {
    eventId: "00000000-0000-4000-8000-000000000003",
    eventKey: `task-command:${eventType}:${commandState}`,
    aggregateId: "task-1",
    eventType,
    payload: {
      commandType: "UPDATE",
      previousState: "CLAIMED",
      currentState: commandState,
      commandSequence: 3,
      attempt: 2,
      adapterRpcStatus: "success",
      answers: { field: "secret-answer" },
    },
    createdAt: new Date("2026-07-18T00:00:00.000Z"),
  };
}
