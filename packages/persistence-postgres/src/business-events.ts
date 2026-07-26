import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  businessEventId,
  canonicalSha256,
  normalizeRfc3339Nano,
  parseBusinessEventSequence,
} from "../../adapter-protocol/src/index.js";
import type { BusinessEventProviderOpsRecorderLike } from "./business-event-provider-ops.js";

export type BusinessEventDeliverySemantics = "durable_at_least_once" | "best_effort_live";
export type BusinessEventContinuityClass = "all_durable" | "mixed" | "best_effort_only";

export interface BusinessEventSourceDefinition {
  sourceId: string;
  sourceStreamId: string;
  deliverySemantics: BusinessEventDeliverySemantics;
}

export interface BusinessEventGeneration {
  providerId: string;
  streamId: string;
  status: "current" | "rotating" | "replayable_closed" | "retired";
  currentSequence: string;
  earliestAvailableSequence: string;
  lastReplayableSequence: string;
  lastContinuousSequence: string | null;
  continuityClass: BusinessEventContinuityClass;
}

export interface BusinessEventLease {
  providerId: string;
  sourceId: string;
  sourceStreamId: string;
  owner: string;
  fencingToken: string;
  leaseUntil: Date;
  lastPersistedSourceSequence: string;
  lastFinalizedSourceSequence: string;
}

export interface ProjectionIdentity {
  providerId: string;
  streamId: string;
  eventId: string;
  authorizationScopeHash: string;
  executionMode: "live" | "simulation" | "historical-replay";
  simulationId: string | null;
  candidateRelationHash: string;
  projectionRelationHash: string;
}

export interface ProjectionPage {
  items: string[];
  total: number;
  nextAfterTaskId?: string;
}

export interface BusinessEventSourceFact {
  sourceEventId: string;
  sourceSequence: string;
  sourceStreamId: string;
  scope: "task" | "resource";
  occurredAt: string;
  eventType: string;
  description: string;
  externalExecutionId?: string;
  resourceRef?: string;
  severityHint?: "info" | "warning" | "critical";
  reasonCode?: string;
  rawPayload?: unknown;
}

export interface IntakeResult {
  disposition: "received" | "duplicate" | "rejected";
  sourceCanonicalHash?: string;
}

export interface FinalizedBusinessEvent {
  providerId: string;
  streamId: string;
  sequence: string;
  eventId: string;
  sourceId: string;
  sourceStreamId: string;
  sourceEventId: string;
  sourceSequence: string;
  eventType: string;
  occurredAt: Date;
  scope: "task" | "resource";
  description: string;
  taskId: string | null;
  resourceRef: string | null;
  candidateRelatedTaskCount: number;
  severityHint: "info" | "warning" | "critical" | null;
  reasonCode: string | null;
  rawPayload: unknown;
}

export interface RotationResult {
  previousStreamId: string;
  newStreamId: string;
  reasonCode: string;
  affectedSourceIds: string[];
  lastReplayableSequence: string;
  lastContinuousSequence: string | null;
  gapDetectedAt: Date;
}

export interface BusinessEventAuthorizationSnapshot {
  authorizationScopeHash: string;
  executionMode: "live" | "simulation" | "historical-replay";
  simulationId: string | null;
}

export interface AuthorizedBusinessEventProjection {
  event: FinalizedBusinessEvent;
  relatedTaskIds: string[];
  candidateRelationHash: string;
  projectionRelationHash: string;
}

export interface BusinessEventRepositoryOptions {
  providerOpsRecorder?: BusinessEventProviderOpsRecorderLike;
}

export class BusinessEventRepository {
  readonly providerOpsRecorder: BusinessEventProviderOpsRecorderLike | undefined;

  constructor(
    readonly pool: Pool,
    options: BusinessEventRepositoryOptions = {},
  ) {
    this.providerOpsRecorder = options.providerOpsRecorder;
  }

