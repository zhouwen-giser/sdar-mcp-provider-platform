import { createHash, randomUUID } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as grpc from "@grpc/grpc-js";
import type { GrpcAdapterGateway } from "../../adapter-protocol/src/index.js";
import {
  protoStructToJson,
  validateAdapterSnapshotIdentity,
} from "../../adapter-protocol/src/index.js";
import type {
  AvailabilityCheckInput,
  ExecutionSnapshot,
  StartOperationResponse,
} from "../../adapter-protocol/src/index.js";
import type { AuthorizationContext, TaskRecord } from "../../domain/src/index.js";
import type {
  AvailabilityCheck,
  AvailabilityResponseValue,
  Clock,
  SnapshotTransition,
  TaskExecutionTiming,
  TimingAnchors,
} from "../../domain/src/index.js";
import {
  CapabilityNotSupportedError,
  AdapterContractError,
  defaultTiming,
  InvalidParamsError,
  CommandInProgressError,
  isTerminalState,
  systemClock,
  TechnicalExecutionError,
  unknownAvailability,
  validateAvailabilityResponse,
  validateTiming,
} from "../../domain/src/index.js";
import type { ValidatedManifest, ValidatedOperation } from "../../operation-registry/src/index.js";
import type {
  AdmissionIntentRecord,
  IdempotencyRepository,
  ObservationPage,
  CommandResolution,
  PendingCommandRecord,
  ResolvedTaskOperation,
  StoredInvocation,
  TaskRepository,
} from "../../persistence-postgres/src/index.js";
import { OperationSnapshotRepository } from "../../persistence-postgres/src/index.js";
import {
  sanitizedAdapterResultPayload,
  synchronousResult,
  validatedSnapshotTransition,
} from "./result-contract.js";
import { mapTaskToDetailedTask, type DetailedTaskProjection } from "./detailed-task.js";

export type ToolInvocationResult =
  | { kind: "result"; result: Record<string, unknown> }
  | { kind: "task"; task: Record<string, unknown> };

export interface TaskEngineMetrics {
  increment(name: string, labels?: Record<string, string>, amount?: number): void;
}

export interface TaskTraceEvent {
  event: string;
  providerId: string;
  taskId: string;
  operationName: string;
  resourceRef: string | null;
  executionMode: string;
  correlationId: string | null;
  error?: string;
}

export class TaskEngine {
  readonly #repository: TaskRepository;
  readonly #operationSnapshots: OperationSnapshotRepository;

  constructor(
    readonly manifest: ValidatedManifest,
    readonly operationSnapshotIds: Map<string, string>,
    readonly gateway: GrpcAdapterGateway,
    repository: TaskRepository,
    readonly idempotency?: IdempotencyRepository,
    readonly clock: Clock = systemClock,
    readonly metrics?: TaskEngineMetrics,
    readonly onTrace?: (event: TaskTraceEvent) => void,
    operationSnapshots: OperationSnapshotRepository = new OperationSnapshotRepository(
      repository.pool,
    ),
  ) {
    this.#repository = repository;
    this.#operationSnapshots = operationSnapshots;
  }

  async loadOperationSnapshot(snapshotId: string): Promise<ValidatedOperation> {
    return (await this.resolveTaskOperation(snapshotId)).operation;
  }

  async resolveTaskOperation(snapshotId: string): Promise<ResolvedTaskOperation> {
    return this.#operationSnapshots.loadOperationSnapshot(snapshotId);
  }

