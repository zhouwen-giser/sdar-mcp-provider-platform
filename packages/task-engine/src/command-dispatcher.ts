import { createHash, randomUUID } from "node:crypto";
import {
  validateAdapterSnapshotIdentity,
  validateCommandAckIdentity,
} from "../../adapter-protocol/src/index.js";
import type { GrpcAdapterGateway } from "../../adapter-protocol/src/index.js";
import type { Clock, ExecutionMode } from "../../domain/src/index.js";
import { isTerminalState, systemClock } from "../../domain/src/index.js";
import { OperationSnapshotRepository } from "../../persistence-postgres/src/index.js";
import type { PendingCommandRecord, TaskRepository } from "../../persistence-postgres/src/index.js";
import type { ValidatedOperation } from "../../operation-registry/src/index.js";
import { withLeaseHeartbeat } from "./lease-heartbeat.js";
import { validatedSnapshotTransition } from "./result-contract.js";

export interface CommandDispatcherOptions {
  concurrency?: number;
  leaseMilliseconds?: number;
  maxInputResponseAttempts?: number;
  onMetric?: (durationMs: number) => void;
}

export interface CommandDispatcherTickResult {
  claimed: number;
  acknowledged: number;
  retried: number;
  rejected: number;
  exhausted: number;
  terminal: number;
}

export class DurableCommandDispatcher {
  readonly workerId: string;

  constructor(
    readonly gateway: GrpcAdapterGateway,
    readonly repository: TaskRepository,
    readonly clock: Clock = systemClock,
    workerId: string = randomUUID(),
    readonly maxSafeStopAttempts = 5,
    readonly claimLeaseMs = 30_000,
    readonly operationSnapshots: OperationSnapshotRepository = new OperationSnapshotRepository(
      repository.pool,
    ),
    readonly options: CommandDispatcherOptions = {},
  ) {
    this.workerId = workerId;
  }

  async tick(): Promise<CommandDispatcherTickResult> {
    const startedAt = performance.now();
    const now = this.clock.now();
    const concurrency = this.options.concurrency ?? 8;
    const leaseMilliseconds = this.options.leaseMilliseconds ?? this.claimLeaseMs;
    const promoter = (this.repository as Partial<TaskRepository>).promotePendingInputResponses;
    if (typeof promoter === "function") {
      await promoter.call(this.repository, concurrency);
    }
    const commands = await this.repository.claimDueCommands(
      now,
      this.workerId,
      leaseMilliseconds,
      concurrency,
    );
    const result: CommandDispatcherTickResult = {
      claimed: commands.length,
      acknowledged: 0,
      retried: 0,
      rejected: 0,
      exhausted: 0,
      terminal: 0,
    };
    await Promise.all(commands.map((command) => this.executeClaimed(command, result)));
    try {
      this.options.onMetric?.(performance.now() - startedAt);
    } catch {
      // Operational telemetry must never alter command dispatch outcomes.
    }
    return result;
  }

