import { describe, expect, it } from "vitest";
import type { GrpcAdapterGateway } from "../../packages/adapter-protocol/src/index.js";
import type { SnapshotTransition, TaskRecord } from "../../packages/domain/src/index.js";
import type {
  OperationSnapshotRepository,
  TaskRepository,
} from "../../packages/persistence-postgres/src/index.js";
import { BoundExecutionWatchdog } from "../../packages/task-engine/src/index.js";

describe("H2 unified bound-execution start watchdog", () => {
  it("reconciles started, unstarted, scheduled-accepted, and duplicate watchdog races", async () => {
    const repository = new StartWindowRepository([
      task("started", "immediate"),
      task("unstarted", "immediate"),
      task("scheduled", "scheduled"),
      task("duplicate", "immediate"),
    ]);
    const gateway = {
      reconcileExecution: (taskId: string) => {
        const state = taskId === "started" ? "RUNNING" : "ACCEPTED";
        return Promise.resolve({
          status: "FOUND",
          externalExecutionId: `execution-${taskId}`,
          reasonCode: "EXECUTION_FOUND",
          message: "reconciled",
          retryable: false,
          snapshot: {
            taskId,
            externalExecutionId: `execution-${taskId}`,
            operationName: "durable_task",
            argumentHash: "a".repeat(64),
            state,
            revision: 2,
            reasonCode: state === "RUNNING" ? "RUNNING" : "ACCEPTED",
            message: state === "RUNNING" ? "started" : "not started",
            retryable: false,
            executionContext: {
              authorizationContextHash: "b".repeat(64),
              executionMode: "LIVE",
              simulationId: "",
              correlationId: "",
            },
          },
        });
      },
    } as unknown as GrpcAdapterGateway;
    const snapshots = {
      loadOperationSnapshot: () => Promise.resolve({ operation: { name: "durable_task" } }),
    } as unknown as OperationSnapshotRepository;
    const first = new BoundExecutionWatchdog(
      gateway,
      repository as unknown as TaskRepository,
      undefined,
      "runtime-a",
      snapshots,
      { concurrency: 4, leaseMilliseconds: 100 },
    );
    const second = new BoundExecutionWatchdog(
      gateway,
      repository as unknown as TaskRepository,
      undefined,
      "runtime-b",
      snapshots,
      { concurrency: 4, leaseMilliseconds: 100 },
    );

    const [firstResult, secondResult] = await Promise.all([first.tick(), second.tick()]);

    expect(firstResult.claimed + secondResult.claimed).toBe(4);
    expect(repository.required("started")).toMatchObject({
      internalState: "RUNNING",
      stopReason: null,
    });
    expect(repository.required("started").actualStartedAt).toBeInstanceOf(Date);
    expect(repository.required("unstarted")).toMatchObject({
      internalState: "STOPPING",
      stopReason: "START_WINDOW_MISSED",
    });
    expect(repository.required("scheduled")).toMatchObject({
      internalState: "STOPPING",
      stopReason: "START_WINDOW_MISSED",
    });
    expect(repository.stopCounts.get("duplicate")).toBe(1);
    expect((await first.tick()).claimed).toBe(0);
  });
});

class StartWindowRepository {
  readonly tasks = new Map<string, TaskRecord>();
  readonly stopCounts = new Map<string, number>();

  constructor(tasks: TaskRecord[]) {
    for (const value of tasks) this.tasks.set(value.taskId, value);
  }

  claimBoundStartConfirmations(_now: Date, owner: string, limit: number): Promise<TaskRecord[]> {
    const claimed = [...this.tasks.values()]
      .filter(
        (value) =>
          value.actualStartedAt === null &&
          value.stopReason === null &&
          value.scheduleClaimOwner === null,
      )
      .slice(0, limit);
    for (const value of claimed) {
      value.internalState = "WAITING_START_CONFIRMATION";
      value.scheduleClaimOwner = owner;
      value.startConfirmationAttempts += 1;
    }
    return Promise.resolve(claimed);
  }

  renewStartConfirmationClaim(taskId: string, owner: string): Promise<void> {
    this.requiredOwned(taskId, owner);
    return Promise.resolve();
  }

  confirmBoundExecutionStarted(
    taskId: string,
    owner: string,
    _revision: number,
    transition: SnapshotTransition,
    confirmedAt: Date,
  ): Promise<TaskRecord> {
    const value = this.requiredOwned(taskId, owner);
    value.internalState = transition.internalState;
    value.mcpStatus = transition.mcpStatus;
    value.actualStartedAt = confirmedAt;
    value.scheduleClaimOwner = null;
    return Promise.resolve(value);
  }

  stopUnconfirmedBoundExecution(taskId: string, owner: string): Promise<TaskRecord> {
    const value = this.requiredOwned(taskId, owner);
    value.internalState = "STOPPING";
    value.stopReason = "START_WINDOW_MISSED";
    value.scheduleClaimOwner = null;
    this.stopCounts.set(taskId, (this.stopCounts.get(taskId) ?? 0) + 1);
    return Promise.resolve(value);
  }

  deferStartConfirmation(taskId: string, owner: string): Promise<void> {
    const value = this.requiredOwned(taskId, owner);
    value.scheduleClaimOwner = null;
    return Promise.resolve();
  }

  required(taskId: string): TaskRecord {
    const value = this.tasks.get(taskId);
    if (value === undefined) throw new Error("TASK_NOT_FOUND");
    return value;
  }

  private requiredOwned(taskId: string, owner: string): TaskRecord {
    const value = this.required(taskId);
    if (value.scheduleClaimOwner !== owner) throw new Error("START_CONFIRMATION_CLAIM_LOST");
    return value;
  }
}

function task(taskId: string, mode: "immediate" | "scheduled"): TaskRecord {
  const now = new Date();
  return {
    taskId,
    operationSnapshotId: "snapshot",
    operationName: "durable_task",
    argumentHash: "a".repeat(64),
    authorizationContextHash: "b".repeat(64),
    executionMode: "live",
    simulationId: null,
    externalExecutionId: `execution-${taskId}`,
    internalState: mode === "scheduled" ? "SCHEDULED" : "QUEUED",
    mcpStatus: "working",
    actualStartedAt: null,
    stopReason: null,
    scheduleClaimOwner: null,
    startConfirmationAttempts: 0,
    timing: { start: { mode } },
    latestStartAt: new Date(now.getTime() - 1),
  } as unknown as TaskRecord;
}
