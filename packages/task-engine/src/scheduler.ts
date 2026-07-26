import { randomUUID } from "node:crypto";
import {
  protoStructToJson,
  validateAdapterSnapshotIdentity,
} from "../../adapter-protocol/src/index.js";
import type { ExecutionSnapshot, GrpcAdapterGateway } from "../../adapter-protocol/src/index.js";
import type { Clock, TaskExecutionTiming, TaskRecord } from "../../domain/src/index.js";
import { systemClock } from "../../domain/src/index.js";
import type { ValidatedManifest, ValidatedOperation } from "../../operation-registry/src/index.js";
import { OperationSnapshotRepository } from "../../persistence-postgres/src/index.js";
import type { TaskRepository } from "../../persistence-postgres/src/index.js";
import { validatedSnapshotTransition } from "./result-contract.js";
import { withLeaseHeartbeat } from "./lease-heartbeat.js";
import { BoundExecutionWatchdog } from "./bound-execution-watchdog.js";

export interface SchedulerOptions {
  concurrency?: number;
  leaseMilliseconds?: number;
  onEvent?: (decision: SchedulerDecision, amount: number) => void;
}

export type SchedulerDecision =
  "scheduled" | "claimed" | "started" | "retry" | "deadline" | "start_window_missed";

export interface SchedulerTickResult {
  started: number;
  missed: number;
  deferred: number;
  deadlineStops: number;
  watchdogStops: number;
  reconciled: number;
}

export class DurableScheduler {
  readonly workerId: string;

  constructor(
    readonly manifest: ValidatedManifest,
    readonly gateway: GrpcAdapterGateway,
    readonly repository: TaskRepository,
    readonly clock: Clock = systemClock,
    workerId: string = randomUUID(),
    readonly claimLeaseMs = 30_000,
    readonly operationSnapshots: OperationSnapshotRepository = new OperationSnapshotRepository(
      repository.pool,
    ),
    readonly options: SchedulerOptions = {},
  ) {
    this.workerId = workerId;
  }

  async tick(): Promise<SchedulerTickResult> {
    const now = this.clock.now();
    // rc.3 replaces rc.2 claimOverdueImmediateStarts with reconciliation for every bound mode.
    const watchdog = await new BoundExecutionWatchdog(
      this.gateway,
      this.repository,
      this.clock,
      `${this.workerId}:start-watchdog`,
      this.operationSnapshots,
      this.options,
    ).tick();
    const missedBeforeClaim = await this.repository.completeDueStartWindowMisses(now);
    const result: SchedulerTickResult = {
      started: 0,
      missed: missedBeforeClaim,
      deferred: 0,
      deadlineStops: 0,
      watchdogStops: watchdog.stopRequested,
      reconciled: watchdog.started,
    };

    const concurrency = this.options.concurrency ?? 8;
    const leaseMilliseconds = this.options.leaseMilliseconds ?? this.claimLeaseMs;
    const uncertain = await this.repository.claimExpiredScheduledStarts(
      now,
      this.workerId,
      leaseMilliseconds,
      concurrency,
    );
    await Promise.all(uncertain.map((task) => this.reconcileUncertainStart(task, result)));

    const due = await this.repository.claimDueScheduled(
      now,
      this.workerId,
      leaseMilliseconds,
      concurrency,
    );
    await Promise.all(due.map((task) => this.startClaimedTask(task, result)));

    const expired = await this.repository.claimExpiredDeadlines(this.clock.now());
    result.deadlineStops += expired.length;
    const claimed = uncertain.length + due.length;
    this.#emit("scheduled", claimed);
    this.#emit("claimed", claimed);
    this.#emit("started", result.started);
    this.#emit("retry", result.deferred);
    this.#emit("deadline", result.deadlineStops);
    this.#emit("start_window_missed", result.missed);
    return result;
  }