  async #validateTaskSnapshot(
    task: TaskRecord,
    operationName: string,
    snapshot: ExecutionSnapshot,
  ): Promise<void> {
    try {
      validateAdapterSnapshotIdentity(snapshot, expectedTaskIdentity(task, operationName));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "ADAPTER_SNAPSHOT_IDENTITY_MISMATCH";
      await this.#repository.recordIdentityConflict(task.taskId, detail);
      this.metrics?.increment("sdar_adapter_identity_conflicts_total", { kind: "snapshot" });
      throw error;
    }
  }

  async callOperation(
    operation: ValidatedOperation,
    argumentsValue: Record<string, unknown>,
    authorization: AuthorizationContext,
    ttlMs?: number,
    idempotencyKey?: string,
    timing: TaskExecutionTiming = defaultTiming,
    reservationRef?: string,
  ): Promise<ToolInvocationResult> {
    const startedAt = performance.now();
    try {
      if (
        ttlMs !== undefined &&
        (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 31_536_000_000)
      ) {
        throw new InvalidParamsError("INVALID_TASK_TTL");
      }
      if (
        reservationRef !== undefined &&
        (reservationRef.length < 1 || reservationRef.length > 256)
      ) {
        throw new InvalidParamsError("INVALID_RESERVATION_REF");
      }
      operation.validateArguments(argumentsValue);
      let anchors: TimingAnchors;
      try {
        anchors = validateTiming(timing, operation.capabilities, this.clock.now());
      } catch (error) {
        throw new InvalidParamsError(
          error instanceof Error ? error.message : "INVALID_TASK_TIMING",
          "Invalid Task timing parameters.",
          { cause: error },
        );
      }
      const argumentHash = hashArguments(argumentsValue);
      if (idempotencyKey !== undefined) {
        if (!operation.capabilities.idempotency || this.idempotency === undefined) {
          throw new CapabilityNotSupportedError("IDEMPOTENCY_NOT_SUPPORTED");
        }
        if (idempotencyKey.length < 1 || idempotencyKey.length > 256) {
          throw new InvalidParamsError("INVALID_IDEMPOTENCY_KEY");
        }
        const outcome = await this.idempotency.execute(
          { authorization, operationName: operation.name, idempotencyKey, argumentHash },
          async (stableTaskId, recovering) =>
            storedInvocation(
              await this.#executeOperation(
                operation,
                argumentsValue,
                authorization,
                ttlMs,
                stableTaskId,
                recovering,
                argumentHash,
                timing,
                anchors,
                reservationRef,
              ),
            ),
        );
        return await this.#restoreStored(outcome, authorization);
      }
      return await this.#executeOperation(
        operation,
        argumentsValue,
        authorization,
        ttlMs,
        randomUUID(),
        false,
        argumentHash,
        timing,
        anchors,
        reservationRef,
      );
    } finally {
      const labels = { operation: operation.name, executionMode: authorization.executionMode };
      this.metrics?.increment("sdar_tool_calls_total", labels);
      this.metrics?.increment("sdar_tool_call_duration_seconds_count", labels);
      this.metrics?.increment(
        "sdar_tool_call_duration_seconds_sum",
        labels,
        (performance.now() - startedAt) / 1_000,
      );
    }
  }

  async callFrozenOperation(
    operation: ValidatedOperation,
    argumentsValue: Record<string, unknown>,
    authorization: AuthorizationContext,
    idempotencyKey?: string,
    timing?: TaskExecutionTiming,
    reservationRef?: string,
  ): Promise<Record<string, unknown>> {
    const invocation = await this.callOperation(
      operation,
      argumentsValue,
      authorization,
      undefined,
      idempotencyKey,
      timing,
      reservationRef,
    );
    if (invocation.kind === "result") {
      return { resultType: "complete", ...invocation.result };
    }
    const taskId = invocation.task.taskId;
    if (typeof taskId !== "string") throw new Error("CREATE_TASK_RESULT_TASK_ID_MISSING");
    return this.getFrozenTask(taskId, authorization, "create");
  }

  async checkAvailability(
    checks: AvailabilityCheck[],
    authorization: AuthorizationContext,
  ): Promise<AvailabilityResponseValue> {
    if (checks.length < 1 || checks.length > 64) throw new Error("INVALID_AVAILABILITY_BATCH");
    const requestIds = new Set<string>();
    for (const check of checks) {
      if (
        !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(check.requestId) ||
        requestIds.has(check.requestId)
      ) {
        throw new Error("INVALID_AVAILABILITY_REQUEST_ID");
      }
      requestIds.add(check.requestId);
      const operation = this.manifest.operations.find(
        (candidate) => candidate.name === check.operationName,
      );
      if (!operation?.capabilities.availability) {
        throw new CapabilityNotSupportedError("AVAILABILITY_NOT_SUPPORTED");
      }
      if (check.arguments.state === "complete") {
        operation.validateArguments(check.arguments.value);
      } else {
        assertUnresolvedPointers(check.arguments.unresolvedPaths);
      }
    }
    try {
      const response = await this.gateway.checkAvailability(
        checks.map(toAdapterAvailabilityCheck),
        executionOptions(authorization),
      );
      const checkedAt = protoTimestampToDate(response.checkedAt);
      const results = response.checks.map(fromAdapterAvailability);
      return validateAvailabilityResponse(checkedAt, checks, results);
    } catch (error) {
      if (isAvailabilityContractError(error)) throw error;
      return unknownAvailability(checks);
    }
  }

  async #executeOperation(
    operation: ValidatedOperation,
    argumentsValue: Record<string, unknown>,
    authorization: AuthorizationContext,
    ttlMs: number | undefined,
    taskId: string,
    recovering: boolean,
    argumentHash: string,
    timing: TaskExecutionTiming,
    anchors: TimingAnchors,
    reservationRef?: string,
    persistedOperationSnapshotId?: string,
  ): Promise<ToolInvocationResult> {
    this.onTrace?.({
      event: "operation.admission",
      providerId: this.manifest.providerId,
      taskId,
      operationName: operation.name,
      resourceRef: resourceReference(operation, argumentsValue),
      executionMode: authorization.executionMode,
      correlationId: authorization.correlationId ?? null,
    });
    if (operation.execution === "SYNCHRONOUS") {
      const response = await this.gateway.startOperation(operation.name, argumentsValue, {
        ...executionOptions(authorization),
        taskId,
        argumentHash,
        timing: toAdapterTiming(timing),
        ...(reservationRef === undefined ? {} : { reservationRef }),
      });
      validateStartResponseIdentity(response, {
        taskId,
        operationName: operation.name,
        argumentHash,
        authorizationContextHash: authorization.hash,
        executionMode: authorization.executionMode,
        simulationId: authorization.simulationId,
      });
      return { kind: "result", result: resultFromStart(operation, response) };
    }

    const operationSnapshotId =
      persistedOperationSnapshotId ?? this.operationSnapshotIds.get(operation.name);
    if (operationSnapshotId === undefined) throw new Error("OPERATION_SNAPSHOT_NOT_FOUND");
    const intent = {
      taskId,
      providerId: this.manifest.providerId,
      operationName: operation.name,
      operationSnapshotId,
      authorization,
      arguments: argumentsValue,
      argumentHash,
      acceptedAt: anchors.acceptedAt,
      notBefore: anchors.notBefore,
      latestStartAt: anchors.latestStartAt,
      deadlineAt: anchors.deadlineAt,
      ttlMs: ttlMs ?? 259_200_000,
      timing,
      reservationRef: reservationRef ?? null,
    };
    const inserted = await this.#repository.createAdmissionIntent(intent);
    if (!inserted || recovering) {
      const existing = await this.#repository.getById(taskId);
      if (existing !== null) return { kind: "task", task: detailedTask(existing) };
      const reconciliation = await this.gateway.reconcileExecution(
        taskId,
        operation.name,
        argumentHash,
        executionOptions(authorization),
      );
      if (reconciliation.status === "CONFLICT") throw new Error("ADAPTER_RECONCILE_CONFLICT");
      if (reconciliation.status === "FOUND" && reconciliation.snapshot !== undefined) {
        return this.#publishReconciled(
          operation,
          intent,
          reconciliation.externalExecutionId || reconciliation.snapshot.externalExecutionId,
          reconciliation.snapshot,
          ttlMs,
          reconciliation as unknown as Record<string, unknown>,
          timing,
          anchors,
        );
      }
      if (reconciliation.status !== "NOT_FOUND") {
        throw new Error("ADAPTER_RECONCILE_UNAVAILABLE");
      }
    }

    if (timing.start.mode === "scheduled") {
      const task = await this.#repository.publishScheduled({
        ...intent,
        acceptedAt: anchors.acceptedAt,
        notBefore: anchors.notBefore,
        latestStartAt: anchors.latestStartAt,
        deadlineAt: anchors.deadlineAt,
        ttlMs: ttlMs ?? 259_200_000,
        timing,
      });
      return { kind: "task", task: detailedTask(task) };
    }

    let response;
    try {
      response = await this.gateway.startOperation(operation.name, argumentsValue, {
        taskId,
        argumentHash,
        ...executionOptions(authorization),
        invocationAttempt: 1,
        timing: toAdapterTiming(timing),
        ...(reservationRef === undefined ? {} : { reservationRef }),
      });
    } catch (error) {
      await this.#repository.markAdmissionUncertain(taskId);
      throw error;
    }
    if (response.result === "rejected" || response.rejected !== undefined) {
      const rejected =
        this.clock.now() > anchors.latestStartAt
          ? startWindowMissed(this.clock.now(), "Start response arrived after the start window.")
          : rejectionResult(response.rejected);
      await this.#repository.recordRejection(taskId, rejected);
      return { kind: "result", result: rejected };
    }
    const accepted = response.accepted;
    if (accepted === undefined) {
      await this.#repository.markAdmissionUncertain(taskId);
      throw new Error("ADAPTER_START_RESPONSE_MISSING_RESULT");
    }
    try {
      validateStartResponseIdentity(response, {
        taskId,
        operationName: operation.name,
        argumentHash,
        authorizationContextHash: authorization.hash,
        executionMode: authorization.executionMode,
        simulationId: authorization.simulationId,
      });
    } catch (error) {
      await this.#repository.markAdmissionUncertain(taskId);
      throw error;
    }
    const transition = validatedSnapshotTransition(operation, accepted.initialSnapshot);
    const inputRequests = normalizeInputRequests(accepted.initialSnapshot);
    const respondedAt = this.clock.now();
    const actualStartedAt = snapshotHasStarted(accepted.initialSnapshot.state) ? respondedAt : null;
    const startWindowMissedAt =
      (actualStartedAt ?? respondedAt) > anchors.latestStartAt ? respondedAt : undefined;
    if (operation.execution === "TASK_CAPABLE" && transition.terminal) {
      if (transition.mcpStatus === "failed") {
        await this.#repository.markAdmissionUncertain(taskId);
        throw new TechnicalExecutionError(transitionReasonCode(transition));
      }
      const result = transition.result ?? transition.error ?? {};
      await this.#repository.completeAdmissionWithoutTask(
        taskId,
        response as unknown as Record<string, unknown>,
      );
      return { kind: "result", result };
    }
    let task;
    try {
      task = await this.#repository.publishAccepted({
        ...intent,
        externalExecutionId: accepted.externalExecutionId,
        transition,
        adapterRevision: Number(accepted.initialSnapshot.revision),
        ttlMs: ttlMs ?? 259_200_000,
        adapterResponse: response as unknown as Record<string, unknown>,
        acceptedAt: anchors.acceptedAt,
        notBefore: anchors.notBefore,
        latestStartAt: anchors.latestStartAt,
        deadlineAt: anchors.deadlineAt,
        timing,
        inputRequests,
        actualStartedAt,
        ...(startWindowMissedAt === undefined ? {} : { startWindowMissedAt }),
      });
    } catch (error) {
      await this.#repository.markAdmissionUncertain(taskId);
      throw error;
    }
    return { kind: "task", task: detailedTask(task, inputRequests) };
  }

  async #publishReconciled(
    operation: ValidatedOperation,
    intent: {
      taskId: string;
      providerId: string;
      operationName: string;
      operationSnapshotId: string;
      authorization: AuthorizationContext;
      arguments: Record<string, unknown>;
      argumentHash: string;
      acceptedAt: Date;
      notBefore: Date;
      latestStartAt: Date;
      deadlineAt: Date | null;
      ttlMs: number | null;
      timing: TaskExecutionTiming;
      reservationRef: string | null;
    },
    externalExecutionId: string,
    snapshotValue: ExecutionSnapshot,
    ttlMs: number | undefined,
    adapterResponse: Record<string, unknown>,
    timing: TaskExecutionTiming,
    anchors: TimingAnchors,
  ): Promise<ToolInvocationResult> {
    validateAdapterSnapshotIdentity(snapshotValue, {
      taskId: intent.taskId,
      externalExecutionId,
      operationName: operation.name,
      argumentHash: intent.argumentHash,
      authorizationContextHash: intent.authorization.hash,
      executionMode: intent.authorization.executionMode,
      simulationId: intent.authorization.simulationId,
    });
    const transition = validatedSnapshotTransition(operation, snapshotValue);
    const inputRequests = normalizeInputRequests(snapshotValue);
    const respondedAt = this.clock.now();
    const actualStartedAt = snapshotHasStarted(snapshotValue.state) ? respondedAt : null;
    if (operation.execution === "TASK_CAPABLE" && transition.terminal) {
      if (transition.mcpStatus === "failed") {
        await this.#repository.markAdmissionUncertain(intent.taskId);
        throw new TechnicalExecutionError(transitionReasonCode(transition));
      }
      await this.#repository.completeAdmissionWithoutTask(intent.taskId, adapterResponse);
      return { kind: "result", result: transition.result ?? transition.error ?? {} };
    }
    const task = await this.#repository.publishAccepted({
      ...intent,
      externalExecutionId,
      transition,
      adapterRevision: Number(snapshotValue.revision),
      ttlMs: ttlMs ?? 259_200_000,
      adapterResponse,
      acceptedAt: anchors.acceptedAt,
      notBefore: anchors.notBefore,
      latestStartAt: anchors.latestStartAt,
      deadlineAt: anchors.deadlineAt,
      timing,
      inputRequests,
      actualStartedAt,
      ...((actualStartedAt ?? respondedAt) > anchors.latestStartAt
        ? { startWindowMissedAt: respondedAt }
        : {}),
    });
    return { kind: "task", task: detailedTask(task, inputRequests) };
  }

  async #restoreStored(
    outcome: StoredInvocation,
    authorization: AuthorizationContext,
  ): Promise<ToolInvocationResult> {
    if (outcome.kind === "result") return outcome;
    const task = await this.#repository.getAuthorized(outcome.taskId, authorization);
    return {
      kind: "task",
      task: detailedTask(
        task,
        await this.#repository.listInputRequests(task.taskId),
        await this.#repository.listObservationPage(task.taskId),
      ),
    };
  }

  async getTask(
    taskId: string,
    authorization: AuthorizationContext,
  ): Promise<Record<string, unknown>> {
    let task = await this.#repository.getAuthorized(taskId, authorization);
    const operation = await this.loadOperationSnapshot(task.operationSnapshotId);
    if (
      !isTerminalState(task.internalState) &&
      task.internalState !== "SCHEDULED" &&
      task.internalState !== "STARTING"
    ) {
      if (task.externalExecutionId === null) return detailedTask(task);
      try {
        const snapshot = await this.gateway.getExecution(
          task.taskId,
          task.externalExecutionId,
          executionOptions(authorization),
        );
        await this.#validateTaskSnapshot(task, operation.name, snapshot);
        task = await this.#repository.applySnapshot(
          task.taskId,
          Number(snapshot.revision),
          stopTransition(task, operation, snapshot, this.clock.now()),
          normalizeInputRequests(snapshot),
        );
      } catch (error) {
        if (!isTransientAdapterReadError(error)) throw error;
        setImmediate(() => {
          void this.reconcileTask(task, operation)
            .then((outcome) => {
              this.metrics?.increment("sdar_recovery_total", {
                outcome: `degraded_read_${outcome}`,
              });
            })
            .catch((reconcileError: unknown) => {
              this.metrics?.increment("sdar_recovery_total", {
                outcome: "degraded_read_error",
              });
              this.onTrace?.({
                event: "task.degraded_reconcile_failed",
                providerId: task.providerId,
                taskId: task.taskId,
                operationName: operation.name,
                resourceRef: resourceReference(operation, task.arguments),
                executionMode: task.executionMode,
                correlationId: authorization.correlationId ?? null,
                error: reconcileError instanceof Error ? reconcileError.message : "unknown",
              });
            });
        });
        return detailedTask(
          task,
          await this.#repository.listInputRequests(task.taskId),
          await this.#repository.listObservationPage(task.taskId),
          {
            snapshotFreshness: "stale",
            degradedReasonCode: "ADAPTER_TRANSIENT_UNAVAILABLE",
          },
        );
      }
    }
    return detailedTask(
      task,
      await this.#repository.listInputRequests(task.taskId),
      await this.#repository.listObservationPage(task.taskId),
    );
  }

  async getFrozenTask(
    taskId: string,
    authorization: AuthorizationContext,
    projection: DetailedTaskProjection = "get",
  ): Promise<Record<string, unknown>> {
    const [task, inputRequests] = await Promise.all([
      this.#repository.getAuthorized(taskId, authorization),
      this.#repository.listInputRequests(taskId),
    ]);
    return mapTaskToDetailedTask(task, inputRequests, projection);
  }

  async getFrozenTasks(
    taskIds: readonly string[],
    authorization: AuthorizationContext,
  ): Promise<Map<string, Record<string, unknown>>> {
    const tasks = await this.#repository.getAuthorizedTasksByIds(taskIds, authorization);
    const inputRequests = await this.#repository.listInputRequestsByTaskIds(
      tasks.map((task) => task.taskId),
    );
    return new Map(
      tasks.map((task) => [
        task.taskId,
        mapTaskToDetailedTask(task, inputRequests.get(task.taskId) ?? [], "notification"),
      ]),
    );
  }

  async cancelTaskCooperatively(
    taskId: string,
    authorization: AuthorizationContext,
  ): Promise<void> {
    const task = await this.#repository.getAuthorized(taskId, authorization);
    if (isTerminalState(task.internalState)) return;
    const operation = await this.loadOperationSnapshot(task.operationSnapshotId);
    if (operation.capabilities.cancel) {
      const requestHash = createHash("sha256").update("cancel:user_requested").digest("hex");
      await this.#repository.beginCancel(taskId, requestHash);
      return;
    }
    await this.#repository.recordCooperativeCancellationIntent(taskId);
  }

  async getTaskObservations(
    taskId: string,
    authorization: AuthorizationContext,
    cursor?: number,
    limit = 100,
  ): Promise<Record<string, unknown>> {
    await this.#repository.getAuthorized(taskId, authorization);
    const page = await this.#repository.listObservationPage(taskId, cursor, limit);
    return {
      taskId,
      observations: wireObservations(page.observations),
      _meta: {
        observationCursor: page.nextCursor === null ? null : String(page.nextCursor),
        hasMore: page.hasMore,
      },
    };
  }

  async recoverAdmission(
    admission: AdmissionIntentRecord,
    resolvedOperation?: ValidatedOperation,
  ): Promise<ToolInvocationResult> {
    const operation =
      resolvedOperation ?? (await this.loadOperationSnapshot(admission.operationSnapshotId));
    return this.#executeOperation(
      operation,
      admission.arguments,
      admission.authorization,
      admission.ttlMs ?? undefined,
      admission.taskId,
      true,
      admission.argumentHash,
      admission.timing,
      {
        acceptedAt: admission.acceptedAt,
        notBefore: admission.notBefore,
        latestStartAt: admission.latestStartAt,
        deadlineAt: admission.deadlineAt,
      },
      admission.reservationRef ?? undefined,
      admission.operationSnapshotId,
    );
  }

  async reconcileTask(
    task: TaskRecord,
    resolvedOperation?: ValidatedOperation,
  ): Promise<"found" | "not_found" | "deferred"> {
    if (task.internalState === "STARTING" && task.externalExecutionId === null) return "deferred";
    const operation =
      resolvedOperation ?? (await this.loadOperationSnapshot(task.operationSnapshotId));
    const response = await this.gateway.reconcileExecution(
      task.taskId,
      operation.name,
      task.argumentHash,
      {
        ...executionOptions({
          hash: task.authorizationContextHash,
          executionMode: task.executionMode,
          simulationId: task.simulationId,
          ...(task.rootTraceparent === undefined || task.rootTraceparent === null
            ? {}
            : { rootTraceparent: task.rootTraceparent }),
          ...(task.rootTracestate === undefined || task.rootTracestate === null
            ? {}
            : { rootTracestate: task.rootTracestate }),
        }),
        externalExecutionId: task.externalExecutionId,
      },
    );
    if (response.status === "TRANSIENT_UNAVAILABLE") return "deferred";
    if (response.status === "CONFLICT") {
      await this.#repository.failRecoveryNotFound(
        task.taskId,
        "Adapter reported a conflicting execution identity during recovery.",
      );
      return "not_found";
    }
    if (response.status === "NOT_FOUND" || response.snapshot === undefined) {
      await this.#repository.failRecoveryNotFound(
        task.taskId,
        "Adapter execution was not found during recovery.",
      );
      return "not_found";
    }
    const snapshot = response.snapshot;
    if (response.externalExecutionId !== snapshot.externalExecutionId) {
      await this.#repository.recordIdentityConflict(
        task.taskId,
        "ADAPTER_RECONCILE_IDENTITY_MISMATCH",
      );
      throw new Error("ADAPTER_RECONCILE_IDENTITY_MISMATCH");
    }
    await this.#validateTaskSnapshot(task, operation.name, snapshot);
    await this.#repository.applySnapshot(
      task.taskId,
      Number(snapshot.revision),
      stopTransition(task, operation, snapshot, this.clock.now()),
      normalizeInputRequests(snapshot),
    );
    await this.#repository.noteRecovery(task.taskId);
    return "found";
  }

  async getTaskResult(
    taskId: string,
    authorization: AuthorizationContext,
  ): Promise<Record<string, unknown>> {
    const task = await this.#repository.getAuthorized(taskId, authorization);
    if (!isTerminalState(task.internalState)) {
      throw new InvalidParamsError("TASK_NOT_TERMINAL");
    }
    return task.result ?? task.error ?? { content: [], isError: task.mcpStatus !== "completed" };
  }

  async cancelTask(
    taskId: string,
    authorization: AuthorizationContext,
  ): Promise<Record<string, unknown>> {
    this.metrics?.increment("sdar_cancel_requests_total", {
      executionMode: authorization.executionMode,
    });
    let task = await this.#repository.getAuthorized(taskId, authorization);
    const operation = await this.loadOperationSnapshot(task.operationSnapshotId);
    this.onTrace?.({
      event: "task.cancel_requested",
      providerId: task.providerId,
      taskId,
      operationName: task.operationName,
      resourceRef: null,
      executionMode: authorization.executionMode,
      correlationId: authorization.correlationId ?? null,
    });
    if (isTerminalState(task.internalState)) return detailedTask(task);
    if (!operation.capabilities.cancel) {
      throw new CapabilityNotSupportedError("CANCEL_NOT_SUPPORTED");
    }
    const requestHash = createHash("sha256").update("cancel:user_requested").digest("hex");
    const command = await this.#repository.beginCancel(taskId, requestHash);
    if (command.commandType !== "CANCEL") {
      throw new Error("CANCEL_COMMAND_NOT_PERSISTED");
    }
    task = (await this.#repository.getById(taskId)) ?? task;
    return detailedTask(task);
  }

  async updateTask(
    taskId: string,
    answers: Record<string, unknown>,
    authorization: AuthorizationContext,
  ): Promise<Record<string, unknown>> {
    const task = await this.#repository.getAuthorized(taskId, authorization);
    const operation = await this.loadOperationSnapshot(task.operationSnapshotId);
    if (!operation.capabilities.inputRequired) {
      throw new CapabilityNotSupportedError("INPUT_NOT_SUPPORTED");
    }
    const requests = await this.#repository.listInputRequests(taskId);
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    const allAnswers: { key: string; hash: string; value: unknown }[] = [];
    const pending: { key: string; hash: string; value: unknown }[] = [];
    for (const [key, value] of Object.entries(answers)) {
      const request = requests.find((candidate) => candidate.key === key);
      if (request === undefined) throw new InvalidParamsError("UNKNOWN_INPUT_REQUEST_KEY");
      const hash = createHash("sha256").update(canonicalize(value)).digest("hex");
      allAnswers.push({ key, hash, value });
      if (request.status === "ANSWERED") {
        if (request.answerHash !== hash) throw new InvalidParamsError("INPUT_ANSWER_CONFLICT");
        continue;
      }
      if (!ajv.compile(request.schema)(value)) {
        throw new InvalidParamsError("INVALID_INPUT_ANSWER");
      }
      pending.push({ key, hash, value });
    }
    if (pending.length === 0) {
      const normalizedAnswers = [...allAnswers].sort((left, right) =>
        left.key.localeCompare(right.key),
      );
      const requestHash = createHash("sha256")
        .update(canonicalize(normalizedAnswers))
        .digest("hex");
      const command = await this.#repository.findCommandByRequestHash(
        taskId,
        "UPDATE",
        requestHash,
      );
      if (command !== null) {
        return this.#resolveExistingCommand(taskId, authorization, "UPDATE", command);
      }
      return this.#taskSnapshot(taskId, authorization);
    }
    const normalizedAnswers = [...allAnswers].sort((left, right) =>
      left.key.localeCompare(right.key),
    );
    const requestHash = createHash("sha256").update(canonicalize(normalizedAnswers)).digest("hex");
    const pendingPayload = Object.fromEntries(
      pending.map(({ key, value }) => [key, value] as const),
    );
    const command = await this.#repository.beginCommand(taskId, "UPDATE", requestHash, {
      answers: pendingPayload,
    });
    if (command.disposition === "existing") {
      return this.#resolveExistingCommand(taskId, authorization, "UPDATE", command);
    }
    return this.#taskWithCommandReceipt(taskId, authorization, command);
  }

  async updateTaskInputResponses(
    taskId: string,
    inputResponses: Record<string, { action: "accept" | "decline" | "cancel"; content?: unknown }>,
    authorization: AuthorizationContext,
  ): Promise<void> {
    const task = await this.#repository.getAuthorized(taskId, authorization);
    const operation = await this.loadOperationSnapshot(task.operationSnapshotId);
    if (!operation.capabilities.inputRequired) {
      throw new CapabilityNotSupportedError("INPUT_NOT_SUPPORTED");
    }
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    await this.#repository.acceptMcpInputResponses(
      taskId,
      authorization,
      inputResponses,
      (request, response) => {
        if (response.action !== "accept") return;
        let validate;
        try {
          validate = ajv.compile(request.schema);
        } catch (error) {
          throw new AdapterContractError("INVALID_INPUT_SCHEMA", { cause: error });
        }
        if (!validate(response.content)) {
          throw new InvalidParamsError("INVALID_INPUT_RESPONSE");
        }
      },
    );
  }

  async controlTask(
    taskId: string,
    commandType: "PAUSE" | "RESUME",
    authorization: AuthorizationContext,
  ): Promise<Record<string, unknown>> {
    const task = await this.#repository.getAuthorized(taskId, authorization);
    const operation = await this.loadOperationSnapshot(task.operationSnapshotId);
    if (!operation.capabilities.pauseResume) {
      throw new CapabilityNotSupportedError("PAUSE_RESUME_NOT_SUPPORTED");
    }
    const requestHash = createHash("sha256").update(commandType).digest("hex");
    const command = await this.#repository.beginCommand(taskId, commandType, requestHash, {});
    if (command.disposition === "existing") {
      return this.#resolveExistingCommand(taskId, authorization, commandType, command);
    }
    return this.#taskWithCommandReceipt(taskId, authorization, command);
  }

  async #taskWithCommandReceipt(
    taskId: string,
    authorization: AuthorizationContext,
    command: CommandResolution,
  ): Promise<Record<string, unknown>> {
    const [task, inputRequests, observations] = await Promise.all([
      this.#repository.getAuthorized(taskId, authorization),
      this.#repository.listInputRequests(taskId),
      this.#repository.listObservationPage(taskId),
    ]);
    const taskResult = detailedTask(task, inputRequests, observations) as Record<
      string,
      Record<string, unknown> | null
    > & { _meta?: Record<string, Record<string, unknown>> };
    const profile = taskResult._meta?.["io.sdar/taskExecution"];
    const acceptedAt = this.clock.now().toISOString();
    const retryAfterMs =
      command.nextAttemptAt === null
        ? undefined
        : Math.max(0, command.nextAttemptAt.getTime() - this.clock.now().getTime());
    taskResult._meta = {
      "io.sdar/taskExecution": {
        ...(profile ?? {}),
        receipt: {
          commandType: command.commandType,
          commandSequence: command.sequence,
          commandState: command.state,
          durablyAccepted: true,
          duplicate: command.duplicate,
          acceptedAt,
          ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
          ...(command.adapterAck === null ? {} : { adapterAck: command.adapterAck }),
        },
      },
    };
    return taskResult;
  }

  async #taskSnapshot(
    taskId: string,
    authorization: AuthorizationContext,
  ): Promise<Record<string, unknown>> {
    const [task, inputRequests, observations] = await Promise.all([
      this.#repository.getAuthorized(taskId, authorization),
      this.#repository.listInputRequests(taskId),
      this.#repository.listObservationPage(taskId),
    ]);
    return detailedTask(task, inputRequests, observations);
  }

  async #resolveExistingCommand(
    taskId: string,
    authorization: AuthorizationContext,
    commandType: "UPDATE" | "PAUSE" | "RESUME",
    command: CommandResolution,
  ): Promise<Record<string, unknown>> {
    switch (command.state) {
      case "PENDING":
      case "CLAIMED":
      case "RETRY_WAIT":
        this.#commandInProgressError(command, commandType);
        break;
      case "ACKNOWLEDGED":
        if (command.commandType === "CANCEL") {
          this.#blockingCommandError(command, commandType);
        }
        return this.#taskWithCommandReceipt(taskId, authorization, command);
      case "REJECTED":
        return this.#commandRejectionResult(command);
      case "EXHAUSTED":
        return this.#commandFailureResult(command);
    }
    return this.#taskWithCommandReceipt(taskId, authorization, command);
  }

  #commandInProgressError(
    command: {
      sequence: number;
      commandType: CommandResolution["commandType"];
      state: PendingCommandRecord["state"];
      nextAttemptAt: Date | null;
      claimUntil: Date | null;
    },
    commandType: "UPDATE" | "PAUSE" | "RESUME",
  ): never {
    if (
      command.state !== "PENDING" &&
      command.state !== "CLAIMED" &&
      command.state !== "RETRY_WAIT"
    ) {
      throw new Error("COMMAND_NOT_IN_PROGRESS");
    }
    const retryAfterMs = this.#commandRetryAfterMs(command.nextAttemptAt ?? command.claimUntil);
    throw new CommandInProgressError({
      commandSequence: command.sequence,
      commandType: command.commandType,
      requestedCommandType: commandType,
      blockingCommandType: command.commandType,
      commandState: command.state,
      retryAfterMs,
    });
  }

  #blockingCommandError(
    command: CommandResolution,
    requestedCommandType: "UPDATE" | "PAUSE" | "RESUME",
  ): never {
    if (
      command.state !== "PENDING" &&
      command.state !== "CLAIMED" &&
      command.state !== "RETRY_WAIT" &&
      !(command.commandType === "CANCEL" && command.state === "ACKNOWLEDGED")
    ) {
      throw new Error("COMMAND_NOT_BLOCKING");
    }
    const retryAfterMs =
      command.state === "ACKNOWLEDGED"
        ? 0
        : this.#commandRetryAfterMs(command.nextAttemptAt ?? command.claimUntil);
    throw new CommandInProgressError({
      commandSequence: command.sequence,
      commandType: command.commandType,
      requestedCommandType,
      blockingCommandType: command.commandType,
      commandState: command.state,
      retryAfterMs,
    });
  }

  #commandRetryAfterMs(nextAttemptAt: Date | null): number {
    return nextAttemptAt === null
      ? 0
      : Math.max(0, nextAttemptAt.getTime() - this.clock.now().getTime());
  }

  #commandRejectionResult(command: CommandResolution): Record<string, unknown> {
    const commandType = command.commandType;
    return {
      content: [
        {
          type: "text",
          text: command.lastErrorMessage ?? `${commandType} command was rejected.`,
        },
      ],
      isError: true,
      structuredContent: {
        outcome: "command_rejected",
        reasonCode: command.lastErrorCode ?? "COMMAND_REJECTED",
        commandSequence: command.sequence,
        commandType,
        commandState: command.state,
        message: command.lastErrorMessage ?? `${commandType} command was rejected.`,
        ...(command.adapterAck === null ? {} : { adapterAck: command.adapterAck }),
      },
    };
  }

  #commandFailureResult(command: CommandResolution): Record<string, unknown> {
    const commandType = command.commandType;
    return {
      content: [
        {
          type: "text",
          text: command.lastErrorMessage ?? `${commandType} command failed permanently.`,
        },
      ],
      isError: true,
      structuredContent: {
        outcome: "command_exhausted",
        reasonCode: command.lastErrorCode ?? "COMMAND_EXHAUSTED",
        commandSequence: command.sequence,
        commandType,
        commandState: command.state,
        message: command.lastErrorMessage ?? `${commandType} command failed permanently.`,
      },
    };
  }
}