  private async executeClaimed(
    command: PendingCommandRecord,
    result: CommandDispatcherTickResult,
  ): Promise<void> {
    const leaseMilliseconds = this.options.leaseMilliseconds ?? this.claimLeaseMs;
    const renew = () => this.repository.renewCommandClaim(command, leaseMilliseconds);
    await renew();
    const task = await this.repository.getById(command.taskId);
    if (task === null || isTerminalState(task.internalState)) {
      await this.repository.rejectClaimedCommand(
        command,
        "TASK_TERMINAL",
        "Task transitioned to terminal while command was in progress.",
      );
      result.terminal += 1;
      return;
    }
    try {
      const operation = (
        await this.operationSnapshots.loadOperationSnapshot(task.operationSnapshotId)
      ).operation;
      await this.repository.recordCommandStarted(command);
      let outcome: "acknowledged" | "retriable" | "rejected" | "exhausted";
      if (command.commandType === "CANCEL") {
        await this.repository.supersedeExpiredClaimedNormalCommandsForSafeStop(command.taskId);
        outcome = await this.dispatchCancel(command, task, operation);
      } else if (command.commandType === "UPDATE") {
        outcome = await this.dispatchUpdate(command, task, operation.name);
      } else {
        outcome = await this.dispatchPauseOrResume(
          command,
          task,
          operation.name,
          command.commandType,
        );
      }
      if (outcome === "acknowledged") result.acknowledged += 1;
      else if (outcome === "retriable") result.retried += 1;
      else if (outcome === "rejected") result.rejected += 1;
      else result.exhausted += 1;
    } catch (error) {
      if (isIdentityError(error)) {
        await this.repository.recordIdentityConflict(
          command.taskId,
          error instanceof Error ? error.message : "ADAPTER_IDENTITY_MISMATCH",
        );
        await this.repository.rejectClaimedCommand(
          command,
          "ADAPTER_IDENTITY_MISMATCH",
          error instanceof Error ? error.message : "Adapter identity mismatch.",
        );
        result.rejected += 1;
        return;
      }
      if (
        command.commandType === "CANCEL" &&
        command.stopReason !== "USER_REQUESTED" &&
        command.attemptCount >= this.maxSafeStopAttempts
      ) {
        await this.repository.failSafeStopUnconfirmed(
          command,
          error instanceof Error ? error.message : "Safe stop could not be confirmed.",
        );
        result.exhausted += 1;
        return;
      }
      if (
        command.commandType === "UPDATE" &&
        command.attemptCount >= (this.options.maxInputResponseAttempts ?? 8)
      ) {
        await this.repository.failInputResponseDelivery(
          command,
          error instanceof Error ? error.message : "Input response delivery failed.",
        );
        result.exhausted += 1;
        return;
      }
      if (command.commandType !== "CANCEL" && (task.cancelRequested || task.stopReason !== null)) {
        if (await this.trySupersedeClaimedCommandForSafeStop(command)) {
          result.exhausted += 1;
          return;
        }
      }
      await this.repository.retryClaimedCommand(
        command,
        new Date(this.clock.now().getTime() + retryDelayMs(command)),
        "ADAPTER_TRANSIENT_ERROR",
        error instanceof Error ? error.message : "Adapter command failed.",
      );
      result.retried += 1;
    }
  }

  private async dispatchCancel(
    command: PendingCommandRecord,
    task: {
      taskId: string;
      operationName: string;
      argumentHash: string;
      externalExecutionId: string | null;
      authorizationContextHash: string;
      executionMode: ExecutionMode;
      simulationId: string | null;
    },
    operation: ValidatedOperation,
  ): Promise<"acknowledged" | "retriable" | "rejected" | "exhausted"> {
    const operationName = operation.name;
    const stopReason =
      command.stopReason === "DEADLINE_REACHED"
        ? "DEADLINE_REACHED"
        : command.stopReason === "START_WINDOW_MISSED"
          ? "START_WINDOW_MISSED"
          : "USER_REQUESTED";
    const ack = await this.withClaimHeartbeat(command, () =>
      this.gateway.requestCancel(
        task.taskId,
        operationName,
        task.argumentHash,
        stopReason,
        command.commandSequence,
        {
          ...executionOptions(task),
          externalExecutionId: task.externalExecutionId,
        },
      ),
    );
    validateCommandAckIdentity(ack, {
      taskId: task.taskId,
      externalExecutionId: task.externalExecutionId,
      operationName,
      argumentHash: task.argumentHash,
      authorizationContextHash: task.authorizationContextHash,
      executionMode: task.executionMode,
      simulationId: task.simulationId,
      commandSequence: command.commandSequence,
    });
    if (ack.accepted) {
      await this.repository.acknowledgeClaimedCommand(
        command,
        ack as unknown as Record<string, unknown>,
      );
      return "acknowledged";
    }
    if (isRetryableAck(ack.reasonCode)) {
      await this.retry(
        command,
        ack.reasonCode || "ADAPTER_RETRYABLE_REJECTION",
        ack.message || "Adapter retryable safe-stop rejection.",
      );
      return "retriable";
    }
    if (command.stopReason !== "USER_REQUESTED") {
      await this.repository.failSafeStopUnconfirmed(
        command,
        ack.message || "Adapter permanently rejected the required safe stop.",
      );
      return "exhausted";
    }
    const reconciled = await this.withClaimHeartbeat(command, () =>
      this.gateway.reconcileExecution(task.taskId, operationName, task.argumentHash, {
        ...executionOptions(task),
        externalExecutionId: task.externalExecutionId,
      }),
    );
    if (reconciled.status !== "FOUND" || reconciled.snapshot === undefined) {
      await this.retry(
        command,
        reconciled.reasonCode || "RECONCILE_UNAVAILABLE",
        reconciled.message || "Unable to reconcile rejected cancellation.",
      );
      return "retriable";
    }
    const snapshot = reconciled.snapshot;
    if (reconciled.externalExecutionId !== snapshot.externalExecutionId) {
      throw new Error("ADAPTER_RECONCILE_IDENTITY_MISMATCH");
    }
    validateAdapterSnapshotIdentity(snapshot, {
      taskId: task.taskId,
      externalExecutionId: task.externalExecutionId,
      operationName,
      argumentHash: task.argumentHash,
      authorizationContextHash: task.authorizationContextHash,
      executionMode: task.executionMode,
      simulationId: task.simulationId,
    });
    await this.repository.rejectUserCancel(
      command,
      Number(snapshot.revision),
      validatedSnapshotTransition(operation, snapshot),
      ack as unknown as Record<string, unknown>,
    );
    return "rejected";
  }