  #emit(decision: SchedulerDecision, amount: number): void {
    if (amount < 1) return;
    try {
      this.options.onEvent?.(decision, amount);
    } catch {
      // Operational telemetry must never alter scheduler outcomes.
    }
  }

  private async reconcileUncertainStart(
    task: TaskRecord,
    result: SchedulerTickResult,
  ): Promise<void> {
    const owner = requiredClaimOwner(task);
    const now = this.clock.now();
    const leaseMilliseconds = this.options.leaseMilliseconds ?? 30_000;
    const renew = () => this.repository.renewScheduleClaim(task.taskId, owner, leaseMilliseconds);
    await renew();
    try {
      const operation = (
        await this.operationSnapshots.loadOperationSnapshot(task.operationSnapshotId)
      ).operation;
      const response = await withLeaseHeartbeat(renew, leaseMilliseconds, () =>
        this.gateway.reconcileExecution(task.taskId, operation.name, task.argumentHash, {
          ...executionOptions(task),
          externalExecutionId: task.externalExecutionId,
        }),
      );
      const completedAt = this.clock.now();
      if (response.status === "TRANSIENT_UNAVAILABLE") {
        await this.repository.deferScheduleReconcile(
          task.taskId,
          owner,
          retryAt(task, completedAt),
          response.message || "Scheduled start reconciliation is temporarily unavailable.",
        );
        result.deferred += 1;
        return;
      }
      if (response.status === "CONFLICT") {
        await this.repository.completeScheduledRejection(
          task.taskId,
          owner,
          completedAt,
          response.reasonCode || "ADAPTER_RECONCILE_CONFLICT",
          response.message || "Adapter reported a conflicting scheduled start identity.",
          false,
        );
        result.missed += 1;
        return;
      }
      if (response.status === "NOT_FOUND" || response.snapshot === undefined) {
        if (startWindowClosed(task, completedAt)) {
          await this.repository.completeStartWindowMissed(task.taskId, completedAt, owner);
          result.missed += 1;
        } else {
          await this.repository.releaseScheduleRetry(
            task.taskId,
            owner,
            retryAt(task, completedAt),
            "Prior start attempt was definitively absent; retry scheduled.",
          );
          result.deferred += 1;
        }
        return;
      }
      await this.acceptStart(
        task,
        owner,
        operation,
        response.externalExecutionId || response.snapshot.externalExecutionId,
        response.snapshot,
        response as unknown as Record<string, unknown>,
        completedAt,
      );
      result.reconciled += 1;
      if (startResponseLate(task, completedAt)) result.watchdogStops += 1;
      else result.started += 1;
    } catch (error) {
      if (isIdentityError(error)) {
        await this.repository.recordIdentityConflict(
          task.taskId,
          error instanceof Error ? error.message : "ADAPTER_IDENTITY_MISMATCH",
        );
      }
      await this.repository.deferScheduleReconcile(
        task.taskId,
        owner,
        retryAt(task, now),
        error instanceof Error ? error.message : "Scheduled start reconciliation deferred.",
      );
      result.deferred += 1;
    }
  }

  private async startClaimedTask(task: TaskRecord, result: SchedulerTickResult): Promise<void> {
    const owner = requiredClaimOwner(task);
    const now = this.clock.now();
    const leaseMilliseconds = this.options.leaseMilliseconds ?? 30_000;
    const renew = () => this.repository.renewScheduleClaim(task.taskId, owner, leaseMilliseconds);
    await renew();
    if (startWindowClosed(task, now)) {
      await this.repository.completeStartWindowMissed(task.taskId, now, owner);
      result.missed += 1;
      return;
    }
    let operation;
    try {
      operation = (await this.operationSnapshots.loadOperationSnapshot(task.operationSnapshotId))
        .operation;
    } catch {
      await this.repository.releaseScheduleRetry(
        task.taskId,
        owner,
        retryAt(task, now),
        "Operation snapshot resolution is temporarily unavailable.",
      );
      result.deferred += 1;
      return;
    }
    try {
      const response = await withLeaseHeartbeat(renew, leaseMilliseconds, () =>
        this.gateway.startOperation(task.operationName, task.arguments, {
          taskId: task.taskId,
          argumentHash: task.argumentHash,
          ...executionOptions(task),
          invocationAttempt: task.invocationAttempt,
          timing: adapterTiming(task.timing as unknown as TaskExecutionTiming),
          ...(task.reservationRef === null ? {} : { reservationRef: task.reservationRef }),
        }),
      );
      const completedAt = this.clock.now();
      if (response.rejected !== undefined || response.result === "rejected") {
        const rejected = response.rejected;
        if (rejected?.retryable === true && !startWindowClosed(task, completedAt)) {
          await this.repository.releaseScheduleRetry(
            task.taskId,
            owner,
            retryAt(task, completedAt),
            rejected.message || "Retryable scheduled start rejection.",
          );
          result.deferred += 1;
        } else if (rejected?.retryable === true) {
          await this.repository.completeStartWindowMissed(task.taskId, completedAt, owner);
          result.missed += 1;
        } else {
          await this.repository.completeScheduledRejection(
            task.taskId,
            owner,
            completedAt,
            rejected?.reasonCode ?? "ADMISSION_REJECTED",
            rejected?.message ?? "Scheduled execution was rejected.",
            false,
          );
          result.missed += 1;
        }
        return;
      }
      const accepted = response.accepted;
      if (accepted === undefined) throw new Error("ADAPTER_START_RESPONSE_MISSING_RESULT");
      await this.acceptStart(
        task,
        owner,
        operation,
        accepted.externalExecutionId,
        accepted.initialSnapshot,
        response as unknown as Record<string, unknown>,
        completedAt,
      );
      if (startResponseLate(task, completedAt)) {
        result.watchdogStops += 1;
      } else result.started += 1;
    } catch (error) {
      const failedAt = this.clock.now();
      if (isIdentityError(error)) {
        await this.repository.recordIdentityConflict(
          task.taskId,
          error instanceof Error ? error.message : "ADAPTER_IDENTITY_MISMATCH",
        );
      }
      await this.repository.markScheduleResponseUncertain(
        task.taskId,
        owner,
        retryAt(task, failedAt),
        error instanceof Error ? error.message : "Scheduled start response is uncertain.",
      );
      result.deferred += 1;
    }
  }

  private async acceptStart(
    task: TaskRecord,
    owner: string,
    operation: ValidatedOperation,
    externalExecutionId: string,
    snapshot: ExecutionSnapshot,
    adapterResponse: Record<string, unknown>,
    completedAt: Date,
  ): Promise<void> {
    if (snapshot.externalExecutionId !== externalExecutionId) {
      throw new Error("ADAPTER_START_IDENTITY_MISMATCH");
    }
    validateAdapterSnapshotIdentity(snapshot, {
      taskId: task.taskId,
      externalExecutionId,
      operationName: operation.name,
      argumentHash: task.argumentHash,
      authorizationContextHash: task.authorizationContextHash,
      executionMode: task.executionMode,
      simulationId: task.simulationId,
    });
    await this.repository.acceptScheduled(
      task.taskId,
      owner,
      externalExecutionId,
      Number(snapshot.revision),
      validatedSnapshotTransition(operation, snapshot),
      adapterResponse,
      (snapshot.inputRequests ?? []).map((input) => ({
        key: input.key,
        description: input.description,
        schema: protoStructToJson(input.inputSchema),
        required: input.required,
      })),
      startResponseLate(task, completedAt) ? completedAt : undefined,
      snapshotHasStarted(snapshot.state) ? completedAt : null,
    );
  }
}

