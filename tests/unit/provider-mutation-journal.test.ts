import { describe, expect, it } from "vitest";
import {
  MemoryProviderStore,
  type MutationJournalEntry,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";

describe("Provider mutation journal", () => {
  it("claims one immutable intent and advances it with durable compare-and-set states", async () => {
    const store = new MemoryProviderStore();
    await store.putExecution(execution("journal-task"));
    const intent = journalIntent("journal-task", "primary:1");

    await expect(store.claimMutationJournal(intent)).resolves.toEqual({
      claimed: true,
      record: intent,
    });
    await expect(store.claimMutationJournal(structuredClone(intent))).resolves.toEqual({
      claimed: false,
      record: intent,
    });

    const dispatching: MutationJournalEntry = {
      ...intent,
      state: "DISPATCHING",
      dispatchedAt: "2026-08-20T01:00:01.000Z",
    };
    await expect(store.advanceMutationJournal(dispatching, "INTENT_PERSISTED")).resolves.toBe(true);
    await expect(store.advanceMutationJournal(dispatching, "INTENT_PERSISTED")).resolves.toBe(
      false,
    );

    const accepted: MutationJournalEntry = {
      ...dispatching,
      state: "ACCEPTED",
      externalMissionId: "mission-42",
      resultHash: "c".repeat(64),
      completedAt: "2026-08-20T01:00:02.000Z",
    };
    await expect(store.advanceMutationJournal(accepted, "DISPATCHING")).resolves.toBe(true);
    await expect(store.getMutationJournalEntry(intent.taskId, intent.stepId)).resolves.toEqual(
      accepted,
    );
    await expect(store.listMutationJournal(intent.taskId)).resolves.toEqual([accepted]);

    const returned = await store.getMutationJournalEntry(intent.taskId, intent.stepId);
    if (returned === undefined) throw new Error("MUTATION_JOURNAL_TEST_ENTRY_MISSING");
    returned.state = "REJECTED";
    await expect(store.getMutationJournalEntry(intent.taskId, intent.stepId)).resolves.toEqual(
      accepted,
    );
  });

  it("rejects invalid transitions, missing executions and immutable identity drift", async () => {
    const store = new MemoryProviderStore();
    const intent = journalIntent("missing-task", "primary:1");
    await expect(store.claimMutationJournal(intent)).rejects.toThrow(
      "MUTATION_JOURNAL_EXECUTION_REQUIRED",
    );

    await store.putExecution(execution(intent.taskId));
    await store.claimMutationJournal(intent);
    await expect(
      store.advanceMutationJournal(
        {
          ...intent,
          state: "ACCEPTED",
          dispatchedAt: "2026-08-20T01:00:01.000Z",
          completedAt: "2026-08-20T01:00:02.000Z",
        },
        "INTENT_PERSISTED",
      ),
    ).rejects.toThrow("MUTATION_JOURNAL_STATE_TRANSITION_INVALID");
    await expect(
      store.claimMutationJournal({ ...intent, toolName: "ugv_return_home" }),
    ).rejects.toThrow("MUTATION_JOURNAL_IDENTITY_CONFLICT");
  });
});

function journalIntent(taskId: string, stepId: string): MutationJournalEntry {
  return {
    taskId,
    stepId,
    phase: "PRIMARY",
    toolName: "ugv_path_follow_mission",
    argumentHash: "a".repeat(64),
    state: "INTENT_PERSISTED",
    intentPersistedAt: "2026-08-20T01:00:00.000Z",
  };
}

function execution(taskId: string): ProviderExecution {
  return {
    taskId,
    externalExecutionId: `vehicle:ugv1:chassis:${taskId}`,
    operationName: "vehicle_navigate",
    argumentHash: "b".repeat(64),
    resourceId: "vehicle:ugv1",
    tracks: ["chassis"],
    arguments: { resourceId: "vehicle:ugv1", mission: { type: "point" } },
    executionContext: {
      authorizationContextHash: "d".repeat(64),
      executionMode: "SIMULATION",
      simulationId: "sim-1",
      correlationId: `correlation-${taskId}`,
    },
    downstreamMissionIds: [],
    state: "ACCEPTED",
    revision: 1,
    reasonCode: "UGV_TASK_ACCEPTED",
    createdAt: "2026-08-20T01:00:00.000Z",
    updatedAt: "2026-08-20T01:00:00.000Z",
    evidence: [],
  };
}