  private async dispatchUpdate(
    command: PendingCommandRecord,
    task: {
      taskId: string;
      operationName: string;
      argumentHash: string;
      externalExecutionId: string | null;
      authorizationContextHash: string;
      executionMode: ExecutionMode;
      simulationId: string | null;
    },
    operationName: string,
  ): Promise<"acknowledged" | "retriable" | "rejected" | "exhausted"> {
    const update = parseUpdatePayload(command.payload);
    const answers = update.answers;
    const identity = {
      taskId: task.taskId,
      operationName,
      argumentHash: task.argumentHash,
      commandSequence: command.commandSequence,
    };
    try {
      const ack = await this.withClaimHeartbeat(command, () => {
        const options = {
          ...executionOptions(task),
          externalExecutionId: task.externalExecutionId,
        };
        return update.kind === "frozen"
          ? this.gateway.updateMcpTaskExecution(
              identity,
              answers.map((answer) => ({ key: answer.key, result: answer.response })),
              options,
            )
          : this.gateway.updateExecution(identity, answers, options);
      });
      validateCommandAckIdentity(ack, {
        taskId: task.taskId,
        externalExecutionId: task.externalExecutionId,
        operationName,
        argumentHash: task.argumentHash,
        authorizationContextHash: task.authorizationContextHash,
        executionMode: task.executionMode,
        simulationId: task.simulationId,
        commandSequence: command.commandSequence,
      });
      if (!ack.accepted) {
        if (isRetryableAck(ack.reasonCode)) {
          if (await this.trySupersedeClaimedCommandForSafeStop(command)) {
            return "exhausted";
          }
          await this.retry(
            command,
            ack.reasonCode || "ADAPTER_RETRYABLE_REJECTION",
            ack.message || "Adapter rejected update command.",
          );
          return "retriable";
        }
        await this.repository.rejectInputResponseAndFailTask(
          command,
          typeof ack.reasonCode === "string" ? ack.reasonCode : "ADAPTER_REJECTED",
          ack.message || "Adapter rejected update command.",
        );
        return "rejected";
      }
      const result = await this.repository.acknowledgeUpdateAndCompleteInputAnswers(
        command,
        ack as unknown as Record<string, unknown>,
        answers,
      );
      return result === "acknowledged" ? "acknowledged" : "exhausted";
    } catch (error) {
      if (await this.trySupersedeClaimedCommandForSafeStop(command)) {
        return "exhausted";
      }
      throw error;
    }
  }

  private async dispatchPauseOrResume(
    command: PendingCommandRecord,
    task: {
      taskId: string;
      operationName: string;
      argumentHash: string;
      externalExecutionId: string | null;
      authorizationContextHash: string;
      executionMode: ExecutionMode;
      simulationId: string | null;
    },
    operationName: string,
    commandType: "PAUSE" | "RESUME",
  ): Promise<"acknowledged" | "retriable" | "rejected" | "exhausted"> {
    const identity = {
      taskId: task.taskId,
      operationName,
      argumentHash: task.argumentHash,
      commandSequence: command.commandSequence,
    };
    try {
      const ack = await this.withClaimHeartbeat(command, () =>
        commandType === "PAUSE"
          ? this.gateway.pauseExecution(identity, {
              ...executionOptions(task),
              externalExecutionId: task.externalExecutionId,
            })
          : this.gateway.resumeExecution(identity, {
              ...executionOptions(task),
              externalExecutionId: task.externalExecutionId,
            }),
      );
      validateCommandAckIdentity(ack, {
        taskId: task.taskId,
        externalExecutionId: task.externalExecutionId,
        operationName,
        argumentHash: task.argumentHash,
        authorizationContextHash: task.authorizationContextHash,
        executionMode: task.executionMode,
        simulationId: task.simulationId,
        commandSequence: command.commandSequence,
      });
      if (!ack.accepted) {
        if (isRetryableAck(ack.reasonCode)) {
          if (await this.trySupersedeClaimedCommandForSafeStop(command)) {
            return "exhausted";
          }
          await this.retry(
            command,
            ack.reasonCode || "ADAPTER_RETRYABLE_REJECTION",
            ack.message || "Adapter rejected pause/resume command.",
          );
          return "retriable";
        }
        await this.repository.rejectClaimedCommand(
          command,
          typeof ack.reasonCode === "string" ? ack.reasonCode : "ADAPTER_REJECTED",
          ack.message || "Adapter rejected pause or resume command.",
        );
        return "rejected";
      }
      await this.repository.acknowledgeClaimedCommand(
        command,
        ack as unknown as Record<string, unknown>,
      );
      return "acknowledged";
    } catch (error) {
      if (await this.trySupersedeClaimedCommandForSafeStop(command)) {
        return "exhausted";
      }
      throw error;
    }
  }