function validateStartResponseIdentity(
  response: StartOperationResponse,
  expected: Omit<ReturnType<typeof expectedTaskIdentity>, "externalExecutionId">,
): void {
  const accepted = response.accepted;
  if (accepted === undefined) return;
  if (
    accepted.externalExecutionId.length === 0 ||
    accepted.initialSnapshot.externalExecutionId !== accepted.externalExecutionId
  ) {
    throw new Error("ADAPTER_START_IDENTITY_MISMATCH");
  }
  validateAdapterSnapshotIdentity(accepted.initialSnapshot, {
    ...expected,
    externalExecutionId: accepted.externalExecutionId,
  });
}

function expectedTaskIdentity(task: TaskRecord, operationName: string) {
  return {
    taskId: task.taskId,
    externalExecutionId: task.externalExecutionId,
    operationName,
    argumentHash: task.argumentHash,
    authorizationContextHash: task.authorizationContextHash,
    executionMode: task.executionMode,
    simulationId: task.simulationId,
  };
}

function normalizeInputRequests(snapshot: ExecutionSnapshot) {
  const frozen = snapshot.mcpInputRequests ?? [];
  const legacy = snapshot.inputRequests ?? [];
  if (frozen.length > 0 && legacy.length > 0) throw new Error("ADAPTER_MRTR_WIRE_MIXED");
  if (frozen.length > 0) {
    return frozen.map((request) => {
      const method: unknown = request.method;
      if (method !== "elicitation/create") {
        throw new Error("ADAPTER_MRTR_METHOD_UNSUPPORTED");
      }
      const params = protoStructToJson(request.params);
      const description = typeof params.message === "string" ? params.message : "Input required";
      const requestedSchema = params.requestedSchema;
      const schema =
        typeof requestedSchema === "object" &&
        requestedSchema !== null &&
        !Array.isArray(requestedSchema)
          ? (requestedSchema as Record<string, unknown>)
          : {};
      return {
        key: request.key,
        description,
        schema,
        required: true,
        requestJson: { method: "elicitation/create" as const, params },
        status: "OPEN" as const,
      };
    });
  }
  return legacy.map((request) => ({
    key: request.key,
    description: request.description,
    schema: protoStructToJson(request.inputSchema),
    required: request.required,
    requestJson: {
      method: "elicitation/create" as const,
      params: {
        mode: "form",
        message: request.description,
        requestedSchema: protoStructToJson(request.inputSchema),
      },
    },
    status: "OPEN" as const,
  }));
}

