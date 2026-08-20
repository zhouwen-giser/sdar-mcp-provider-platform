import type { MutationJournalEntry, MutationJournalState } from "./types.js";

const IDENTIFIER = /^[A-Za-z0-9._:-]{1,256}$/;
const SHA256 = /^[a-f0-9]{64}$/;

const TRANSITIONS: Readonly<Record<MutationJournalState, readonly MutationJournalState[]>> = {
  INTENT_PERSISTED: ["DISPATCHING"],
  DISPATCHING: ["ACCEPTED", "REJECTED", "UNCERTAIN"],
  ACCEPTED: [],
  REJECTED: [],
  UNCERTAIN: [],
};

export function assertMutationJournalEntry(entry: MutationJournalEntry): void {
  if (!IDENTIFIER.test(entry.taskId)) throw new Error("MUTATION_JOURNAL_TASK_ID_INVALID");
  if (!IDENTIFIER.test(entry.stepId)) throw new Error("MUTATION_JOURNAL_STEP_ID_INVALID");
  if (!IDENTIFIER.test(entry.toolName)) throw new Error("MUTATION_JOURNAL_TOOL_NAME_INVALID");
  if (!SHA256.test(entry.argumentHash)) throw new Error("MUTATION_JOURNAL_ARGUMENT_HASH_INVALID");
  if (entry.resultHash !== undefined && !SHA256.test(entry.resultHash))
    throw new Error("MUTATION_JOURNAL_RESULT_HASH_INVALID");
  if (
    entry.externalMissionId !== undefined &&
    (entry.externalMissionId.length === 0 || entry.externalMissionId.length > 256)
  )
    throw new Error("MUTATION_JOURNAL_EXTERNAL_MISSION_ID_INVALID");

  const intentAt = timestamp(entry.intentPersistedAt, "INTENT_PERSISTED_AT");
  const dispatchedAt = optionalTimestamp(entry.dispatchedAt, "DISPATCHED_AT");
  const completedAt = optionalTimestamp(entry.completedAt, "COMPLETED_AT");
  if (dispatchedAt !== undefined && dispatchedAt < intentAt)
    throw new Error("MUTATION_JOURNAL_TIMESTAMP_ORDER_INVALID");
  if (completedAt !== undefined && (dispatchedAt === undefined || completedAt < dispatchedAt))
    throw new Error("MUTATION_JOURNAL_TIMESTAMP_ORDER_INVALID");

  if (
    entry.state === "INTENT_PERSISTED" &&
    (dispatchedAt !== undefined || completedAt !== undefined)
  )
    throw new Error("MUTATION_JOURNAL_INTENT_TIMESTAMPS_INVALID");
  if (entry.state === "DISPATCHING" && (dispatchedAt === undefined || completedAt !== undefined))
    throw new Error("MUTATION_JOURNAL_DISPATCH_TIMESTAMPS_INVALID");
  if (
    (entry.state === "ACCEPTED" || entry.state === "REJECTED" || entry.state === "UNCERTAIN") &&
    (dispatchedAt === undefined || completedAt === undefined)
  )
    throw new Error("MUTATION_JOURNAL_COMPLETION_TIMESTAMPS_INVALID");
}

export function assertMutationJournalTransition(
  current: MutationJournalEntry,
  next: MutationJournalEntry,
  expectedState: MutationJournalState,
): void {
  assertMutationJournalEntry(current);
  assertMutationJournalEntry(next);
  if (current.state !== expectedState) throw new Error("MUTATION_JOURNAL_EXPECTED_STATE_MISMATCH");
  if (
    current.taskId !== next.taskId ||
    current.stepId !== next.stepId ||
    current.phase !== next.phase ||
    current.toolName !== next.toolName ||
    current.argumentHash !== next.argumentHash ||
    current.intentPersistedAt !== next.intentPersistedAt
  )
    throw new Error("MUTATION_JOURNAL_IDENTITY_CONFLICT");
  if (!TRANSITIONS[current.state].includes(next.state))
    throw new Error("MUTATION_JOURNAL_STATE_TRANSITION_INVALID");
}

export function sameMutationJournalIdentity(
  left: MutationJournalEntry,
  right: MutationJournalEntry,
): boolean {
  return (
    left.taskId === right.taskId &&
    left.stepId === right.stepId &&
    left.phase === right.phase &&
    left.toolName === right.toolName &&
    left.argumentHash === right.argumentHash &&
    left.intentPersistedAt === right.intentPersistedAt
  );
}

function timestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
    throw new Error(`MUTATION_JOURNAL_${field}_INVALID`);
  return parsed;
}

function optionalTimestamp(value: string | undefined, field: string): number | undefined {
  return value === undefined ? undefined : timestamp(value, field);
}
