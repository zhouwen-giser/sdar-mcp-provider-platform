import { describe, expect, it } from "vitest";
import type { GrpcAdapterGateway } from "../../packages/adapter-protocol/src/index.js";
import type { TaskRecord } from "../../packages/domain/src/index.js";
import type {
  OperationSnapshotRepository,
  PendingCommandRecord,
  TaskRepository,
} from "../../packages/persistence-postgres/src/index.js";
import { DurableCommandDispatcher } from "../../packages/task-engine/src/index.js";

describe("H1 command lease expiry race", () => {
  it("executes 32 slow commands once across two Runtime replicas", async () => {
    const repository = new LeaseRaceRepository(32);
    const sideEffects = new Map<string, number>();
    const gateway = {
      requestCancel: async (
        taskId: string,
        operationName: string,
        argumentHash: string,
        _reason: string,
        commandSequence: number,
        options: {
          authorizationContextHash: string;
          executionMode: string;
          simulationId: string | null;
          externalExecutionId: string | null;
        },
      ) => {
        sideEffects.set(taskId, (sideEffects.get(taskId) ?? 0) + 1);
        await delay(100);
        return {
          accepted: true,
          reasonCode: "STOP_ACCEPTED",
          message: "accepted",
          commandSequence,
          identity: {
            taskId,
            externalExecutionId: options.externalExecutionId ?? `execution-${taskId}`,
            operationName,
            argumentHash,
            commandSequence,
            executionContext: {
              authorizationContextHash: options.authorizationContextHash,
              executionMode: options.executionMode,
              simulationId: options.simulationId,
            },
          },
        };
      },
    } as unknown as GrpcAdapterGateway;
    const snapshots = {
      loadOperationSnapshot: () =>
        Promise.resolve({ operation: { name: "durable_task", capabilities: { cancel: true } } }),
    } as unknown as OperationSnapshotRepository;
    const first = new DurableCommandDispatcher(
      gateway,
      repository as unknown as TaskRepository,
      undefined,
      "runtime-a",
      undefined,
      undefined,
      snapshots,
      { concurrency: 8, leaseMilliseconds: 60 },
    );
    const second = new DurableCommandDispatcher(
      gateway,
      repository as unknown as TaskRepository,
      undefined,
      "runtime-b",
      undefined,
      undefined,
      snapshots,
      { concurrency: 8, leaseMilliseconds: 60 },
    );

    await Promise.all([drain(first, repository), drain(second, repository)]);

    expect(repository.acknowledged).toBe(32);
    expect(repository.claimLosses).toBe(0);
    expect([...sideEffects.values()]).toHaveLength(32);
    expect([...sideEffects.values()].every((count) => count === 1)).toBe(true);
  });
});

class LeaseRaceRepository {
  readonly commands: LeaseCommand[];
  acknowledged = 0;
  claimLosses = 0;

  constructor(count: number) {
    this.commands = Array.from({ length: count }, (_, index) => ({
      taskId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      commandSequence: 1,
      commandType: "CANCEL" as const,
      payload: {},
      state: "PENDING",
      attemptCount: 0,
      claimOwner: null,
      claimUntil: 0,
      stopReason: "USER_REQUESTED",
    }));
  }

  claimDueCommands(
    _now: Date,
    owner: string,
    leaseMilliseconds: number,
    limit: number,
  ): Promise<PendingCommandRecord[]> {
    const now = Date.now();
    const due = this.commands
      .filter(
        (command) =>
          command.state === "PENDING" || (command.state === "CLAIMED" && command.claimUntil <= now),
      )
      .slice(0, limit);
    for (const command of due) {
      command.state = "CLAIMED";
      command.claimOwner = owner;
      command.claimUntil = now + leaseMilliseconds;
      command.attemptCount += 1;
    }
    return Promise.resolve(due.map(toPendingCommand));
  }

  renewCommandClaim(command: PendingCommandRecord, leaseMilliseconds: number): Promise<void> {
    const current = this.requiredOwned(command);
    current.claimUntil = Date.now() + leaseMilliseconds;
    return Promise.resolve();
  }

  supersedeExpiredClaimedNormalCommandsForSafeStop(): Promise<number> {
    return Promise.resolve(0);
  }

  recordCommandStarted(command: PendingCommandRecord): Promise<void> {
    this.requiredOwned(command);
    return Promise.resolve();
  }

  getById(taskId: string): Promise<TaskRecord> {
    return Promise.resolve({
      taskId,
      internalState: "RUNNING",
      operationSnapshotId: "snapshot",
      operationName: "durable_task",
      argumentHash: "a".repeat(64),
      authorizationContextHash: "b".repeat(64),
      executionMode: "LIVE",
      simulationId: null,
      externalExecutionId: `execution-${taskId}`,
    } as unknown as TaskRecord);
  }

  acknowledgeClaimedCommand(command: PendingCommandRecord): Promise<void> {
    const current = this.requiredOwned(command);
    current.state = "ACKNOWLEDGED";
    current.claimOwner = null;
    current.claimUntil = 0;
    this.acknowledged += 1;
    return Promise.resolve();
  }

  private requiredOwned(command: PendingCommandRecord): LeaseCommand {
    const current = this.commands.find((candidate) => candidate.taskId === command.taskId);
    if (current?.state !== "CLAIMED" || current.claimOwner !== command.claimOwner) {
      this.claimLosses += 1;
      throw new Error("COMMAND_CLAIM_LOST");
    }
    return current;
  }
}

interface LeaseCommand {
  taskId: string;
  commandSequence: number;
  commandType: "CANCEL" | "UPDATE" | "PAUSE" | "RESUME";
  payload: Record<string, unknown>;
  state: PendingCommandRecord["state"];
  attemptCount: number;
  claimOwner: string | null;
  claimUntil: number;
  stopReason: string | null;
}

function toPendingCommand(command: LeaseCommand): PendingCommandRecord {
  return {
    taskId: command.taskId,
    commandSequence: command.commandSequence,
    commandType: command.commandType,
    payload: command.payload,
    state: command.state,
    attemptCount: command.attemptCount,
    adapterAck: null,
    nextAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    claimOwner: command.claimOwner,
    claimUntil: command.claimUntil === 0 ? null : new Date(command.claimUntil),
    stopReason: command.stopReason,
  };
}

async function drain(
  dispatcher: DurableCommandDispatcher,
  repository: LeaseRaceRepository,
): Promise<void> {
  while (repository.acknowledged < repository.commands.length) {
    await dispatcher.tick();
    await delay(5);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