function resultFromStart(
  operation: ValidatedOperation,
  response: Awaited<ReturnType<GrpcAdapterGateway["startOperation"]>>,
): Record<string, unknown> {
  if (response.rejected !== undefined) return rejectionResult(response.rejected);
  const snapshot = response.accepted?.initialSnapshot;
  if (snapshot === undefined) throw new Error("ADAPTER_START_RESPONSE_MISSING_RESULT");
  return synchronousResult(operation, snapshot);
}

function rejectionResult(
  rejected: { reasonCode: string; message: string; retryable: boolean } | undefined,
) {
  return {
    content: [{ type: "text", text: rejected?.message ?? "Operation rejected." }],
    isError: true,
    structuredContent: {
      outcome: "admission_rejected",
      reasonCode: rejected?.reasonCode ?? "ADMISSION_REJECTED",
      retryable: rejected?.retryable ?? false,
      completedAt: new Date().toISOString(),
    },
  };
}

function hashArguments(value: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

function detailedTask(
  task: TaskRecord,
  inputRequests: {
    key: string;
    description: string;
    schema: Record<string, unknown>;
    required: boolean;
    status: "OPEN" | "ANSWERED" | "SUPERSEDED";
  }[] = [],
  observationPage: ObservationPage = { observations: [], nextCursor: null, hasMore: false },
  readStatus: {
    snapshotFreshness: "fresh" | "stale";
    degradedReasonCode?: string;
  } = { snapshotFreshness: "fresh" },
): Record<string, unknown> {
  return {
    taskId: task.taskId,
    status: task.mcpStatus,
    statusMessage: task.statusMessage ?? undefined,
    createdAt: task.createdAt.toISOString(),
    lastUpdatedAt: task.updatedAt.toISOString(),
    ttl: task.ttlMs,
    pollInterval: task.pollIntervalMs,
    ...(inputRequests.some((request) => request.status === "OPEN")
      ? {
          inputRequests: inputRequests
            .filter((request) => request.status === "OPEN")
            .map(({ status, ...request }) => {
              void status;
              return request;
            }),
        }
      : {}),
    ...(task.result === null ? {} : { result: task.result }),
    ...(task.error === null ? {} : { error: task.error }),
    _meta: {
      "io.sdar/taskExecution": {
        profileVersion: "1.0",
        substate: task.substate,
        observationRevision: task.observationRevision,
        executionMode: task.executionMode,
        ttlMs: task.ttlMs,
        pollIntervalMs: task.pollIntervalMs,
        snapshotFreshness: readStatus.snapshotFreshness,
        lastConfirmedAt: task.lastConfirmedAt?.toISOString() ?? null,
        ...(readStatus.degradedReasonCode === undefined
          ? {}
          : { degradedReasonCode: readStatus.degradedReasonCode }),
        timing: {
          acceptedAt: task.acceptedAt.toISOString(),
          notBefore: task.notBefore?.toISOString(),
          latestStartAt: task.latestStartAt?.toISOString(),
          actualStartedAt: task.actualStartedAt?.toISOString() ?? null,
          startStopRequestedAt: task.startStopRequestedAt?.toISOString() ?? null,
          invocationAttempt: task.invocationAttempt,
          nextStartAttemptAt: task.nextStartAttemptAt?.toISOString() ?? null,
          deadlineAt: task.deadlineAt?.toISOString() ?? null,
        },
        observations: wireObservations(observationPage.observations),
        observationCursor:
          observationPage.nextCursor === null ? null : String(observationPage.nextCursor),
        hasMore: observationPage.hasMore,
      },
    },
  };
}

function wireObservations(
  observations: ObservationPage["observations"],
): Record<string, unknown>[] {
  return observations.map((observation) => ({
    revision: observation.revision,
    type: observation.type,
    occurredAt: observation.occurredAt.toISOString(),
    ...(observation.reasonCode === null ? {} : { reasonCode: observation.reasonCode }),
    ...(observation.message === null ? {} : { message: observation.message }),
    ...(observation.substate === null ? {} : { substate: observation.substate }),
    ...(observation.progress === null ? {} : { progress: observation.progress }),
    source: observation.source,
    ...(observation.adapterRevision === null
      ? {}
      : { adapterRevision: observation.adapterRevision }),
    ...observation.payload,
  }));
}

function isTransientAdapterReadError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = (error as { code?: unknown }).code;
  return (
    typeof code === "number" &&
    [
      grpc.status.CANCELLED,
      grpc.status.DEADLINE_EXCEEDED,
      grpc.status.RESOURCE_EXHAUSTED,
      grpc.status.ABORTED,
      grpc.status.UNAVAILABLE,
    ].includes(code)
  );
}