  private async withClaimHeartbeat<T>(
    command: PendingCommandRecord,
    operation: () => Promise<T>,
  ): Promise<T> {
    const leaseMilliseconds = this.options.leaseMilliseconds ?? this.claimLeaseMs;
    const renew = () => this.repository.renewCommandClaim(command, leaseMilliseconds);
    return withLeaseHeartbeat(renew, leaseMilliseconds, operation);
  }

  private async retry(
    command: PendingCommandRecord,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    await this.repository.retryClaimedCommand(
      command,
      new Date(this.clock.now().getTime() + retryDelayMs(command)),
      errorCode,
      errorMessage,
    );
  }

  private async trySupersedeClaimedCommandForSafeStop(
    command: PendingCommandRecord,
  ): Promise<boolean> {
    const task = await this.repository.getById(command.taskId);
    if (
      task === null ||
      (!task.cancelRequested && task.stopReason === null && task.internalState !== "STOPPING")
    ) {
      return false;
    }
    try {
      await this.repository.supersedeClaimedCommandForSafeStop(command);
    } catch (error) {
      if (error instanceof Error && error.message === "COMMAND_CLAIM_LOST") {
        return true;
      }
      throw error;
    }
    return true;
  }
}

function retryDelayMs(command: PendingCommandRecord): number {
  const attempts = Math.max(command.attemptCount - 1, 0);
  return Math.min(30_000, 250 * 2 ** Math.min(attempts, 7));
}

function isRetryableAck(reasonCode: string): boolean {
  return /TRANSIENT|RETRY|UNAVAILABLE|TIMEOUT/.test(reasonCode.toUpperCase());
}

function isIdentityError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("IDENTITY_MISMATCH");
}

function parseUpdatePayload(payload: Record<string, unknown>): {
  kind: "legacy" | "frozen";
  answers: {
    key: string;
    value: unknown;
    answerHash: string;
    response: { action: "accept" | "decline" | "cancel"; content?: unknown };
  }[];
} {
  const inputResponses = payload.inputResponses;
  if (
    inputResponses !== undefined &&
    inputResponses !== null &&
    typeof inputResponses === "object" &&
    !Array.isArray(inputResponses)
  ) {
    const answers = Object.entries(inputResponses as Record<string, unknown>).map(
      ([key, value]) => {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("INVALID_UPDATE_COMMAND_PAYLOAD");
        }
        const response = value as {
          action?: unknown;
          content?: unknown;
        };
        if (!new Set(["accept", "decline", "cancel"]).has(String(response.action))) {
          throw new Error("INVALID_UPDATE_COMMAND_PAYLOAD");
        }
        const normalized = {
          action: response.action as "accept" | "decline" | "cancel",
          ...("content" in response ? { content: response.content } : {}),
        };
        return {
          key,
          value: response.content ?? null,
          answerHash: commandHash(normalized),
          response: normalized,
        };
      },
    );
    return { kind: "frozen", answers };
  }
  const answers = payload.answers;
  if (
    answers === undefined ||
    answers === null ||
    typeof answers !== "object" ||
    Array.isArray(answers)
  ) {
    throw new Error("INVALID_UPDATE_COMMAND_PAYLOAD");
  }
  const answerRecord = answers as Record<string, unknown>;
  return {
    kind: "legacy",
    answers: Object.entries(answerRecord).map(([key, value]) => ({
      key,
      value,
      answerHash: commandHash(value),
      response: { action: "accept", content: value },
    })),
  };
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
    .join(",")}}`;
}

function commandHash(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

function executionOptions(task: {
  authorizationContextHash: string;
  executionMode: ExecutionMode;
  simulationId: string | null;
  rootTraceparent?: string | null;
  rootTracestate?: string | null;
}): Record<string, unknown> {
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
