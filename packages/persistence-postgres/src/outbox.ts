import type { Pool } from "pg";

export interface OutboxRecord {
  eventId: string;
  eventKey: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export class OutboxRepository {
  constructor(readonly pool: Pool) {}

  async pending(limit = 100): Promise<OutboxRecord[]> {
    const result = await this.pool.query<{
      event_id: string;
      event_key: string;
      aggregate_id: string;
      event_type: string;
      payload: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT event_id, event_key, aggregate_id, event_type, payload, created_at
       FROM outbox_event WHERE published_at IS NULL
       ORDER BY created_at, event_id LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      eventId: row.event_id,
      eventKey: row.event_key,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      payload: row.payload,
      createdAt: row.created_at,
    }));
  }

  async markPublished(eventIds: string[]): Promise<number> {
    if (eventIds.length === 0) return 0;
    const result = await this.pool.query(
      `UPDATE outbox_event SET published_at=clock_timestamp(),
       delivery_attempts=delivery_attempts+1
       WHERE event_id = ANY($1::uuid[]) AND published_at IS NULL`,
      [eventIds],
    );
    return result.rowCount ?? 0;
  }

  async recordAttempt(eventId: string): Promise<void> {
    await this.pool.query(
      "UPDATE outbox_event SET delivery_attempts=delivery_attempts+1 WHERE event_id=$1",
      [eventId],
    );
  }

  async recordAttempts(eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return;
    await this.pool.query(
      `UPDATE outbox_event SET delivery_attempts=delivery_attempts+1
       WHERE event_id = ANY($1::uuid[]) AND published_at IS NULL`,
      [eventIds],
    );
  }
}