function deadlineReached(message: string, completedAt: Date) {
  return {
    internalState: "TERMINAL_COMPLETED" as const,
    mcpStatus: "completed" as const,
    substate: null,
    statusMessage: message || "Maximum elapsed time reached after safe stop.",
    result: {
      content: [{ type: "text", text: message || "Maximum elapsed time reached." }],
      isError: true,
      structuredContent: {
        outcome: "deadline_reached",
        reasonCode: "MAX_ELAPSED_TIME_REACHED",
        retryable: true,
        completedAt: completedAt.toISOString(),
      },
    },
    error: null,
    terminal: true,
    observationType: "task.progress",
  };
}

export function startWindowMissed(
  completedAt: Date,
  message: string,
  adapterResult?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
    structuredContent: {
      outcome: "start_window_missed",
      reasonCode: "START_WINDOW_MISSED",
      retryable: true,
      completedAt: completedAt.toISOString(),
      ...(adapterResult === undefined ? {} : { adapterResult }),
    },
  };
}

function startWindowMissedTransition(
  message: string,
  completedAt: Date,
  adapterResult?: Record<string, unknown>,
) {
  return {
    internalState: "TERMINAL_COMPLETED" as const,
    mcpStatus: "completed" as const,
    substate: null,
    statusMessage: message || "Start window was missed after safe stop.",
    result: startWindowMissed(
      completedAt,
      message || "Start window was missed after safe stop.",
      adapterResult,
    ),
    error: null,
    terminal: true,
    observationType: "task.start_window_missed",
  };
}

