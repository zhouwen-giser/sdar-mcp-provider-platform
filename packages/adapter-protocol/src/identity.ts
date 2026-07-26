import type { AdapterExecutionContext, CommandAck, ExecutionSnapshot } from "./types.js";

export interface ExpectedExecutionIdentity {
  taskId: string;
  externalExecutionId?: string | null;
  operationName: string;
  argumentHash: string;
  authorizationContextHash: string;
  executionMode: string;
  simulationId: string | null;
}

export function validateAdapterSnapshotIdentity(
  snapshot: ExecutionSnapshot,
  expected: ExpectedExecutionIdentity,
): void {
  if (
    snapshot.taskId !== expected.taskId ||
    snapshot.externalExecutionId.length === 0 ||
    (expected.externalExecutionId !== undefined &&
      expected.externalExecutionId !== null &&
      snapshot.externalExecutionId !== expected.externalExecutionId) ||
    snapshot.operationName !== expected.operationName ||
    snapshot.argumentHash !== expected.argumentHash ||
    !matchesContext(snapshot.executionContext, expected)
  ) {
    throw new Error("ADAPTER_SNAPSHOT_IDENTITY_MISMATCH");
  }
}

export function validateCommandAckIdentity(
  ack: CommandAck,
  expected: ExpectedExecutionIdentity & { commandSequence: number },
): void {
  const identity = ack.identity;
  if (
    Number(ack.commandSequence) !== expected.commandSequence ||
    identity?.taskId !== expected.taskId ||
    identity.externalExecutionId.length === 0 ||
    (expected.externalExecutionId !== undefined &&
      expected.externalExecutionId !== null &&
      identity.externalExecutionId !== expected.externalExecutionId) ||
    identity.operationName !== expected.operationName ||
    identity.argumentHash !== expected.argumentHash ||
    Number(identity.commandSequence) !== expected.commandSequence ||
    !matchesContext(identity.executionContext, expected)
  ) {
    throw new Error("ADAPTER_COMMAND_ACK_IDENTITY_MISMATCH");
  }
}

function matchesContext(
  actual: AdapterExecutionContext | undefined,
  expected: ExpectedExecutionIdentity,
): boolean {
  return (
    actual?.authorizationContextHash === expected.authorizationContextHash &&
    normalizeMode(actual.executionMode) === normalizeMode(expected.executionMode) &&
    (actual.simulationId || null) === expected.simulationId
  );
}

function normalizeMode(value: string): string {
  return value.replaceAll("-", "_").toUpperCase();
}
