import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { AdapterBusinessEvent } from "../../adapter-protocol/src/index.js";
import { canonicalSha256, jsonToProtoStruct } from "../../adapter-protocol/src/index.js";
import { businessEventSourceCapabilities } from "./sources.js";
import {
  assertMutationJournalEntry,
  assertMutationJournalTransition,
  sameMutationJournalIdentity,
} from "./mutation-journal.js";
import type {
  BusinessEventDraft,
  CommandAckClaim,
  CommandAckRecord,
  DeviceToolCallRecord,
  MutationJournalClaim,
  MutationJournalEntry,
  MutationJournalState,
  ProviderExecution,
  ProviderStore,
  SnapshotRecord,
} from "./types.js";
import type {
  SmppDiagnosticBinding,
  SmppDiagnosticControlResult,
  SmppDiagnosticLease,
  SmppDiagnosticReceipt,
} from "./diagnostics.js";

export class PostgresProviderStore implements ProviderStore {
  readonly pool: Pool;
  readonly tables: ProviderStoreTables;
  constructor(connectionString: string, maximum = 8, scope: "ugv" | "npc_tank" = "ugv") {
    this.pool = new Pool({ connectionString, max: maximum });
    this.tables = TABLES[scope];
  }
  async initialize(): Promise<void> {
    await this.pool.query("SELECT 1");
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
  async getExecution(taskId: string): Promise<ProviderExecution | undefined> {
    const result = await this.pool.query<{ payload: ProviderExecution }>(
      `SELECT payload FROM ${this.tables.execution} WHERE task_id = $1`,
      [taskId],
    );
    return result.rows[0]?.payload;
  }
  async listActiveExecutions(): Promise<ProviderExecution[]> {
    const result = await this.pool.query<{ payload: ProviderExecution }>(
      `SELECT payload FROM ${this.tables.execution} WHERE state NOT IN ('SUCCEEDED','BUSINESS_FAILED','CANCELLED','TECHNICAL_FAILED') ORDER BY created_at`,
    );
    return result.rows.map((row) => row.payload);
  }
  async putExecution(execution: ProviderExecution): Promise<void> {
    assertPostgresJsonbSafe(execution, "execution");
    const result = await this.pool.query(
      `INSERT INTO ${this.tables.execution}
       (task_id, external_execution_id, operation_name, argument_hash, resource_id, tracks,
        execution_context, downstream_mission_ids, state, revision, reason_code, progress, result,
        latest_snapshot_revision, payload, created_at, updated_at, terminal_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (task_id) DO UPDATE SET
         tracks=EXCLUDED.tracks, downstream_mission_ids=EXCLUDED.downstream_mission_ids,
         state=EXCLUDED.state, revision=EXCLUDED.revision, reason_code=EXCLUDED.reason_code,
         progress=EXCLUDED.progress, result=EXCLUDED.result,
         latest_snapshot_revision=EXCLUDED.latest_snapshot_revision, payload=EXCLUDED.payload,
         updated_at=EXCLUDED.updated_at, terminal_at=EXCLUDED.terminal_at
       WHERE ${this.tables.execution}.external_execution_id=EXCLUDED.external_execution_id
         AND ${this.tables.execution}.operation_name=EXCLUDED.operation_name
         AND ${this.tables.execution}.argument_hash=EXCLUDED.argument_hash`,
      [
        execution.taskId,
        execution.externalExecutionId,
        execution.operationName,
        execution.argumentHash,
        execution.resourceId,
        execution.tracks,
        execution.executionContext,
        execution.downstreamMissionIds,
        execution.state,
        execution.revision,
        execution.reasonCode,
        execution.progress ?? null,
        execution.result ?? null,
        execution.latestSnapshotRevision ?? null,
        execution,
        execution.createdAt,
        execution.updatedAt,
        execution.terminalAt ?? null,
      ],
    );
    if (result.rowCount !== 1) throw new Error("TASK_IDENTITY_CONFLICT");
  }
  async getCommandAck(
    taskId: string,
    command: string,
    commandSequence: string,
  ): Promise<CommandAckRecord | undefined> {
    const result = await this.pool.query<{ payload: CommandAckRecord }>(
      `SELECT payload FROM ${this.tables.commandAck} WHERE task_id=$1 AND command=$2 AND command_sequence=$3`,
      [taskId, command, commandSequence],
    );
    return result.rows[0]?.payload;
  }
  async claimCommandAck(ack: CommandAckRecord): Promise<CommandAckClaim> {
    assertPostgresJsonbSafe(ack, "commandAck");
    const claimed = await this.pool.query<{ payload: CommandAckRecord }>(
      `INSERT INTO ${this.tables.commandAck}(task_id, command, command_sequence, payload, created_at)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING payload`,
      [ack.taskId, ack.command, ack.commandSequence, ack, ack.createdAt],
    );
    const inserted = claimed.rows[0]?.payload;
    if (inserted !== undefined) return { claimed: true, record: inserted };
    const existing = await this.getCommandAck(ack.taskId, ack.command, ack.commandSequence);
    if (existing === undefined) throw new Error("COMMAND_ACK_CLAIM_LOST");
    return { claimed: false, record: existing };
  }
  async completeCommandAck(ack: CommandAckRecord, expectedReasonCode?: string): Promise<boolean> {
    assertPostgresJsonbSafe(ack, "commandAck");
    const result = await this.pool.query(
      `UPDATE ${this.tables.commandAck} SET payload=$4, created_at=$5
       WHERE task_id=$1 AND command=$2 AND command_sequence=$3
         AND ($6::text IS NULL OR payload->'response'->>'reasonCode'=$6)`,
      [
        ack.taskId,
        ack.command,
        ack.commandSequence,
        ack,
        ack.createdAt,
        expectedReasonCode ?? null,
      ],
    );
    if (result.rowCount === 1) return true;
    if (expectedReasonCode !== undefined) return false;
    throw new Error("COMMAND_ACK_CLAIM_REQUIRED");
  }
  async putCommandAck(ack: CommandAckRecord): Promise<void> {
    assertPostgresJsonbSafe(ack, "commandAck");
    await this.pool.query(
      `INSERT INTO ${this.tables.commandAck}(task_id, command, command_sequence, payload, created_at)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [ack.taskId, ack.command, ack.commandSequence, ack, ack.createdAt],
    );
  }
  async getMutationJournalEntry(
    taskId: string,
    stepId: string,
  ): Promise<MutationJournalEntry | undefined> {
    const result = await this.pool.query<{ payload: MutationJournalEntry }>(
      `SELECT payload FROM ${this.tables.mutationJournal} WHERE task_id=$1 AND step_id=$2`,
      [taskId, stepId],
    );
    return result.rows[0]?.payload;
  }
  async listMutationJournal(taskId: string): Promise<MutationJournalEntry[]> {
    const result = await this.pool.query<{ payload: MutationJournalEntry }>(
      `SELECT payload FROM ${this.tables.mutationJournal}
       WHERE task_id=$1 ORDER BY intent_persisted_at, step_id`,
      [taskId],
    );
    return result.rows.map(({ payload }) => payload);
  }
  async claimMutationJournal(entry: MutationJournalEntry): Promise<MutationJournalClaim> {
    assertMutationJournalEntry(entry);
    assertPostgresJsonbSafe(entry, "mutationJournal");
    if (entry.state !== "INTENT_PERSISTED")
      throw new Error("MUTATION_JOURNAL_INTENT_STATE_REQUIRED");
    const result = await this.pool.query<{ payload: MutationJournalEntry }>(
      `INSERT INTO ${this.tables.mutationJournal}
       (task_id,step_id,phase,tool_name,argument_hash,state,external_mission_id,result_hash,
        intent_persisted_at,dispatched_at,completed_at,payload)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT DO NOTHING RETURNING payload`,
      journalValues(entry),
    );
    const inserted = result.rows[0]?.payload;
    if (inserted !== undefined) return { claimed: true, record: inserted };
    const existing = await this.getMutationJournalEntry(entry.taskId, entry.stepId);
    if (existing === undefined) throw new Error("MUTATION_JOURNAL_CLAIM_LOST");
    if (!sameMutationJournalIdentity(existing, entry))
      throw new Error("MUTATION_JOURNAL_IDENTITY_CONFLICT");
    return { claimed: false, record: existing };
  }
  async advanceMutationJournal(
    entry: MutationJournalEntry,
    expectedState: MutationJournalState,
  ): Promise<boolean> {
    assertPostgresJsonbSafe(entry, "mutationJournal");
    const existing = await this.getMutationJournalEntry(entry.taskId, entry.stepId);
    if (existing === undefined) throw new Error("MUTATION_JOURNAL_INTENT_REQUIRED");
    if (!sameMutationJournalIdentity(existing, entry))
      throw new Error("MUTATION_JOURNAL_IDENTITY_CONFLICT");
    if (existing.state !== expectedState) return false;
    assertMutationJournalTransition(existing, entry, expectedState);
    const values = journalValues(entry);
    const result = await this.pool.query(
      `UPDATE ${this.tables.mutationJournal}
       SET state=$6,external_mission_id=$7,result_hash=$8,dispatched_at=$10,
           completed_at=$11,payload=$12
       WHERE task_id=$1 AND step_id=$2 AND phase=$3 AND tool_name=$4 AND argument_hash=$5
         AND state=$13 AND intent_persisted_at=$9`,
      [...values, expectedState],
    );
    return result.rowCount === 1;
  }
  async appendDeviceToolCall(record: DeviceToolCallRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.tables.deviceToolCall}
       (call_id,task_id,tool_name,argument_hash,outcome,duration_ms,occurred_at)
       VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [
        record.callId,
        record.taskId ?? null,
        record.toolName,
        record.argumentHash,
        record.outcome,
        record.durationMs,
        record.occurredAt,
      ],
    );
  }
  async putSnapshot(record: SnapshotRecord): Promise<void> {
    assertPostgresJsonbSafe(record.snapshot, "snapshot");
    await this.pool.query(
      `INSERT INTO ${this.tables.snapshot}(revision, observed_at, snapshot)
       VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
      [record.revision, record.observedAt, record.snapshot],
    );
  }
  async armDiagnosticLease(
    lease: Omit<SmppDiagnosticLease, "fence">,
    receipt: Omit<SmppDiagnosticReceipt, "state">,
  ): Promise<SmppDiagnosticControlResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `ugv-diagnostic:${lease.stableOperationKey}`,
      ]);
      const existing = await client.query<{ payload: SmppDiagnosticLease }>(
        "SELECT payload FROM ugv_diagnostic_lease WHERE stable_operation_key=$1 FOR UPDATE",
        [lease.stableOperationKey],
      );
      const prior = existing.rows[0]?.payload;
      if (prior !== undefined) {
        if (prior.canonicalRequestHash !== lease.canonicalRequestHash)
          throw new Error("SMPP_DIAGNOSTIC_OPERATION_CONFLICT");
        const result = await diagnosticResult(client, prior, "armed");
        await client.query("COMMIT");
        return result;
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `ugv-diagnostic-selector:${lease.scope.selector.argumentHash}`,
      ]);
      const selectorConflict = await client.query(
        `SELECT lease_id FROM ugv_diagnostic_lease
         WHERE selector_argument_hash=$1
           AND state IN ('ARMED','BOUND') AND expires_at>$2
         FOR UPDATE`,
        [lease.scope.selector.argumentHash, lease.armedAt],
      );
      if ((selectorConflict.rowCount ?? 0) > 0)
        throw new Error("SMPP_DIAGNOSTIC_SELECTOR_CONFLICT");
      const allocated = await client.query<{ fence: string }>(
        "SELECT nextval('ugv_diagnostic_fence_seq')::text AS fence",
      );
      const fence = allocated.rows[0]?.fence;
      if (fence === undefined) throw new Error("SMPP_DIAGNOSTIC_FENCE_ALLOCATION_FAILED");
      const stored: SmppDiagnosticLease = { ...lease, fence };
      const storedReceipt: SmppDiagnosticReceipt = { ...receipt, state: stored.state };
      await client.query(
        `INSERT INTO ugv_diagnostic_lease(
           lease_id,capability_id,stable_operation_key,canonical_request_hash,idempotency_key,
           fence,state,selector_argument_hash,logical_invocation_id,scoped_task_id,
           expires_at,payload,created_at,updated_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,$10,$11,$12,$12)`,
        [
          stored.leaseId,
          stored.capabilityId,
          stored.stableOperationKey,
          stored.canonicalRequestHash,
          stored.idempotencyKey,
          stored.fence,
          stored.state,
          stored.scope.selector.argumentHash,
          stored.scope.taskId ?? null,
          stored.expiresAt,
          stored,
          stored.armedAt,
        ],
      );
      await insertDiagnosticReceipt(client, storedReceipt);
      await client.query("COMMIT");
      return { lease: stored, receipt: storedReceipt };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async getDiagnosticLease(leaseId: string): Promise<SmppDiagnosticLease | undefined> {
    const result = await this.pool.query<{ payload: SmppDiagnosticLease }>(
      "SELECT payload FROM ugv_diagnostic_lease WHERE lease_id=$1",
      [leaseId],
    );
    return result.rows[0]?.payload;
  }
  async getDiagnosticStatus(leaseId: string): Promise<SmppDiagnosticControlResult | undefined> {
    const result = await this.pool.query<{
      lease: SmppDiagnosticLease;
      receipt: SmppDiagnosticReceipt;
    }>(
      `SELECT lease.payload AS lease, receipt.payload AS receipt
       FROM ugv_diagnostic_lease lease
       JOIN LATERAL (
         SELECT payload FROM ugv_diagnostic_receipt
         WHERE lease_id=lease.lease_id ORDER BY occurred_at DESC, receipt_id DESC LIMIT 1
       ) receipt ON true
       WHERE lease.lease_id=$1`,
      [leaseId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { lease: row.lease, receipt: row.receipt };
  }
  async disarmDiagnosticLease(
    leaseId: string,
    requestHash: string,
    receiptId: string,
    occurredAt: string,
  ): Promise<SmppDiagnosticControlResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const lease = await lockedDiagnosticLease(client, leaseId);
      const prior = await optionalDiagnosticReceipt(client, leaseId, "disarmed");
      if (prior !== undefined) {
        if (prior.requestHash !== requestHash)
          throw new Error("SMPP_DIAGNOSTIC_OPERATION_CONFLICT");
        await client.query("COMMIT");
        return { lease, receipt: prior };
      }
      const next: SmppDiagnosticLease = {
        ...lease,
        state: "DISARMED",
        cleanupAt: occurredAt,
      };
      const receipt: SmppDiagnosticReceipt = {
        contract: lease.contract,
        receiptId,
        leaseId,
        action: "disarmed",
        requestHash,
        occurredAt,
        state: next.state,
        reasonCode: "SMPP_DIAGNOSTIC_DISARMED",
      };
      await updateDiagnosticLease(client, next, occurredAt);
      await insertDiagnosticReceipt(client, receipt);
      await client.query("COMMIT");
      return { lease: next, receipt };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async bindDiagnosticLease(
    binding: SmppDiagnosticBinding,
  ): Promise<SmppDiagnosticControlResult | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `ugv-diagnostic-selector:${binding.argumentHash}`,
      ]);
      const result = await client.query<{ payload: SmppDiagnosticLease }>(
        `SELECT payload FROM ugv_diagnostic_lease
         WHERE capability_id=$1 AND selector_argument_hash=$2 AND state='ARMED'
           AND (scoped_task_id IS NULL OR scoped_task_id=$3) AND expires_at>$4
         ORDER BY fence FOR UPDATE`,
        [binding.capabilityId, binding.argumentHash, binding.taskId, binding.observedAt],
      );
      if (result.rows.length > 1) throw new Error("SMPP_DIAGNOSTIC_SELECTOR_AMBIGUOUS");
      const lease = result.rows[0]?.payload;
      if (lease === undefined) {
        await client.query("COMMIT");
        return undefined;
      }
      const next: SmppDiagnosticLease = {
        ...lease,
        state: "BOUND",
        boundAt: binding.observedAt,
        logicalInvocationId: binding.logicalInvocationId,
        taskId: binding.taskId,
        externalExecutionId: binding.externalExecutionId,
        deviceMissionId: binding.deviceMissionId,
      };
      const receipt: SmppDiagnosticReceipt = {
        contract: lease.contract,
        receiptId: randomUUID(),
        leaseId: lease.leaseId,
        action: "bound",
        requestHash: lease.canonicalRequestHash,
        occurredAt: binding.observedAt,
        state: next.state,
        reasonCode: "SMPP_DIAGNOSTIC_BOUND",
        binding: diagnosticReceiptBinding(binding),
      };
      await updateDiagnosticLease(client, next, binding.observedAt);
      await insertDiagnosticReceipt(client, receipt);
      await client.query("COMMIT");
      return { lease: next, receipt };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async consumeDiagnosticLease(
    leaseId: string,
    requestHash: string,
    receiptId: string,
    occurredAt: string,
  ): Promise<SmppDiagnosticControlResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const lease = await lockedDiagnosticLease(client, leaseId);
      const prior = await optionalDiagnosticReceipt(client, leaseId, "consumed");
      if (prior !== undefined) {
        await client.query("COMMIT");
        return { lease, receipt: prior };
      }
      if (lease.state !== "BOUND") throw new Error("SMPP_DIAGNOSTIC_NOT_BOUND");
      const next: SmppDiagnosticLease = {
        ...lease,
        state: "CONSUMED",
        consumedAt: occurredAt,
      };
      const receipt: SmppDiagnosticReceipt = {
        contract: lease.contract,
        receiptId,
        leaseId,
        action: "consumed",
        requestHash,
        occurredAt,
        state: next.state,
        reasonCode: "SMPP_DIAGNOSTIC_CONSUMED",
        ...(next.logicalInvocationId === undefined ||
        next.taskId === undefined ||
        next.externalExecutionId === undefined ||
        next.deviceMissionId === undefined
          ? {}
          : {
              binding: {
                operationName: next.operationName,
                argumentHash: next.scope.selector.argumentHash,
                logicalInvocationId: next.logicalInvocationId,
                taskId: next.taskId,
                externalExecutionId: next.externalExecutionId,
                deviceMissionId: next.deviceMissionId,
              },
            }),
      };
      await updateDiagnosticLease(client, next, occurredAt);
      await insertDiagnosticReceipt(client, receipt);
      await client.query("COMMIT");
      return { lease: next, receipt };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async expireDiagnosticLeases(
    occurredAt: string,
  ): Promise<readonly SmppDiagnosticControlResult[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const expired = await client.query<{ payload: SmppDiagnosticLease }>(
        `SELECT payload FROM ugv_diagnostic_lease
         WHERE state IN ('ARMED','BOUND') AND expires_at<=$1 ORDER BY fence FOR UPDATE`,
        [occurredAt],
      );
      const results: SmppDiagnosticControlResult[] = [];
      for (const { payload: lease } of expired.rows) {
        const next: SmppDiagnosticLease = { ...lease, state: "EXPIRED", cleanupAt: occurredAt };
        const receipt: SmppDiagnosticReceipt = {
          contract: lease.contract,
          receiptId: randomUUID(),
          leaseId: lease.leaseId,
          action: "expired",
          requestHash: lease.canonicalRequestHash,
          occurredAt,
          state: next.state,
          reasonCode: "SMPP_DIAGNOSTIC_EXPIRED",
        };
        await updateDiagnosticLease(client, next, occurredAt);
        await insertDiagnosticReceipt(client, receipt);
        results.push({ lease: next, receipt });
      }
      await client.query("COMMIT");
      return results;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async appendBusinessEvent(draft: BusinessEventDraft): Promise<AdapterBusinessEvent> {
    assertPostgresJsonbSafe(draft.rawPayload, "businessEvent.rawPayload");
    const source = businessEventSourceCapabilities().find((x) => x.sourceId === draft.sourceId);
    if (source === undefined) throw new Error("SOURCE_NOT_FOUND");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const sequence = await nextSequence(
        client,
        this.tables,
        draft.sourceId,
        source.sourceStreamId,
      );
      const sourceEventId = createHash("sha256")
        .update(`${draft.sourceId}\0${sequence}\0${randomUUID()}`)
        .digest("base64url");
      const event: AdapterBusinessEvent = {
        sourceEventId,
        sourceSequence: sequence,
        sourceStreamId: source.sourceStreamId,
        scope: draft.scope,
        occurredAt: timestamp(draft.occurredAt),
        eventType: draft.eventType,
        description: draft.description,
        ...(draft.externalExecutionId === undefined
          ? {}
          : { externalExecutionId: draft.externalExecutionId }),
        ...(draft.resourceRef === undefined ? {} : { resourceRef: draft.resourceRef }),
        severityHint: draft.severityHint,
        reasonCode: draft.reasonCode,
        rawPayload: jsonToProtoStruct(draft.rawPayload),
      };
      await client.query(
        `INSERT INTO ${this.tables.businessEventLog}
         (source_id,source_sequence,source_event_id,source_stream_id,payload_hash,occurred_at,retain_until,payload)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          draft.sourceId,
          sequence,
          sourceEventId,
          source.sourceStreamId,
          canonicalSha256(draft.rawPayload),
          draft.occurredAt,
          draft.retainUntil,
          event,
        ],
      );
      await client.query("COMMIT");
      return event;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async replayBusinessEvents(
    sourceId: string,
    sourceStreamId: string,
    afterSourceSequence: bigint,
  ): Promise<AdapterBusinessEvent[]> {
    const source = businessEventSourceCapabilities().find((x) => x.sourceId === sourceId);
    if (source === undefined) throw new Error("SOURCE_NOT_FOUND");
    if (source.sourceStreamId !== sourceStreamId) throw new Error("SOURCE_STREAM_RESET");
    const range = await this.pool.query<{ minimum: string | null; maximum: string | null }>(
      `SELECT min(source_sequence)::text AS minimum, max(source_sequence)::text AS maximum
       FROM ${this.tables.businessEventLog} WHERE source_id=$1 AND retain_until > now()`,
      [sourceId],
    );
    const maximum = BigInt(range.rows[0]?.maximum ?? "0");
    const minimum = BigInt(range.rows[0]?.minimum ?? "1");
    if (afterSourceSequence > maximum) throw new Error("SOURCE_CURSOR_AHEAD");
    if (maximum > 0n && afterSourceSequence + 1n < minimum)
      throw new Error("SOURCE_CURSOR_EXPIRED");
    const result = await this.pool.query<{ payload: AdapterBusinessEvent }>(
      `SELECT payload FROM ${this.tables.businessEventLog}
       WHERE source_id=$1 AND source_sequence>$2 AND retain_until > now()
       ORDER BY source_sequence LIMIT 1000`,
      [sourceId, afterSourceSequence.toString()],
    );
    return result.rows.map((row) => row.payload);
  }
  businessEventSources() {
    return businessEventSourceCapabilities();
  }
}

async function nextSequence(
  client: PoolClient,
  tables: ProviderStoreTables,
  sourceId: string,
  streamId: string,
): Promise<string> {
  await client.query(
    `INSERT INTO ${tables.businessEventState}(source_id,source_stream_id,next_sequence)
     VALUES($1,$2,1) ON CONFLICT DO NOTHING`,
    [sourceId, streamId],
  );
  const result = await client.query<{ next_sequence: string }>(
    `UPDATE ${tables.businessEventState} SET next_sequence=next_sequence+1,updated_at=now()
     WHERE source_id=$1 AND source_stream_id=$2 RETURNING (next_sequence-1)::text AS next_sequence`,
    [sourceId, streamId],
  );
  const value = result.rows[0]?.next_sequence;
  if (value === undefined) throw new Error("SOURCE_STREAM_RESET");
  return value;
}

interface ProviderStoreTables {
  execution: string;
  commandAck: string;
  mutationJournal: string;
  deviceToolCall: string;
  snapshot: string;
  businessEventState: string;
  businessEventLog: string;
}
const TABLES: Record<"ugv" | "npc_tank", ProviderStoreTables> = {
  ugv: {
    execution: "ugv_execution",
    commandAck: "ugv_execution_command_ack",
    mutationJournal: "ugv_mutation_journal",
    deviceToolCall: "ugv_device_tool_call",
    snapshot: "ugv_state_snapshot",
    businessEventState: "ugv_business_event_source_state",
    businessEventLog: "ugv_business_event_source_log",
  },
  npc_tank: {
    execution: "npc_tank_execution",
    commandAck: "npc_tank_execution_command_ack",
    mutationJournal: "npc_tank_mutation_journal",
    deviceToolCall: "npc_tank_device_tool_call",
    snapshot: "npc_tank_state_snapshot",
    businessEventState: "npc_tank_business_event_source_state",
    businessEventLog: "npc_tank_business_event_source_log",
  },
};

function journalValues(entry: MutationJournalEntry): unknown[] {
  return [
    entry.taskId,
    entry.stepId,
    entry.phase,
    entry.toolName,
    entry.argumentHash,
    entry.state,
    entry.externalMissionId ?? null,
    entry.resultHash ?? null,
    entry.intentPersistedAt,
    entry.dispatchedAt ?? null,
    entry.completedAt ?? null,
    entry,
  ];
}
async function lockedDiagnosticLease(
  client: PoolClient,
  leaseId: string,
): Promise<SmppDiagnosticLease> {
  const result = await client.query<{ payload: SmppDiagnosticLease }>(
    "SELECT payload FROM ugv_diagnostic_lease WHERE lease_id=$1 FOR UPDATE",
    [leaseId],
  );
  const lease = result.rows[0]?.payload;
  if (lease === undefined) throw new Error("SMPP_DIAGNOSTIC_LEASE_NOT_FOUND");
  return lease;
}
async function optionalDiagnosticReceipt(
  client: PoolClient,
  leaseId: string,
  action: SmppDiagnosticReceipt["action"],
): Promise<SmppDiagnosticReceipt | undefined> {
  const result = await client.query<{ payload: SmppDiagnosticReceipt }>(
    "SELECT payload FROM ugv_diagnostic_receipt WHERE lease_id=$1 AND action=$2",
    [leaseId, action],
  );
  return result.rows[0]?.payload;
}
async function diagnosticResult(
  client: PoolClient,
  lease: SmppDiagnosticLease,
  action: SmppDiagnosticReceipt["action"],
): Promise<SmppDiagnosticControlResult> {
  const receipt = await optionalDiagnosticReceipt(client, lease.leaseId, action);
  if (receipt === undefined) throw new Error("SMPP_DIAGNOSTIC_RECEIPT_NOT_FOUND");
  return { lease, receipt };
}
async function insertDiagnosticReceipt(
  client: PoolClient,
  receipt: SmppDiagnosticReceipt,
): Promise<void> {
  await client.query(
    `INSERT INTO ugv_diagnostic_receipt(
       receipt_id,lease_id,action,request_hash,occurred_at,payload
     ) VALUES($1,$2,$3,$4,$5,$6)`,
    [
      receipt.receiptId,
      receipt.leaseId,
      receipt.action,
      receipt.requestHash,
      receipt.occurredAt,
      receipt,
    ],
  );
}
async function updateDiagnosticLease(
  client: PoolClient,
  lease: SmppDiagnosticLease,
  updatedAt: string,
): Promise<void> {
  const result = await client.query(
    `UPDATE ugv_diagnostic_lease
     SET state=$2,logical_invocation_id=$3,bound_task_id=$4,external_execution_id=$5,
         device_mission_id=$6,payload=$7,updated_at=$8
     WHERE lease_id=$1`,
    [
      lease.leaseId,
      lease.state,
      lease.logicalInvocationId ?? null,
      lease.taskId ?? null,
      lease.externalExecutionId ?? null,
      lease.deviceMissionId ?? null,
      lease,
      updatedAt,
    ],
  );
  if (result.rowCount !== 1) throw new Error("SMPP_DIAGNOSTIC_LEASE_NOT_FOUND");
}
function diagnosticReceiptBinding(binding: SmppDiagnosticBinding) {
  return {
    operationName: binding.operationName,
    argumentHash: binding.argumentHash,
    logicalInvocationId: binding.logicalInvocationId,
    taskId: binding.taskId,
    externalExecutionId: binding.externalExecutionId,
    deviceMissionId: binding.deviceMissionId,
  };
}
function timestamp(value: string): { seconds: string; nanos: number } {
  const milliseconds = Date.parse(value);
  return {
    seconds: String(Math.floor(milliseconds / 1000)),
    nanos: (milliseconds % 1000) * 1_000_000,
  };
}

export class ProviderStoreJsonbUnsafePayloadError extends Error {
  readonly code = "PROVIDER_STORE_JSONB_UNSAFE_PAYLOAD";

  constructor(
    readonly rootName: string,
    readonly path: string,
    readonly unsafeKind: "nul_string" | "non_finite_number" | "bigint" | "cyclic_reference",
  ) {
    super(`PROVIDER_STORE_JSONB_UNSAFE_PAYLOAD root=${rootName} path=${path} kind=${unsafeKind}`);
    this.name = "ProviderStoreJsonbUnsafePayloadError";
  }
}

export function assertPostgresJsonbSafe(value: unknown, rootName: string): void {
  const active = new WeakSet();
  const visit = (current: unknown, path: string): void => {
    if (typeof current === "string") {
      if (current.includes("\0"))
        throw new ProviderStoreJsonbUnsafePayloadError(rootName, path, "nul_string");
      return;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current))
        throw new ProviderStoreJsonbUnsafePayloadError(rootName, path, "non_finite_number");
      return;
    }
    if (typeof current === "bigint")
      throw new ProviderStoreJsonbUnsafePayloadError(rootName, path, "bigint");
    if (current === null || typeof current !== "object") return;
    if (active.has(current))
      throw new ProviderStoreJsonbUnsafePayloadError(rootName, path, "cyclic_reference");
    active.add(current);
    if (Array.isArray(current)) {
      for (const [index, child] of current.entries()) visit(child, `${path}/${String(index)}`);
    } else {
      for (const [key, child] of Object.entries(current)) {
        const childPath = `${path}/${diagnosticPathSegment(key)}`;
        if (key.includes("\0"))
          throw new ProviderStoreJsonbUnsafePayloadError(rootName, childPath, "nul_string");
        visit(child, childPath);
      }
    }
    active.delete(current);
  };
  visit(value, "$");
}

function diagnosticPathSegment(value: string): string {
  return value
    .slice(0, 128)
    .replaceAll("~", "~0")
    .replaceAll("/", "~1")
    .replace(/\p{Cc}/gu, "?");
}