function stopTransition(
  task: TaskRecord,
  operation: ValidatedOperation,
  snapshot: ExecutionSnapshot,
  completedAt: Date,
): SnapshotTransition {
  if (snapshot.state === "CANCELLED" && task.stopReason === "DEADLINE_REACHED") {
    return deadlineReached(snapshot.message, completedAt);
  }
  if (snapshot.state === "CANCELLED" && task.stopReason === "START_WINDOW_MISSED") {
    return startWindowMissedTransition(
      snapshot.message,
      completedAt,
      sanitizedAdapterResultPayload(snapshot),
    );
  }
  if (task.stopReason === "START_WINDOW_MISSED" && isTerminalTaskState(snapshot.state)) {
    return startWindowMissedWithAdapterResultTransition(
      snapshot,
      task,
      completedAt,
      "START_WINDOW_MISSED",
    );
  }
  return validatedSnapshotTransition(operation, snapshot);
}

function transitionReasonCode(transition: { error: Record<string, unknown> | null }): string {
  const data = transition.error?.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return "TECHNICAL_EXECUTION_FAILED";
  }
  const reasonCode = (data as Record<string, unknown>).reasonCode;
  return typeof reasonCode === "string" ? reasonCode : "TECHNICAL_EXECUTION_FAILED";
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

