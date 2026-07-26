import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  AuthorizationContext,
  SnapshotTransition,
  TaskExecutionTiming,
  TaskRecord,
} from "../../domain/src/index.js";
import {
  isTerminalState,
  TaskExpiredError,
  TaskNotFoundOrUnauthorizedError,
  RUNTIME_VERSION,
} from "../../domain/src/index.js";
import { createProviderOpsEnvelope } from "../../observability/src/index.js";
import { captureProviderOpsDelivery } from "./provider-ops-delivery.js";

export interface AdmissionIntentInput {
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
}

export interface PublishTaskInput extends AdmissionIntentInput {
  externalExecutionId: string;
  transition: SnapshotTransition;
  adapterRevision: number;
  adapterResponse: Record<string, unknown>;
  actualStartedAt?: Date | null;
  startWindowMissedAt?: Date;
  inputRequests?: NewInputRequest[];
}

export interface NewInputRequest {
  key: string;
  description: string;
  schema: Record<string, unknown>;
  required: boolean;
  requestJson?: InputRequestRecord["requestJson"];
}

export type PublishScheduledInput = AdmissionIntentInput;

export interface AdmissionIntentRecord extends AdmissionIntentInput {
  state: "PENDING" | "ACCEPTED" | "REJECTED" | "PUBLISHED" | "UNCERTAIN";
}

export interface PendingCommandRecord {
  taskId: string;
  commandSequence: number;
  commandType: "CANCEL" | "UPDATE" | "PAUSE" | "RESUME";
  payload: Record<string, unknown>;
  state: "PENDING" | "CLAIMED" | "RETRY_WAIT" | "ACKNOWLEDGED" | "REJECTED" | "EXHAUSTED";
  attemptCount: number;
  claimOwner: string | null;
  stopReason: string | null;
  adapterAck: Record<string, unknown> | null;
  nextAttemptAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  claimUntil: Date | null;
}

export interface CommandResolution {
  sequence: number;
  disposition: "created" | "existing";
  duplicate: boolean;
  commandType: PendingCommandRecord["commandType"];
  state: PendingCommandRecord["state"];
  adapterAck: Record<string, unknown> | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  nextAttemptAt: Date | null;
  claimUntil: Date | null;
  claimOwner: string | null;
}

interface PendingCommandRecordRow {
  task_id: string;
  command_sequence: string;
  command_type: PendingCommandRecord["commandType"];
  state: PendingCommandRecord["state"];
  payload: Record<string, unknown>;
  attempt_count: number;
  claim_owner: string | null;
  stop_reason: string | null;
  adapter_ack: Record<string, unknown> | null;
  next_attempt_at?: Date | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
  claim_until: Date | null;
  previous_state?: PendingCommandRecord["state"];
}

function mapPendingCommandRecord(row: PendingCommandRecordRow): PendingCommandRecord {
  return {
    taskId: row.task_id,
    commandSequence: Number(row.command_sequence),
    commandType: row.command_type,
    payload: row.payload,
    state: row.state,
    attemptCount: row.attempt_count,
    claimOwner: row.claim_owner,
    stopReason: row.stop_reason,
    adapterAck: row.adapter_ack ?? null,
    nextAttemptAt: row.next_attempt_at ?? null,
    lastErrorCode: row.last_error_code ?? null,
    lastErrorMessage: row.last_error_message ?? null,
    claimUntil: row.claim_until,
  };
}

function assertUuidList(values: readonly string[]): void {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (values.some((value) => !uuid.test(value))) {
    throw new Error("RUNTIME_CONTRACT_INVALID_TASK_UUID");
  }
}

function mapCommandResolution(row: PendingCommandRecordRow): Omit<CommandResolution, "duplicate"> {
  return {
    sequence: Number(row.command_sequence),
    disposition: "existing",
    commandType: row.command_type,
    state: row.state,
    adapterAck: row.adapter_ack ?? null,
    lastErrorCode: row.last_error_code ?? null,
    lastErrorMessage: row.last_error_message ?? null,
    nextAttemptAt: row.next_attempt_at ?? null,
    claimOwner: row.claim_owner,
    claimUntil: row.claim_until,
  };
}

export interface InputRequestRecord {
  key: string;
  description: string;
  schema: Record<string, unknown>;
  required: boolean;
  status: "OPEN" | "ANSWERED" | "SUPERSEDED";
  answerHash: string | null;
  requestJson: {
    method: "elicitation/create";
    params: Record<string, unknown>;
  };
  responseHash: string | null;
  responseJson: Record<string, unknown> | null;
}

export interface McpInputResponse {
  action: "accept" | "decline" | "cancel";
  content?: unknown;
}

export interface LockedInputResponseRequest {
  key: string;
  status: "OPEN" | "ANSWERED" | "SUPERSEDED";
  schema: Record<string, unknown>;
  requestJson: {
    method: "elicitation/create";
    params: Record<string, unknown>;
  };
}

export type ValidateLockedInputResponse = (
  request: LockedInputResponseRequest,
  response: McpInputResponse,
) => void;

export interface InputResponseAcceptance {
  acceptedKeys: string[];
  ignoredUnknownKeys: string[];
  ignoredAnsweredKeys: string[];
  ignoredSupersededKeys: string[];
  duplicatePendingKeys: string[];
}

export interface ObservationRecord {
  revision: number;
  type: string;
  occurredAt: Date;
  reasonCode: string | null;
  message: string | null;
  substate: string | null;
  progress: Record<string, unknown> | null;
  source: "runtime" | "adapter";
  adapterRevision: number | null;
  payload: Record<string, unknown>;
}

export interface ObservationPage {
  observations: ObservationRecord[];
  nextCursor: number | null;
  hasMore: boolean;
}

export interface DeadlineStopRecord {
  task: TaskRecord;
  commandSequence: number;
}

interface TransitionObservation {
  type: string;
  occurredAt: Date;
  reasonCode?: string | null;
  message: string;
  substate: string | null;
  progress?: Record<string, unknown> | null;
  source: "runtime" | "adapter";
  adapterRevision?: number | null;
  payload?: Record<string, unknown>;
}

interface TaskTransitionUpdate {
  internalState?: TaskRecord["internalState"];
  mcpStatus?: TaskRecord["mcpStatus"];
  substate?: string | null;
  statusMessage?: string | null;
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  adapterRevision?: number;
  externalExecutionId?: string | null;
  actualStartedAt?: Date | null;
  cancelRequested?: boolean;
  stopReason?: string | null;
  startStopRequestedAt?: Date | null;
  startConfirmationDeadline?: Date | null;
  startConfirmationAttempts?: number;
  scheduleClaimOwner?: string | null;
  scheduleClaimUntil?: Date | null;
  nextStartAttemptAt?: Date | null;
  invocationAttempt?: number;
  recoveryAttempts?: number;
  nextRecoveryAt?: Date;
  recoveryFailureCount?: number;
  lastReconciledAt?: Date | null;
}

interface TaskTransitionRequest {
  taskId: string;
  expectedVersion?: number;
  update: TaskTransitionUpdate;
  observation: TransitionObservation;
  outboxType: string;
  eventKey: string;
  outboxPayload?: Record<string, unknown>;
}

interface TaskRow {
  task_id: string;
  provider_id: string;
  operation_name: string;
  operation_snapshot_id: string;
  authorization_context_hash: string;
  trace_id: string | null;
  root_traceparent: string | null;
  root_tracestate: string | null;
  correlation_id: string | null;
  execution_mode: TaskRecord["executionMode"];
  simulation_id: string | null;
  reservation_ref: string | null;
  arguments: Record<string, unknown>;
  argument_hash: string;
  external_execution_id: string | null;
  internal_state: TaskRecord["internalState"];
  mcp_status: TaskRecord["mcpStatus"];
  substate: string | null;
  status_message: string | null;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  adapter_revision: string;
  observation_revision: string;
  runtime_revision: string;
  ttl_ms: string | null;
  handle_expires_at: Date | null;
  terminal_at: Date | null;
  expired_at: Date | null;
  purge_after: Date | null;
  last_confirmed_at: Date | null;
  poll_interval_ms: number;
  created_at: Date;
  updated_at: Date;
  runtime_updated_at: Date;
  version: string;
  accepted_at: Date;
  not_before: Date | null;
  latest_start_at: Date | null;
  actual_started_at: Date | null;
  start_stop_requested_at: Date | null;
  start_confirmation_deadline: Date | null;
  start_confirmation_attempts: number;
  invocation_attempt: number;
  next_start_attempt_at: Date | null;
  schedule_claim_owner: string | null;
  schedule_claim_until: Date | null;
  deadline_at: Date | null;
  cancel_requested: boolean;
  stop_reason: string | null;
  next_command_sequence: string;
  timing: Record<string, unknown>;
  recovery_attempts: number;
  next_recovery_at: Date;
  recovery_failure_count: number;
  last_reconciled_at: Date | null;
}

export interface TaskOperationalEventInput {
  recordType:
    "provider.scheduler.decision" | "provider.recovery.lifecycle" | "provider.ttl.lifecycle";
  eventType: string;
  eventIdentity: string;
  occurredAt: Date;
  payload: Record<string, string | number | boolean | null>;
}

export async function captureTaskOperationalEvent(
  client: PoolClient,
  taskId: string,
  input: TaskOperationalEventInput,
): Promise<void> {
  const result = await client.query<TaskRow>("SELECT * FROM provider_task WHERE task_id=$1", [
    taskId,
  ]);
  const task = result.rows[0];
  if (task === undefined) throw new Error("TASK_NOT_FOUND");
  const aggregateType = input.recordType.startsWith("provider.scheduler")
    ? "scheduler"
    : input.recordType.startsWith("provider.recovery")
      ? "recovery"
      : "ttl";
  const eventKey = `${input.eventIdentity}:${input.recordType}`;
  const envelope = createProviderOpsEnvelope({
    recordType: input.recordType,
    eventCategory: input.recordType.replace("provider.", ""),
    deliveryClass: "operational",
    providerId: task.provider_id,
    runtimeVersion: RUNTIME_VERSION,
    instanceId: "",
    taskId,
    resourceId: taskId,
    resourceType: "task",
    ...(task.external_execution_id === null
      ? {}
      : { externalExecutionId: task.external_execution_id }),
    operationName: task.operation_name,
    executionMode: task.execution_mode,
    ...(task.simulation_id === null ? {} : { simulationId: task.simulation_id }),
    argumentHash: task.argument_hash,
    authorizationContextHash: task.authorization_context_hash,
    adapterRevision: task.adapter_revision,
    eventType: input.eventType,
    stableAggregateIdentity: taskId,
    eventIdentity: input.eventIdentity,
    occurredAt: input.occurredAt,
    attributes: { source: "committed_postgres", eventType: input.eventType },
    payload: input.payload,
  });
  await captureProviderOpsDelivery(client, {
    envelope,
    eventKey,
    aggregateType,
    aggregateId: taskId,
  });
}

export async function insertCommittedTaskEvent(
  client: PoolClient,
  taskId: string,
  eventType: string,
  payload: Record<string, unknown>,
  eventKey: string,
): Promise<void> {
  await insertOutbox(client, taskId, eventType, payload, eventKey);
}

export class TaskRepository {
  constructor(readonly pool: Pool) {}