  async initializeProvider(
    providerId: string,
    sources: BusinessEventSourceDefinition[],
    generationRetentionMs: number,
  ): Promise<BusinessEventGeneration> {
    if (sources.length < 1 || sources.length > 16)
      throw new Error("BUSINESS_EVENT_SOURCE_COUNT_INVALID");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<GenerationRow>(
        `SELECT g.* FROM provider_business_event_runtime_state r
         JOIN provider_business_event_stream_generation g
           ON g.provider_id=r.provider_id AND g.stream_id=r.current_stream_id
         WHERE r.provider_id=$1 FOR UPDATE OF r, g`,
        [providerId],
      );
      if (existing.rows[0] !== undefined) {
        await client.query("COMMIT");
        return mapGeneration(existing.rows[0]);
      }

      const streamId = randomUUID();
      const continuityClass = classifyContinuity(sources);
      await client.query(
        `INSERT INTO provider_business_event_stream_generation
           (provider_id, stream_id, status, continuity_class, retain_until)
         VALUES ($1,$2,'current',$3,clock_timestamp() + ($4 * interval '1 millisecond'))`,
        [providerId, streamId, continuityClass, generationRetentionMs],
      );
      await client.query(
        `INSERT INTO provider_business_event_runtime_state
           (provider_id, current_stream_id, generation_version) VALUES ($1,$2,1)`,
        [providerId, streamId],
      );
      for (const source of [...sources].sort((left, right) =>
        compareText(left.sourceId, right.sourceId),
      )) {
        await client.query(
          `INSERT INTO provider_business_event_generation_source
             (provider_id, runtime_stream_id, source_id, source_stream_id,
              delivery_semantics, joined_at_runtime_sequence)
           VALUES ($1,$2,$3,$4,$5,0)`,
          [providerId, streamId, source.sourceId, source.sourceStreamId, source.deliverySemantics],
        );
        await client.query(
          `INSERT INTO adapter_business_event_source_state
             (provider_id, source_id, source_stream_id, delivery_semantics, status)
           VALUES ($1,$2,$3,$4,'active')`,
          [providerId, source.sourceId, source.sourceStreamId, source.deliverySemantics],
        );
      }
      await this.providerOpsRecorder?.capture({
        client,
        providerId,
        recordType: "provider.business_event.stream.lifecycle",
        aggregateId: providerId,
        stableAggregateIdentity: streamId,
        eventIdentity: "generation_created",
        revision: "1",
        occurredAt: new Date(),
        payload: {
          event: "generation_created",
          currentStreamId: streamId,
          generationStatus: "current",
          continuityClass,
          generationVersion: "1",
        },
      });
      await client.query("COMMIT");
      return {
        providerId,
        streamId,
        status: "current",
        currentSequence: "0",
        earliestAvailableSequence: "1",
        lastReplayableSequence: "0",
        lastContinuousSequence: null,
        continuityClass,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async currentGeneration(providerId: string): Promise<BusinessEventGeneration | undefined> {
    const result = await this.pool.query<GenerationRow>(
      `SELECT g.* FROM provider_business_event_runtime_state r
       JOIN provider_business_event_stream_generation g
         ON g.provider_id=r.provider_id AND g.stream_id=r.current_stream_id
       WHERE r.provider_id=$1`,
      [providerId],
    );
    return result.rows[0] === undefined ? undefined : mapGeneration(result.rows[0]);
  }

  async generation(
    providerId: string,
    streamId: string,
  ): Promise<BusinessEventGeneration | undefined> {
    const result = await this.pool.query<GenerationRow>(
      `SELECT * FROM provider_business_event_stream_generation WHERE provider_id=$1 AND stream_id=$2`,
      [providerId, streamId],
    );
    return result.rows[0] === undefined ? undefined : mapGeneration(result.rows[0]);
  }

  async sourceRoster(
    providerId: string,
    streamId: string,
  ): Promise<BusinessEventSourceDefinition[]> {
    const result = await this.pool.query<{
      source_id: string;
      source_stream_id: string;
      delivery_semantics: BusinessEventDeliverySemantics;
    }>(
      `SELECT source_id, source_stream_id, delivery_semantics
       FROM provider_business_event_generation_source
       WHERE provider_id=$1 AND runtime_stream_id=$2 ORDER BY source_id`,
      [providerId, streamId],
    );
    return result.rows.map((row) => ({
      sourceId: row.source_id,
      sourceStreamId: row.source_stream_id,
      deliverySemantics: row.delivery_semantics,
    }));
  }

  async acquireSourceLease(
    providerId: string,
    sourceId: string,
    sourceStreamId: string,
    owner: string,
    leaseMs: number,
  ): Promise<BusinessEventLease | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const before = await client.query<{
        lease_owner: string | null;
        lease_until: Date | null;
        fencing_token: string;
        status: string;
      }>(
        `SELECT lease_owner,lease_until,fencing_token,status
         FROM adapter_business_event_source_state
         WHERE provider_id=$1 AND source_id=$2 AND source_stream_id=$3 FOR UPDATE`,
        [providerId, sourceId, sourceStreamId],
      );
      const previous = before.rows[0];
      if (
        previous === undefined ||
        previous.status.startsWith("blocked_") ||
        previous.status === "continuity_loss_pending" ||
        (previous.lease_until !== null &&
          previous.lease_until > new Date() &&
          previous.lease_owner !== owner)
      ) {
        await client.query("COMMIT");
        return undefined;
      }
      const result = await client.query<SourceStateRow>(
        `UPDATE adapter_business_event_source_state
         SET lease_owner=$4,
             lease_until=clock_timestamp() + ($5 * interval '1 millisecond'),
             fencing_token=fencing_token + 1,
             updated_at=clock_timestamp()
         WHERE provider_id=$1 AND source_id=$2 AND source_stream_id=$3
         RETURNING *`,
        [providerId, sourceId, sourceStreamId, owner, leaseMs],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error("BUSINESS_EVENT_SOURCE_NOT_FOUND");
      const event =
        previous.lease_owner === owner
          ? "lease_renewed"
          : previous.lease_owner === null
            ? "lease_acquired"
            : "lease_takeover";
      if (event !== "lease_renewed") {
        await this.providerOpsRecorder?.capture({
          client,
          providerId,
          recordType: "provider.business_event.source.lifecycle",
          aggregateId: providerId,
          stableAggregateIdentity: `${sourceId}:${sourceStreamId}`,
          eventIdentity: event,
          revision: row.fencing_token,
          occurredAt: new Date(),
          payload: {
            event,
            sourceId,
            sourceStreamId,
            previousStatus: previous.status,
            currentStatus: previous.status,
            fencingToken: row.fencing_token,
          },
        });
      }
      await client.query("COMMIT");
      return mapLease(row);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async renewSourceLease(lease: BusinessEventLease, leaseMs: number): Promise<BusinessEventLease> {
    const result = await this.pool.query<SourceStateRow>(
      `UPDATE adapter_business_event_source_state
       SET lease_until=clock_timestamp() + ($6 * interval '1 millisecond'), updated_at=clock_timestamp()
       WHERE provider_id=$1 AND source_id=$2 AND source_stream_id=$3
         AND lease_owner=$4 AND fencing_token=$5 AND lease_until > clock_timestamp()
       RETURNING *`,
      [
        lease.providerId,
        lease.sourceId,
        lease.sourceStreamId,
        lease.owner,
        lease.fencingToken,
        leaseMs,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("BUSINESS_EVENT_STALE_FENCE");
    return mapLease(row);
  }

  async intakeSourceFact(
    lease: BusinessEventLease,
    fact: BusinessEventSourceFact,
    retainMs: number,
    mappingDeadlineMs: number,
  ): Promise<IntakeResult> {
    const sequence = parseBusinessEventSequence(fact.sourceSequence);
    const occurredAt = normalizeRfc3339Nano(fact.occurredAt);
    const sourceCanonicalInput = {
      providerId: lease.providerId,
      sourceId: lease.sourceId,
      sourceStreamId: lease.sourceStreamId,
      sourceEventId: fact.sourceEventId,
      sourceSequence: fact.sourceSequence,
      scope: fact.scope,
      ...(fact.scope === "task"
        ? { externalExecutionId: fact.externalExecutionId }
        : { resourceRef: fact.resourceRef }),
      eventType: fact.eventType,
      occurredAt,
      description: fact.description,
      severityHint: fact.severityHint ?? "",
      reasonCode: fact.reasonCode ?? "",
      rawPayload: fact.rawPayload ?? {},
    };
    const sourceCanonicalHash = canonicalSha256(sourceCanonicalInput);
    const rawEnvelopeHash = canonicalSha256(fact);
    const validationError = validateSourceFact(fact);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const state = await lockAndValidateLease(client, lease);
      if (fact.sourceStreamId !== lease.sourceStreamId) {
        await blockSource(client, lease, "blocked_identity_conflict", "SOURCE_STREAM_RESET");
        await this.#captureIngestAudit(
          client,
          lease,
          fact,
          rawEnvelopeHash,
          "rejected",
          "SOURCE_STREAM_RESET",
        );
        await client.query("COMMIT");
        throw new Error("SOURCE_STREAM_RESET");
      }
      const duplicate = await client.query<{
        normalized_source_event_id: string | null;
        normalized_source_sequence: string | null;
        source_canonical_hash: string | null;
      }>(
        `SELECT normalized_source_event_id, normalized_source_sequence, source_canonical_hash
         FROM adapter_business_event_inbox
         WHERE provider_id=$1 AND source_id=$2 AND source_stream_id=$3
           AND (normalized_source_event_id=$4 OR normalized_source_sequence=$5)
         FOR UPDATE`,
        [
          lease.providerId,
          lease.sourceId,
          lease.sourceStreamId,
          fact.sourceEventId,
          sequence.toString(),
        ],
      );
      if (duplicate.rows.length > 0) {
        const exact = duplicate.rows.find(
          (row) =>
            row.normalized_source_event_id === fact.sourceEventId &&
            row.normalized_source_sequence === sequence.toString() &&
            row.source_canonical_hash === sourceCanonicalHash,
        );
        if (exact !== undefined && duplicate.rows.length === 1) {
          await client.query("COMMIT");
          return { disposition: "duplicate", sourceCanonicalHash };
        }
        await blockSource(client, lease, "blocked_identity_conflict", "SOURCE_IDENTITY_CONFLICT");
        await this.#captureIngestAudit(
          client,
          lease,
          fact,
          rawEnvelopeHash,
          "rejected",
          "SOURCE_IDENTITY_CONFLICT",
        );
        await client.query("COMMIT");
        throw new Error("BUSINESS_EVENT_IDEMPOTENCY_CONFLICT");
      }
      if (sequence <= BigInt(state.last_persisted_source_sequence)) {
        await blockSource(client, lease, "blocked_identity_conflict", "SOURCE_SEQUENCE_REGRESSION");
        await this.#captureIngestAudit(
          client,
          lease,
          fact,
          rawEnvelopeHash,
          "rejected",
          "SOURCE_SEQUENCE_REGRESSION",
        );
        await client.query("COMMIT");
        throw new Error("BUSINESS_EVENT_SOURCE_SEQUENCE_REGRESSION");
      }
      const rejected = validationError !== undefined;
      await client.query(
        `INSERT INTO adapter_business_event_inbox
           (provider_id, source_id, source_stream_id, status, raw_envelope_json,
            raw_envelope_hash, decode_status, reject_reason,
            normalized_source_event_id, normalized_source_sequence, normalized_scope,
            normalized_occurred_at, normalized_event_type, source_canonical_hash,
            source_payload, mapping_deadline, retain_until)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,'decoded',$7,$8,$9,$10,$11,$12,$13,$14::jsonb,
                 clock_timestamp() + ($15 * interval '1 millisecond'),
                 clock_timestamp() + ($16 * interval '1 millisecond'))`,
        [
          lease.providerId,
          lease.sourceId,
          lease.sourceStreamId,
          rejected ? "rejected" : "received",
          JSON.stringify(fact),
          rawEnvelopeHash,
          validationError ?? null,
          fact.sourceEventId,
          sequence.toString(),
          fact.scope,
          occurredAt,
          fact.eventType,
          sourceCanonicalHash,
          JSON.stringify({ ...fact, occurredAt }),
          mappingDeadlineMs,
          retainMs,
        ],
      );
      await client.query(
        `UPDATE adapter_business_event_source_state
         SET last_persisted_source_sequence=$6, last_seen_at=clock_timestamp(),
             status=CASE
               WHEN $7 AND delivery_semantics='durable_at_least_once' THEN 'continuity_loss_pending'
               WHEN $7 THEN 'degraded'
               ELSE 'active'
             END,
             updated_at=clock_timestamp()
         WHERE provider_id=$1 AND source_id=$2 AND source_stream_id=$3
           AND lease_owner=$4 AND fencing_token=$5 AND lease_until > clock_timestamp()`,
        [
          lease.providerId,
          lease.sourceId,
          lease.sourceStreamId,
          lease.owner,
          lease.fencingToken,
          sequence.toString(),
          rejected,
        ],
      );
      await this.#captureIngestAudit(
        client,
        lease,
        fact,
        rawEnvelopeHash,
        rejected ? "rejected" : "received",
        validationError,
      );
      await client.query("COMMIT");
      return rejected
        ? { disposition: "rejected", sourceCanonicalHash }
        : { disposition: "received", sourceCanonicalHash };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async persistUndecodablePoison(
    lease: BusinessEventLease,
    transportPayloadHash: string,
    retainMs: number,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await lockAndValidateLease(client, lease);
      await client.query(
        `INSERT INTO adapter_business_event_inbox
           (provider_id, source_id, source_stream_id, status, raw_envelope_hash,
            transport_payload_hash, decode_status, reject_reason, retain_until)
         VALUES ($1,$2,$3,'rejected',$4,$4,'undecodable','BUSINESS_EVENT_PAYLOAD_INVALID',
                 clock_timestamp() + ($5 * interval '1 millisecond'))`,
        [lease.providerId, lease.sourceId, lease.sourceStreamId, transportPayloadHash, retainMs],
      );
      await blockSource(client, lease, "blocked_contract_violation", "UNDECODABLE_SOURCE_SEQUENCE");
      await this.providerOpsRecorder?.capture({
        client,
        providerId: lease.providerId,
        recordType: "provider.business_event.ingest.lifecycle",
        aggregateId: lease.providerId,
        stableAggregateIdentity: `${lease.sourceId}:${lease.sourceStreamId}:${transportPayloadHash}`,
        eventIdentity: "rejected",
        revision: transportPayloadHash,
        occurredAt: new Date(),
        payload: {
          event: "rejected",
          sourceId: lease.sourceId,
          sourceStreamId: lease.sourceStreamId,
          inboxState: "rejected",
          decodeStatus: "undecodable",
          transportPayloadHash,
          reasonCode: "SOURCE_PAYLOAD_UNDECODABLE",
        },
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async prepareNextSourceEvent(
    providerId: string,
    sourceId: string,
  ): Promise<"ready" | "pending" | "terminal" | "none"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const source = await client.query<{
        source_stream_id: string;
        delivery_semantics: BusinessEventDeliverySemantics;
      }>(
        `SELECT source_stream_id, delivery_semantics FROM adapter_business_event_source_state
         WHERE provider_id=$1 AND source_id=$2 FOR UPDATE`,
        [providerId, sourceId],
      );
      const state = source.rows[0];
      if (state === undefined) throw new Error("BUSINESS_EVENT_SOURCE_NOT_FOUND");
      const inbox = await client.query<InboxRow>(
        `SELECT * FROM adapter_business_event_inbox
         WHERE provider_id=$1 AND source_id=$2 AND source_stream_id=$3
           AND status IN ('received','pending_mapping','ready','continuity_loss_pending','rejected','mapping_failed')
         ORDER BY normalized_source_sequence NULLS FIRST, inbox_id
         LIMIT 1 FOR UPDATE`,
        [providerId, sourceId, state.source_stream_id],
      );
      const row = inbox.rows[0];
      if (row === undefined) {
        await client.query("COMMIT");
        return "none";
      }
      if (row.status === "ready") {
        await client.query("COMMIT");
        return "ready";
      }
      if (["continuity_loss_pending", "rejected", "mapping_failed"].includes(row.status)) {
        await client.query("COMMIT");
        return "terminal";
      }
      const payload = row.source_payload;
      if (payload === null) throw new Error("BUSINESS_EVENT_PAYLOAD_INVALID");
      if (row.normalized_scope === "task") {
        const externalExecutionId = payload.externalExecutionId;
        const mapped =
          typeof externalExecutionId === "string"
            ? await client.query<{ task_id: string }>(
                `SELECT task_id FROM provider_task
                 WHERE provider_id=$1 AND external_execution_id=$2`,
                [providerId, externalExecutionId],
              )
            : undefined;
        const taskId = mapped?.rows[0]?.task_id;
        if (taskId === undefined) {
          if (row.mapping_deadline !== null && row.mapping_deadline > new Date()) {
            await client.query(
              `UPDATE adapter_business_event_inbox SET status='pending_mapping',
                 attempt_count=attempt_count+1,last_attempt_at=clock_timestamp()
               WHERE inbox_id=$1`,
              [row.inbox_id],
            );
            await client.query("COMMIT");
            return "pending";
          }
          const durable = state.delivery_semantics === "durable_at_least_once";
          await client.query(
            `UPDATE adapter_business_event_inbox SET status=$2,last_error='TASK_MAPPING_FAILED',
               last_attempt_at=clock_timestamp() WHERE inbox_id=$1`,
            [row.inbox_id, durable ? "continuity_loss_pending" : "terminal_skipped"],
          );
          await client.query(
            `UPDATE adapter_business_event_source_state SET status=$3,last_error='TASK_MAPPING_FAILED'
             WHERE provider_id=$1 AND source_id=$2`,
            [providerId, sourceId, durable ? "continuity_loss_pending" : "degraded"],
          );
          await this.providerOpsRecorder?.capture({
            client,
            providerId,
            recordType: "provider.business_event.ingest.lifecycle",
            aggregateId: providerId,
            stableAggregateIdentity: `${sourceId}:${state.source_stream_id}:${row.normalized_source_event_id ?? row.inbox_id}`,
            eventIdentity: "mapping_failed",
            revision: row.attempt_count + 1,
            occurredAt: new Date(),
            payload: {
              event: "mapping_failed",
              sourceId,
              sourceStreamId: state.source_stream_id,
              ...(row.normalized_source_event_id === null
                ? {}
                : { sourceEventId: row.normalized_source_event_id }),
              ...(row.normalized_source_sequence === null
                ? {}
                : { sourceSequence: row.normalized_source_sequence }),
              inboxState: durable ? "continuity_loss_pending" : "terminal_skipped",
              reasonCode: "SOURCE_MAPPING_FAILED",
              attemptCount: row.attempt_count + 1,
            },
          });
          await client.query("COMMIT");
          return "terminal";
        }
        await client.query(
          `UPDATE adapter_business_event_inbox
           SET status='ready',source_payload=source_payload || jsonb_build_object('taskId',$2::text),
               attempt_count=attempt_count+1,last_attempt_at=clock_timestamp()
           WHERE inbox_id=$1`,
          [row.inbox_id, taskId],
        );
      } else {
        const resourceRef = payload.resourceRef;
        if (typeof resourceRef !== "string" || row.normalized_occurred_at === null) {
          throw new Error("BUSINESS_EVENT_PAYLOAD_INVALID");
        }
        const related = await client.query<{ task_id: string }>(
          `SELECT task_id::text FROM provider_task_resource_binding
           WHERE provider_id=$1 AND resource_ref=$2 AND bound_at <= $3
             AND (terminal_at IS NULL OR terminal_at >= $3)
           ORDER BY task_id`,
          [providerId, resourceRef, row.normalized_occurred_at],
        );
        const taskIds = related.rows.map((item) => item.task_id);
        await client.query(
          `UPDATE adapter_business_event_inbox
           SET status='ready',source_payload=source_payload ||
                 jsonb_build_object('candidateRelatedTaskIds',$2::jsonb,'candidateRelatedTaskCount',$3::int),
               attempt_count=attempt_count+1,last_attempt_at=clock_timestamp()
           WHERE inbox_id=$1`,
          [row.inbox_id, JSON.stringify(taskIds), taskIds.length],
        );
      }
      await client.query("COMMIT");
      return "ready";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async finalizeNextSourceEvent(
    providerId: string,
    sourceId: string,
    eventRetentionMs: number,
  ): Promise<FinalizedBusinessEvent | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const runtime = await client.query<{ current_stream_id: string }>(
        `SELECT current_stream_id FROM provider_business_event_runtime_state
         WHERE provider_id=$1 FOR UPDATE`,
        [providerId],
      );
      const streamId = runtime.rows[0]?.current_stream_id;
      if (streamId === undefined) throw new Error("BUSINESS_EVENT_NOT_FOUND");
      const generation = await client.query<{ current_sequence: string; status: string }>(
        `SELECT current_sequence,status FROM provider_business_event_stream_generation
         WHERE provider_id=$1 AND stream_id=$2 FOR UPDATE`,
        [providerId, streamId],
      );
      if (generation.rows[0]?.status !== "current") throw new Error("BUSINESS_EVENT_STREAM_RESET");
      const source = await client.query<{
        source_stream_id: string;
        last_finalized_source_sequence: string;
      }>(
        `SELECT source_stream_id,last_finalized_source_sequence
         FROM adapter_business_event_source_state
         WHERE provider_id=$1 AND source_id=$2 FOR UPDATE`,
        [providerId, sourceId],
      );
      const sourceState = source.rows[0];
      if (sourceState === undefined) throw new Error("BUSINESS_EVENT_SOURCE_NOT_FOUND");
      const inbox = await client.query<InboxRow>(
        `SELECT * FROM adapter_business_event_inbox
         WHERE provider_id=$1 AND source_id=$2 AND source_stream_id=$3
           AND status IN ('received','pending_mapping','ready','continuity_loss_pending','rejected','mapping_failed')
         ORDER BY normalized_source_sequence NULLS FIRST,inbox_id LIMIT 1 FOR UPDATE`,
        [providerId, sourceId, sourceState.source_stream_id],
      );
      const row = inbox.rows[0];
      if (row?.status !== "ready" || row.source_payload === null) {
        await client.query("COMMIT");
        return undefined;
      }
      const payload = row.source_payload;
      const sourceEventId = requiredString(payload.sourceEventId);
      const sourceSequence = requiredString(payload.sourceSequence);
      const eventId = businessEventId(
        providerId,
        sourceId,
        sourceState.source_stream_id,
        sourceEventId,
      );
      const candidateIds = Array.isArray(payload.candidateRelatedTaskIds)
        ? payload.candidateRelatedTaskIds
            .filter((value): value is string => typeof value === "string")
            .sort(compareText)
        : [];
      const storedEventHash = canonicalSha256({
        sourceCanonicalHash: row.source_canonical_hash,
        eventId,
        ...(row.normalized_scope === "task"
          ? { taskId: requiredString(payload.taskId) }
          : { resourceRef: requiredString(payload.resourceRef) }),
        candidateRelatedTaskIds: candidateIds,
        candidateRelatedTaskCount: candidateIds.length,
      });
      const runtimeSequence = (BigInt(generation.rows[0].current_sequence) + 1n).toString();
      const inserted = await client.query<StoredEventRow>(
        `INSERT INTO provider_business_event
           (provider_id,stream_id,sequence,event_id,source_id,source_stream_id,
            source_event_id,source_sequence,source_canonical_hash,stored_event_hash,
            event_type,occurred_at,scope,description,task_id,resource_ref,
            candidate_related_task_count,severity_hint,reason_code,raw_payload,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,
                 clock_timestamp() + ($21 * interval '1 millisecond')) RETURNING *`,
        [
          providerId,
          streamId,
          runtimeSequence,
          eventId,
          sourceId,
          sourceState.source_stream_id,
          sourceEventId,
          sourceSequence,
          row.source_canonical_hash,
          storedEventHash,
          requiredString(payload.eventType),
          requiredString(payload.occurredAt),
          row.normalized_scope,
          requiredString(payload.description),
          row.normalized_scope === "task" ? requiredString(payload.taskId) : null,
          row.normalized_scope === "resource" ? requiredString(payload.resourceRef) : null,
          candidateIds.length,
          optionalString(payload.severityHint),
          optionalString(payload.reasonCode),
          JSON.stringify(payload.rawPayload ?? {}),
          eventRetentionMs,
        ],
      );
      for (const [ordinal, taskId] of candidateIds.entries()) {
        await client.query(
          `INSERT INTO provider_business_event_relation
             (provider_id,stream_id,event_id,task_id,ordinal) VALUES ($1,$2,$3,$4,$5)`,
          [providerId, streamId, eventId, taskId, ordinal],
        );
      }
      await client.query(
        `UPDATE provider_business_event_stream_generation SET current_sequence=$3
         WHERE provider_id=$1 AND stream_id=$2`,
        [providerId, streamId, runtimeSequence],
      );
      await client.query(
        `UPDATE adapter_business_event_inbox SET status='published',finalized_at=clock_timestamp()
         WHERE inbox_id=$1`,
        [row.inbox_id],
      );
      await client.query(
        `UPDATE adapter_business_event_source_state
         SET last_finalized_source_sequence=$3,updated_at=clock_timestamp()
         WHERE provider_id=$1 AND source_id=$2`,
        [providerId, sourceId, sourceSequence],
      );
      if (candidateIds.length > 0) {
        await client.query(
          `UPDATE provider_task_resource_binding binding
           SET retain_until=GREATEST(retain_until,event.expires_at)
           FROM provider_business_event event
           WHERE event.provider_id=$1 AND event.event_id=$2
             AND binding.provider_id=$1 AND binding.task_id=ANY($3::uuid[])`,
          [providerId, eventId, candidateIds],
        );
      }
      await this.providerOpsRecorder?.capture({
        client,
        providerId,
        recordType: "provider.business_event.publication.lifecycle",
        aggregateId: providerId,
        stableAggregateIdentity: eventId,
        eventIdentity: "published",
        revision: runtimeSequence,
        occurredAt: requiredString(payload.occurredAt),
        payload: {
          event: "published",
          streamId,
          eventId,
          runtimeSequence,
          sourceId,
          sourceSequence,
          scope: row.normalized_scope ?? "task",
          outcome: "published",
        },
      });
      await client.query("COMMIT");
      const event = inserted.rows[0];
      if (event === undefined) throw new Error("BUSINESS_EVENT_NOT_RETURNED");
      return mapStoredEvent(event);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async rotateStream(
    providerId: string,
    reasonCode: string,
    affectedSourceIds: string[],
    continuityReasonIdentity: string,
    generationRetentionMs: number,
    replacementRoster?: BusinessEventSourceDefinition[],
  ): Promise<RotationResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const retry = await client.query<ContinuityRow>(
        `SELECT * FROM provider_business_event_continuity_record
         WHERE provider_id=$1 AND continuity_reason_identity=$2 ORDER BY created_at LIMIT 1`,
        [providerId, continuityReasonIdentity],
      );
      if (retry.rows[0] !== undefined) {
        await client.query("COMMIT");
        return mapRotation(retry.rows[0]);
      }
      const runtime = await client.query<{ current_stream_id: string; generation_version: string }>(
        `SELECT current_stream_id,generation_version FROM provider_business_event_runtime_state
         WHERE provider_id=$1 FOR UPDATE`,
        [providerId],
      );
      const current = runtime.rows[0];
      if (current === undefined) throw new Error("BUSINESS_EVENT_NOT_FOUND");
      const serializedRetry = await client.query<ContinuityRow>(
        `SELECT * FROM provider_business_event_continuity_record
         WHERE provider_id=$1 AND continuity_reason_identity=$2 ORDER BY created_at LIMIT 1`,
        [providerId, continuityReasonIdentity],
      );
      if (serializedRetry.rows[0] !== undefined) {
        await client.query("COMMIT");
        return mapRotation(serializedRetry.rows[0]);
      }
      const generation = await client.query<GenerationRow>(
        `SELECT * FROM provider_business_event_stream_generation
         WHERE provider_id=$1 AND stream_id=$2 FOR UPDATE`,
        [providerId, current.current_stream_id],
      );
      const previous = generation.rows[0];
      if (previous?.status !== "current") throw new Error("BUSINESS_EVENT_STREAM_RESET");
      const currentRoster = await this.sourceRosterWithClient(
        client,
        providerId,
        previous.stream_id,
      );
      const roster = replacementRoster ?? currentRoster;
      if (
        roster.length < 1 ||
        roster.length > 16 ||
        new Set(roster.map((source) => source.sourceId)).size !== roster.length
      ) {
        throw new Error("BUSINESS_EVENT_SOURCE_COUNT_INVALID");
      }
      const normalizedAffectedSourceIds = [
        ...new Set(
          affectedSourceIds.length === 0
            ? currentRoster.map((source) => source.sourceId)
            : affectedSourceIds,
        ),
      ].sort(compareText);
      if (normalizedAffectedSourceIds.length === 0) {
        throw new Error("BUSINESS_EVENT_ROTATION_SOURCE_REQUIRED");
      }
      await client.query(
        `SELECT source_id FROM adapter_business_event_source_state
         WHERE provider_id=$1 AND source_id=ANY($2::text[])
         ORDER BY source_id FOR UPDATE`,
        [providerId, normalizedAffectedSourceIds],
      );
      await client.query(
        `SELECT inbox_id FROM adapter_business_event_inbox
         WHERE provider_id=$1 AND source_id=ANY($2::text[])
           AND status IN ('continuity_loss_pending','rejected','mapping_failed')
         ORDER BY source_id,normalized_source_sequence NULLS FIRST,inbox_id FOR UPDATE`,
        [providerId, normalizedAffectedSourceIds],
      );
      const newStreamId = randomUUID();
      await client.query(
        `INSERT INTO provider_business_event_stream_generation
           (provider_id,stream_id,status,continuity_class,retain_until)
         VALUES ($1,$2,'rotating',$3,clock_timestamp() + ($4 * interval '1 millisecond'))`,
        [providerId, newStreamId, classifyContinuity(roster), generationRetentionMs],
      );
      const lastReplayable = previous.current_sequence;
      const lastContinuous =
        previous.continuity_class === "all_durable" ? previous.current_sequence : null;
      await client.query(
        `UPDATE provider_business_event_generation_source
         SET left_at_runtime_sequence=$3
         WHERE provider_id=$1 AND runtime_stream_id=$2 AND left_at_runtime_sequence IS NULL`,
        [providerId, previous.stream_id, lastReplayable],
      );
      await client.query(
        `UPDATE provider_business_event_stream_generation
         SET status='replayable_closed',closed_at=clock_timestamp(),rotated_to_stream_id=$3,
             reset_reason=$4,affected_source_ids=$5,last_replayable_sequence=current_sequence,
             last_continuous_sequence=$6,
             retain_until=GREATEST(retain_until,clock_timestamp() + ($7 * interval '1 millisecond'))
         WHERE provider_id=$1 AND stream_id=$2`,
        [
          providerId,
          previous.stream_id,
          newStreamId,
          reasonCode,
          normalizedAffectedSourceIds,
          lastContinuous,
          generationRetentionMs,
        ],
      );
      await client.query(
        `UPDATE provider_business_event_stream_generation SET status='current'
         WHERE provider_id=$1 AND stream_id=$2`,
        [providerId, newStreamId],
      );
      const rosterSourceIds = roster.map((source) => source.sourceId);
      await client.query(
        `UPDATE adapter_business_event_source_state
         SET status='disabled',lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp()
         WHERE provider_id=$1 AND NOT (source_id=ANY($2::text[]))`,
        [providerId, rosterSourceIds],
      );
      for (const source of [...roster].sort((left, right) =>
        compareText(left.sourceId, right.sourceId),
      )) {
        await client.query(
          `INSERT INTO provider_business_event_generation_source
             (provider_id,runtime_stream_id,source_id,source_stream_id,delivery_semantics,
              joined_at_runtime_sequence)
           VALUES ($1,$2,$3,$4,$5,0)`,
          [
            providerId,
            newStreamId,
            source.sourceId,
            source.sourceStreamId,
            source.deliverySemantics,
          ],
        );
        await client.query(
          `INSERT INTO adapter_business_event_source_state
             (provider_id,source_id,source_stream_id,delivery_semantics,status)
           VALUES ($1,$2,$3,$4,'active')
           ON CONFLICT (provider_id,source_id) DO UPDATE
             SET source_stream_id=EXCLUDED.source_stream_id,
                 delivery_semantics=EXCLUDED.delivery_semantics,
                 status='active',
                 lease_owner=NULL,lease_until=NULL,
                 last_persisted_source_sequence=CASE
                   WHEN adapter_business_event_source_state.source_stream_id=EXCLUDED.source_stream_id
                   THEN adapter_business_event_source_state.last_persisted_source_sequence ELSE 0 END,
                 last_finalized_source_sequence=CASE
                   WHEN adapter_business_event_source_state.source_stream_id=EXCLUDED.source_stream_id
                   THEN adapter_business_event_source_state.last_finalized_source_sequence ELSE 0 END,
                 updated_at=clock_timestamp()`,
          [providerId, source.sourceId, source.sourceStreamId, source.deliverySemantics],
        );
      }
      await client.query(
        `UPDATE provider_business_event_runtime_state
         SET current_stream_id=$2,generation_version=generation_version+1,updated_at=clock_timestamp()
         WHERE provider_id=$1`,
        [providerId, newStreamId],
      );
      const continuityId = randomUUID();
      const continuity = await client.query<ContinuityRow>(
        `INSERT INTO provider_business_event_continuity_record
           (continuity_record_id,provider_id,previous_stream_id,new_stream_id,reason_code,
            affected_source_ids,gap_detected_at,last_replayable_sequence,
            last_continuous_sequence,continuity_reason_identity,retain_until)
         VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp(),$7,$8,$9,
                 clock_timestamp() + ($10 * interval '1 millisecond'))
         RETURNING *`,
        [
          continuityId,
          providerId,
          previous.stream_id,
          newStreamId,
          reasonCode,
          normalizedAffectedSourceIds,
          lastReplayable,
          lastContinuous,
          continuityReasonIdentity,
          generationRetentionMs,
        ],
      );
      await client.query(
        `UPDATE adapter_business_event_inbox
         SET status=CASE WHEN status IN ('continuity_loss_pending','rejected','mapping_failed')
                         THEN 'terminal_skipped' ELSE status END,
             finalized_at=CASE WHEN status IN ('continuity_loss_pending','rejected','mapping_failed')
                               THEN clock_timestamp() ELSE finalized_at END
         WHERE provider_id=$1 AND source_id=ANY($2::text[])`,
        [providerId, normalizedAffectedSourceIds],
      );
      const generationVersion = (BigInt(current.generation_version) + 1n).toString();
      const rotationIdentity = `${previous.stream_id}:${newStreamId}`;
      await this.providerOpsRecorder?.capture({
        client,
        providerId,
        recordType: "provider.business_event.continuity",
        aggregateId: providerId,
        stableAggregateIdentity: rotationIdentity,
        eventIdentity: "continuity_loss",
        revision: continuityReasonIdentity,
        occurredAt: continuity.rows[0]?.gap_detected_at ?? new Date(),
        payload: {
          event: "continuity_loss",
          previousStreamId: previous.stream_id,
          newStreamId,
          affectedSourceCount: normalizedAffectedSourceIds.length,
          reasonCode,
          lastReplayableSequence: lastReplayable,
          ...(lastContinuous === null ? {} : { lastContinuousSequence: lastContinuous }),
        },
      });
      await this.providerOpsRecorder?.capture({
        client,
        providerId,
        recordType: "provider.business_event.stream.lifecycle",
        aggregateId: providerId,
        stableAggregateIdentity: rotationIdentity,
        eventIdentity: reasonCode,
        revision: generationVersion,
        occurredAt: continuity.rows[0]?.gap_detected_at ?? new Date(),
        payload: {
          event: "rotation",
          previousStreamId: previous.stream_id,
          currentStreamId: newStreamId,
          generationStatus: "current",
          continuityClass: classifyContinuity(roster),
          lastReplayableSequence: lastReplayable,
          ...(lastContinuous === null ? {} : { lastContinuousSequence: lastContinuous }),
          reasonCode,
          generationVersion,
        },
      });
      await client.query("COMMIT");
      const continuityRow = continuity.rows[0];
      if (continuityRow === undefined) throw new Error("BUSINESS_EVENT_CONTINUITY_NOT_RETURNED");
      return mapRotation(continuityRow);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async replayEvents(
    providerId: string,
    streamId: string,
    afterSequence: string,
    throughSequence: string,
    limit: number,
  ): Promise<FinalizedBusinessEvent[]> {
    const result = await this.pool.query<StoredEventRow>(
      `SELECT * FROM provider_business_event
       WHERE provider_id=$1 AND stream_id=$2 AND sequence>$3 AND sequence<=$4
       ORDER BY sequence LIMIT $5`,
      [providerId, streamId, afterSequence, throughSequence, limit],
    );
    return result.rows.map(mapStoredEvent);
  }

  async authorizedEventProjection(
    providerId: string,
    streamId: string,
    eventId: string,
    authorization: BusinessEventAuthorizationSnapshot,
  ): Promise<AuthorizedBusinessEventProjection | undefined> {
    const eventResult = await this.pool.query<StoredEventRow>(
      `SELECT * FROM provider_business_event
       WHERE provider_id=$1 AND stream_id=$2 AND event_id=$3`,
      [providerId, streamId, eventId],
    );
    const event = eventResult.rows[0];
    if (event === undefined) return undefined;
    if (event.expires_at <= new Date()) return undefined;
    const candidateIds =
      event.scope === "task"
        ? event.task_id === null
          ? []
          : [event.task_id]
        : (
            await this.pool.query<{ task_id: string }>(
              `SELECT task_id::text FROM provider_business_event_relation
               WHERE provider_id=$1 AND stream_id=$2 AND event_id=$3 ORDER BY task_id`,
              [providerId, streamId, eventId],
            )
          ).rows.map((row) => row.task_id);
    if (event.scope === "resource" && candidateIds.length !== event.candidate_related_task_count) {
      throw new Error("BUSINESS_EVENT_RETENTION_AUTHORITY_INVALID");
    }
    const visibleRows =
      candidateIds.length === 0
        ? []
        : (
            await this.pool.query<{ task_id: string }>(
              `WITH authority AS (
               SELECT task_id,authorization_context_hash,execution_mode,simulation_id
               FROM provider_task WHERE provider_id=$1 AND task_id=ANY($2::uuid[])
               UNION ALL
               SELECT task_id,authorization_context_hash,execution_mode,simulation_id
               FROM provider_task_visibility_tombstone
               WHERE provider_id=$1 AND task_id=ANY($2::uuid[])
             ), resolved AS (
               SELECT task_id,
                      count(*)::text AS authority_count,
                      bool_or(authorization_context_hash=$3 AND execution_mode=$4 AND
                        simulation_id IS NOT DISTINCT FROM $5::text) AS visible
               FROM authority GROUP BY task_id
             )
             SELECT candidate.task_id::text
             FROM unnest($2::uuid[]) candidate(task_id)
             LEFT JOIN resolved USING (task_id)
             WHERE COALESCE(resolved.visible,false)
             ORDER BY candidate.task_id`,
              [
                providerId,
                candidateIds,
                authorization.authorizationScopeHash,
                authorization.executionMode,
                authorization.simulationId,
              ],
            )
          ).rows;
    const authorityCount = await this.pool.query<{ count: string }>(
      `SELECT count(DISTINCT task_id)::text AS count FROM (
         SELECT task_id FROM provider_task WHERE provider_id=$1 AND task_id=ANY($2::uuid[])
         UNION ALL
         SELECT task_id FROM provider_task_visibility_tombstone
         WHERE provider_id=$1 AND task_id=ANY($2::uuid[])
       ) authority`,
      [providerId, candidateIds],
    );
    if (Number(authorityCount.rows[0]?.count ?? "0") !== candidateIds.length) {
      throw new Error("BUSINESS_EVENT_RETENTION_AUTHORITY_INVALID");
    }
    const relatedTaskIds = visibleRows.map((row) => row.task_id);
    if (relatedTaskIds.length === 0) return undefined;
    return {
      event: mapStoredEvent(event),
      relatedTaskIds,
      candidateRelationHash: canonicalSha256(candidateIds),
      projectionRelationHash: canonicalSha256(relatedTaskIds),
    };
  }

  async continuityForPreviousStream(
    providerId: string,
    previousStreamId: string,
  ): Promise<RotationResult | undefined> {
    const result = await this.pool.query<ContinuityRow>(
      `SELECT * FROM provider_business_event_continuity_record
       WHERE provider_id=$1 AND previous_stream_id=$2 ORDER BY created_at DESC LIMIT 1`,
      [providerId, previousStreamId],
    );
    return result.rows[0] === undefined ? undefined : mapRotation(result.rows[0]);
  }

  async markSourceUnavailable(lease: BusinessEventLease, errorCode: string): Promise<void> {
    await this.pool.query(
      `UPDATE adapter_business_event_source_state
       SET status='unavailable',last_error=$6,updated_at=clock_timestamp()
       WHERE provider_id=$1 AND source_id=$2 AND source_stream_id=$3
         AND lease_owner=$4 AND fencing_token=$5`,
      [
        lease.providerId,
        lease.sourceId,
        lease.sourceStreamId,
        lease.owner,
        lease.fencingToken,
        errorCode,
      ],
    );
  }

  async extendVisibilityRetention(historyHorizonMs: number): Promise<void> {
    await this.pool.query(
      `UPDATE provider_task_resource_binding
       SET retain_until=GREATEST(retain_until,COALESCE(terminal_at,bound_at) + ($1 * interval '1 millisecond'))`,
      [historyHorizonMs],
    );
    await this.pool.query(
      `UPDATE provider_task_visibility_tombstone
       SET retain_until=GREATEST(retain_until,terminal_at + ($1 * interval '1 millisecond'))`,
      [historyHorizonMs],
    );
  }

  private async sourceRosterWithClient(
    client: PoolClient,
    providerId: string,
    streamId: string,
  ): Promise<BusinessEventSourceDefinition[]> {
    const result = await client.query<{
      source_id: string;
      source_stream_id: string;
      delivery_semantics: BusinessEventDeliverySemantics;
    }>(
      `SELECT source_id,source_stream_id,delivery_semantics
       FROM provider_business_event_generation_source
       WHERE provider_id=$1 AND runtime_stream_id=$2 ORDER BY source_id`,
      [providerId, streamId],
    );
    return result.rows.map((row) => ({
      sourceId: row.source_id,
      sourceStreamId: row.source_stream_id,
      deliverySemantics: row.delivery_semantics,
    }));
  }

  async #captureIngestAudit(
    client: PoolClient,
    lease: BusinessEventLease,
    fact: BusinessEventSourceFact,
    rawEnvelopeHash: string,
    event: "received" | "rejected",
    reasonCode?: string,
  ): Promise<void> {
    await this.providerOpsRecorder?.capture({
      client,
      providerId: lease.providerId,
      recordType: "provider.business_event.ingest.lifecycle",
      aggregateId: lease.providerId,
      stableAggregateIdentity: `${lease.sourceId}:${lease.sourceStreamId}:${fact.sourceEventId}`,
      eventIdentity: event,
      revision: fact.sourceSequence,
      occurredAt: fact.occurredAt,
      payload: {
        event,
        sourceId: lease.sourceId,
        sourceStreamId: lease.sourceStreamId,
        sourceEventId: fact.sourceEventId,
        sourceSequence: fact.sourceSequence,
        inboxState: event,
        decodeStatus: "decoded",
        rawEnvelopeHash,
        ...(reasonCode === undefined ? {} : { reasonCode }),
      },
    });
  }

  async createRelationProjection(
    identity: ProjectionIdentity,
    taskIds: string[],
    ttlMs: number,
  ): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const sorted = [...new Set(taskIds)].sort(compareText);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await lockRuntimeAndGeneration(client, identity.providerId, identity.streamId);
      await client.query(
        `INSERT INTO provider_business_event_relation_projection
           (token_hash, provider_id, stream_id, event_id, authorization_scope_hash,
            execution_mode, simulation_id, candidate_relation_hash,
            projection_relation_hash, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp() + ($10 * interval '1 millisecond'))`,
        [
          tokenHash,
          identity.providerId,
          identity.streamId,
          identity.eventId,
          identity.authorizationScopeHash,
          identity.executionMode,
          identity.simulationId,
          identity.candidateRelationHash,
          identity.projectionRelationHash,
          ttlMs,
        ],
      );
      for (const [ordinal, taskId] of sorted.entries()) {
        await client.query(
          `INSERT INTO provider_business_event_relation_projection_item(token_hash, task_id, ordinal)
           VALUES ($1,$2,$3)`,
          [tokenHash, taskId, ordinal],
        );
      }
      await client.query("COMMIT");
      return token;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async cleanupExpiredRelationProjections(limit = 256): Promise<number> {
    if (limit < 1 || limit > 10_000) throw new Error("BUSINESS_EVENT_CLEANUP_LIMIT_INVALID");
    const result = await this.pool.query(
      `WITH expired AS (
         SELECT token_hash FROM provider_business_event_relation_projection
         WHERE expires_at <= clock_timestamp()
         ORDER BY expires_at,token_hash
         LIMIT $1 FOR UPDATE SKIP LOCKED
       )
       DELETE FROM provider_business_event_relation_projection projection
       USING expired
       WHERE projection.token_hash=expired.token_hash
       RETURNING projection.token_hash`,
      [limit],
    );
    return result.rowCount ?? 0;
  }

  async relationProjectionPage(
    token: string,
    expected: Pick<ProjectionIdentity, "providerId" | "streamId" | "eventId">,
    authorization: Pick<
      ProjectionIdentity,
      "authorizationScopeHash" | "executionMode" | "simulationId"
    >,
    afterTaskId: string | undefined,
    limit: number,
  ): Promise<ProjectionPage> {
    if (limit < 1 || limit > 256) throw new Error("BUSINESS_EVENT_RELATION_CURSOR_INVALID");
    const tokenHash = hashToken(token);
    const projection = await this.pool.query<{
      authorization_scope_hash: string;
      provider_id: string;
      stream_id: string;
      event_id: string;
      execution_mode: string;
      simulation_id: string | null;
      expires_at: Date;
      total: string;
      candidate_relation_hash: string;
      projection_relation_hash: string;
      event_expires_at: Date;
    }>(
      `SELECT p.authorization_scope_hash,p.provider_id,p.stream_id::text,p.event_id,
              p.execution_mode,p.simulation_id,p.expires_at,p.candidate_relation_hash,
              p.projection_relation_hash,event.expires_at AS event_expires_at,
              count(i.task_id)::text AS total
       FROM provider_business_event_relation_projection p
       JOIN provider_business_event event
         ON event.provider_id=p.provider_id AND event.stream_id=p.stream_id AND event.event_id=p.event_id
       LEFT JOIN provider_business_event_relation_projection_item i ON i.token_hash=p.token_hash
       WHERE p.token_hash=$1
       GROUP BY p.token_hash,event.expires_at`,
      [tokenHash],
    );
    const row = projection.rows[0];
    if (row === undefined) throw new Error("BUSINESS_EVENT_RELATION_CURSOR_INVALID");
    if (row.expires_at <= new Date()) throw new Error("BUSINESS_EVENT_RELATION_CURSOR_EXPIRED");
    if (row.event_expires_at <= new Date()) throw new Error("BUSINESS_EVENT_NOT_FOUND");
    if (
      row.provider_id !== expected.providerId ||
      row.stream_id !== expected.streamId ||
      row.event_id !== expected.eventId
    ) {
      throw new Error("BUSINESS_EVENT_RELATION_CURSOR_INVALID");
    }
    if (
      row.authorization_scope_hash !== authorization.authorizationScopeHash ||
      row.execution_mode !== authorization.executionMode ||
      row.simulation_id !== authorization.simulationId
    ) {
      throw new Error("BUSINESS_EVENT_AUTHORIZATION_MISMATCH");
    }
    const candidate = await this.pool.query<{ task_id: string }>(
      `SELECT task_id::text FROM provider_business_event_relation
       WHERE provider_id=$1 AND stream_id=$2 AND event_id=$3 ORDER BY task_id`,
      [expected.providerId, expected.streamId, expected.eventId],
    );
    const projected = await this.pool.query<{ task_id: string }>(
      `SELECT task_id::text FROM provider_business_event_relation_projection_item
       WHERE token_hash=$1 ORDER BY task_id`,
      [tokenHash],
    );
    if (
      canonicalSha256(candidate.rows.map((item) => item.task_id)) !== row.candidate_relation_hash ||
      canonicalSha256(projected.rows.map((item) => item.task_id)) !== row.projection_relation_hash
    ) {
      throw new Error("BUSINESS_EVENT_RELATION_PROJECTION_STALE");
    }
    if (afterTaskId !== undefined) {
      const anchor = await this.pool.query(
        `SELECT 1 FROM provider_business_event_relation_projection_item
         WHERE token_hash=$1 AND task_id=$2`,
        [tokenHash, afterTaskId],
      );
      if (anchor.rowCount !== 1) throw new Error("BUSINESS_EVENT_RELATION_CURSOR_INVALID");
    }
    const items = await this.pool.query<{ task_id: string }>(
      `SELECT task_id::text FROM provider_business_event_relation_projection_item
       WHERE token_hash=$1 AND ($2::uuid IS NULL OR task_id > $2::uuid)
       ORDER BY task_id LIMIT $3`,
      [tokenHash, afterTaskId ?? null, limit],
    );
    const taskIds = items.rows.map((item) => item.task_id);
    const lastTaskId = taskIds.at(-1);
    const hasMore =
      lastTaskId !== undefined &&
      (
        await this.pool.query(
          `SELECT 1 FROM provider_business_event_relation_projection_item
           WHERE token_hash=$1 AND task_id>$2::uuid LIMIT 1`,
          [tokenHash, lastTaskId],
        )
      ).rowCount === 1;
    return {
      items: taskIds,
      total: Number(row.total),
      ...(hasMore ? { nextAfterTaskId: lastTaskId } : {}),
    };
  }
}

interface GenerationRow {
  provider_id: string;
  stream_id: string;
  status: BusinessEventGeneration["status"];
  current_sequence: string;
  earliest_available_sequence: string;
  last_replayable_sequence: string;
  last_continuous_sequence: string | null;
  continuity_class: BusinessEventContinuityClass;
}

interface SourceStateRow {
  provider_id: string;
  source_id: string;
  source_stream_id: string;
  lease_owner: string;
  lease_until: Date;
  fencing_token: string;
  last_persisted_source_sequence: string;
  last_finalized_source_sequence: string;
}

interface LockedSourceStateRow extends SourceStateRow {
  last_persisted_source_sequence: string;
  lease_valid: boolean;
}

interface InboxRow {
  inbox_id: string;
  status: string;
  normalized_scope: "task" | "resource" | null;
  normalized_occurred_at: Date | null;
  source_canonical_hash: string | null;
  source_payload: Record<string, unknown> | null;
  mapping_deadline: Date | null;
  normalized_source_event_id: string | null;
  normalized_source_sequence: string | null;
  attempt_count: number;
}

interface StoredEventRow {
  provider_id: string;
  stream_id: string;
  sequence: string;
  event_id: string;
  source_id: string;
  source_stream_id: string;
  source_event_id: string;
  source_sequence: string;
  event_type: string;
  occurred_at: Date;
  scope: "task" | "resource";
  description: string;
  task_id: string | null;
  resource_ref: string | null;
  candidate_related_task_count: number;
  severity_hint: "info" | "warning" | "critical" | null;
  reason_code: string | null;
  raw_payload: unknown;
  expires_at: Date;
}

interface ContinuityRow {
  previous_stream_id: string;
  new_stream_id: string;
  reason_code: string;
  affected_source_ids: string[];
  last_replayable_sequence: string;
  last_continuous_sequence: string | null;
  gap_detected_at: Date;
}

function mapGeneration(row: GenerationRow): BusinessEventGeneration {
  return {
    providerId: row.provider_id,
    streamId: row.stream_id,
    status: row.status,
    currentSequence: row.current_sequence,
    earliestAvailableSequence: row.earliest_available_sequence,
    lastReplayableSequence: row.last_replayable_sequence,
    lastContinuousSequence: row.last_continuous_sequence,
    continuityClass: row.continuity_class,
  };
}

function mapLease(row: SourceStateRow): BusinessEventLease {
  return {
    providerId: row.provider_id,
    sourceId: row.source_id,
    sourceStreamId: row.source_stream_id,
    owner: row.lease_owner,
    fencingToken: row.fencing_token,
    leaseUntil: row.lease_until,
    lastPersistedSourceSequence: row.last_persisted_source_sequence,
    lastFinalizedSourceSequence: row.last_finalized_source_sequence,
  };
}

function mapStoredEvent(row: StoredEventRow): FinalizedBusinessEvent {
  return {
    providerId: row.provider_id,
    streamId: row.stream_id,
    sequence: row.sequence,
    eventId: row.event_id,
    sourceId: row.source_id,
    sourceStreamId: row.source_stream_id,
    sourceEventId: row.source_event_id,
    sourceSequence: row.source_sequence,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    scope: row.scope,
    description: row.description,
    taskId: row.task_id,
    resourceRef: row.resource_ref,
    candidateRelatedTaskCount: row.candidate_related_task_count,
    severityHint: row.severity_hint,
    reasonCode: row.reason_code,
    rawPayload: row.raw_payload,
  };
}

function mapRotation(row: ContinuityRow): RotationResult {
  return {
    previousStreamId: row.previous_stream_id,
    newStreamId: row.new_stream_id,
    reasonCode: row.reason_code,
    affectedSourceIds: row.affected_source_ids,
    lastReplayableSequence: row.last_replayable_sequence,
    lastContinuousSequence: row.last_continuous_sequence,
    gapDetectedAt: row.gap_detected_at,
  };
}

function classifyContinuity(
  sources: BusinessEventSourceDefinition[],
): BusinessEventContinuityClass {
  const durable = sources.filter(
    (source) => source.deliverySemantics === "durable_at_least_once",
  ).length;
  return durable === sources.length ? "all_durable" : durable === 0 ? "best_effort_only" : "mixed";
}

function hashToken(token: string): string {
  if (!/^[A-Za-z0-9_-]{22,256}$/.test(token))
    throw new Error("BUSINESS_EVENT_RELATION_CURSOR_INVALID");
  return createHash("sha256").update(token).digest("hex");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateSourceFact(fact: BusinessEventSourceFact): string | undefined {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/.test(fact.sourceEventId)) {
    return "SOURCE_EVENT_ID_INVALID";
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/.test(fact.eventType)) {
    return "EVENT_TYPE_INVALID";
  }
  if (
    fact.description.length < 1 ||
    fact.description.length > 4096 ||
    containsDisallowedControl(fact.description)
  ) {
    return "DESCRIPTION_INVALID";
  }
  if (
    fact.scope === "task" &&
    (fact.externalExecutionId === undefined ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,511}$/.test(fact.externalExecutionId) ||
      fact.resourceRef !== undefined)
  ) {
    return "TASK_SCOPE_INVALID";
  }
  if (
    fact.scope === "resource" &&
    (fact.resourceRef === undefined ||
      !/^[!-~]+$/.test(fact.resourceRef) ||
      fact.resourceRef.length > 512 ||
      fact.externalExecutionId !== undefined)
  ) {
    return "RESOURCE_SCOPE_INVALID";
  }
  if (
    fact.reasonCode !== undefined &&
    !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/.test(fact.reasonCode)
  ) {
    return "REASON_CODE_INVALID";
  }
  return undefined;
}

async function lockAndValidateLease(
  client: PoolClient,
  lease: BusinessEventLease,
): Promise<LockedSourceStateRow> {
  const result = await client.query<LockedSourceStateRow>(
    `SELECT *,lease_until > clock_timestamp() AS lease_valid
     FROM adapter_business_event_source_state
     WHERE provider_id=$1 AND source_id=$2 FOR UPDATE`,
    [lease.providerId, lease.sourceId],
  );
  const row = result.rows[0];
  if (
    row?.source_stream_id !== lease.sourceStreamId ||
    row.lease_owner !== lease.owner ||
    row.fencing_token !== lease.fencingToken ||
    !row.lease_valid
  ) {
    throw new Error("BUSINESS_EVENT_STALE_FENCE");
  }
  return row;
}

async function blockSource(
  client: PoolClient,
  lease: BusinessEventLease,
  status: "blocked_contract_violation" | "blocked_identity_conflict",
  errorCode: string,
): Promise<void> {
  await client.query(
    `UPDATE adapter_business_event_source_state
     SET status=$6,last_error=$7,updated_at=clock_timestamp()
     WHERE provider_id=$1 AND source_id=$2 AND source_stream_id=$3
       AND lease_owner=$4 AND fencing_token=$5`,
    [
      lease.providerId,
      lease.sourceId,
      lease.sourceStreamId,
      lease.owner,
      lease.fencingToken,
      status,
      errorCode,
    ],
  );
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error("BUSINESS_EVENT_PAYLOAD_INVALID");
  return value;
}

function containsDisallowedControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (
      (codeUnit < 32 && codeUnit !== 9 && codeUnit !== 10 && codeUnit !== 13) ||
      codeUnit === 127
    ) {
      return true;
    }
  }
  return false;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function lockRuntimeAndGeneration(
  client: PoolClient,
  providerId: string,
  streamId: string,
): Promise<void> {
  const runtime = await client.query(
    `SELECT 1 FROM provider_business_event_runtime_state WHERE provider_id=$1 FOR UPDATE`,
    [providerId],
  );
  if (runtime.rowCount !== 1) throw new Error("BUSINESS_EVENT_NOT_FOUND");
  const generation = await client.query(
    `SELECT 1 FROM provider_business_event_stream_generation
     WHERE provider_id=$1 AND stream_id=$2 FOR UPDATE`,
    [providerId, streamId],
  );
  if (generation.rowCount !== 1) throw new Error("BUSINESS_EVENT_STREAM_RESET");
}