function isTerminalTaskState(state: string): boolean {
  return [
    "SUCCEEDED",
    "BUSINESS_FAILED",
    "PARTIALLY_COMPLETED",
    "CANCELLED",
    "TECHNICAL_FAILED",
  ].includes(state);
}

function startWindowMissedWithAdapterResultTransition(
  snapshot: ExecutionSnapshot,
  task: TaskRecord,
  completedAt: Date,
  stopReason: string,
): SnapshotTransition {
  const message =
    task.actualStartedAt === null
      ? snapshot.message || "Start window was missed before execution began."
      : "Task completed after the start window was missed.";
  const base = startWindowMissed(completedAt, message);
  return {
    internalState: "TERMINAL_COMPLETED",
    mcpStatus: "completed",
    substate: null,
    statusMessage: message,
    result: {
      ...base,
      structuredContent: {
        ...(base.structuredContent as Record<string, unknown>),
        stopReason,
        adapterOutcome: snapshot.state,
        ...(snapshot.result === undefined || snapshot.result === null
          ? {}
          : { adapterResult: snapshot.result }),
      },
    },
    error: null,
    terminal: true,
    observationType: "task.start_window_missed",
  };
}

function storedInvocation(invocation: ToolInvocationResult): StoredInvocation {
  if (invocation.kind === "result") return invocation;
  return { kind: "task", taskId: String(invocation.task.taskId) };
}

