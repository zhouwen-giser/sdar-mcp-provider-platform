import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  OutboxRecord,
  OutboxRepository,
} from "../../packages/persistence-postgres/src/index.js";
import {
  InternalNoopOutboxSink,
  OutboxPublisher,
  type OutboxSink,
} from "../../packages/task-engine/src/index.js";

describe("H6 Outbox publication lifecycle", () => {
  it("publishes a created Task event and marks it delivered", async () => {
    const repository = new MemoryOutboxRepository([event("created")]);
    const sink = new RecordingSink();
    const publisher = new OutboxPublisher(repository as unknown as OutboxRepository, sink, 10);

    await expect(publisher.tick()).resolves.toEqual({ selected: 1, published: 1 });
    expect(sink.events.map((value) => value.eventType)).toEqual(["task.created"]);
    expect(repository.pendingEvents).toHaveLength(0);
  });

  it("treats the internal sink as a completed publication boundary", async () => {
    const repository = new MemoryOutboxRepository([event("expired")]);
    const publisher = new OutboxPublisher(
      repository as unknown as OutboxRepository,
      new InternalNoopOutboxSink(),
    );
    expect((await publisher.tick()).published).toBe(1);
  });

  it("keeps TTL purge blocked until every Task event is published", () => {
    const cleaner = readFileSync("packages/task-engine/src/ttl-cleaner.ts", "utf8");
    expect(cleaner).toContain("published_at IS NULL");
    expect(cleaner).toContain("NOT EXISTS");
  });
});

class RecordingSink implements OutboxSink {
  readonly events: OutboxRecord[] = [];
  publish(events: OutboxRecord[]): Promise<void> {
    this.events.push(...events);
    return Promise.resolve();
  }
}

class MemoryOutboxRepository {
  pendingEvents: OutboxRecord[];
  constructor(events: OutboxRecord[]) {
    this.pendingEvents = events;
  }
  pending(limit: number): Promise<OutboxRecord[]> {
    return Promise.resolve(this.pendingEvents.slice(0, limit));
  }
  markPublished(eventIds: string[]): Promise<number> {
    const before = this.pendingEvents.length;
    this.pendingEvents = this.pendingEvents.filter((value) => !eventIds.includes(value.eventId));
    return Promise.resolve(before - this.pendingEvents.length);
  }
  recordAttempts(): Promise<void> {
    return Promise.resolve();
  }
}

function event(id: string): OutboxRecord {
  return {
    eventId: `00000000-0000-4000-8000-${id.padStart(12, "0")}`,
    eventKey: `test-event-${id}`,
    aggregateId: "00000000-0000-4000-8000-000000000001",
    eventType: `task.${id}`,
    payload: { taskId: "task" },
    createdAt: new Date(),
  };
}
