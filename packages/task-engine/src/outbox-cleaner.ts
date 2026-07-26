import type { TaskRepository } from "../../persistence-postgres/src/index.js";

export interface OutboxCleanerTickResult {
  removed: number;
}

export interface OutboxCleanerOptions {
  batchSize?: number;
  publishedRetentionMs?: number;
  onMetric?: (outcome: "removed" | "error", amount?: number) => void;
}

export class OutboxCleaner {
  readonly #batchSize: number;
  readonly #publishedRetentionMs: number;
  readonly #onMetric: OutboxCleanerOptions["onMetric"];

  constructor(
    readonly repository: TaskRepository,
    options: OutboxCleanerOptions = {},
  ) {
    this.#batchSize = options.batchSize ?? 256;
    this.#publishedRetentionMs = options.publishedRetentionMs ?? 86_400_000;
    if (!Number.isInteger(this.#batchSize) || this.#batchSize < 1) {
      throw new RangeError("OUTBOX_CLEANER_BATCH_SIZE_INVALID");
    }
    if (!Number.isInteger(this.#publishedRetentionMs) || this.#publishedRetentionMs < 1) {
      throw new RangeError("OUTBOX_CLEANER_PUBLISHED_RETENTION_MS_INVALID");
    }
    this.#onMetric = options.onMetric;
  }

  async tick(now = new Date()): Promise<OutboxCleanerTickResult> {
    const client = await this.repository.pool.connect();
    try {
      await client.query("BEGIN");
      const cutoff = new Date(now.getTime() - this.#publishedRetentionMs);
      const pending = await client.query<{ event_id: string }>(
        `SELECT event_id
         FROM outbox_event
         WHERE published_at IS NOT NULL
           AND published_at <= $1
         ORDER BY published_at, event_id
         FOR UPDATE SKIP LOCKED
         LIMIT $2`,
        [cutoff, this.#batchSize],
      );
      const eventIds = pending.rows.map((row) => row.event_id);
      if (eventIds.length === 0) {
        await client.query("COMMIT");
        return { removed: 0 };
      }
      const deleted = await client.query(
        "DELETE FROM outbox_event WHERE event_id = ANY($1::uuid[])",
        [eventIds],
      );
      await client.query("COMMIT");
      const removed = deleted.rowCount ?? 0;
      if (removed > 0) this.#onMetric?.("removed", removed);
      return { removed };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      this.#onMetric?.("error");
      throw error;
    } finally {
      client.release();
    }
  }
}
