import type { OutboxRecord, OutboxRepository } from "../../persistence-postgres/src/index.js";

export interface OutboxSink {
  publish(events: OutboxRecord[]): Promise<void>;
}

export interface OutboxPublisherResult {
  selected: number;
  published: number;
}

export class OutboxPublisher {
  constructor(
    readonly repository: OutboxRepository,
    readonly sink: OutboxSink,
    readonly batchSize = 100,
  ) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
      throw new RangeError("OUTBOX_BATCH_SIZE_INVALID");
    }
  }

  async tick(): Promise<OutboxPublisherResult> {
    const events = await this.repository.pending(this.batchSize);
    if (events.length === 0) return { selected: 0, published: 0 };
    try {
      await this.sink.publish(events);
      return {
        selected: events.length,
        published: await this.repository.markPublished(events.map((event) => event.eventId)),
      };
    } catch (error) {
      await this.repository.recordAttempts(events.map((event) => event.eventId));
      throw error;
    }
  }
}

export class InternalNoopOutboxSink implements OutboxSink {
  publish(events: OutboxRecord[]): Promise<void> {
    void events;
    return Promise.resolve();
  }
}

export class WebhookOutboxSink implements OutboxSink {
  constructor(
    readonly endpoint: URL,
    readonly timeoutMilliseconds = 5_000,
  ) {}

  async publish(events: OutboxRecord[]): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(this.timeoutMilliseconds),
    });
    if (!response.ok) throw new Error(`OUTBOX_WEBHOOK_REJECTED:${String(response.status)}`);
  }
}