function executionOptions(authorization: AuthorizationContext) {
  return {
    authorizationContextHash: authorization.hash,
    executionMode: authorization.executionMode,
    simulationId: authorization.simulationId,
    ...(authorization.correlationId === undefined
      ? {}
      : { correlationId: authorization.correlationId }),
    ...(authorization.rootTraceparent === undefined
      ? {}
      : { rootTraceparent: authorization.rootTraceparent }),
    ...(authorization.rootTracestate === undefined
      ? {}
      : { rootTracestate: authorization.rootTracestate }),
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

function resourceReference(
  operation: ValidatedOperation,
  argumentsValue: Record<string, unknown>,
): string | null {
  const pointer = operation.resourceBinding?.resourceIdJsonPointer;
  if (operation.resourceBinding?.mode !== "ARGUMENT_REFERENCE" || !pointer?.startsWith("/")) {
    return null;
  }
  let current: unknown = argumentsValue;
  for (const encoded of pointer.slice(1).split("/")) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return null;
    const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" || typeof current === "number" ? String(current) : null;
}

function toAdapterAvailabilityCheck(check: AvailabilityCheck): AvailabilityCheckInput {
  if (check.arguments.state === "partial") {
    return {
      requestId: check.requestId,
      operationName: check.operationName,
      unresolvedArguments: {
        knownArguments: check.arguments.knownValue,
        unresolvedPaths: check.arguments.unresolvedPaths,
      },
      timing: toAdapterTiming(check.timing),
    };
  }
  return {
    requestId: check.requestId,
    operationName: check.operationName,
    arguments: check.arguments.value,
    timing: toAdapterTiming(check.timing),
  };
}

function assertUnresolvedPointers(pointers: string[]): void {
  if (pointers.length < 1 || pointers.length > 128 || new Set(pointers).size !== pointers.length) {
    throw new InvalidParamsError("INVALID_UNRESOLVED_PATHS");
  }
  for (const pointer of pointers) {
    if (pointer.length > 512 || !/^(?:|(?:\/(?:[^~/]|~[01])*)*)$/.test(pointer)) {
      throw new InvalidParamsError("INVALID_UNRESOLVED_PATH");
    }
  }
}

function toAdapterTiming(timing: AvailabilityCheck["timing"]): Record<string, unknown> {
  const start = timing?.start;
  return {
    start: {
      mode: (start?.mode ?? "immediate").toUpperCase(),
      ...(start?.scheduledAt === undefined
        ? {}
        : { scheduledAt: dateToProtoTimestamp(new Date(start.scheduledAt)) }),
      startToleranceMs: String(start?.startToleranceMs ?? 0),
    },
    ...(timing?.maxElapsedMs === undefined || timing.maxElapsedMs === null
      ? {}
      : { maxElapsedMs: String(timing.maxElapsedMs) }),
  };
}

function fromAdapterAvailability(result: {
  requestId: string;
  operationName: string;
  availability: string;
  riskLevel: string;
  reasonCode: string;
  description: string;
  validUntil?: unknown;
  earliestStartTime?: unknown;
  nextAvailableWindows: { startTime?: unknown; endTime?: unknown }[];
  estimatedDelayMs: string | number;
  reservationMode: string;
  reservationRef?: string;
  possibleEffects: string[];
}) {
  if (result.reservationMode === "UNSPECIFIED") {
    throw new Error("AVAILABILITY_RESERVATION_MODE_MISSING");
  }
  return {
    requestId: result.requestId,
    operationName: result.operationName,
    availability: result.availability.toLowerCase() as
      "available" | "restricted" | "disabled" | "unknown",
    riskLevel:
      result.riskLevel === "UNSPECIFIED"
        ? ("critical" as const)
        : (result.riskLevel.toLowerCase() as "low" | "medium" | "high" | "critical"),
    ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
    ...(result.description ? { description: result.description } : {}),
    ...(hasTimestamp(result.validUntil)
      ? { validUntil: protoTimestampToDate(result.validUntil).toISOString() }
      : {}),
    ...(hasTimestamp(result.earliestStartTime)
      ? { earliestStartTime: protoTimestampToDate(result.earliestStartTime).toISOString() }
      : {}),
    nextAvailableWindows: result.nextAvailableWindows
      .filter((window) => hasTimestamp(window.startTime) && hasTimestamp(window.endTime))
      .map((window) => ({
        startTime: protoTimestampToDate(window.startTime).toISOString(),
        endTime: protoTimestampToDate(window.endTime).toISOString(),
      })),
    estimatedDelayMs: Number(result.estimatedDelayMs),
    reservationMode: result.reservationMode.toLowerCase() as "none" | "best_effort" | "guaranteed",
    ...(result.reservationRef ? { reservationRef: result.reservationRef } : {}),
    possibleEffects: result.possibleEffects,
  };
}

function hasTimestamp(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    Number.isFinite(Number((value as { seconds?: unknown }).seconds)) &&
    Number((value as { seconds?: unknown }).seconds) !== 0
  );
}

function protoTimestampToDate(value: unknown): Date {
  if (!hasTimestamp(value)) throw new Error("INVALID_AVAILABILITY_TIMESTAMP");
  const timestamp = value as { seconds: string | number; nanos?: number };
  return new Date(Number(timestamp.seconds) * 1000 + (timestamp.nanos ?? 0) / 1_000_000);
}

function dateToProtoTimestamp(value: Date): Record<string, string | number> {
  if (!Number.isFinite(value.getTime())) throw new Error("INVALID_SCHEDULED_AT");
  return { seconds: String(Math.floor(value.getTime() / 1000)), nanos: 0 };
}

function isAvailabilityContractError(error: unknown): boolean {
  return (
    error instanceof Error && /^(AVAILABILITY_|AVAILABLE_|RESTRICTED_|INVALID_)/.test(error.message)
  );
}