function startWindowClosed(task: TaskRecord, now: Date): boolean {
  return task.latestStartAt !== null && now >= task.latestStartAt;
}

function startResponseLate(task: TaskRecord, responseAt: Date): boolean {
  return task.latestStartAt !== null && responseAt > task.latestStartAt;
}

function snapshotHasStarted(state: string): boolean {
  return [
    "RUNNING",
    "PAUSED",
    "RESUMING",
    "WAITING_INPUT",
    "SUCCEEDED",
    "BUSINESS_FAILED",
    "PARTIALLY_COMPLETED",
    "TECHNICAL_FAILED",
  ].includes(state);
}

function requiredClaimOwner(task: TaskRecord): string {
  if (task.scheduleClaimOwner === null) throw new Error("SCHEDULED_TASK_CLAIM_OWNER_MISSING");
  return task.scheduleClaimOwner;
}

function retryAt(task: TaskRecord, now: Date): Date {
  const exponential = Math.min(5_000, 250 * 2 ** Math.min(task.invocationAttempt - 1, 5));
  const jitter = Number.parseInt(task.taskId.slice(-2), 16) % 101;
  const candidate = new Date(now.getTime() + exponential + jitter);
  if (task.latestStartAt !== null && candidate > task.latestStartAt) return task.latestStartAt;
  return candidate;
}

function executionOptions(task: TaskRecord) {
  return {
    authorizationContextHash: task.authorizationContextHash,
    executionMode: task.executionMode,
    simulationId: task.simulationId,
    ...(task.rootTraceparent === undefined || task.rootTraceparent === null
      ? {}
      : { rootTraceparent: task.rootTraceparent }),
    ...(task.rootTracestate === undefined || task.rootTracestate === null
      ? {}
      : { rootTracestate: task.rootTracestate }),
  };
}

function adapterTiming(timing: TaskExecutionTiming): Record<string, unknown> {
  const start =
    timing.start.mode === "scheduled"
      ? {
          mode: "SCHEDULED",
          scheduledAt: timestamp(new Date(timing.start.scheduledAt)),
          startToleranceMs: String(timing.start.startToleranceMs),
        }
      : {
          mode: "IMMEDIATE",
          startToleranceMs: String(timing.start.startToleranceMs),
        };
  return {
    start,
    ...(timing.maxElapsedMs === null ? {} : { maxElapsedMs: String(timing.maxElapsedMs) }),
  };
}

function isIdentityError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("IDENTITY_MISMATCH");
}

function timestamp(value: Date): { seconds: string; nanos: number } {
  return { seconds: String(Math.floor(value.getTime() / 1000)), nanos: 0 };
}
