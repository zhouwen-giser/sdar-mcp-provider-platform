import type { Pool, PoolClient } from "pg";
import type { ProviderOpsEnvelope } from "../../observability/src/index.js";

export type ProviderOpsDeliveryState =
  "PENDING" | "CLAIMED" | "RETRY_WAIT" | "DELIVERED" | "EXHAUSTED";

export interface ProviderOpsDeliveryRecord {
  recordId: string;
  eventKey: string;
  recordType: string;
  eventCategory: string;
  deliveryClass: "audit" | "operational";
  aggregateType: "task" | "command" | "provider" | "scheduler" | "recovery" | "ttl";
  aggregateId: string;
  occurredAt: Date;
  recordBody: ProviderOpsEnvelope;
  state: ProviderOpsDeliveryState;
  attemptCount: number;
  nextAttemptAt: Date;
  claimOwner: string | null;
  claimUntil: Date | null;
}

export interface CaptureProviderOpsDeliveryInput {
  envelope: ProviderOpsEnvelope;
  eventKey: string;
  aggregateType: ProviderOpsDeliveryRecord["aggregateType"];
  aggregateId: string;
}

export async function captureProviderOpsDelivery(
  client: PoolClient,
  input: CaptureProviderOpsDeliveryInput,
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO provider_ops_delivery
      (record_id,event_key,record_type,event_category,delivery_class,
       aggregate_type,aggregate_id,occurred_at,record_body)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     ON CONFLICT (event_key) DO NOTHING`,
    [
      input.envelope.recordId,
      input.eventKey,
      input.envelope.recordType,
      input.envelope.eventCategory,
      input.envelope.deliveryClass,
      input.aggregateType,
      input.aggregateId,
      input.envelope.occurredAt,
      JSON.stringify(input.envelope),
    ],
  );
  return result.rowCount === 1;
}

export class ProviderOpsDeliveryRepository {
  constructor(readonly pool: Pool) {}

  async claimDue(
    ownerId: string,
    leaseMilliseconds = 30_000,
    limit = 100,
    now?: Date,
  ): Promise<ProviderOpsDeliveryRecord[]> {
    if (!Number.isInteger(leaseMilliseconds) || leaseMilliseconds < 1) {
      throw new RangeError("PROVIDER_OPS_LEASE_INVALID");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
      throw new RangeError("PROVIDER_OPS_BATCH_INVALID");
    }
    const result = await this.pool.query<ProviderOpsDeliveryRow>(
      `WITH candidates AS (
         SELECT record_id FROM provider_ops_delivery
         WHERE (state IN ('PENDING','RETRY_WAIT')
                AND next_attempt_at <= COALESCE($1::timestamptz,clock_timestamp()))
            OR (state='CLAIMED'
                AND claim_until <= COALESCE($1::timestamptz,clock_timestamp()))
         ORDER BY COALESCE(claim_until,next_attempt_at),created_at,record_id
         FOR UPDATE SKIP LOCKED LIMIT $2
       )
       UPDATE provider_ops_delivery delivery
       SET state='CLAIMED', claim_owner=$3,
           claim_until=COALESCE($1::timestamptz,clock_timestamp())
             + ($4::text || ' milliseconds')::interval,
           attempt_count=attempt_count+1, updated_at=clock_timestamp()
       FROM candidates WHERE delivery.record_id=candidates.record_id
       RETURNING delivery.*`,
      [now ?? null, limit, ownerId, leaseMilliseconds],
    );
    return result.rows.map(fromRow);
  }

  async markDelivered(recordId: string, ownerId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE provider_ops_delivery
       SET state='DELIVERED', delivered_at=clock_timestamp(),
           claim_owner=NULL, claim_until=NULL, updated_at=clock_timestamp()
       WHERE record_id=$1 AND state='CLAIMED' AND claim_owner=$2`,
      [recordId, ownerId],
    );
    return result.rowCount === 1;
  }

  async recordFailure(
    recordId: string,
    ownerId: string,
    errorCode: string,
    errorMessage: string,
    failedAt = new Date(),
    maximumAttempts = 20,
  ): Promise<ProviderOpsDeliveryState | null> {
    const result = await this.pool.query<{ state: ProviderOpsDeliveryState }>(
      `UPDATE provider_ops_delivery
       SET state=CASE WHEN attempt_count >= $6 THEN 'EXHAUSTED' ELSE 'RETRY_WAIT' END,
           next_attempt_at=$3::timestamptz + (
             LEAST(300000,1000 * power(2,LEAST(GREATEST(attempt_count-1,0),8))) +
             mod(hashtext(record_id::text)::bigint + 2147483648,251)
           ) * interval '1 millisecond',
           claim_owner=NULL, claim_until=NULL,
           last_error_code=$4, last_error_message=$5,
           updated_at=clock_timestamp()
       WHERE record_id=$1 AND state='CLAIMED' AND claim_owner=$2
       RETURNING state`,
      [recordId, ownerId, failedAt, errorCode, boundedError(errorMessage), maximumAttempts],
    );
    return result.rows[0]?.state ?? null;
  }

  async backlog(now = new Date()): Promise<{ count: number; oldestAgeSeconds: number }> {
    const result = await this.pool.query<{ count: string; oldest_at: Date | null }>(
      `SELECT count(*)::text AS count,min(created_at) AS oldest_at
       FROM provider_ops_delivery WHERE state <> 'DELIVERED'`,
    );
    const row = result.rows[0];
    return {
      count: Number(row?.count ?? 0),
      oldestAgeSeconds:
        row?.oldest_at === null || row?.oldest_at === undefined
          ? 0
          : Math.max(0, (now.getTime() - row.oldest_at.getTime()) / 1_000),
    };
  }
}

interface ProviderOpsDeliveryRow {
  record_id: string;
  event_key: string;
  record_type: string;
  event_category: string;
  delivery_class: "audit" | "operational";
  aggregate_type: ProviderOpsDeliveryRecord["aggregateType"];
  aggregate_id: string;
  occurred_at: Date;
  record_body: ProviderOpsEnvelope;
  state: ProviderOpsDeliveryState;
  attempt_count: number;
  next_attempt_at: Date;
  claim_owner: string | null;
  claim_until: Date | null;
}

function fromRow(row: ProviderOpsDeliveryRow): ProviderOpsDeliveryRecord {
  return {
    recordId: row.record_id,
    eventKey: row.event_key,
    recordType: row.record_type,
    eventCategory: row.event_category,
    deliveryClass: row.delivery_class,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    occurredAt: row.occurred_at,
    recordBody: row.record_body,
    state: row.state,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    claimOwner: row.claim_owner,
    claimUntil: row.claim_until,
  };
}

function boundedError(message: string): string {
  return message.replaceAll(/[\r\n\t]/g, " ").slice(0, 512);
}
