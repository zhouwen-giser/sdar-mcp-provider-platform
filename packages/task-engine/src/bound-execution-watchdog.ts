import { randomUUID } from "node:crypto";
import {
  validateAdapterSnapshotIdentity,
  type GrpcAdapterGateway,
} from "../../adapter-protocol/src/index.js";
import { systemClock, type Clock, type TaskRecord } from "../../domain/src/index.js";
import {
  OperationSnapshotRepository,
  type TaskRepository,
} from "../../persistence-postgres/src/index.js";
import { withLeaseHeartbeat } from "./lease-heartbeat.js";
import { validatedSnapshotTransition } from "./result-contract.js";

export interface BoundExecutionWatchdogResult {
  claimed: number;
  started: number;
  stopRequested: number;
  deferred: number;
}

export interface BoundExecutionWatchdogOptions {
  concurrency?: number;
  leaseMilliseconds?: number;
}

export class BoundExecutionWatchdog {
  readonly workerId: string;

  constructor(
    readonly gateway: GrpcAdapterGateway,
    readonly repository: TaskRepository,
    readonly clock: Clock = systemClock,
    workerId: string = randomUUID(),
    readonly operationSnapshots: OperationSnapshotRepository = new OperationSnapshotRepository(
      repository.pool,
    ),
    readonly options: BoundExecutionWatchdogOptions = {},
  ) {
    this.workerId = workerId;
  }

  async tick(): Promise<BoundExecutionWatchdogResult> {
    const now = this.clock.now();
    const concurrency = this.options.concurrency ?? 8;
    const leaseMilliseconds = this.options.leaseMilliseconds ?? 30_000;
    const tasks = await this.repository.claimBoundStartConfirmations(
      now,
      this.workerId,
      concurrency,
      leaseMilliseconds,
    );
    const result: BoundExecutionWatchdogResult = {
      claimed: tasks.length,
      started: 0,
      stopRequested: 0,
      deferred: 0,
    };
    await Promise.all(tasks.map((task) => this.confirm(task, result)));
    return result;
  }

  private async confirm(task: TaskRecord, result: BoundExecutionWatchdogResult): Promise<void> {
    const owner = requiredClaimOwner(task);
    const leaseMilliseconds = this.options.leaseMilliseconds ?? 30_000;
    const renew = () =>
      this.repository.renewStartConfirmationClaim(task.taskId, owner, leaseMilliseconds);
    try {
      const operation = (
        await this.operationSnapshots.loadOperationSnapshot(task.operationSnapshotId)
      ).operation;
      const response = await withLeaseHeartbeat(renew, leaseMilliseconds, () =>
        this.gateway.reconcileExecution(task.taskId, operation.name, task.argumentHash, {
          authorizationContextHash: task.authorizationContextHash,
          executionMode: task.executionMode,
          simulationId: task.simulationId,
          ...(task.rootTraceparent === undefined || task.rootTraceparent === null
            ? {}
            : { rootTraceparent: task.rootTraceparent }),
          ...(task.rootTracestate === undefined || task.rootTracestate === null
            ? {}
            : { rootTracestate: task.rootTracestate }),
          externalExecutionId: task.externalExecutionId,
        }),
      );
      const completedAt = this.clock.now();
      if (response.status === "TRANSIENT_UNAVAILABLE") {
        await this.repository.deferStartConfirmation(
          task.taskId,
          owner,
          new Date(completedAt.getTime() + retryDelay(task.startConfirmationAttempts)),
          response.message || "Start confirmation is temporarily unavailable.",
        );
        result.deferred += 1;
        return;
      }
      if (response.status === "FOUND" && response.snapshot !== undefined) {
        validateAdapterSnapshotIdentity(response.snapshot, {
          taskId: task.taskId,
          externalExecutionId: task.externalExecutionId,
          operationName: operation.name,
          argumentHash: task.argumentHash,
          authorizationContextHash: task.authorizationContextHash,
          executionMode: task.executionMode,
          simulationId: task.simulationId,
        });
        if (snapshotHasStarted(response.snapshot.state)) {
          await this.repository.confirmBoundExecutionStarted(
            task.taskId,
            owner,
            Number(response.snapshot.revision),
            validatedSnapshotTransition(operation, response.snapshot),
            completedAt,
          );
          result.started += 1;
          return;
        }
      }
      await this.repository.stopUnconfirmedBoundExecution(task.taskId, owner, completedAt);
      result.stopRequested += 1;
    } catch (error) {
      if (error instanceof Error && error.message === "START_CONFIRMATION_CLAIM_LOST") return;
      const deferredAt = this.clock.now();
      await this.repository.deferStartConfirmation(
        task.taskId,
        owner,
        new Date(deferredAt.getTime() + retryDelay(task.startConfirmationAttempts)),
        error instanceof Error ? error.message : "Start confirmation failed.",
      );
      result.deferred += 1;
    }
  }
}

function requiredClaimOwner(task: TaskRecord): string {
  if (task.scheduleClaimOwner === null) throw new Error("START_CONFIRMATION_CLAIM_OWNER_MISSING");
  return task.scheduleClaimOwner;
}

function snapshotHasStarted(state: string): boolean {
  return [
    "RUNNING",
    "PAUSED",
    "RESUMING",
    "SUCCEEDED",
    "BUSINESS_FAILED",
    "PARTIALLY_COMPLETED",
    "TECHNICAL_FAILED",
  ].includes(state);
}

function retryDelay(attempt: number): number {
  return Math.min(30_000, 250 * 2 ** Math.min(Math.max(0, attempt - 1), 7));
}