  async createAdmissionIntent(input: AdmissionIntentInput): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO admission_intent
        (task_id, provider_id, operation_name, operation_snapshot_id,
         authorization_context_hash, execution_mode, simulation_id, arguments,
         argument_hash, state, accepted_at, not_before, latest_start_at,
         deadline_at, ttl_ms, timing, trace_id, root_traceparent, root_tracestate, correlation_id,
         reservation_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,'PENDING',$10,$11,$12,$13,$14,$15::jsonb,
               $16,$17,$18,$19,$20)
       ON CONFLICT (task_id) DO NOTHING`,
      [
        input.taskId,
        input.providerId,
        input.operationName,
        input.operationSnapshotId,
        input.authorization.hash,
        input.authorization.executionMode,
        input.authorization.simulationId,
        JSON.stringify(input.arguments),
        input.argumentHash,
        input.acceptedAt,
        input.notBefore,
        input.latestStartAt,
        input.deadlineAt,
        input.ttlMs,
        JSON.stringify(input.timing),
        input.authorization.traceId ?? null,
        input.authorization.rootTraceparent ?? null,
        input.authorization.rootTracestate ?? null,
        input.authorization.correlationId ?? null,
        input.reservationRef,
      ],
    );
    return result.rowCount === 1;
  }

  async getAdmission(taskId: string): Promise<AdmissionIntentRecord | null> {
    const result = await this.pool.query<{
      task_id: string;
      provider_id: string;
      operation_name: string;
      operation_snapshot_id: string;
      authorization_context_hash: string;
      execution_mode: AuthorizationContext["executionMode"];
      simulation_id: string | null;
      arguments: Record<string, unknown>;
      argument_hash: string;
      state: AdmissionIntentRecord["state"];
      accepted_at: Date;
      not_before: Date;
      latest_start_at: Date;
      deadline_at: Date | null;
      ttl_ms: string | null;
      timing: TaskExecutionTiming;
      trace_id: string | null;
      root_traceparent: string | null;
      root_tracestate: string | null;
      correlation_id: string | null;
      reservation_ref: string | null;
    }>("SELECT * FROM admission_intent WHERE task_id=$1", [taskId]);
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      taskId: row.task_id,
      providerId: row.provider_id,
      operationName: row.operation_name,
      operationSnapshotId: row.operation_snapshot_id,
      authorization: {
        hash: row.authorization_context_hash,
        executionMode: row.execution_mode,
        simulationId: row.simulation_id,
        ...(row.trace_id === null ? {} : { traceId: row.trace_id }),
        ...(row.root_traceparent === null ? {} : { rootTraceparent: row.root_traceparent }),
        ...(row.root_tracestate === null ? {} : { rootTracestate: row.root_tracestate }),
        ...(row.correlation_id === null ? {} : { correlationId: row.correlation_id }),
      },
      arguments: row.arguments,
      argumentHash: row.argument_hash,
      acceptedAt: row.accepted_at,
      notBefore: row.not_before,
      latestStartAt: row.latest_start_at,
      deadlineAt: row.deadline_at,
      ttlMs: row.ttl_ms === null ? null : Number(row.ttl_ms),
      timing: row.timing,
      reservationRef: row.reservation_ref,
      state: row.state,
    };
  }

  async markAdmissionUncertain(taskId: string): Promise<void> {
    await this.pool.query(
      "UPDATE admission_intent SET state='UNCERTAIN', updated_at=clock_timestamp() WHERE task_id=$1 AND state='PENDING'",
      [taskId],
    );
  }

  async recordRejection(taskId: string, response: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `UPDATE admission_intent
       SET state='REJECTED', adapter_response=$2::jsonb, updated_at=clock_timestamp()
       WHERE task_id=$1`,
      [taskId, JSON.stringify(response)],
    );
  }

  async completeAdmissionWithoutTask(
    taskId: string,
    response: Record<string, unknown>,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE admission_intent SET state='PUBLISHED', adapter_response=$2::jsonb,
       updated_at=clock_timestamp() WHERE task_id=$1`,
      [taskId, JSON.stringify(response)],
    );
  }

  async publishAccepted(input: PublishTaskInput): Promise<TaskRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE admission_intent SET state='ACCEPTED', adapter_response=$2::jsonb,
           updated_at=clock_timestamp() WHERE task_id=$1`,
        [input.taskId, JSON.stringify(input.adapterResponse)],
      );
      await client.query(
        `INSERT INTO provider_task
          (task_id, provider_id, operation_name, operation_snapshot_id,
           authorization_context_hash, execution_mode, simulation_id, arguments,
           argument_hash, external_execution_id, internal_state, mcp_status,
           substate, status_message, result, error, adapter_revision, accepted_at, ttl_ms,
           timing, not_before, latest_start_at, deadline_at, actual_started_at,
           invocation_attempt, observation_revision, terminal_at, handle_expires_at,
           last_confirmed_at, trace_id, root_traceparent, root_tracestate, correlation_id,
           reservation_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15::jsonb,
                 $16::jsonb,$17,$18,$19,$20::jsonb,$21,$22,$23,
                 $24,$25,1,
                 CASE WHEN $11 LIKE 'TERMINAL_%' THEN clock_timestamp() ELSE NULL END,
                 CASE
                   WHEN $19::bigint IS NULL AND $11 NOT LIKE 'TERMINAL_%' THEN NULL
                   ELSE clock_timestamp() + (COALESCE($19::bigint,86400000) * interval '1 millisecond')
                 END,
                 clock_timestamp(),$26,$27,$28,$29,$30)`,
        [
          input.taskId,
          input.providerId,
          input.operationName,
          input.operationSnapshotId,
          input.authorization.hash,
          input.authorization.executionMode,
          input.authorization.simulationId,
          JSON.stringify(input.arguments),
          input.argumentHash,
          input.externalExecutionId,
          input.transition.internalState,
          input.transition.mcpStatus,
          input.transition.substate,
          input.transition.statusMessage,
          jsonOrNull(input.transition.result),
          jsonOrNull(input.transition.error),
          input.adapterRevision,
          input.acceptedAt,
          input.ttlMs,
          JSON.stringify(input.timing),
          input.notBefore,
          input.latestStartAt,
          input.deadlineAt,
          input.actualStartedAt ?? null,
          1,
          input.authorization.traceId ?? null,
          input.authorization.rootTraceparent ?? null,
          input.authorization.rootTracestate ?? null,
          input.authorization.correlationId ?? null,
          input.reservationRef,
        ],
      );
      await materializeTaskResourceBinding(client, input);
      await insertObservation(client, input.taskId, 1, input.transition, {
        source: "adapter",
        adapterRevision: input.adapterRevision,
      });
      if (input.startWindowMissedAt !== undefined) {
        await persistStartWindowStop(client, input.taskId, input.startWindowMissedAt);
      }
      await insertOutbox(
        client,
        input.taskId,
        "task.created",
        { status: input.transition.mcpStatus },
        `${input.taskId}:created`,
      );
      await upsertInputRequests(client, input.taskId, input.inputRequests ?? []);
      await client.query(
        "UPDATE admission_intent SET state='PUBLISHED', updated_at=clock_timestamp() WHERE task_id=$1",
        [input.taskId],
      );
      await client.query("COMMIT");
      const task = await selectTaskById(client, input.taskId);
      if (task === null) throw new Error("TASK_NOT_VISIBLE_AFTER_COMMIT");
      return task;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async publishScheduled(input: PublishScheduledInput): Promise<TaskRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO provider_task
          (task_id, provider_id, operation_name, operation_snapshot_id,
           authorization_context_hash, execution_mode, simulation_id, arguments,
           argument_hash, external_execution_id, internal_state, mcp_status,
           substate, status_message, adapter_revision, accepted_at, ttl_ms,
           timing, not_before, latest_start_at, deadline_at, invocation_attempt,
           next_start_attempt_at, observation_revision, trace_id, root_traceparent,
           root_tracestate, correlation_id, reservation_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,NULL,'SCHEDULED','working',
                 'scheduled','Waiting for scheduled start.',0,$10,$11,$12::jsonb,$13,$14,$15,0,$13,1,
                 $16,$17,$18,$19,$20)`,
        [
          input.taskId,
          input.providerId,
          input.operationName,
          input.operationSnapshotId,
          input.authorization.hash,
          input.authorization.executionMode,
          input.authorization.simulationId,
          JSON.stringify(input.arguments),
          input.argumentHash,
          input.acceptedAt,
          input.ttlMs,
          JSON.stringify(input.timing),
          input.notBefore,
          input.latestStartAt,
          input.deadlineAt,
          input.authorization.traceId ?? null,
          input.authorization.rootTraceparent ?? null,
          input.authorization.rootTracestate ?? null,
          input.authorization.correlationId ?? null,
          input.reservationRef,
        ],
      );
      await materializeTaskResourceBinding(client, input);
      await initializeTaskRetention(
        client,
        input.taskId,
        "SCHEDULED",
        input.acceptedAt,
        input.ttlMs,
      );
      await client.query(
        `INSERT INTO task_observation
          (task_id, revision, type, occurred_at, message, substate, source, payload)
         VALUES ($1,1,'task.scheduled',$2,'Waiting for scheduled start.','scheduled',
                 'runtime','{}'::jsonb)`,
        [input.taskId, input.acceptedAt],
      );
      await insertOutbox(
        client,
        input.taskId,
        "task.created",
        {
          status: "working",
          substate: "scheduled",
        },
        `${input.taskId}:created`,
      );
      await client.query(
        "UPDATE admission_intent SET state='PUBLISHED', updated_at=clock_timestamp() WHERE task_id=$1",
        [input.taskId],
      );
      await client.query("COMMIT");
      const task = await selectTaskById(client, input.taskId);
      if (task === null) throw new Error("SCHEDULED_TASK_NOT_VISIBLE_AFTER_COMMIT");
      return task;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getAuthorized(taskId: string, authorization: AuthorizationContext): Promise<TaskRecord> {
    const result = await this.pool.query<TaskRow & { handle_expired: boolean }>(
      `SELECT *,
              (internal_state LIKE 'TERMINAL_%'
               AND handle_expires_at IS NOT NULL
               AND handle_expires_at <= clock_timestamp()) AS handle_expired
       FROM provider_task
       WHERE task_id=$1 AND authorization_context_hash=$2 AND execution_mode=$3
         AND simulation_id IS NOT DISTINCT FROM $4`,
      [taskId, authorization.hash, authorization.executionMode, authorization.simulationId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new TaskNotFoundOrUnauthorizedError();
    const task = fromRow(row);
    if (task.expiredAt !== null || row.handle_expired) {
      throw new TaskExpiredError();
    }
    return task;
  }

  async getAuthorizedTasksByIds(
    taskIds: readonly string[],
    authorization: AuthorizationContext,
  ): Promise<TaskRecord[]> {
    if (taskIds.length === 0) return [];
    assertUuidList(taskIds);
    const result = await this.pool.query<TaskRow & { handle_expired: boolean }>(
      `SELECT *,
              (internal_state LIKE 'TERMINAL_%'
               AND handle_expires_at IS NOT NULL
               AND handle_expires_at <= clock_timestamp()) AS handle_expired
       FROM provider_task
       WHERE task_id = ANY($1::uuid[])
         AND authorization_context_hash=$2 AND execution_mode=$3
         AND simulation_id IS NOT DISTINCT FROM $4
       ORDER BY task_id`,
      [taskIds, authorization.hash, authorization.executionMode, authorization.simulationId],
    );
    return result.rows.filter((row) => row.expired_at === null && !row.handle_expired).map(fromRow);
  }

  async getById(taskId: string): Promise<TaskRecord | null> {
    return selectTaskById(this.pool, taskId);
  }

  async listAdmissionsForRecovery(limit = 128): Promise<AdmissionIntentRecord[]> {
    const result = await this.pool.query<{ task_id: string }>(
      `SELECT task_id FROM admission_intent
       WHERE state IN ('PENDING','UNCERTAIN')
       ORDER BY updated_at, task_id LIMIT $1`,
      [limit],
    );
    const records = await Promise.all(result.rows.map((row) => this.getAdmission(row.task_id)));
    return records.filter((record): record is AdmissionIntentRecord => record !== null);
  }

  async listTasksForRecovery(limit = 256): Promise<TaskRecord[]> {
    const result = await this.pool.query<TaskRow>(
      `SELECT * FROM provider_task
       WHERE internal_state NOT LIKE 'TERMINAL_%' AND internal_state <> 'SCHEDULED'
         AND next_recovery_at <= clock_timestamp()
       ORDER BY next_recovery_at, last_reconciled_at NULLS FIRST, task_id LIMIT $1`,
      [limit],
    );
    return result.rows.map(fromRow);
  }

  async withRecoveryLock<T>(
    taskId: string,
    recover: () => Promise<T>,
    leaseMilliseconds = 30_000,
  ): Promise<T | null> {
    const leaseKey = `sdar-recovery:${taskId}`;
    const ownerId = randomUUID();
    const claimed = await this.pool.query(
      `INSERT INTO runtime_lease(lease_key, owner_id, fencing_token, expires_at)
       VALUES ($1,$2,1,clock_timestamp() + ($3::text || ' milliseconds')::interval)
       ON CONFLICT (lease_key) DO UPDATE SET
         owner_id=EXCLUDED.owner_id,
         fencing_token=runtime_lease.fencing_token+1,
         expires_at=EXCLUDED.expires_at,
         updated_at=clock_timestamp()
       WHERE runtime_lease.expires_at <= clock_timestamp()
       RETURNING lease_key`,
      [leaseKey, ownerId, leaseMilliseconds],
    );
    if (claimed.rowCount !== 1) return null;
    try {
      return await recover();
    } finally {
      await this.pool.query("DELETE FROM runtime_lease WHERE lease_key=$1 AND owner_id=$2", [
        leaseKey,
        ownerId,
      ]);
    }
  }

  async claimDueCommands(
    now: Date,
    ownerId: string,
    leaseMilliseconds = 30_000,
    limit = 32,
  ): Promise<PendingCommandRecord[]> {
    // Rank candidates with a window function first, then lock base-table rows.
    // PostgreSQL rejects FOR UPDATE when the locking SELECT itself uses window functions.
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const superseded = await client.query<PendingCommandRecordRow>(
        `UPDATE task_command command
            SET state='EXHAUSTED', claim_owner=NULL, claim_until=NULL,
                last_error_code='SUPERSEDED_BY_SAFE_STOP',
                last_error_message='Safe stop superseded the pending command.',
                updated_at=clock_timestamp()
           FROM provider_task
          WHERE provider_task.task_id=command.task_id
            AND provider_task.cancel_requested IS TRUE
            AND command.command_type IN ('UPDATE','PAUSE','RESUME')
            AND command.state='CLAIMED'
            AND command.claim_until <= GREATEST($1,clock_timestamp())
         RETURNING command.task_id, command.command_sequence, command.command_type,
           command.payload, command.state, command.attempt_count, command.claim_owner,
           command.stop_reason, command.adapter_ack, command.next_attempt_at,
           command.last_error_code, command.last_error_message, command.claim_until`,
        [now],
      );
      for (const row of superseded.rows) {
        if (row.command_type === "UPDATE") {
          await markAssignedInputResponsesIgnored(
            client,
            row.task_id,
            Number(row.command_sequence),
          );
        }
        await insertCommandFact(
          client,
          row.task_id,
          {
            sequence: Number(row.command_sequence),
            commandType: row.command_type,
            state: "EXHAUSTED",
            attemptCount: row.attempt_count,
          },
          "task.command.superseded",
          {
            previousState: "CLAIMED",
            reasonCode: "SUPERSEDED_BY_SAFE_STOP",
            adapterRpcStatus: "not_dispatched",
          },
        );
      }
      const result = await client.query<PendingCommandRecordRow>(
        `WITH ranked AS (
         SELECT task_command.task_id, task_command.command_sequence,
                ROW_NUMBER() OVER (
                  PARTITION BY task_command.task_id
                  ORDER BY task_command.priority DESC, task_command.next_attempt_at,
                    task_command.created_at, task_command.command_sequence
                ) AS rank
         FROM task_command
         JOIN provider_task
           ON provider_task.task_id = task_command.task_id
         WHERE task_command.command_type IN ('CANCEL','UPDATE','PAUSE','RESUME')
           AND (
             (task_command.state IN ('PENDING','RETRY_WAIT')
              AND task_command.next_attempt_at <= GREATEST($1,clock_timestamp())
              AND (task_command.command_type='CANCEL' OR provider_task.cancel_requested IS NOT TRUE))
             OR (
               task_command.state='CLAIMED'
               AND task_command.claim_until <= GREATEST($1,clock_timestamp())
               AND (task_command.command_type='CANCEL' OR provider_task.cancel_requested IS NOT TRUE)
             )
           )
           AND NOT EXISTS (
             SELECT 1 FROM task_command in_flight
             WHERE in_flight.task_id = task_command.task_id
               AND in_flight.state = 'CLAIMED'
               AND in_flight.claim_until > GREATEST($1,clock_timestamp())
               AND in_flight.command_sequence <> task_command.command_sequence
           )
       ),
       candidates AS (
         SELECT task_id, command_sequence
         FROM ranked
         WHERE rank = 1
         ORDER BY task_id
         LIMIT $4
       ),
       due AS (
         SELECT task_command.task_id, task_command.command_sequence,
                task_command.state AS previous_state
         FROM task_command
         INNER JOIN candidates
           ON candidates.task_id = task_command.task_id
          AND candidates.command_sequence = task_command.command_sequence
         WHERE (task_command.state IN ('PENDING','RETRY_WAIT')
                AND task_command.next_attempt_at <= GREATEST($1,clock_timestamp()))
            OR (
              task_command.state = 'CLAIMED'
              AND task_command.claim_until <= GREATEST($1,clock_timestamp())
            )
         FOR UPDATE OF task_command SKIP LOCKED
       )
       UPDATE task_command command SET state='CLAIMED', claim_owner=$2,
         claim_until=GREATEST($1,clock_timestamp()) + ($3::text || ' milliseconds')::interval,
         attempt_count=attempt_count+1, updated_at=clock_timestamp()
       FROM due WHERE command.task_id=due.task_id
         AND command.command_sequence=due.command_sequence
       RETURNING command.task_id, command.command_sequence, command.command_type,
         command.payload, command.state, command.attempt_count, command.claim_owner,
         command.stop_reason, command.adapter_ack, command.next_attempt_at,
         command.last_error_code, command.last_error_message, command.claim_until,
         due.previous_state`,
        [now, ownerId, leaseMilliseconds, limit],
      );
      const commands = result.rows.map((row) => ({
        ...mapPendingCommandRecord(row),
      }));
      for (const [index, command] of commands.entries()) {
        const previousState = result.rows[index]?.previous_state;
        await insertCommandFact(
          client,
          command.taskId,
          {
            sequence: command.commandSequence,
            commandType: command.commandType,
            state: "CLAIMED",
            attemptCount: command.attemptCount,
          },
          "task.command.claimed",
          {
            ...(previousState === undefined ? {} : { previousState }),
            adapterRpcStatus: "not_started",
          },
        );
      }
      await client.query("COMMIT");
      return commands;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const databaseError = error as { code?: string; constraint?: string };
      if (
        databaseError.code === "23505" &&
        databaseError.constraint === "task_command_one_claimed_per_task_idx"
      ) {
        return [];
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async claimDueCancelCommands(
    now: Date,
    ownerId: string,
    leaseMilliseconds = 30_000,
    limit = 32,
  ): Promise<PendingCommandRecord[]> {
    const all = await this.claimDueCommands(now, ownerId, leaseMilliseconds, limit);
    return all.filter((command) => command.commandType === "CANCEL");
  }

  async listPendingCommands(taskId: string): Promise<PendingCommandRecord[]> {
    const result = await this.pool.query<PendingCommandRecordRow>(
      `SELECT task_id, command_sequence, command_type, payload, state, attempt_count,
              claim_owner, stop_reason, adapter_ack, claim_until
       FROM task_command WHERE task_id=$1 AND state IN ('PENDING','CLAIMED','RETRY_WAIT')
       ORDER BY command_sequence`,
      [taskId],
    );
    return result.rows.map((row) => ({
      ...mapPendingCommandRecord(row),
    }));
  }

  async retryClaimedCommand(
    command: PendingCommandRecord,
    nextAttemptAt: Date,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE task_command SET state='RETRY_WAIT', next_attempt_at=$4,
         claim_owner=NULL, claim_until=NULL, last_error_code=$5,
         last_error_message=$6, updated_at=clock_timestamp()
       WHERE task_id=$1 AND command_sequence=$2 AND state='CLAIMED' AND claim_owner=$3`,
        [
          command.taskId,
          command.commandSequence,
          command.claimOwner,
          nextAttemptAt,
          errorCode,
          errorMessage,
        ],
      );
      if (result.rowCount !== 1) throw new Error("COMMAND_CLAIM_LOST");
      await insertCommandFact(
        client,
        command.taskId,
        {
          sequence: command.commandSequence,
          commandType: command.commandType,
          state: "RETRY_WAIT",
          attemptCount: command.attemptCount,
        },
        "task.command.retry_scheduled",
        {
          previousState: "CLAIMED",
          reasonCode: errorCode,
          retryAfterMs: Math.max(0, nextAttemptAt.getTime() - Date.now()),
          adapterRpcStatus: "error",
        },
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordCommandStarted(command: PendingCommandRecord): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query(
        `SELECT 1 FROM task_command
         WHERE task_id=$1 AND command_sequence=$2 AND state='CLAIMED' AND claim_owner=$3
         FOR UPDATE`,
        [command.taskId, command.commandSequence, command.claimOwner],
      );
      if (claimed.rowCount !== 1) throw new Error("COMMAND_CLAIM_LOST");
      await insertCommandFact(
        client,
        command.taskId,
        {
          sequence: command.commandSequence,
          commandType: command.commandType,
          state: "CLAIMED",
          attemptCount: command.attemptCount,
        },
        "task.command.started",
        { previousState: "CLAIMED", adapterRpcStatus: "started" },
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async renewCommandClaim(
    command: PendingCommandRecord,
    leaseMilliseconds = 30_000,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE task_command
       SET claim_until=clock_timestamp() + ($4::text || ' milliseconds')::interval,
           updated_at=clock_timestamp()
       WHERE task_id=$1 AND command_sequence=$2 AND state='CLAIMED' AND claim_owner=$3`,
      [command.taskId, command.commandSequence, command.claimOwner, leaseMilliseconds],
    );
    if (result.rowCount !== 1) throw new Error("COMMAND_CLAIM_LOST");
  }

  async rejectClaimedCommand(
    command: PendingCommandRecord,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE task_command SET state='REJECTED', claim_owner=NULL, claim_until=NULL,
         last_error_code=$4, last_error_message=$5, updated_at=clock_timestamp()
       WHERE task_id=$1 AND command_sequence=$2 AND state='CLAIMED' AND claim_owner=$3`,
        [command.taskId, command.commandSequence, command.claimOwner, errorCode, errorMessage],
      );
      if (result.rowCount !== 1) throw new Error("COMMAND_CLAIM_LOST");
      if (command.commandType === "UPDATE") {
        await client.query(
          `UPDATE task_input_response_inbox
           SET state='FAILED', failed_at=clock_timestamp(), updated_at=clock_timestamp(),
               last_error_code='INPUT_RESPONSE_REJECTED', last_error_message=$3
           WHERE task_id=$1 AND command_sequence=$2 AND state='ASSIGNED'`,
          [command.taskId, command.commandSequence, errorMessage],
        );
      }
      await insertCommandFact(
        client,
        command.taskId,
        {
          sequence: command.commandSequence,
          commandType: command.commandType,
          state: "REJECTED",
          attemptCount: command.attemptCount,
        },
        "task.command.rejected",
        {
          previousState: "CLAIMED",
          reasonCode: errorCode,
          adapterRpcStatus: "rejected",
        },
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async rejectInputResponseAndFailTask(
    command: PendingCommandRecord,
    reasonCode: string,
    message: string,
  ): Promise<"failed" | "task_terminal" | "superseded_by_safe_stop"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const lockedTask = await client.query<TaskRow>(
        "SELECT * FROM provider_task WHERE task_id=$1 FOR UPDATE",
        [command.taskId],
      );
      const task = lockedTask.rows[0];
      if (task === undefined) throw new Error("TASK_NOT_FOUND");
      const claimed = await client.query(
        `SELECT 1 FROM task_command
         WHERE task_id=$1 AND command_sequence=$2 AND command_type='UPDATE'
           AND state='CLAIMED' AND claim_owner=$3
         FOR UPDATE`,
        [command.taskId, command.commandSequence, command.claimOwner],
      );
      if (claimed.rowCount !== 1) throw new Error("COMMAND_CLAIM_LOST");

      const terminal = isTerminalState(task.internal_state);
      const safeStop =
        task.cancel_requested || task.stop_reason !== null || task.internal_state === "STOPPING";
      const disposition = terminal
        ? "task_terminal"
        : safeStop
          ? "superseded_by_safe_stop"
          : "failed";
      const commandCode = terminal
        ? "TASK_TERMINAL"
        : safeStop
          ? "SUPERSEDED_BY_SAFE_STOP"
          : reasonCode;
      const commandState = disposition === "failed" ? "REJECTED" : "EXHAUSTED";

      await client.query(
        `UPDATE task_command
         SET state=$4, claim_owner=NULL, claim_until=NULL, last_error_code=$5,
             last_error_message=$6, updated_at=clock_timestamp()
         WHERE task_id=$1 AND command_sequence=$2 AND state='CLAIMED' AND claim_owner=$3`,
        [
          command.taskId,
          command.commandSequence,
          command.claimOwner,
          commandState,
          commandCode,
          disposition === "failed" ? message : "Input response was superseded by task state.",
        ],
      );
      const responseKeys = Object.keys(
        (command.payload.inputResponses as Record<string, unknown> | undefined) ?? {},
      );
      if (responseKeys.length > 0 && !terminal) {
        await client.query(
          `UPDATE task_input_request SET status='SUPERSEDED'
           WHERE task_id=$1 AND request_key=ANY($2::text[]) AND status='OPEN'`,
          [command.taskId, responseKeys],
        );
      }
      const inboxState = disposition === "failed" ? "FAILED" : "IGNORED";
      await client.query(
        `UPDATE task_input_response_inbox
         SET state=$3, failed_at=CASE WHEN $3='FAILED' THEN clock_timestamp() ELSE failed_at END,
             updated_at=clock_timestamp(), last_error_code=$4, last_error_message=$5
         WHERE task_id=$1 AND command_sequence=$2 AND state='ASSIGNED'`,
        [
          command.taskId,
          command.commandSequence,
          inboxState,
          disposition === "failed" ? "INPUT_RESPONSE_REJECTED" : commandCode,
          disposition === "failed"
            ? "Input response was rejected."
            : "Input response was superseded by task state.",
        ],
      );
      if (!terminal && !safeStop) {
        await transitionTask(client, {
          taskId: command.taskId,
          expectedVersion: Number(task.version),
          update: {
            internalState: "TERMINAL_FAILED",
            mcpStatus: "failed",
            substate: null,
            statusMessage: "Input response was rejected.",
            result: null,
            error: {
              code: -32603,
              message: "Input response was rejected.",
              data: { reasonCode: "INPUT_RESPONSE_REJECTED" },
            },
          },
          observation: {
            type: "task.failed",
            occurredAt: new Date(),
            reasonCode: "INPUT_RESPONSE_REJECTED",
            message: "Input response was rejected.",
            substate: null,
            source: "runtime",
            payload: { commandSequence: command.commandSequence },
          },
          outboxType: "task.failed",
          eventKey: `${command.taskId}:command:${String(command.commandSequence)}:input-rejected`,
          outboxPayload: {
            commandSequence: command.commandSequence,
            reasonCode: "INPUT_RESPONSE_REJECTED",
          },
        });
      }
      await insertCommandFact(
        client,
        command.taskId,
        {
          sequence: command.commandSequence,
          commandType: command.commandType,
          state: commandState,
          attemptCount: command.attemptCount,
        },
        disposition === "failed" ? "task.command.rejected" : "task.command.superseded",
        {
          previousState: "CLAIMED",
          reasonCode: commandCode,
          adapterRpcStatus: disposition === "failed" ? "rejected" : "not_dispatched",
        },
      );
      await client.query("COMMIT");
      return disposition;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async failInputResponseDelivery(command: PendingCommandRecord, message: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const lockedTask = await client.query<TaskRow>(
        "SELECT * FROM provider_task WHERE task_id=$1 FOR UPDATE",
        [command.taskId],
      );
      const task = lockedTask.rows[0];
      if (task === undefined) throw new Error("TASK_NOT_FOUND");
      const terminal = isTerminalState(task.internal_state);
      const safeStop =
        task.cancel_requested || task.stop_reason !== null || task.internal_state === "STOPPING";
      const commandCode = terminal
        ? "TASK_TERMINAL"
        : safeStop
          ? "SUPERSEDED_BY_SAFE_STOP"
          : "INPUT_RESPONSE_DELIVERY_EXHAUSTED";
      const exhausted = await client.query(
        `UPDATE task_command
         SET state='EXHAUSTED', claim_owner=NULL, claim_until=NULL,
             last_error_code=$4, last_error_message=$5,
             updated_at=clock_timestamp()
         WHERE task_id=$1 AND command_sequence=$2 AND state='CLAIMED' AND claim_owner=$3`,
        [command.taskId, command.commandSequence, command.claimOwner, commandCode, message],
      );
      if (exhausted.rowCount !== 1) throw new Error("COMMAND_CLAIM_LOST");
      const responseKeys = Object.keys(
        (command.payload.inputResponses as Record<string, unknown> | undefined) ?? {},
      );
      if (responseKeys.length > 0 && !terminal) {
        await client.query(
          `UPDATE task_input_request SET status='SUPERSEDED'
           WHERE task_id=$1 AND request_key=ANY($2::text[]) AND status='OPEN'`,
          [command.taskId, responseKeys],
        );
      }
      await client.query(
        `UPDATE task_input_response_inbox
         SET state=$3, failed_at=CASE WHEN $3='FAILED' THEN clock_timestamp() ELSE failed_at END,
             updated_at=clock_timestamp(), last_error_code=$4, last_error_message=$5
         WHERE task_id=$1 AND command_sequence=$2 AND state='ASSIGNED'`,
        [
          command.taskId,
          command.commandSequence,
          terminal || safeStop ? "IGNORED" : "FAILED",
          commandCode,
          message,
        ],
      );
      if (!terminal && !safeStop) {
        await transitionTask(client, {
          taskId: command.taskId,
          expectedVersion: Number(task.version),
          update: {
            internalState: "TERMINAL_FAILED",
            mcpStatus: "failed",
            substate: null,
            statusMessage: "Input response delivery exhausted.",
            result: null,
            error: {
              code: -32603,
              message: "Input response delivery exhausted.",
              data: { reasonCode: "INPUT_RESPONSE_DELIVERY_EXHAUSTED" },
            },
          },
          observation: {
            type: "task.failed",
            occurredAt: new Date(),
            reasonCode: "INPUT_RESPONSE_DELIVERY_EXHAUSTED",
            message: "Input response delivery exhausted.",
            substate: null,
            source: "runtime",
            payload: { commandSequence: command.commandSequence },
          },
          outboxType: "task.failed",
          eventKey: `${command.taskId}:command:${String(command.commandSequence)}:input-delivery-exhausted`,
          outboxPayload: {
            commandSequence: command.commandSequence,
            reasonCode: "INPUT_RESPONSE_DELIVERY_EXHAUSTED",
          },
        });
      }
      await insertCommandFact(
        client,
        command.taskId,
        {
          sequence: command.commandSequence,
          commandType: command.commandType,
          state: "EXHAUSTED",
          attemptCount: command.attemptCount,
        },
        "task.command.exhausted",
        {
          previousState: "CLAIMED",
          reasonCode: commandCode,
          adapterRpcStatus: "error",
        },
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async noteRecovery(taskId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<TaskRow>(
        "SELECT * FROM provider_task WHERE task_id=$1 FOR UPDATE",
        [taskId],
      );
      const row = locked.rows[0];
      if (row === undefined) throw new Error("TASK_NOT_FOUND");
      const attempt = row.recovery_attempts + 1;
      const now = new Date();
      await transitionTask(client, {
        taskId,
        expectedVersion: Number(row.version),
        update: {
          recoveryAttempts: attempt,
          lastReconciledAt: now,
          nextRecoveryAt: now,
          recoveryFailureCount: 0,
        },
        observation: {
          type: "task.recovery",
          occurredAt: now,
          reasonCode: "RECONCILED",
          message: "Task reconciled with the Adapter.",
          substate: row.substate,
          source: "runtime",
          payload: { recoveryAttempt: attempt },
        },
        outboxType: "task.recovery",
        eventKey: `${taskId}:recovery:${String(attempt)}`,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async noteRecoveryFailure(taskId: string, failedAt = new Date()): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        recovery_failure_count: number;
        recovery_attempts: number;
        next_recovery_at: Date;
      }>(
        `UPDATE provider_task
       SET recovery_failure_count=recovery_failure_count+1,
           next_recovery_at=$2 + (
             LEAST(300000, 1000 * power(2, LEAST(recovery_failure_count, 8))) +
             mod(hashtext(task_id::text)::bigint + 2147483648, 251)
           ) * interval '1 millisecond',
           updated_at=clock_timestamp()
       WHERE task_id=$1 AND internal_state NOT LIKE 'TERMINAL_%'
       RETURNING recovery_failure_count,recovery_attempts,next_recovery_at`,
        [taskId, failedAt],
      );
      const row = result.rows[0];
      if (row !== undefined) {
        await captureTaskOperationalEvent(client, taskId, {
          recordType: "provider.recovery.lifecycle",
          eventType: "reconcile_failed",
          eventIdentity: `${taskId}:recovery-failed:${String(row.recovery_failure_count)}`,
          occurredAt: failedAt,
          payload: {
            event: "reconcile",
            taskId,
            recoveryAttempt: row.recovery_attempts,
            outcome: "deferred",
            reasonCode: "RECOVERY_DEFERRED",
            nextRecoveryAt: row.next_recovery_at.toISOString(),
          },
        });
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordIdentityConflict(taskId: string, detail: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const task = await client.query<TaskRow>(
        "SELECT * FROM provider_task WHERE task_id=$1 FOR UPDATE",
        [taskId],
      );
      const row = task.rows[0];
      if (row === undefined) throw new Error("TASK_NOT_FOUND");
      const eventKey = `${taskId}:identity-conflict:${createHash("sha256").update(detail).digest("hex")}`;
      await insertOutbox(
        client,
        taskId,
        "task.identity_conflict",
        {
          taskId,
          audit: true,
          reasonCode: "ADAPTER_IDENTITY_MISMATCH",
          detail,
          internalState: row.internal_state,
          status: row.mcp_status,
          substate: row.substate,
          statusMessage: row.status_message,
          observationRevision: Number(row.observation_revision),
          adapterRevision: Number(row.adapter_revision),
        },
        eventKey,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async failRecoveryNotFound(taskId: string, message: string): Promise<TaskRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<TaskRow>(
        "SELECT * FROM provider_task WHERE task_id=$1 FOR UPDATE",
        [taskId],
      );
      const row = locked.rows[0];
      if (row === undefined) throw new Error("TASK_NOT_FOUND");
      if (isTerminalState(row.internal_state)) {
        await client.query("COMMIT");
        return fromRow(row);
      }
      const error = { code: -32603, message, data: { reasonCode: "EXECUTION_NOT_FOUND" } };
      const attempt = row.recovery_attempts + 1;
      const now = new Date();
      const applied = await transitionTask(client, {
        taskId,
        expectedVersion: Number(row.version),
        update: {
          internalState: "TERMINAL_FAILED",
          mcpStatus: "failed",
          substate: null,
          statusMessage: message,
          result: null,
          error,
          recoveryAttempts: attempt,
          lastReconciledAt: now,
        },
        observation: {
          type: "task.failed",
          occurredAt: now,
          reasonCode: "EXECUTION_NOT_FOUND",
          message,
          substate: null,
          source: "runtime",
          payload: { recoveryAttempt: attempt },
        },
        outboxType: "task.failed",
        eventKey: `${taskId}:recovery-failed:${String(attempt)}`,
        outboxPayload: { reasonCode: "EXECUTION_NOT_FOUND" },
      });
      await client.query("COMMIT");
      return fromRow(applied.row);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async claimDueScheduled(
    now: Date,
    ownerId: string,
    leaseMilliseconds = 30_000,
    limit = 32,
  ): Promise<TaskRecord[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const due = await client.query<TaskRow>(
        `SELECT * FROM provider_task
         WHERE external_execution_id IS NULL AND internal_state='SCHEDULED'
           AND not_before <= $1 AND COALESCE(next_start_attempt_at,not_before) <= $1
           AND latest_start_at > $1
         ORDER BY COALESCE(next_start_attempt_at,not_before), task_id
         FOR UPDATE SKIP LOCKED LIMIT $2`,
        [now, limit],
      );
      const claimed: TaskRecord[] = [];
      for (const row of due.rows) {
        const attempt = row.invocation_attempt + 1;
        const applied = await transitionTask(client, {
          taskId: row.task_id,
          expectedVersion: Number(row.version),
          update: {
            internalState: "STARTING",
            statusMessage: "Claimed for scheduled start.",
            scheduleClaimOwner: ownerId,
            scheduleClaimUntil: new Date(now.getTime() + leaseMilliseconds),
            invocationAttempt: attempt,
            nextStartAttemptAt: null,
          },
          observation: {
            type: "task.start_attempt",
            occurredAt: now,
            reasonCode: "START_ATTEMPT_CLAIMED",
            message: "Claimed for scheduled start.",
            substate: row.substate,
            source: "runtime",
            payload: { invocationAttempt: attempt },
          },
          outboxType: "task.start_attempt",
          eventKey: `${row.task_id}:start-attempt:${String(attempt)}`,
          outboxPayload: { invocationAttempt: attempt },
        });
        claimed.push(fromRow(applied.row));
      }
      await client.query("COMMIT");
      return claimed;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async completeDueStartWindowMisses(now: Date, limit = 32): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const due = await client.query<{ task_id: string }>(
        `SELECT task_id FROM provider_task
         WHERE internal_state='SCHEDULED' AND external_execution_id IS NULL
           AND latest_start_at <= $1
         ORDER BY latest_start_at, task_id FOR UPDATE SKIP LOCKED LIMIT $2`,
        [now, limit],
      );
      for (const row of due.rows) {
        const transition = startWindowMissedTransition(now);
        await transitionTask(client, {
          taskId: row.task_id,
          update: {
            internalState: transition.internalState,
            mcpStatus: transition.mcpStatus,
            substate: transition.substate,
            statusMessage: transition.statusMessage,
            result: transition.result,
            error: null,
            scheduleClaimOwner: null,
            scheduleClaimUntil: null,
            nextStartAttemptAt: null,
          },
          observation: {
            type: "task.completed",
            occurredAt: now,
            reasonCode: "START_WINDOW_MISSED",
            message: transition.statusMessage,
            substate: null,
            source: "runtime",
          },
          outboxType: "task.completed",
          eventKey: `${row.task_id}:start-window-missed`,
          outboxPayload: { reasonCode: "START_WINDOW_MISSED", safeStopRequired: false },
        });
      }
      await client.query("COMMIT");
      return due.rowCount ?? 0;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async claimExpiredScheduledStarts(
    now: Date,
    ownerId: string,
    leaseMilliseconds = 30_000,
    limit = 32,
  ): Promise<TaskRecord[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const due = await client.query<TaskRow>(
        `SELECT * FROM provider_task
         WHERE external_execution_id IS NULL AND internal_state='STARTING'
           AND schedule_claim_until <= $1
         ORDER BY schedule_claim_until, task_id FOR UPDATE SKIP LOCKED LIMIT $2`,
        [now, limit],
      );
      const claimed: TaskRecord[] = [];
      for (const row of due.rows) {
        const previousLease = row.schedule_claim_until?.toISOString() ?? "none";
        const applied = await transitionTask(client, {
          taskId: row.task_id,
          expectedVersion: Number(row.version),
          update: {
            scheduleClaimOwner: ownerId,
            scheduleClaimUntil: new Date(now.getTime() + leaseMilliseconds),
            statusMessage: "Reconciling an uncertain scheduled start.",
          },
          observation: {
            type: "task.recovery",
            occurredAt: now,
            reasonCode: "START_RECONCILE_CLAIMED",
            message: "Reconciling an uncertain scheduled start.",
            substate: row.substate,
            source: "runtime",
            payload: { invocationAttempt: row.invocation_attempt },
          },
          outboxType: "task.recovery",
          eventKey: `${row.task_id}:start-reconcile:${String(row.invocation_attempt)}:${previousLease}`,
        });
        claimed.push(fromRow(applied.row));
      }
      await client.query("COMMIT");
      return claimed;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async renewScheduleClaim(
    taskId: string,
    claimOwner: string,
    leaseMilliseconds = 30_000,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE provider_task
       SET schedule_claim_until=clock_timestamp() + ($3::text || ' milliseconds')::interval,
           updated_at=clock_timestamp()
       WHERE task_id=$1 AND internal_state='STARTING' AND schedule_claim_owner=$2`,
      [taskId, claimOwner, leaseMilliseconds],
    );
    if (result.rowCount !== 1) throw new Error("SCHEDULED_TASK_CLAIM_LOST");
  }

  async acceptScheduled(
    taskId: string,
    claimOwner: string,
    externalExecutionId: string,
    adapterRevision: number,
    transition: SnapshotTransition,
    adapterResponse: Record<string, unknown>,
    inputRequests: NewInputRequest[] = [],
    startWindowMissedAt?: Date,
    actualStartedAt?: Date | null,
  ): Promise<TaskRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<TaskRow>(
        `SELECT * FROM provider_task WHERE task_id=$1 AND internal_state='STARTING'
         AND schedule_claim_owner=$2 FOR UPDATE`,
        [taskId, claimOwner],
      );
      const row = locked.rows[0];
      if (row === undefined) throw new Error("SCHEDULED_TASK_CLAIM_LOST");
      await transitionTask(client, {
        taskId,
        expectedVersion: Number(row.version),
        update: {
          externalExecutionId,
          internalState: transition.internalState,
          mcpStatus: transition.mcpStatus,
          substate: transition.substate,
          statusMessage: transition.statusMessage,
          result: transition.result,
          error: transition.error,
          adapterRevision,
          actualStartedAt: row.actual_started_at ?? actualStartedAt ?? null,
          scheduleClaimOwner: null,
          scheduleClaimUntil: null,
        },
        observation: {
          type: stableObservationType(transition),
          occurredAt: new Date(),
          reasonCode: reasonCodeFromTransition(transition),
          message: transition.statusMessage,
          substate: transition.substate,
          source: "adapter",
          adapterRevision,
        },
        outboxType: stableObservationType(transition),
        eventKey: `${taskId}:adapter:${String(adapterRevision)}`,
        outboxPayload: { invocationAttempt: row.invocation_attempt },
      });
      if (startWindowMissedAt !== undefined) {
        await persistStartWindowStop(client, taskId, startWindowMissedAt);
      }
      await upsertInputRequests(client, taskId, inputRequests);
      await client.query(
        `UPDATE admission_intent SET state='PUBLISHED', adapter_response=$2::jsonb,
         updated_at=clock_timestamp() WHERE task_id=$1`,
        [taskId, JSON.stringify(adapterResponse)],
      );
      await client.query("COMMIT");
      const visible = await selectTaskById(client, taskId);
      if (visible === null) throw new Error("SCHEDULED_TASK_NOT_VISIBLE_AFTER_COMMIT");
      return visible;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseScheduleRetry(
    taskId: string,
    claimOwner: string,
    nextAttemptAt: Date,
    message: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<TaskRow>(
        `SELECT * FROM provider_task WHERE task_id=$1 AND internal_state='STARTING'
         AND schedule_claim_owner=$2 FOR UPDATE`,
        [taskId, claimOwner],
      );
      const row = locked.rows[0];
      if (row === undefined) throw new Error("SCHEDULED_TASK_CLAIM_LOST");
      await transitionTask(client, {
        taskId,
        expectedVersion: Number(row.version),
        update: {
          internalState: "SCHEDULED",
          substate: "scheduled",
          statusMessage: message,
          scheduleClaimOwner: null,
          scheduleClaimUntil: null,
          nextStartAttemptAt: nextAttemptAt,
        },
        observation: {
          type: "task.start_retry",
          occurredAt: new Date(),
          reasonCode: "START_RETRY_SCHEDULED",
          message,
          substate: "scheduled",
          source: "runtime",
          payload: {
            invocationAttempt: row.invocation_attempt,
            nextStartAttemptAt: nextAttemptAt.toISOString(),
          },
        },
        outboxType: "task.start_retry",
        eventKey: `${taskId}:start-retry:${String(row.invocation_attempt)}`,
        outboxPayload: { nextStartAttemptAt: nextAttemptAt.toISOString() },
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async markScheduleResponseUncertain(
    taskId: string,
    claimOwner: string,
    reconcileAt: Date,
    message: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<TaskRow>(
        `SELECT * FROM provider_task WHERE task_id=$1 AND internal_state='STARTING'
         AND schedule_claim_owner=$2 FOR UPDATE`,
        [taskId, claimOwner],
      );
      const row = locked.rows[0];
      if (row === undefined) throw new Error("SCHEDULED_TASK_CLAIM_LOST");
      await transitionTask(client, {
        taskId,
        expectedVersion: Number(row.version),
        update: {
          statusMessage: message,
          scheduleClaimOwner: null,
          scheduleClaimUntil: reconcileAt,
        },
        observation: {
          type: "task.start_uncertain",
          occurredAt: new Date(),
          reasonCode: "START_RESPONSE_UNCERTAIN",
          message,
          substate: row.substate,
          source: "runtime",
          payload: {
            invocationAttempt: row.invocation_attempt,
            reconcileAt: reconcileAt.toISOString(),
          },
        },
        outboxType: "task.start_uncertain",
        eventKey: `${taskId}:start-uncertain:${String(row.invocation_attempt)}:${reconcileAt.toISOString()}`,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async deferScheduleReconcile(
    taskId: string,
    claimOwner: string,
    reconcileAt: Date,
    message: string,
  ): Promise<void> {
    return this.markScheduleResponseUncertain(taskId, claimOwner, reconcileAt, message);
  }

  async completeStartWindowMissed(
    taskId: string,
    completedAt: Date,
    claimOwner: string,
  ): Promise<TaskRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<TaskRow>(
        `SELECT * FROM provider_task WHERE task_id=$1 AND external_execution_id IS NULL
         AND internal_state='STARTING' AND schedule_claim_owner=$2 FOR UPDATE`,
        [taskId, claimOwner],
      );
      const row = locked.rows[0];
      if (row === undefined) throw new Error("SCHEDULED_TASK_NOT_COMPLETED");
      const transition = startWindowMissedTransition(completedAt);
      const applied = await transitionTask(client, {
        taskId,
        expectedVersion: Number(row.version),
        update: {
          internalState: transition.internalState,
          mcpStatus: transition.mcpStatus,
          substate: null,
          statusMessage: transition.statusMessage,
          result: transition.result,
          error: null,
          scheduleClaimOwner: null,
          scheduleClaimUntil: null,
          nextStartAttemptAt: null,
        },
        observation: {
          type: "task.completed",
          occurredAt: completedAt,
          reasonCode: "START_WINDOW_MISSED",
          message: transition.statusMessage,
          substate: null,
          source: "runtime",
        },
        outboxType: "task.completed",
        eventKey: `${taskId}:start-window-missed`,
        outboxPayload: { reasonCode: "START_WINDOW_MISSED", safeStopRequired: false },
      });
      await client.query("COMMIT");
      return fromRow(applied.row);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async completeScheduledRejection(
    taskId: string,
    claimOwner: string,
    completedAt: Date,
    reasonCode: string,
    message: string,
    retryable: boolean,
  ): Promise<TaskRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const transition: SnapshotTransition = {
        internalState: "TERMINAL_COMPLETED",
        mcpStatus: "completed",
        substate: null,
        statusMessage: message,
        result: admissionRejectedResult(completedAt, reasonCode, message, retryable),
        error: null,
        terminal: true,
        observationType: "task.admission_rejected",
      };
      const locked = await client.query<TaskRow>(
        `SELECT * FROM provider_task WHERE task_id=$1 AND internal_state='STARTING'
         AND schedule_claim_owner=$2 FOR UPDATE`,
        [taskId, claimOwner],
      );
      const row = locked.rows[0];
      if (row === undefined) throw new Error("SCHEDULED_REJECTION_NOT_COMPLETED");
      const applied = await transitionTask(client, {
        taskId,
        expectedVersion: Number(row.version),
        update: {
          internalState: transition.internalState,
          mcpStatus: transition.mcpStatus,
          substate: null,
          statusMessage: message,
          result: transition.result,
          error: null,
          scheduleClaimOwner: null,
          scheduleClaimUntil: null,
          nextStartAttemptAt: null,
        },
        observation: {
          type: "task.completed",
          occurredAt: completedAt,
          reasonCode,
          message,
          substate: null,
          source: "runtime",
        },
        outboxType: "task.completed",
        eventKey: `${taskId}:admission-rejected:${String(row.invocation_attempt)}`,
        outboxPayload: { reasonCode, retryable, outcome: "admission_rejected" },
      });
      await client.query("COMMIT");
      return fromRow(applied.row);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async requestStartWindowStop(taskId: string, requestedAt: Date): Promise<TaskRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<TaskRow>(
        "SELECT * FROM provider_task WHERE task_id=$1 FOR UPDATE",
        [taskId],
      );
      const row = locked.rows[0];
      if (row === undefined) throw new Error("TASK_NOT_FOUND");
      if (isTerminalState(row.internal_state)) {
        await client.query("COMMIT");
        return fromRow(row);
      }
      if (row.external_execution_id === null) {
        throw new Error("START_WINDOW_STOP_WITHOUT_EXECUTION");
      }
      await persistStartWindowStop(client, taskId, requestedAt);
      await client.query("COMMIT");
      const updated = await selectTaskById(client, taskId);
      if (updated === null) throw new Error("TASK_NOT_FOUND");
      return updated;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async claimBoundStartConfirmations(
    now: Date,
    ownerId: string,
    limit = 32,
    leaseMilliseconds = 30_000,
  ): Promise<TaskRecord[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const due = await client.query<TaskRow>(
        `SELECT * FROM provider_task
         WHERE internal_state NOT LIKE 'TERMINAL_%'
           AND actual_started_at IS NULL
           AND COALESCE(start_confirmation_deadline,latest_start_at) <= $1
           AND external_execution_id IS NOT NULL
           AND stop_reason IS NULL
           AND (schedule_claim_owner IS NULL OR schedule_claim_until <= $1)
         ORDER BY COALESCE(start_confirmation_deadline,latest_start_at), task_id
         FOR UPDATE SKIP LOCKED LIMIT $2`,
        [now, limit],
      );
      const claimed: TaskRecord[] = [];
      for (const row of due.rows) {
        const attempt = row.start_confirmation_attempts + 1;
        const applied = await transitionTask(client, {
          taskId: row.task_id,
          expectedVersion: Number(row.version),
          update: {
            internalState: "WAITING_START_CONFIRMATION",
            mcpStatus: "working",
            statusMessage: "Reconciling bound execution start confirmation.",
            startConfirmationDeadline: row.start_confirmation_deadline ?? row.latest_start_at,
            startConfirmationAttempts: attempt,
            scheduleClaimOwner: ownerId,
            scheduleClaimUntil: new Date(now.getTime() + leaseMilliseconds),
          },
          observation: {
            type: "task.start_confirmation",
            occurredAt: now,
            reasonCode: "START_CONFIRMATION_CLAIMED",
            message: "Reconciling bound execution start confirmation.",
            substate: row.substate,
            source: "runtime",
            payload: { attempt },
          },
          outboxType: "task.start_confirmation",
          eventKey: `${row.task_id}:start-confirmation:${String(attempt)}`,
          outboxPayload: { attempt },
        });
        claimed.push(fromRow(applied.row));
      }
      await client.query("COMMIT");
      return claimed;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async renewStartConfirmationClaim(
    taskId: string,
    claimOwner: string,
    leaseMilliseconds = 30_000,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE provider_task
       SET schedule_claim_until=clock_timestamp() + ($3::text || ' milliseconds')::interval,
           updated_at=clock_timestamp()
       WHERE task_id=$1 AND internal_state='WAITING_START_CONFIRMATION'
         AND schedule_claim_owner=$2`,
      [taskId, claimOwner, leaseMilliseconds],
    );
    if (result.rowCount !== 1) throw new Error("START_CONFIRMATION_CLAIM_LOST");
  }

  async deferStartConfirmation(
    taskId: string,
    claimOwner: string,
    retryAt: Date,
    message: string,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE provider_task
       SET schedule_claim_owner=NULL, schedule_claim_until=$3, status_message=$4,
           updated_at=clock_timestamp(), runtime_updated_at=clock_timestamp(),
           runtime_revision=runtime_revision+1
       WHERE task_id=$1 AND internal_state='WAITING_START_CONFIRMATION'
         AND schedule_claim_owner=$2`,
      [taskId, claimOwner, retryAt, message],
    );
    if (result.rowCount !== 1) throw new Error("START_CONFIRMATION_CLAIM_LOST");
  }

  async confirmBoundExecutionStarted(
    taskId: string,
    claimOwner: string,
    adapterRevision: number,
    transition: SnapshotTransition,
    confirmedAt: Date,
  ): Promise<TaskRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<TaskRow>(
        `SELECT * FROM provider_task WHERE task_id=$1
         AND internal_state='WAITING_START_CONFIRMATION' AND schedule_claim_owner=$2 FOR UPDATE`,
        [taskId, claimOwner],
      );
      const row = locked.rows[0];
      if (row === undefined) throw new Error("START_CONFIRMATION_CLAIM_LOST");
      const applied = await transitionTask(client, {
        taskId,
        expectedVersion: Number(row.version),
        update: {
          internalState: transition.internalState,
          mcpStatus: transition.mcpStatus,
          substate: transition.substate,
          statusMessage: transition.statusMessage,
          result: transition.result,
          error: transition.error,
          adapterRevision: Math.max(adapterRevision, Number(row.adapter_revision)),
          actualStartedAt: confirmedAt,
          scheduleClaimOwner: null,
          scheduleClaimUntil: null,
        },
        observation: {
          type: "task.started",
          occurredAt: confirmedAt,
          reasonCode: "START_CONFIRMED",
          message: transition.statusMessage,
          substate: transition.substate,
          source: "adapter",
          adapterRevision,
        },
        outboxType: "task.started",
        eventKey: `${taskId}:start-confirmed:${String(adapterRevision)}`,
      });
      await client.query("COMMIT");
      return fromRow(applied.row);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async stopUnconfirmedBoundExecution(
    taskId: string,
    claimOwner: string,
    requestedAt: Date,
  ): Promise<TaskRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<TaskRow>(
        `SELECT * FROM provider_task WHERE task_id=$1
         AND internal_state='WAITING_START_CONFIRMATION' AND schedule_claim_owner=$2 FOR UPDATE`,
        [taskId, claimOwner],
      );
      if (locked.rows[0] === undefined) throw new Error("START_CONFIRMATION_CLAIM_LOST");
      await persistStartWindowStop(client, taskId, requestedAt);
      await client.query("COMMIT");
      const updated = await selectTaskById(client, taskId);
      if (updated === null) throw new Error("TASK_NOT_FOUND");
      return updated;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async claimExpiredDeadlines(now: Date, limit = 32): Promise<DeadlineStopRecord[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const expired = await client.query<TaskRow>(
        `SELECT * FROM provider_task
         WHERE deadline_at <= $1 AND stop_reason IS DISTINCT FROM 'DEADLINE_REACHED'
           AND external_execution_id IS NOT NULL
           AND internal_state NOT LIKE 'TERMINAL_%'
         ORDER BY deadline_at, task_id FOR UPDATE SKIP LOCKED LIMIT $2`,
        [now, limit],
      );
      const claimed: DeadlineStopRecord[] = [];
      for (const row of expired.rows) {
        const active = await client.query<{ command_sequence: string }>(
          `SELECT command_sequence FROM task_command
           WHERE task_id=$1 AND command_type='CANCEL'
             AND state IN ('PENDING','CLAIMED','RETRY_WAIT','ACKNOWLEDGED')
           ORDER BY command_sequence DESC LIMIT 1`,
          [row.task_id],
        );
        const activeSequence = active.rows[0]?.command_sequence;
        const commandCreated = activeSequence === undefined;
        let commandSequence = Number(activeSequence);
        if (activeSequence === undefined) {
          const sequence = await client.query<{ next_command_sequence: string }>(
            `UPDATE provider_task SET next_command_sequence=next_command_sequence+1
             WHERE task_id=$1 RETURNING next_command_sequence`,
            [row.task_id],
          );
          commandSequence = Number(sequence.rows[0]?.next_command_sequence);
        }
        if (!Number.isSafeInteger(commandSequence)) throw new Error("DEADLINE_CLAIM_LOST");
        if (activeSequence === undefined) {
          await client.query(
            `INSERT INTO task_command
              (task_id, command_sequence, command_type, request_hash, state, payload,
               stop_reason, priority, previous_internal_state, previous_mcp_status,
               previous_substate, previous_status_message, next_attempt_at)
             VALUES ($1,$2,'CANCEL',$3,'PENDING',$4::jsonb,'DEADLINE_REACHED',100,$5,$6,$7,$8,$9)`,
            [
              row.task_id,
              commandSequence,
              commandHash("DEADLINE_REACHED"),
              JSON.stringify({ reason: "DEADLINE_REACHED" }),
              row.internal_state,
              row.mcp_status,
              row.substate,
              row.status_message,
              now,
            ],
          );
        } else {
          await client.query(
            `UPDATE task_command SET stop_reason='DEADLINE_REACHED', priority=100,
               payload=$3::jsonb, updated_at=clock_timestamp()
             WHERE task_id=$1 AND command_sequence=$2`,
            [row.task_id, commandSequence, JSON.stringify({ reason: "DEADLINE_REACHED" })],
          );
        }
        const applied = await transitionTask(client, {
          taskId: row.task_id,
          expectedVersion: Number(row.version),
          update: {
            internalState: "STOPPING",
            mcpStatus: "working",
            substate: "stopping",
            statusMessage: "Deadline reached; safe stop requested.",
            cancelRequested: true,
            stopReason: "DEADLINE_REACHED",
          },
          observation: {
            type: "task.deadline_stop_requested",
            occurredAt: now,
            reasonCode: "DEADLINE_REACHED",
            message: "Deadline reached; safe stop requested.",
            substate: "stopping",
            source: "runtime",
            payload: { commandSequence },
          },
          outboxType: "task.deadline_stop_requested",
          eventKey: `${row.task_id}:command:${String(commandSequence)}:deadline-stop`,
          outboxPayload: { reasonCode: "DEADLINE_REACHED", commandSequence },
        });
        if (commandCreated) {
          await insertCommandFact(
            client,
            row.task_id,
            {
              sequence: commandSequence,
              commandType: "CANCEL",
              state: "PENDING",
              attemptCount: 0,
            },
            "task.command.created",
            { reasonCode: "DEADLINE_REACHED", adapterRpcStatus: "not_started" },
          );
        }
        claimed.push({ task: fromRow(applied.row), commandSequence });
      }
      await client.query("COMMIT");
      return claimed;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listInputRequests(taskId: string): Promise<InputRequestRecord[]> {
    const result = await this.pool.query<{
      request_key: string;
      description: string;
      schema: Record<string, unknown>;
      required: boolean;
      status: InputRequestRecord["status"];
      answer_hash: string | null;
      request_json: InputRequestRecord["requestJson"];
      response_hash: string | null;
      response_json: Record<string, unknown> | null;
    }>(
      `SELECT request_key, description, schema, required, status, answer_hash,
              request_json, response_hash, response_json
       FROM task_input_request WHERE task_id=$1 ORDER BY created_at, request_key`,
      [taskId],
    );
    return result.rows.map((row) => ({
      key: row.request_key,
      description: row.description,
      schema: row.schema,
      required: row.required,
      status: row.status,
      answerHash: row.answer_hash,
      requestJson: row.request_json,
      responseHash: row.response_hash,
      responseJson: row.response_json,
    }));
  }

  async listInputRequestsByTaskIds(
    taskIds: readonly string[],
  ): Promise<Map<string, InputRequestRecord[]>> {
    const byTaskId = new Map<string, InputRequestRecord[]>();
    for (const taskId of taskIds) byTaskId.set(taskId, []);
    if (taskIds.length === 0) return byTaskId;
    assertUuidList(taskIds);
    const result = await this.pool.query<{
      task_id: string;
      request_key: string;
      description: string;
      schema: Record<string, unknown>;
      required: boolean;
      status: InputRequestRecord["status"];
      answer_hash: string | null;
      request_json: InputRequestRecord["requestJson"];
      response_hash: string | null;
      response_json: Record<string, unknown> | null;
    }>(
      `SELECT task_id, request_key, description, schema, required, status,
              answer_hash, request_json, response_hash, response_json
       FROM task_input_request
       WHERE task_id = ANY($1::uuid[])
       ORDER BY task_id, created_at, request_key`,
      [taskIds],
    );
    for (const row of result.rows) {
      const requests = byTaskId.get(row.task_id) ?? [];
      requests.push({
        key: row.request_key,
        description: row.description,
        schema: row.schema,
        required: row.required,
        status: row.status,
        answerHash: row.answer_hash,
        requestJson: row.request_json,
        responseHash: row.response_hash,
        responseJson: row.response_json,
      });
      byTaskId.set(row.task_id, requests);
    }
    return byTaskId;
  }

  async acceptMcpInputResponses(
    taskId: string,
    authorization: AuthorizationContext,
    inputResponses: Record<string, McpInputResponse>,
    validateLockedResponse: ValidateLockedInputResponse = () => undefined,
  ): Promise<InputResponseAcceptance> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const lockedTask = await client.query<TaskRow & { handle_expired: boolean }>(
        `SELECT *,
                (internal_state LIKE 'TERMINAL_%'
                 AND handle_expires_at IS NOT NULL
                 AND handle_expires_at <= clock_timestamp()) AS handle_expired
         FROM provider_task
         WHERE task_id=$1 AND authorization_context_hash=$2 AND execution_mode=$3
           AND simulation_id IS NOT DISTINCT FROM $4
         FOR UPDATE`,
        [taskId, authorization.hash, authorization.executionMode, authorization.simulationId],
      );
      const task = lockedTask.rows[0];
      if (task === undefined) throw new TaskNotFoundOrUnauthorizedError();
      if (task.expired_at !== null || task.handle_expired) throw new TaskExpiredError();

      const entries = Object.entries(inputResponses).sort(([left], [right]) =>
        left.localeCompare(right),
      );
      const keys = entries.map(([key]) => key);
      const requests =
        keys.length === 0
          ? []
          : (
              await client.query<{
                request_key: string;
                status: InputRequestRecord["status"];
                schema: Record<string, unknown>;
                request_json: InputRequestRecord["requestJson"];
              }>(
                `SELECT request_key, status, schema, request_json FROM task_input_request
                 WHERE task_id=$1 AND request_key=ANY($2::text[])
                 ORDER BY request_key FOR UPDATE`,
                [taskId, keys],
              )
            ).rows;
      const requestByKey = new Map(requests.map((request) => [request.request_key, request]));
      const result: InputResponseAcceptance = {
        acceptedKeys: [],
        ignoredUnknownKeys: [],
        ignoredAnsweredKeys: [],
        ignoredSupersededKeys: [],
        duplicatePendingKeys: [],
      };
      const acceptedHashes: string[] = [];
      for (const [key, response] of entries) {
        const request = requestByKey.get(key);
        if (request === undefined) {
          result.ignoredUnknownKeys.push(key);
          continue;
        }
        if (request.status === "ANSWERED") {
          result.ignoredAnsweredKeys.push(key);
          continue;
        }
        if (request.status === "SUPERSEDED") {
          result.ignoredSupersededKeys.push(key);
          continue;
        }
        validateLockedResponse(
          {
            key,
            status: request.status,
            schema: request.schema,
            requestJson: request.request_json,
          },
          response,
        );
        const responseHash = createHash("sha256")
          .update(canonicalizeResponse(response))
          .digest("hex");
        const inserted = await client.query<{ request_key: string }>(
          `INSERT INTO task_input_response_inbox
            (task_id, request_key, response_hash, response_json, state)
           VALUES ($1,$2,$3,$4::jsonb,'PENDING')
           ON CONFLICT (task_id, request_key) DO NOTHING
           RETURNING request_key`,
          [taskId, key, responseHash, JSON.stringify(response)],
        );
        if (inserted.rows[0] === undefined) {
          result.duplicatePendingKeys.push(key);
        } else {
          result.acceptedKeys.push(key);
          acceptedHashes.push(`${key}:${responseHash}`);
        }
      }

      if (result.acceptedKeys.length > 0) {
        const acceptanceHash = createHash("sha256").update(acceptedHashes.join("\n")).digest("hex");
        await transitionTask(client, {
          taskId,
          expectedVersion: Number(task.version),
          update: {},
          observation: {
            type: "task.input_response_accepted",
            occurredAt: new Date(),
            reasonCode: "INPUT_RESPONSE_ACCEPTED",
            message: "Task input response accepted for durable delivery.",
            substate: task.substate,
            source: "runtime",
            payload: { keys: result.acceptedKeys },
          },
          outboxType: "task.input_response_accepted",
          eventKey: `${taskId}:input-response:${acceptanceHash}`,
          outboxPayload: { keys: result.acceptedKeys },
        });
      }
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async promotePendingInputResponses(limit = 32): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1024) {
      throw new RangeError("INPUT_RESPONSE_PROMOTION_LIMIT_INVALID");
    }
    const candidates = await this.pool.query<{ task_id: string }>(
      `SELECT task_id
       FROM task_input_response_inbox
       WHERE state='PENDING'
       GROUP BY task_id
       ORDER BY min(accepted_at), task_id
       LIMIT $1`,
      [limit],
    );
    let promoted = 0;
    for (const taskId of candidates.rows.map((row) => row.task_id).sort()) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const lockedTask = await client.query<TaskRow>(
          "SELECT * FROM provider_task WHERE task_id=$1 FOR UPDATE",
          [taskId],
        );
        const task = lockedTask.rows[0];
        if (task === undefined) throw new Error("TASK_NOT_FOUND");
        const responses = (
          await client.query<{
            request_key: string;
            response_hash: string;
            response_json: McpInputResponse;
          }>(
            `SELECT request_key, response_hash, response_json
             FROM task_input_response_inbox
             WHERE task_id=$1 AND state='PENDING'
             ORDER BY accepted_at, request_key
             FOR UPDATE SKIP LOCKED`,
            [taskId],
          )
        ).rows;
        if (responses.length === 0) {
          await client.query("COMMIT");
          continue;
        }
        const keys = responses.map((response) => response.request_key);
        if (
          task.cancel_requested ||
          task.stop_reason !== null ||
          task.internal_state === "STOPPING" ||
          isTerminalState(task.internal_state)
        ) {
          await client.query(
            `UPDATE task_input_response_inbox
             SET state='IGNORED', updated_at=clock_timestamp(),
                 last_error_code='TASK_NOT_ACCEPTING_INPUT',
                 last_error_message='Task is stopping or terminal.'
             WHERE task_id=$1 AND request_key=ANY($2::text[]) AND state='PENDING'`,
            [taskId, keys],
          );
          await client.query("COMMIT");
          continue;
        }
        const updated = await client.query<{ next_command_sequence: string }>(
          `UPDATE provider_task SET next_command_sequence=next_command_sequence+1
           WHERE task_id=$1 RETURNING next_command_sequence`,
          [taskId],
        );
        const sequence = updated.rows[0]?.next_command_sequence;
        if (sequence === undefined) throw new Error("COMMAND_SEQUENCE_NOT_RETURNED");
        const normalized = Object.fromEntries(
          responses.map((response) => [response.request_key, response.response_json]),
        );
        const requestHash = createHash("sha256")
          .update(
            responses
              .map((response) => `${response.request_key}:${response.response_hash}`)
              .join("\n"),
          )
          .digest("hex");
        await client.query(
          `INSERT INTO task_command
            (task_id, command_sequence, command_type, request_hash, state, payload)
           VALUES ($1,$2,'UPDATE',$3,'PENDING',$4::jsonb)`,
          [taskId, sequence, requestHash, JSON.stringify({ inputResponses: normalized })],
        );
        const assigned = await client.query(
          `UPDATE task_input_response_inbox
           SET state='ASSIGNED', command_sequence=$3, assigned_at=clock_timestamp(),
               updated_at=clock_timestamp()
           WHERE task_id=$1 AND request_key=ANY($2::text[]) AND state='PENDING'`,
          [taskId, keys, sequence],
        );
        if (assigned.rowCount !== responses.length)
          throw new Error("INPUT_RESPONSE_ASSIGNMENT_LOST");
        await insertCommandFact(
          client,
          taskId,
          {
            sequence: Number(sequence),
            commandType: "UPDATE",
            state: "PENDING",
            attemptCount: 0,
          },
          "task.command.created",
          { reasonCode: "INPUT_RESPONSE_ACCEPTED", adapterRpcStatus: "not_started" },
        );
        promoted += 1;
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
    return promoted;
  }

  async listObservations(
    taskId: string,
    beforeRevision?: number,
    limit = 100,
  ): Promise<ObservationRecord[]> {
    return (await this.listObservationPage(taskId, beforeRevision, limit)).observations
      .slice()
      .reverse();
  }

  async listObservationPage(
    taskId: string,
    beforeRevision?: number,
    limit = 100,
  ): Promise<ObservationPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("OBSERVATION_PAGE_SIZE_INVALID");
    }
    if (
      beforeRevision !== undefined &&
      (!Number.isSafeInteger(beforeRevision) || beforeRevision < 1)
    ) {
      throw new RangeError("OBSERVATION_CURSOR_INVALID");
    }
    const result = await this.pool.query<{
      revision: string;
      type: string;
      occurred_at: Date;
      reason_code: string | null;
      message: string | null;
      substate: string | null;
      progress: Record<string, unknown> | null;
      source: "runtime" | "adapter";
      adapter_revision: string | null;
      payload: Record<string, unknown>;
    }>(
      `SELECT revision, type, occurred_at, reason_code, message, substate, progress,
              source, adapter_revision, payload
        FROM task_observation
        WHERE task_id=$1 AND ($2::bigint IS NULL OR revision < $2)
        ORDER BY revision DESC LIMIT $3`,
      [taskId, beforeRevision ?? null, limit + 1],
    );
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const observations = rows.map((row) => ({
      revision: Number(row.revision),
      type: row.type,
      occurredAt: row.occurred_at,
      reasonCode: row.reason_code,
      message: row.message,
      substate: row.substate,
      progress: row.progress,
      source: row.source,
      adapterRevision: row.adapter_revision === null ? null : Number(row.adapter_revision),
      payload: row.payload,
    }));
    return {
      observations,
      nextCursor: hasMore ? (observations.at(-1)?.revision ?? null) : null,
      hasMore,
    };
  }

  async beginCancel(taskId: string, requestHash: string): Promise<CommandResolution> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<TaskRow>(
        "SELECT * FROM provider_task WHERE task_id=$1 FOR UPDATE",
        [taskId],
      );
      const previous = locked.rows[0];
      if (previous === undefined) throw new Error("TASK_NOT_FOUND");
      const existing = await client.query<PendingCommandRecordRow>(
        `SELECT task_id, command_sequence, command_type, state, payload, attempt_count,
                claim_owner, stop_reason, adapter_ack, next_attempt_at, last_error_code,
                last_error_message, claim_until
         FROM task_command
         WHERE task_id=$1 AND command_type='CANCEL'
           AND state IN ('PENDING','CLAIMED','RETRY_WAIT','ACKNOWLEDGED')
         ORDER BY command_sequence DESC LIMIT 1`,
        [taskId],
      );
      if (existing.rows[0] !== undefined) {
        await client.query("COMMIT");
        const duplicate = {
          ...mapCommandResolution(existing.rows[0]),
          duplicate: true,
          disposition: "existing",
        } as const;
        await recordCommandResolutionFact(this.pool, taskId, duplicate, "task.command.duplicate");
        return duplicate;
      }
      if (isTerminalState(previous.internal_state)) throw new Error("TASK_ALREADY_TERMINAL");

      const superseded = await client.query<{
        command_sequence: string;
        command_type: PendingCommandRecord["commandType"];
        attempt_count: number;
      }>(
        `UPDATE task_command
           SET state='EXHAUSTED', claim_owner=NULL, claim_until=NULL,
               last_error_code='SUPERSEDED_BY_SAFE_STOP',
               last_error_message='Safe stop superseded the pending command.',
               updated_at=clock_timestamp()
         WHERE task_id=$1
           AND command_type IN ('UPDATE','PAUSE','RESUME')
           AND state IN ('PENDING','RETRY_WAIT')
         RETURNING command_sequence, command_type, attempt_count`,
        [taskId],
      );
      for (const row of superseded.rows) {
        await insertCommandFact(
          client,
          taskId,
          {
            sequence: Number(row.command_sequence),
            commandType: row.command_type,
            state: "EXHAUSTED",
            attemptCount: row.attempt_count,
          },
          "task.command.superseded",
          { reasonCode: "SUPERSEDED_BY_SAFE_STOP", adapterRpcStatus: "not_dispatched" },
        );
      }
      const updated = await client.query<{ next_command_sequence: string }>(
        `UPDATE provider_task SET next_command_sequence=next_command_sequence+1
         WHERE task_id=$1 RETURNING next_command_sequence`,
        [taskId],
      );
      const sequence = updated.rows[0]?.next_command_sequence;
      if (sequence === undefined) throw new Error("TASK_ALREADY_TERMINAL");
      await client.query(
        `INSERT INTO task_command
          (task_id, command_sequence, command_type, request_hash, state, payload,
           stop_reason, priority, previous_internal_state, previous_mcp_status,
           previous_substate, previous_status_message)
         VALUES ($1,$2,'CANCEL',$3,'PENDING',$4::jsonb,'USER_REQUESTED',100,$5,$6,$7,$8)`,
        [
          taskId,
          sequence,
          requestHash,
          JSON.stringify({ reason: "USER_REQUESTED" }),
          previous.internal_state,
          previous.mcp_status,
          previous.substate,
          previous.status_message,
        ],
      );
      await transitionTask(client, {
        taskId,
        expectedVersion: Number(previous.version),
        update: {
          cancelRequested: true,
          stopReason: "USER_REQUESTED",
          internalState: "STOPPING",
          mcpStatus: "working",
          substate: "stopping",
          statusMessage: "Cancellation requested.",
        },
        observation: {
          type: "task.cancel_requested",
          occurredAt: new Date(),
          reasonCode: "USER_REQUESTED",
          message: "Cancellation requested.",
          substate: "stopping",
          source: "runtime",
        },
        outboxType: "task.cancel_requested",
        eventKey: `${taskId}:command:${sequence}:requested`,
        outboxPayload: {
          commandType: "CANCEL",
          commandSequence: Number(sequence),
          commandPreviousState: null,
          commandCurrentState: "PENDING",
          commandAttempt: 0,
          commandReasonCode: "USER_REQUESTED",
          commandAdapterRpcStatus: "not_started",
        },
      });
      await insertCommandFact(
        client,
        taskId,
        {
          sequence: Number(sequence),
          commandType: "CANCEL",
          state: "PENDING",
          attemptCount: 0,
        },
        "task.command.created",
        {
          reasonCode: "USER_REQUESTED",
          adapterRpcStatus: "not_started",
        },
      );
      await client.query("COMMIT");
      return {
        sequence: Number(sequence),
        commandType: "CANCEL",
        duplicate: false,
        state: "PENDING",
        disposition: "created",
        adapterAck: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        nextAttemptAt: null,
        claimOwner: null,
        claimUntil: null,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordCooperativeCancellationIntent(taskId: string): Promise<TaskRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const applied = await transitionTask(client, {
        taskId,
        update: { cancelRequested: true, stopReason: "USER_REQUESTED" },
        observation: {
          type: "task.cancel_requested",
          occurredAt: new Date(),
          reasonCode: "ADAPTER_CANCEL_UNSUPPORTED",
          message: "Cancellation intent recorded; Adapter does not support immediate stop.",
          substate: null,
          source: "runtime",
        },
        outboxType: "task.cancel_intent_recorded",
        eventKey: `${taskId}:cancel-intent:user-requested`,
        outboxPayload: { adapterDispatch: false },
      });
      await client.query("COMMIT");
      return fromRow(applied.row);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async beginCommand(
    taskId: string,
    commandType: "UPDATE" | "PAUSE" | "RESUME",
    requestHash: string,
    payload: Record<string, unknown>,
  ): Promise<CommandResolution> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<TaskRow>(
        "SELECT * FROM provider_task WHERE task_id=$1 FOR UPDATE",
        [taskId],
      );
      const task = locked.rows[0];
      if (task === undefined) throw new Error("TASK_NOT_FOUND");

      const existing = await client.query<PendingCommandRecordRow>(
        `SELECT task_id, command_sequence, command_type, state, payload, attempt_count,
                claim_owner, stop_reason, adapter_ack, next_attempt_at, last_error_code,
                last_error_message, claim_until
         FROM task_command
         WHERE task_id=$1 AND command_type=$2 AND request_hash=$3
         ORDER BY command_sequence DESC LIMIT 1`,
        [taskId, commandType, requestHash],
      );
      if (existing.rows[0] !== undefined) {
        await client.query("COMMIT");
        const duplicate = {
          ...mapCommandResolution(existing.rows[0]),
          duplicate: true,
          disposition: "existing",
        } as const;
        await recordCommandResolutionFact(this.pool, taskId, duplicate, "task.command.duplicate");
        return duplicate;
      }

      if (isTerminalState(task.internal_state)) throw new Error("TASK_ALREADY_TERMINAL");

      if (
        task.cancel_requested ||
        task.stop_reason !== null ||
        task.internal_state === "STOPPING"
      ) {
        const stopping = await client.query<PendingCommandRecordRow>(
          `SELECT task_id, command_sequence, command_type, state, payload, attempt_count,
                  claim_owner, stop_reason, adapter_ack, next_attempt_at, last_error_code,
                  last_error_message, claim_until
           FROM task_command
           WHERE task_id=$1
             AND command_type='CANCEL'
             AND state IN ('PENDING','CLAIMED','RETRY_WAIT','ACKNOWLEDGED')
           ORDER BY command_sequence DESC LIMIT 1`,
          [taskId],
        );
        if (stopping.rows[0] !== undefined) {
          await client.query("COMMIT");
          return {
            ...mapCommandResolution(stopping.rows[0]),
            duplicate: true,
            disposition: "existing",
          };
        }
        throw new Error("STOP_IN_PROGRESS_WITHOUT_COMMAND");
      }

      const active = await client.query<PendingCommandRecordRow>(
        `SELECT task_id, command_sequence, command_type, state, payload, attempt_count,
                claim_owner, stop_reason, adapter_ack, next_attempt_at, last_error_code,
                last_error_message, claim_until
         FROM task_command
         WHERE task_id=$1
           AND state IN ('PENDING','CLAIMED','RETRY_WAIT')
         ORDER BY command_sequence
         LIMIT 1`,
        [taskId],
      );
      if (active.rows[0] !== undefined) {
        await client.query("COMMIT");
        return {
          ...mapCommandResolution(active.rows[0]),
          duplicate: true,
          disposition: "existing",
        };
      }

      const updated = await client.query<{ next_command_sequence: string }>(
        `UPDATE provider_task SET next_command_sequence=next_command_sequence+1
         WHERE task_id=$1 RETURNING next_command_sequence`,
        [taskId],
      );
      const sequence = updated.rows[0]?.next_command_sequence;
      if (sequence === undefined) throw new Error("TASK_ALREADY_TERMINAL");
      await client.query(
        `INSERT INTO task_command
          (task_id, command_sequence, command_type, request_hash, state, payload)
         VALUES ($1,$2,$3,$4,'PENDING',$5::jsonb)`,
        [taskId, sequence, commandType, requestHash, JSON.stringify(payload)],
      );
      await transitionTask(client, {
        taskId,
        expectedVersion: Number(task.version),
        update: {},
        observation: {
          type: "task.command_requested",
          occurredAt: new Date(),
          reasonCode: commandType,
          message: `${commandType.toLowerCase()} command requested.`,
          substate: task.substate,
          source: "runtime",
          payload: { commandType, commandSequence: Number(sequence) },
        },
        outboxType: "task.command_requested",
        eventKey: `${taskId}:command:${sequence}:requested`,
        outboxPayload: {
          commandType,
          commandSequence: Number(sequence),
          previousState: null,
          currentState: "PENDING",
          attempt: 0,
          adapterRpcStatus: "not_started",
        },
      });
      await insertCommandFact(
        client,
        taskId,
        {
          sequence: Number(sequence),
          commandType,
          state: "PENDING",
          attemptCount: 0,
        },
        "task.command.created",
        { adapterRpcStatus: "not_started" },
      );
      await client.query("COMMIT");
      return {
        sequence: Number(sequence),
        commandType,
        duplicate: false,
        state: "PENDING",
        disposition: "created",
        adapterAck: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        nextAttemptAt: null,
        claimOwner: null,
        claimUntil: null,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async findCommandByRequestHash(
    taskId: string,
    commandType: "UPDATE" | "PAUSE" | "RESUME",
    requestHash: string,
  ): Promise<CommandResolution | null> {
    const result = await this.pool.query<PendingCommandRecordRow>(
      `SELECT task_id, command_sequence, command_type, state, payload, attempt_count,
              claim_owner, stop_reason, adapter_ack, next_attempt_at, last_error_code,
              last_error_message, claim_until
       FROM task_command
       WHERE task_id=$1 AND command_type=$2 AND request_hash=$3
       ORDER BY command_sequence DESC LIMIT 1`,
      [taskId, commandType, requestHash],
    );
    if (result.rows[0] === undefined) return null;
    return {
      ...mapCommandResolution(result.rows[0]),
      duplicate: true,
      disposition: "existing",
    };
  }

  async supersedeNormalCommandsForSafeStop(
    taskId: string,
    includeClaimed = false,
  ): Promise<number> {
    const states = includeClaimed
      ? "('PENDING','RETRY_WAIT','CLAIMED')"
      : "('PENDING','RETRY_WAIT')";
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        command_sequence: string;
        command_type: PendingCommandRecord["commandType"];
        attempt_count: number;
      }>(
        `UPDATE task_command
         SET state='EXHAUSTED', claim_owner=NULL, claim_until=NULL,
             last_error_code='SUPERSEDED_BY_SAFE_STOP',
             last_error_message='Safe stop superseded the pending command.',
             updated_at=clock_timestamp()
       WHERE task_id=$1
         AND command_type IN ('UPDATE','PAUSE','RESUME')
         AND state IN ${states}
       RETURNING command_sequence, command_type, attempt_count`,
        [taskId],
      );
      for (const row of result.rows) {
        if (row.command_type === "UPDATE") {
          await markAssignedInputResponsesIgnored(client, taskId, Number(row.command_sequence));
        }
        await insertCommandFact(
          client,
          taskId,
          {
            sequence: Number(row.command_sequence),
            commandType: row.command_type,
            state: "EXHAUSTED",
            attemptCount: row.attempt_count,
          },
          "task.command.superseded",
          { reasonCode: "SUPERSEDED_BY_SAFE_STOP", adapterRpcStatus: "not_dispatched" },
        );
      }
      await client.query("COMMIT");
      return result.rowCount ?? 0;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async supersedeClaimedCommandForSafeStop(command: PendingCommandRecord): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE task_command
         SET state='EXHAUSTED', claim_owner=NULL, claim_until=NULL,
             next_attempt_at=clock_timestamp(), last_error_code='SUPERSEDED_BY_SAFE_STOP',
             last_error_message='Safe stop superseded the claimed command.',
             updated_at=clock_timestamp()
       WHERE task_id=$1
         AND command_sequence=$2
         AND command_type IN ('UPDATE','PAUSE','RESUME')
         AND state='CLAIMED'
         AND claim_owner=$3`,
        [command.taskId, command.commandSequence, command.claimOwner],
      );
      if (result.rowCount !== 1) throw new Error("COMMAND_CLAIM_LOST");
      if (command.commandType === "UPDATE") {
        await markAssignedInputResponsesIgnored(client, command.taskId, command.commandSequence);
      }
      await insertCommandFact(
        client,
        command.taskId,
        {
          sequence: command.commandSequence,
          commandType: command.commandType,
          state: "EXHAUSTED",
          attemptCount: command.attemptCount,
        },
        "task.command.superseded",
        {
          previousState: "CLAIMED",
          reasonCode: "SUPERSEDED_BY_SAFE_STOP",
          adapterRpcStatus: "not_dispatched",
        },
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async supersedeExpiredClaimedNormalCommandsForSafeStop(taskId: string): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        command_sequence: string;
        command_type: PendingCommandRecord["commandType"];
        attempt_count: number;
      }>(
        `UPDATE task_command
         SET state='EXHAUSTED', claim_owner=NULL, claim_until=NULL,
             last_error_code='SUPERSEDED_BY_SAFE_STOP',
             last_error_message='Safe stop superseded the pending command.',
             updated_at=clock_timestamp()
       WHERE task_id=$1
         AND command_type IN ('UPDATE','PAUSE','RESUME')
         AND state='CLAIMED'
         AND claim_until <= clock_timestamp()
       RETURNING command_sequence, command_type, attempt_count`,
        [taskId],
      );
      for (const row of result.rows) {
        if (row.command_type === "UPDATE") {
          await markAssignedInputResponsesIgnored(client, taskId, Number(row.command_sequence));
        }
        await insertCommandFact(
          client,
          taskId,
          {
            sequence: Number(row.command_sequence),
            commandType: row.command_type,
            state: "EXHAUSTED",
            attemptCount: row.attempt_count,
          },
          "task.command.superseded",
          {
            previousState: "CLAIMED",
            reasonCode: "SUPERSEDED_BY_SAFE_STOP",
            adapterRpcStatus: "not_dispatched",
          },
        );
      }
      await client.query("COMMIT");
      return result.rowCount ?? 0;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async acknowledgeCommand(
    taskId: string,
    sequence: number,
    accepted: boolean,
    ack: Record<string, unknown>,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        command_type: PendingCommandRecord["commandType"];
        attempt_count: number;
        previous_state: PendingCommandRecord["state"];
      }>(
        `UPDATE task_command SET state=$3, adapter_ack=$4::jsonb,
       updated_at=clock_timestamp() WHERE task_id=$1 AND command_sequence=$2
       RETURNING command_type, attempt_count, state AS previous_state`,
        [taskId, sequence, accepted ? "ACKNOWLEDGED" : "REJECTED", JSON.stringify(ack)],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error("COMMAND_NOT_FOUND");
      await insertCommandFact(
        client,
        taskId,
        {
          sequence,
          commandType: row.command_type,
          state: accepted ? "ACKNOWLEDGED" : "REJECTED",
          attemptCount: row.attempt_count,
        },
        accepted ? "task.command.acknowledged" : "task.command.rejected",
        { adapterRpcStatus: accepted ? "success" : "rejected" },
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async acknowledgeClaimedCommand(
    command: PendingCommandRecord,
    ack: Record<string, unknown>,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE task_command SET state='ACKNOWLEDGED', adapter_ack=$4::jsonb,
         claim_owner=NULL, claim_until=NULL, last_error_code=NULL,
         last_error_message=NULL, updated_at=clock_timestamp()
       WHERE task_id=$1 AND command_sequence=$2 AND state='CLAIMED' AND claim_owner=$3`,
        [command.taskId, command.commandSequence, command.claimOwner, JSON.stringify(ack)],
      );
      if (result.rowCount !== 1) throw new Error("COMMAND_CLAIM_LOST");
      await insertCommandFact(
        client,
        command.taskId,
        {
          sequence: command.commandSequence,
          commandType: command.commandType,
          state: "ACKNOWLEDGED",
          attemptCount: command.attemptCount,
        },
        "task.command.acknowledged",
        { previousState: "CLAIMED", adapterRpcStatus: "success" },
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async acknowledgeUpdateAndCompleteInputAnswers(
    command: PendingCommandRecord,
    ack: Record<string, unknown>,
    answers: {
      key: string;
      answerHash: string;
      value: unknown;
      response: Record<string, unknown>;
    }[],
  ): Promise<"acknowledged" | "task_terminal" | "superseded_by_safe_stop"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const lockedTask = await client.query<TaskRow>(
        "SELECT * FROM provider_task WHERE task_id=$1 FOR UPDATE",
        [command.taskId],
      );
      const task = lockedTask.rows[0];
      if (task === undefined) throw new Error("TASK_NOT_FOUND");
      const claimed = await client.query<PendingCommandRecordRow>(
        `SELECT task_id, command_sequence, command_type, state, payload, attempt_count,
                claim_owner, stop_reason, adapter_ack, next_attempt_at, last_error_code,
                last_error_message, claim_until
         FROM task_command
         WHERE task_id=$1 AND command_sequence=$2 AND command_type='UPDATE'
           AND state='CLAIMED' AND claim_owner=$3
         FOR UPDATE`,
        [command.taskId, command.commandSequence, command.claimOwner],
      );
      if (claimed.rows[0] === undefined) throw new Error("COMMAND_CLAIM_LOST");

      const exhaust = async (code: "TASK_TERMINAL" | "SUPERSEDED_BY_SAFE_STOP") => {
        const message =
          code === "TASK_TERMINAL"
            ? "Task transitioned to terminal while command was in progress."
            : "Safe stop superseded the claimed command.";
        const result = await client.query(
          `UPDATE task_command
             SET state='EXHAUSTED', claim_owner=NULL, claim_until=NULL,
                 next_attempt_at=clock_timestamp(), last_error_code=$4,
                 last_error_message=$5, updated_at=clock_timestamp()
           WHERE task_id=$1 AND command_sequence=$2 AND state='CLAIMED' AND claim_owner=$3`,
          [command.taskId, command.commandSequence, command.claimOwner, code, message],
        );
        if (result.rowCount !== 1) throw new Error("COMMAND_CLAIM_LOST");
      };

      const ignoreInputResponse = async () => {
        const keys = Object.keys(
          (command.payload.inputResponses as Record<string, unknown> | undefined) ?? {},
        );
        if (keys.length > 0) {
          await client.query(
            `UPDATE task_input_request SET status='SUPERSEDED'
             WHERE task_id=$1 AND request_key=ANY($2::text[]) AND status='OPEN'`,
            [command.taskId, keys],
          );
        }
        await client.query(
          `UPDATE task_input_response_inbox
           SET state='IGNORED', updated_at=clock_timestamp(), last_error_code=$3,
               last_error_message='Input response was superseded by task state.'
           WHERE task_id=$1 AND command_sequence=$2 AND state='ASSIGNED'`,
          [
            command.taskId,
            command.commandSequence,
            isTerminalState(task.internal_state) ? "TASK_TERMINAL" : "SUPERSEDED_BY_SAFE_STOP",
          ],
        );
      };

      if (isTerminalState(task.internal_state)) {
        await exhaust("TASK_TERMINAL");
        await ignoreInputResponse();
        await insertCommandFact(
          client,
          command.taskId,
          {
            sequence: command.commandSequence,
            commandType: command.commandType,
            state: "EXHAUSTED",
            attemptCount: command.attemptCount,
          },
          "task.command.exhausted",
          {
            previousState: "CLAIMED",
            reasonCode: "TASK_TERMINAL",
            adapterRpcStatus: "not_dispatched",
          },
        );
        await client.query("COMMIT");
        return "task_terminal";
      }
      if (
        task.cancel_requested ||
        task.stop_reason !== null ||
        task.internal_state === "STOPPING"
      ) {
        await exhaust("SUPERSEDED_BY_SAFE_STOP");
        await ignoreInputResponse();
        await insertCommandFact(
          client,
          command.taskId,
          {
            sequence: command.commandSequence,
            commandType: command.commandType,
            state: "EXHAUSTED",
            attemptCount: command.attemptCount,
          },
          "task.command.superseded",
          {
            previousState: "CLAIMED",
            reasonCode: "SUPERSEDED_BY_SAFE_STOP",
            adapterRpcStatus: "not_dispatched",
          },
        );
        await client.query("COMMIT");
        return "superseded_by_safe_stop";
      }

      for (const answer of answers) {
        const result = await client.query(
          `UPDATE task_input_request
             SET status='ANSWERED', answer_hash=$3, answer=$4::jsonb,
                 response_hash=$3, response_json=$5::jsonb,
                 answered_at=clock_timestamp()
           WHERE task_id=$1 AND request_key=$2 AND status='OPEN'`,
          [
            command.taskId,
            answer.key,
            answer.answerHash,
            JSON.stringify(answer.value),
            JSON.stringify(answer.response),
          ],
        );
        if (result.rowCount !== 1) throw new Error("INPUT_REQUEST_NOT_OPEN");
      }

      await client.query(
        `UPDATE task_input_response_inbox
         SET state='ACKNOWLEDGED', acknowledged_at=clock_timestamp(),
             updated_at=clock_timestamp(), last_error_code=NULL, last_error_message=NULL
         WHERE task_id=$1 AND command_sequence=$2 AND state='ASSIGNED'`,
        [command.taskId, command.commandSequence],
      );

      const keys = answers.map((answer) => answer.key).sort();
      await transitionTask(client, {
        taskId: command.taskId,
        expectedVersion: Number(task.version),
        update: {},
        observation: {
          type: "task.input_answered",
          occurredAt: new Date(),
          reasonCode: "INPUT_ANSWERED",
          message: "Task input was answered.",
          substate: task.substate,
          source: "runtime",
          payload: { keys },
        },
        outboxType: "task.input_answered",
        eventKey: `${command.taskId}:command:${String(command.commandSequence)}:input-answered`,
        outboxPayload: { keys },
      });

      const acknowledged = await client.query(
        `UPDATE task_command
           SET state='ACKNOWLEDGED', adapter_ack=$4::jsonb, claim_owner=NULL,
               claim_until=NULL, last_error_code=NULL, last_error_message=NULL,
               updated_at=clock_timestamp()
         WHERE task_id=$1 AND command_sequence=$2 AND state='CLAIMED' AND claim_owner=$3`,
        [command.taskId, command.commandSequence, command.claimOwner, JSON.stringify(ack)],
      );
      if (acknowledged.rowCount !== 1) throw new Error("COMMAND_CLAIM_LOST");
      await insertCommandFact(
        client,
        command.taskId,
        {
          sequence: command.commandSequence,
          commandType: command.commandType,
          state: "ACKNOWLEDGED",
          attemptCount: command.attemptCount,
        },
        "task.command.acknowledged",
        { previousState: "CLAIMED", adapterRpcStatus: "success" },
      );
      await client.query("COMMIT");
      return "acknowledged";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async rejectUserCancel(
    command: PendingCommandRecord,
    adapterRevision: number,
    transition: SnapshotTransition,
    ack: Record<string, unknown>,
  ): Promise<TaskRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<TaskRow>(
        "SELECT * FROM provider_task WHERE task_id=$1 FOR UPDATE",
        [command.taskId],
      );
      const row = locked.rows[0];
      if (row === undefined) throw new Error("TASK_NOT_FOUND");
      if (isTerminalState(fromRow(row).internalState)) {
        await client.query(
          `UPDATE task_command SET state='EXHAUSTED', claim_owner=NULL, claim_until=NULL,
             last_error_code='TASK_TERMINAL', updated_at=clock_timestamp()
           WHERE task_id=$1 AND command_sequence=$2`,
          [command.taskId, command.commandSequence],
        );
        await insertCommandFact(
          client,
          command.taskId,
          {
            sequence: command.commandSequence,
            commandType: command.commandType,
            state: "EXHAUSTED",
            attemptCount: command.attemptCount,
          },
          "task.command.exhausted",
          {
            previousState: command.state,
            reasonCode: "TASK_TERMINAL",
            adapterRpcStatus: "not_dispatched",
          },
        );
        await client.query("COMMIT");
        return fromRow(row);
      }
      const applied = await transitionTask(client, {
        taskId: command.taskId,
        expectedVersion: Number(row.version),
        update: {
          internalState: transition.internalState,
          mcpStatus: transition.mcpStatus,
          substate: transition.substate,
          statusMessage: transition.statusMessage,
          result: transition.result,
          error: transition.error,
          ...(adapterRevision > Number(row.adapter_revision) ? { adapterRevision } : {}),
          cancelRequested: false,
          stopReason: null,
        },
        observation: {
          type: "task.cancel_rejected",
          occurredAt: new Date(),
          reasonCode: typeof ack.reasonCode === "string" ? ack.reasonCode : "CANCEL_REJECTED",
          message: transition.statusMessage,
          substate: transition.substate,
          source: "runtime",
          adapterRevision,
          payload: { commandSequence: command.commandSequence },
        },
        outboxType: "task.cancel_rejected",
        eventKey: `${command.taskId}:command:${String(command.commandSequence)}:rejected`,
        outboxPayload: { commandSequence: command.commandSequence },
      });
      const rejected = await client.query(
        `UPDATE task_command SET state='REJECTED', adapter_ack=$4::jsonb,
           claim_owner=NULL, claim_until=NULL, last_error_code=$5,
           last_error_message=$6, updated_at=clock_timestamp()
         WHERE task_id=$1 AND command_sequence=$2 AND state='CLAIMED' AND claim_owner=$3`,
        [
          command.taskId,
          command.commandSequence,
          command.claimOwner,
          JSON.stringify(ack),
          typeof ack.reasonCode === "string" ? ack.reasonCode : "CANCEL_REJECTED",
          typeof ack.message === "string" ? ack.message : "Adapter rejected cancellation.",
        ],
      );
      if (rejected.rowCount !== 1) throw new Error("COMMAND_CLAIM_LOST");
      await insertCommandFact(
        client,
        command.taskId,
        {
          sequence: command.commandSequence,
          commandType: command.commandType,
          state: "REJECTED",
          attemptCount: command.attemptCount,
        },
        "task.command.rejected",
        {
          previousState: "CLAIMED",
          reasonCode: typeof ack.reasonCode === "string" ? ack.reasonCode : "CANCEL_REJECTED",
          adapterRpcStatus: "rejected",
        },
      );
      await client.query("COMMIT");
      return fromRow(applied.row);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async failSafeStopUnconfirmed(
    command: PendingCommandRecord,
    message: string,
  ): Promise<TaskRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<TaskRow>(
        "SELECT * FROM provider_task WHERE task_id=$1 FOR UPDATE",
        [command.taskId],
      );
      const row = locked.rows[0];
      if (row === undefined) throw new Error("TASK_NOT_FOUND");
      if (isTerminalState(row.internal_state)) {
        await client.query(
          `UPDATE task_command SET state='EXHAUSTED', claim_owner=NULL, claim_until=NULL,
             last_error_code='TASK_TERMINAL', last_error_message=$4,
             updated_at=clock_timestamp()
           WHERE task_id=$1 AND command_sequence=$2 AND claim_owner=$3`,
          [command.taskId, command.commandSequence, command.claimOwner, message],
        );
        await insertCommandFact(
          client,
          command.taskId,
          {
            sequence: command.commandSequence,
            commandType: command.commandType,
            state: "EXHAUSTED",
            attemptCount: command.attemptCount,
          },
          "task.command.exhausted",
          {
            previousState: "CLAIMED",
            reasonCode: "TASK_TERMINAL",
            adapterRpcStatus: "not_dispatched",
          },
        );
        await client.query("COMMIT");
        return fromRow(row);
      }
      const error = {
        code: -32603,
        message,
        data: { reasonCode: "SAFE_STOP_UNCONFIRMED" },
      };
      const applied = await transitionTask(client, {
        taskId: command.taskId,
        expectedVersion: Number(row.version),
        update: {
          internalState: "TERMINAL_FAILED",
          mcpStatus: "failed",
          substate: null,
          statusMessage: message,
          result: null,
          error,
        },
        observation: {
          type: "task.failed",
          occurredAt: new Date(),
          reasonCode: "SAFE_STOP_UNCONFIRMED",
          message,
          substate: null,
          source: "runtime",
          payload: { stopReason: command.stopReason, severity: "critical" },
        },
        outboxType: "task.failed",
        eventKey: `${command.taskId}:command:${String(command.commandSequence)}:safe-stop-failed`,
        outboxPayload: {
          reasonCode: "SAFE_STOP_UNCONFIRMED",
          stopReason: command.stopReason,
          severity: "critical",
        },
      });
      const exhausted = await client.query(
        `UPDATE task_command SET state='EXHAUSTED', claim_owner=NULL, claim_until=NULL,
           last_error_code='SAFE_STOP_UNCONFIRMED', last_error_message=$4,
           updated_at=clock_timestamp()
         WHERE task_id=$1 AND command_sequence=$2 AND claim_owner=$3`,
        [command.taskId, command.commandSequence, command.claimOwner, message],
      );
      if (exhausted.rowCount !== 1) throw new Error("COMMAND_CLAIM_LOST");
      await insertCommandFact(
        client,
        command.taskId,
        {
          sequence: command.commandSequence,
          commandType: command.commandType,
          state: "EXHAUSTED",
          attemptCount: command.attemptCount,
        },
        "task.command.exhausted",
        {
          previousState: "CLAIMED",
          reasonCode: "SAFE_STOP_UNCONFIRMED",
          adapterRpcStatus: "rejected",
        },
      );
      await client.query("COMMIT");
      return fromRow(applied.row);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async applySnapshot(
    taskId: string,
    adapterRevision: number,
    transition: SnapshotTransition,
    inputRequests: NewInputRequest[] = [],
  ): Promise<TaskRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<TaskRow>(
        "SELECT * FROM provider_task WHERE task_id=$1 FOR UPDATE",
        [taskId],
      );
      const existingRow = locked.rows[0];
      if (existingRow === undefined) throw new Error("TASK_NOT_FOUND");
      const existing = fromRow(existingRow);
      if (isTerminalState(existing.internalState) || adapterRevision < existing.adapterRevision) {
        await client.query("COMMIT");
        return existing;
      }
      if (adapterRevision === existing.adapterRevision) {
        const confirmedAt = new Date();
        const confirmed = await client.query<TaskRow>(
          `UPDATE provider_task SET last_confirmed_at=$2
           WHERE task_id=$1 RETURNING *`,
          [taskId, confirmedAt],
        );
        await client.query("COMMIT");
        const row = confirmed.rows[0];
        if (row === undefined) throw new Error("TASK_CONFIRMATION_NOT_RETURNED");
        return fromRow(row);
      }
      const stateTransition = mergeStopState(existing, transition);
      const applied = await transitionTask(client, {
        taskId,
        expectedVersion: existing.version,
        update: {
          internalState: stateTransition.internalState,
          mcpStatus: stateTransition.mcpStatus,
          substate: stateTransition.substate,
          statusMessage: stateTransition.statusMessage,
          result: stateTransition.result,
          error: stateTransition.error,
          adapterRevision,
          ...(transitionHasStarted(transition) && existing.actualStartedAt === null
            ? { actualStartedAt: new Date() }
            : {}),
        },
        observation: {
          type: stableObservationType(transition),
          occurredAt: new Date(),
          reasonCode: reasonCodeFromTransition(transition),
          message: transition.statusMessage,
          substate: transition.substate,
          source: "adapter",
          adapterRevision,
        },
        outboxType: stableObservationType(transition),
        eventKey: `${taskId}:adapter:${String(adapterRevision)}`,
      });
      await upsertInputRequests(client, taskId, inputRequests);
      if (transition.terminal) {
        const exhausted = await client.query<{
          command_sequence: string;
          command_type: PendingCommandRecord["commandType"];
          attempt_count: number;
        }>(
          `UPDATE task_command SET state='EXHAUSTED', claim_owner=NULL, claim_until=NULL,
             last_error_code='TASK_TERMINAL', updated_at=clock_timestamp()
           WHERE task_id=$1 AND state IN ('PENDING','CLAIMED','RETRY_WAIT')
           RETURNING command_sequence, command_type, attempt_count`,
          [taskId],
        );
        for (const row of exhausted.rows) {
          await insertCommandFact(
            client,
            taskId,
            {
              sequence: Number(row.command_sequence),
              commandType: row.command_type,
              state: "EXHAUSTED",
              attemptCount: row.attempt_count,
            },
            "task.command.exhausted",
            { reasonCode: "TASK_TERMINAL", adapterRpcStatus: "not_dispatched" },
          );
        }
      }
      await client.query("COMMIT");
      return fromRow(applied.row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export function mergeStopState(
  existing: TaskRecord,
  adapterTransition: SnapshotTransition,
): SnapshotTransition {
  if ((!existing.cancelRequested && existing.stopReason === null) || adapterTransition.terminal) {
    return adapterTransition;
  }
  return {
    ...adapterTransition,
    internalState: existing.internalState,
    mcpStatus: existing.mcpStatus,
    substate: existing.substate,
    statusMessage: existing.statusMessage ?? adapterTransition.statusMessage,
    result: existing.result,
    error: existing.error,
  };
}

async function transitionTask(
  client: PoolClient,
  request: TaskTransitionRequest,
): Promise<{ row: TaskRow; applied: boolean }> {
  const transitionStartedAt = performance.now();
  const locked = await client.query<TaskRow>(
    "SELECT * FROM provider_task WHERE task_id=$1 FOR UPDATE",
    [request.taskId],
  );
  const existing = locked.rows[0];
  if (existing === undefined) throw new Error("TASK_NOT_FOUND");
  const duplicate = await client.query("SELECT event_id FROM outbox_event WHERE event_key=$1", [
    request.eventKey,
  ]);
  if ((duplicate.rowCount ?? 0) > 0) return { row: existing, applied: false };
  if (isTerminalState(existing.internal_state)) return { row: existing, applied: false };
  if (
    request.expectedVersion !== undefined &&
    Number(existing.version) !== request.expectedVersion
  ) {
    throw new Error("TASK_VERSION_CONFLICT");
  }
  if (
    request.update.adapterRevision !== undefined &&
    request.update.adapterRevision <= Number(existing.adapter_revision)
  ) {
    return { row: existing, applied: false };
  }

  const values: unknown[] = [request.taskId, request.observation.occurredAt];
  const assignments = [
    "observation_revision=observation_revision+1",
    "runtime_revision=runtime_revision+1",
    "version=version+1",
    "updated_at=$2",
    "runtime_updated_at=$2",
  ];
  const add = (column: string, value: unknown, json = false): void => {
    values.push(json && value !== null ? JSON.stringify(value) : value);
    assignments.push(`${column}=$${String(values.length)}${json ? "::jsonb" : ""}`);
  };
  const update = request.update;
  if (update.internalState !== undefined) add("internal_state", update.internalState);
  if (update.mcpStatus !== undefined) add("mcp_status", update.mcpStatus);
  if (update.substate !== undefined) add("substate", update.substate);
  if (update.statusMessage !== undefined) add("status_message", update.statusMessage);
  if (update.result !== undefined) add("result", update.result, true);
  if (update.error !== undefined) add("error", update.error, true);
  if (update.adapterRevision !== undefined) add("adapter_revision", update.adapterRevision);
  if (update.externalExecutionId !== undefined) {
    add("external_execution_id", update.externalExecutionId);
  }
  if (update.actualStartedAt !== undefined) add("actual_started_at", update.actualStartedAt);
  if (update.cancelRequested !== undefined) add("cancel_requested", update.cancelRequested);
  if (update.stopReason !== undefined) add("stop_reason", update.stopReason);
  if (update.startStopRequestedAt !== undefined) {
    add("start_stop_requested_at", update.startStopRequestedAt);
  }
  if (update.startConfirmationDeadline !== undefined) {
    add("start_confirmation_deadline", update.startConfirmationDeadline);
  }
  if (update.startConfirmationAttempts !== undefined) {
    add("start_confirmation_attempts", update.startConfirmationAttempts);
  }
  if (update.scheduleClaimOwner !== undefined)
    add("schedule_claim_owner", update.scheduleClaimOwner);
  if (update.scheduleClaimUntil !== undefined)
    add("schedule_claim_until", update.scheduleClaimUntil);
  if (update.nextStartAttemptAt !== undefined) {
    add("next_start_attempt_at", update.nextStartAttemptAt);
  }
  if (update.invocationAttempt !== undefined) add("invocation_attempt", update.invocationAttempt);
  if (update.recoveryAttempts !== undefined) add("recovery_attempts", update.recoveryAttempts);
  if (update.nextRecoveryAt !== undefined) add("next_recovery_at", update.nextRecoveryAt);
  if (update.recoveryFailureCount !== undefined) {
    add("recovery_failure_count", update.recoveryFailureCount);
  }
  if (update.lastReconciledAt !== undefined) add("last_reconciled_at", update.lastReconciledAt);
  const resultingState = update.internalState ?? existing.internal_state;
  const ttlMs = existing.ttl_ms === null ? null : Number(existing.ttl_ms);
  if (isTerminalState(resultingState)) {
    const terminalAt = request.observation.occurredAt;
    add("terminal_at", terminalAt);
    add("handle_expires_at", new Date(terminalAt.getTime() + (ttlMs ?? 86_400_000)));
  } else if (ttlMs !== null) {
    add("handle_expires_at", new Date(request.observation.occurredAt.getTime() + ttlMs));
  }
  if (request.observation.source === "adapter") {
    add("last_confirmed_at", request.observation.occurredAt);
  }

  const updated = await client.query<TaskRow>(
    `UPDATE provider_task SET ${assignments.join(", ")} WHERE task_id=$1 RETURNING *`,
    values,
  );
  const row = updated.rows[0];
  if (row === undefined) throw new Error("TASK_TRANSITION_NOT_RETURNED");
  if (isTerminalState(row.internal_state)) {
    await client.query(
      `UPDATE provider_task_resource_binding
       SET terminal_at=$2::timestamptz,
           retain_until=GREATEST(
             retain_until,
             $2::timestamptz + (1209960000 * interval '1 millisecond')
           )
       WHERE provider_id=$3 AND task_id=$1`,
      [request.taskId, request.observation.occurredAt, row.provider_id],
    );
  }
  const revision = Number(row.observation_revision);
  await client.query(
    `INSERT INTO task_observation
      (task_id, revision, type, reason_code, occurred_at, message, substate,
       progress, source, adapter_revision, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb)`,
    [
      request.taskId,
      revision,
      request.observation.type,
      request.observation.reasonCode ?? null,
      request.observation.occurredAt,
      request.observation.message,
      request.observation.substate,
      jsonOrNull(request.observation.progress ?? null),
      request.observation.source,
      request.observation.adapterRevision ?? null,
      JSON.stringify(request.observation.payload ?? {}),
    ],
  );
  const occurredAt = request.observation.occurredAt;
  const outboxPayload = {
    ...(request.outboxPayload ?? {}),
    taskId: request.taskId,
    previousState: existing.internal_state,
    currentState: row.internal_state,
    previousSubstate: existing.substate,
    currentSubstate: row.substate,
    reasonCode: request.observation.reasonCode ?? null,
    terminal: isTerminalState(row.internal_state),
    resultClass: taskResultClass(row),
    internalState: row.internal_state,
    status: row.mcp_status,
    substate: row.substate,
    statusMessage: row.status_message,
    externalExecutionId: row.external_execution_id,
    operationName: row.operation_name,
    executionMode: row.execution_mode,
    simulationId: row.simulation_id,
    reservationRef: row.reservation_ref,
    argumentHash: row.argument_hash,
    authorizationContextHash: row.authorization_context_hash,
    traceId: row.trace_id,
    rootTraceparent: row.root_traceparent,
    rootTracestate: row.root_tracestate,
    correlationId: row.correlation_id,
    observationRevision: revision,
    adapterRevision: Number(row.adapter_revision),
    occurredAt: occurredAt.toISOString(),
    taskTransitionDurationMs: performance.now() - transitionStartedAt,
  };
  await client.query(
    `INSERT INTO outbox_event(event_id, event_key, aggregate_id, event_type, payload)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [
      randomUUID(),
      request.eventKey,
      request.taskId,
      request.outboxType,
      JSON.stringify(outboxPayload),
    ],
  );
  await captureTaskProviderOpsDelivery(
    client,
    row,
    request.outboxType,
    outboxPayload,
    request.eventKey,
    occurredAt,
  );
  const schedulerDecision = schedulerDecisionFor(request.outboxType);
  if (schedulerDecision !== null) {
    await captureTaskOperationalEvent(client, request.taskId, {
      recordType: "provider.scheduler.decision",
      eventType: schedulerDecision,
      eventIdentity: request.eventKey,
      occurredAt,
      payload: {
        decision: schedulerDecision,
        taskId: request.taskId,
        operationName: row.operation_name,
        invocationAttempt: row.invocation_attempt,
        scheduledAt: row.not_before?.toISOString() ?? null,
        latestStartAt: row.latest_start_at?.toISOString() ?? null,
        reasonCode: request.observation.reasonCode ?? null,
      },
    });
  }
  if (request.outboxType === "task.recovery") {
    await captureTaskOperationalEvent(client, request.taskId, {
      recordType: "provider.recovery.lifecycle",
      eventType: "reconcile_success",
      eventIdentity: request.eventKey,
      occurredAt,
      payload: {
        event: "reconcile",
        taskId: request.taskId,
        recoveryAttempt: row.recovery_attempts,
        outcome: "success",
        reasonCode: request.observation.reasonCode ?? null,
        nextRecoveryAt: row.next_recovery_at.toISOString(),
      },
    });
  }
  return { row, applied: true };
}

function schedulerDecisionFor(eventType: string): string | null {
  const decisions: Record<string, string> = {
    "task.start_attempt": "claimed",
    "task.start_retry": "retry",
    "task.start_uncertain": "retry",
    "task.start_window_violation": "start_window_missed",
    "task.start_window_missed": "start_window_missed",
    "task.start_window_stop_requested": "start_window_missed",
    "task.started": "started",
    "task.deadline_stop_requested": "deadline",
  };
  return decisions[eventType] ?? null;
}

async function persistStartWindowStop(
  client: PoolClient,
  taskId: string,
  requestedAt: Date,
): Promise<void> {
  const locked = await client.query<TaskRow>(
    "SELECT * FROM provider_task WHERE task_id=$1 FOR UPDATE",
    [taskId],
  );
  const previous = locked.rows[0];
  if (previous === undefined) throw new Error("TASK_NOT_FOUND");
  if (isTerminalState(previous.internal_state)) return;
  if (previous.external_execution_id === null)
    throw new Error("START_WINDOW_STOP_WITHOUT_EXECUTION");
  const active = await client.query<{ command_sequence: string; stop_reason: string | null }>(
    `SELECT command_sequence, stop_reason FROM task_command
     WHERE task_id=$1 AND command_type='CANCEL'
       AND state IN ('PENDING','CLAIMED','RETRY_WAIT','ACKNOWLEDGED')
     ORDER BY command_sequence DESC LIMIT 1`,
    [taskId],
  );
  const existing = active.rows[0];
  let commandSequence: number;
  if (existing === undefined) {
    const updated = await client.query<{ next_command_sequence: string }>(
      `UPDATE provider_task SET next_command_sequence=next_command_sequence+1
       WHERE task_id=$1 RETURNING next_command_sequence`,
      [taskId],
    );
    commandSequence = Number(updated.rows[0]?.next_command_sequence);
    if (!Number.isSafeInteger(commandSequence))
      throw new Error("START_WINDOW_STOP_SEQUENCE_FAILED");
    await client.query(
      `INSERT INTO task_command
        (task_id, command_sequence, command_type, request_hash, state, payload,
         stop_reason, priority, previous_internal_state, previous_mcp_status,
         previous_substate, previous_status_message, next_attempt_at)
       VALUES ($1,$2,'CANCEL',$3,'PENDING',$4::jsonb,'START_WINDOW_MISSED',200,
               $5,$6,$7,$8,$9)`,
      [
        taskId,
        commandSequence,
        commandHash("START_WINDOW_MISSED"),
        JSON.stringify({ reason: "START_WINDOW_MISSED" }),
        previous.internal_state,
        previous.mcp_status,
        previous.substate,
        previous.status_message,
        requestedAt,
      ],
    );
  } else {
    commandSequence = Number(existing.command_sequence);
    if (existing.stop_reason === "USER_REQUESTED") {
      await client.query(
        `UPDATE task_command SET stop_reason='START_WINDOW_MISSED', priority=200,
         payload=$3::jsonb, updated_at=$4 WHERE task_id=$1 AND command_sequence=$2`,
        [taskId, commandSequence, JSON.stringify({ reason: "START_WINDOW_MISSED" }), requestedAt],
      );
    }
  }
  const effectiveReason =
    existing?.stop_reason === "DEADLINE_REACHED" ? "DEADLINE_REACHED" : "START_WINDOW_MISSED";
  await transitionTask(client, {
    taskId,
    expectedVersion: Number(previous.version),
    update: {
      internalState: "STOPPING",
      mcpStatus: "working",
      substate: "stopping",
      statusMessage: "Start window missed; safe stop requested.",
      cancelRequested: true,
      stopReason: effectiveReason,
      ...(effectiveReason === "START_WINDOW_MISSED" ? { startStopRequestedAt: requestedAt } : {}),
      scheduleClaimOwner: null,
      scheduleClaimUntil: null,
      nextStartAttemptAt: null,
    },
    observation: {
      type: "task.start_window_violation",
      occurredAt: requestedAt,
      reasonCode: "START_WINDOW_MISSED",
      message: "Start window missed; safe stop requested.",
      substate: "stopping",
      source: "runtime",
      payload: { commandSequence },
    },
    outboxType: "task.start_window_stop_requested",
    eventKey: `${taskId}:command:${String(commandSequence)}:start-window-stop`,
    outboxPayload: { reasonCode: "START_WINDOW_MISSED", commandSequence },
  });
  if (existing === undefined) {
    await insertCommandFact(
      client,
      taskId,
      {
        sequence: commandSequence,
        commandType: "CANCEL",
        state: "PENDING",
        attemptCount: 0,
      },
      "task.command.created",
      { reasonCode: "START_WINDOW_MISSED", adapterRpcStatus: "not_started" },
    );
  }
}

function transitionHasStarted(transition: SnapshotTransition): boolean {
  return ["RUNNING", "PAUSED", "RESUMING", "TERMINAL_COMPLETED", "TERMINAL_FAILED"].includes(
    transition.internalState,
  );
}

function startWindowMissedResult(completedAt: Date): Record<string, unknown> {
  return {
    content: [{ type: "text", text: "Start window was missed before execution began." }],
    isError: true,
    structuredContent: {
      outcome: "start_window_missed",
      reasonCode: "START_WINDOW_MISSED",
      retryable: true,
      completedAt: completedAt.toISOString(),
    },
  };
}

function startWindowMissedTransition(completedAt: Date): SnapshotTransition {
  return {
    internalState: "TERMINAL_COMPLETED",
    mcpStatus: "completed",
    substate: null,
    statusMessage: "Start window was missed before execution began.",
    result: startWindowMissedResult(completedAt),
    error: null,
    terminal: true,
    observationType: "task.start_window_missed",
  };
}

function admissionRejectedResult(
  completedAt: Date,
  reasonCode: string,
  message: string,
  retryable: boolean,
): Record<string, unknown> {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
    structuredContent: {
      outcome: "admission_rejected",
      reasonCode,
      retryable,
      completedAt: completedAt.toISOString(),
    },
  };
}

async function insertObservation(
  client: PoolClient,
  taskId: string,
  revision: number,
  transition: SnapshotTransition,
  options: {
    source?: "runtime" | "adapter";
    adapterRevision?: number | null;
    reasonCode?: string | null;
    progress?: Record<string, unknown> | null;
    payload?: Record<string, unknown>;
  } = {},
): Promise<void> {
  await client.query(
    `INSERT INTO task_observation
      (task_id, revision, type, reason_code, occurred_at, message, substate,
       progress, source, adapter_revision, payload)
     VALUES ($1,$2,$3,$4,clock_timestamp(),$5,$6,$7::jsonb,$8,$9,$10::jsonb)
     ON CONFLICT DO NOTHING`,
    [
      taskId,
      revision,
      stableObservationType(transition),
      options.reasonCode ?? reasonCodeFromTransition(transition),
      transition.statusMessage,
      transition.substate,
      jsonOrNull(options.progress ?? null),
      options.source ?? "runtime",
      options.adapterRevision ?? null,
      JSON.stringify(options.payload ?? {}),
    ],
  );
}

async function upsertInputRequests(
  client: PoolClient,
  taskId: string,
  inputRequests: NewInputRequest[],
): Promise<void> {
  for (const input of inputRequests) {
    const requestJson = input.requestJson ?? {
      method: "elicitation/create" as const,
      params: {
        mode: "form",
        message: input.description,
        requestedSchema: input.schema,
      },
    };
    const result = await client.query(
      `INSERT INTO task_input_request
        (task_id, request_key, description, schema, required, status, request_json)
       VALUES ($1,$2,$3,$4::jsonb,$5,'OPEN',$6::jsonb)
       ON CONFLICT (task_id, request_key) DO UPDATE SET
         description=EXCLUDED.description
       WHERE task_input_request.schema=EXCLUDED.schema
         AND task_input_request.required=EXCLUDED.required
         AND task_input_request.request_json=EXCLUDED.request_json
       RETURNING request_key`,
      [
        taskId,
        input.key,
        input.description,
        JSON.stringify(input.schema),
        input.required,
        JSON.stringify(requestJson),
      ],
    );
    if (result.rowCount !== 1) throw new Error("STABLE_INPUT_REQUEST_CONFLICT");
  }
}

function commandHash(reason: string): string {
  return createHash("sha256").update(`cancel:${reason.toLowerCase()}`).digest("hex");
}

function canonicalizeResponse(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeResponse).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeResponse(object[key])}`)
    .join(",")}}`;
}

async function markAssignedInputResponsesIgnored(
  client: PoolClient,
  taskId: string,
  commandSequence: number,
): Promise<void> {
  await client.query(
    `UPDATE task_input_response_inbox
     SET state='IGNORED', updated_at=clock_timestamp(),
         last_error_code='SUPERSEDED_BY_SAFE_STOP',
         last_error_message='Safe stop superseded input response delivery.'
     WHERE task_id=$1 AND command_sequence=$2 AND state='ASSIGNED'`,
    [taskId, commandSequence],
  );
}

async function insertOutbox(
  client: PoolClient,
  taskId: string,
  type: string,
  payload: Record<string, unknown>,
  eventKey = `${taskId}:${type}:${randomUUID()}`,
): Promise<void> {
  const snapshot = await client.query<TaskRow>("SELECT * FROM provider_task WHERE task_id=$1", [
    taskId,
  ]);
  const task = snapshot.rows[0];
  const completePayload =
    task === undefined
      ? payload
      : {
          taskId,
          previousState: null,
          currentState: task.internal_state,
          previousSubstate: null,
          currentSubstate: task.substate,
          reasonCode: null,
          terminal: isTerminalState(task.internal_state),
          resultClass: taskResultClass(task),
          internalState: task.internal_state,
          status: task.mcp_status,
          substate: task.substate,
          statusMessage: task.status_message,
          externalExecutionId: task.external_execution_id,
          operationName: task.operation_name,
          executionMode: task.execution_mode,
          simulationId: task.simulation_id,
          argumentHash: task.argument_hash,
          authorizationContextHash: task.authorization_context_hash,
          observationRevision: Number(task.observation_revision),
          adapterRevision: Number(task.adapter_revision),
          occurredAt: new Date().toISOString(),
          ...payload,
        };
  const inserted = await client.query(
    `INSERT INTO outbox_event(event_id, event_key, aggregate_id, event_type, payload)
     VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (event_key) DO NOTHING RETURNING event_id`,
    [randomUUID(), eventKey, taskId, type, JSON.stringify(completePayload)],
  );
  if (inserted.rowCount === 1 && task !== undefined) {
    const occurredAt = timestampFromPayload(completePayload);
    await captureTaskProviderOpsDelivery(client, task, type, completePayload, eventKey, occurredAt);
  }
}

async function captureTaskProviderOpsDelivery(
  client: PoolClient,
  task: TaskRow,
  eventType: string,
  payload: Record<string, unknown>,
  eventKey: string,
  occurredAt: Date,
): Promise<void> {
  const commandSequence = finiteNumber(payload.commandSequence);
  const observationRevision = finiteNumber(payload.observationRevision);
  const isCommand = eventType.startsWith("task.command.");
  const revision = isCommand ? commandSequence : observationRevision;
  const envelope = createProviderOpsEnvelope({
    recordType: isCommand ? "provider.command.lifecycle" : "provider.task.lifecycle",
    eventCategory: isCommand ? "command.lifecycle" : "task.lifecycle",
    deliveryClass: "audit",
    providerId: task.provider_id,
    runtimeVersion: RUNTIME_VERSION,
    instanceId: "",
    taskId: task.task_id,
    resourceId: task.task_id,
    resourceType: "task",
    ...(task.external_execution_id === null
      ? {}
      : { externalExecutionId: task.external_execution_id }),
    operationName: task.operation_name,
    executionMode: task.execution_mode,
    ...(task.simulation_id === null ? {} : { simulationId: task.simulation_id }),
    argumentHash: task.argument_hash,
    authorizationContextHash: task.authorization_context_hash,
    adapterRevision: task.adapter_revision,
    ...(observationRevision === undefined ? {} : { observationRevision }),
    ...(!isCommand || commandSequence === undefined ? {} : { commandSequence }),
    eventType,
    stableAggregateIdentity: task.task_id,
    eventIdentity: eventKey,
    ...(revision === undefined ? {} : { revision }),
    occurredAt,
    attributes: { source: "committed_postgres", eventType },
    payload: providerOpsPayload(payload),
  });
  await captureProviderOpsDelivery(client, {
    envelope,
    eventKey,
    aggregateType: isCommand ? "command" : "task",
    aggregateId: task.task_id,
  });
}

function providerOpsPayload(
  payload: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const allowed = [
    "taskId",
    "commandSequence",
    "commandType",
    "previousState",
    "currentState",
    "previousSubstate",
    "currentSubstate",
    "reasonCode",
    "terminal",
    "resultClass",
    "status",
    "observationRevision",
    "adapterRevision",
    "attempt",
    "retryAfterMs",
    "adapterRpcStatus",
  ];
  const result: Record<string, string | number | boolean | null> = {};
  for (const key of allowed) {
    const value = payload[key];
    if (value === null || typeof value === "string" || typeof value === "boolean")
      result[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
  }
  return result;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function timestampFromPayload(payload: Record<string, unknown>): Date {
  const value = payload.occurredAt;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function taskResultClass(row: TaskRow): string | null {
  if (row.internal_state === "TERMINAL_FAILED") return "technical_failure";
  if (row.internal_state === "TERMINAL_CANCELLED") return "cancelled";
  if (row.internal_state !== "TERMINAL_COMPLETED") return null;
  const structured = row.result?.structuredContent;
  if (typeof structured === "object" && structured !== null && !Array.isArray(structured)) {
    const outcome = (structured as Record<string, unknown>).outcome;
    if (typeof outcome === "string") return outcome;
  }
  return row.result?.isError === true ? "business_failure" : "success";
}

async function recordCommandResolutionFact(
  pool: Pool,
  taskId: string,
  command: {
    sequence: number;
    commandType: PendingCommandRecord["commandType"];
    state: PendingCommandRecord["state"];
    attemptCount?: number;
  },
  eventType: string,
  extra: {
    previousState?: PendingCommandRecord["state"];
    retryAfterMs?: number;
    reasonCode?: string;
    adapterRpcStatus?: string;
  } = {},
): Promise<void> {
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (eventType === "task.command.duplicate") {
        const { eventKey, payload } = commandFact(taskId, command, eventType, extra);
        await client.query(
          `INSERT INTO outbox_event(event_id,event_key,aggregate_id,event_type,payload)
           VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (event_key) DO NOTHING`,
          [randomUUID(), eventKey, taskId, eventType, JSON.stringify(payload)],
        );
      } else {
        await insertCommandFact(client, taskId, command, eventType, extra);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch {
    // Operational telemetry persistence is best effort and cannot fail command processing.
  }
}

function commandFact(
  taskId: string,
  command: {
    sequence: number;
    commandType: PendingCommandRecord["commandType"];
    state: PendingCommandRecord["state"];
    attemptCount?: number;
  },
  eventType: string,
  extra: {
    previousState?: PendingCommandRecord["state"];
    retryAfterMs?: number;
    reasonCode?: string;
    adapterRpcStatus?: string;
  } = {},
): { eventKey: string; payload: Record<string, unknown> } {
  return {
    eventKey: `${taskId}:command:${String(command.sequence)}:${eventType}:${command.state}:${String(command.attemptCount ?? 0)}`,
    payload: {
      taskId,
      commandSequence: command.sequence,
      commandType: command.commandType,
      previousState: extra.previousState ?? command.state,
      currentState: command.state,
      ...(command.attemptCount === undefined ? {} : { attempt: command.attemptCount }),
      ...(extra.retryAfterMs === undefined ? {} : { retryAfterMs: extra.retryAfterMs }),
      ...(extra.reasonCode === undefined ? {} : { reasonCode: extra.reasonCode }),
      ...(extra.adapterRpcStatus === undefined ? {} : { adapterRpcStatus: extra.adapterRpcStatus }),
      occurredAt: new Date().toISOString(),
    },
  };
}

async function insertCommandFact(
  client: PoolClient,
  taskId: string,
  command: {
    sequence: number;
    commandType: PendingCommandRecord["commandType"];
    state: PendingCommandRecord["state"];
    attemptCount?: number;
  },
  eventType: string,
  extra: {
    previousState?: PendingCommandRecord["state"];
    retryAfterMs?: number;
    reasonCode?: string;
    adapterRpcStatus?: string;
  } = {},
): Promise<void> {
  const { eventKey, payload } = commandFact(taskId, command, eventType, extra);
  await insertOutbox(client, taskId, eventType, payload, eventKey);
}

function stableObservationType(transition: SnapshotTransition): string {
  if (transition.internalState === "TERMINAL_COMPLETED") return "task.completed";
  if (transition.internalState === "TERMINAL_FAILED") return "task.failed";
  if (transition.internalState === "TERMINAL_CANCELLED") return "task.cancelled";
  return transition.observationType;
}

function reasonCodeFromTransition(transition: SnapshotTransition): string | null {
  const body = transition.result ?? transition.error;
  if (body === null) return null;
  const structured = body.structuredContent;
  if (typeof structured === "object" && structured !== null && "reasonCode" in structured) {
    const reason = (structured as { reasonCode?: unknown }).reasonCode;
    return typeof reason === "string" ? reason : null;
  }
  const data = body.data;
  if (typeof data === "object" && data !== null && "reasonCode" in data) {
    const reason = (data as { reasonCode?: unknown }).reasonCode;
    return typeof reason === "string" ? reason : null;
  }
  return null;
}

function jsonOrNull(value: Record<string, unknown> | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

async function selectTaskById(
  queryable: Pool | PoolClient,
  taskId: string,
): Promise<TaskRecord | null> {
  const result = await queryable.query<TaskRow>("SELECT * FROM provider_task WHERE task_id=$1", [
    taskId,
  ]);
  return result.rows[0] === undefined ? null : fromRow(result.rows[0]);
}

function fromRow(row: TaskRow): TaskRecord {
  return {
    taskId: row.task_id,
    providerId: row.provider_id,
    operationName: row.operation_name,
    operationSnapshotId: row.operation_snapshot_id,
    authorizationContextHash: row.authorization_context_hash,
    traceId: row.trace_id,
    rootTraceparent: row.root_traceparent,
    rootTracestate: row.root_tracestate,
    correlationId: row.correlation_id,
    executionMode: row.execution_mode,
    simulationId: row.simulation_id,
    reservationRef: row.reservation_ref,
    arguments: row.arguments,
    argumentHash: row.argument_hash,
    externalExecutionId: row.external_execution_id,
    internalState: row.internal_state,
    mcpStatus: row.mcp_status,
    substate: row.substate,
    statusMessage: row.status_message,
    result: row.result,
    error: row.error,
    adapterRevision: Number(row.adapter_revision),
    observationRevision: Number(row.observation_revision),
    runtimeRevision: row.runtime_revision,
    ttlMs: row.ttl_ms === null ? null : Number(row.ttl_ms),
    handleExpiresAt: row.handle_expires_at,
    terminalAt: row.terminal_at,
    expiredAt: row.expired_at,
    purgeAfter: row.purge_after,
    lastConfirmedAt: row.last_confirmed_at,
    pollIntervalMs: row.poll_interval_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    runtimeUpdatedAt: row.runtime_updated_at,
    version: Number(row.version),
    acceptedAt: row.accepted_at,
    notBefore: row.not_before,
    latestStartAt: row.latest_start_at,
    actualStartedAt: row.actual_started_at,
    startStopRequestedAt: row.start_stop_requested_at,
    startConfirmationDeadline: row.start_confirmation_deadline,
    startConfirmationAttempts: row.start_confirmation_attempts,
    invocationAttempt: row.invocation_attempt,
    nextStartAttemptAt: row.next_start_attempt_at,
    scheduleClaimOwner: row.schedule_claim_owner,
    scheduleClaimUntil: row.schedule_claim_until,
    deadlineAt: row.deadline_at,
    cancelRequested: row.cancel_requested,
    stopReason: row.stop_reason,
    timing: row.timing,
    recoveryAttempts: row.recovery_attempts,
    nextRecoveryAt: row.next_recovery_at,
    recoveryFailureCount: row.recovery_failure_count,
    lastReconciledAt: row.last_reconciled_at,
  };
}

async function initializeTaskRetention(
  client: PoolClient,
  taskId: string,
  state: TaskRecord["internalState"],
  acceptedAt: Date,
  ttlMs: number | null,
): Promise<void> {
  const terminal = isTerminalState(state);
  const effectiveTtlMs = ttlMs ?? (terminal ? 86_400_000 : null);
  await client.query(
    `UPDATE provider_task
     SET terminal_at=$2,
         handle_expires_at=$3,
         last_confirmed_at=$4
     WHERE task_id=$1`,
    [
      taskId,
      terminal ? acceptedAt : null,
      effectiveTtlMs === null ? null : new Date(acceptedAt.getTime() + effectiveTtlMs),
      acceptedAt,
    ],
  );
}

async function materializeTaskResourceBinding(
  client: PoolClient,
  input: AdmissionIntentInput,
): Promise<void> {
  const snapshot = await client.query<{ definition: Record<string, unknown> }>(
    "SELECT definition FROM operation_snapshot WHERE snapshot_id=$1",
    [input.operationSnapshotId],
  );
  const definition = snapshot.rows[0]?.definition;
  const binding = definition?.resourceBinding;
  if (typeof binding !== "object" || binding === null) return;
  const record = binding as Record<string, unknown>;
  if (record.mode !== "ARGUMENT_REFERENCE") return;
  const pointer = record.resourceIdJsonPointer;
  if (typeof pointer !== "string") throw new Error("BUSINESS_EVENT_RESOURCE_BINDING_INVALID");
  const resourceRef = resolveJsonPointer(input.arguments, pointer);
  if (typeof resourceRef !== "string" || !/^[!-~]{1,512}$/.test(resourceRef)) {
    throw new Error("BUSINESS_EVENT_RESOURCE_BINDING_INVALID");
  }
  await client.query(
    `INSERT INTO provider_task_resource_binding
       (provider_id, task_id, resource_ref, operation_snapshot_id,
        authorization_context_hash, execution_mode, simulation_id,
        bound_at, terminal_at, retain_until)
     SELECT provider_id, task_id, $2, operation_snapshot_id,
            authorization_context_hash, execution_mode, simulation_id,
            accepted_at, terminal_at,
            COALESCE(terminal_at, accepted_at) + (1209960000 * interval '1 millisecond')
     FROM provider_task WHERE task_id=$1
     ON CONFLICT (provider_id, task_id) DO UPDATE
       SET retain_until=GREATEST(provider_task_resource_binding.retain_until, EXCLUDED.retain_until)`,
    [input.taskId, resourceRef],
  );
}

function resolveJsonPointer(document: unknown, pointer: string): unknown {
  if (pointer === "") return document;
  if (!pointer.startsWith("/")) throw new Error("BUSINESS_EVENT_RESOURCE_BINDING_INVALID");
  let current = document;
  for (const encoded of pointer.slice(1).split("/")) {
    const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (typeof current !== "object" || current === null || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
