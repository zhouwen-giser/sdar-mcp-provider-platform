import { describe, expect, it } from "vitest";
import type {
  OutboxRecord,
  OutboxRepository,
} from "../../packages/persistence-postgres/src/index.js";
import type { ProviderOpsEnvelope } from "../../packages/observability/src/index.js";
import {
  InternalNoopOutboxSink,
  OutboxPublisher,
  ProviderOpsOutboxSink,
} from "../../packages/task-engine/src/index.js";

const context = {
  providerId: "provider-test",
  runtimeVersion: "1.1.0",
  instanceId: "runtime-a",
};

describe("committed Task lifecycle telemetry", () => {
  it("emits one audit envelope from a committed Outbox fact", async () => {
    const repository = new MemoryOutboxRepository([lifecycleEvent()]);
    const emitter = new RecordingEmitter();
    const publisher = new OutboxPublisher(
      repository as unknown as OutboxRepository,
      new ProviderOpsOutboxSink(new InternalNoopOutboxSink(), emitter, context),
    );

    await publisher.tick();

    expect(emitter.envelopes).toHaveLength(1);
    expect(emitter.envelopes[0]).toMatchObject({
      recordType: "provider.task.lifecycle",
      eventCategory: "task.lifecycle",
      deliveryClass: "audit",
      taskId: "task-1",
      observationRevision: 4,
      occurredAt: "2026-07-17T23:59:00.000Z",
      attributes: { lifecycleEvent: "task.completed" },
      payload: {
        previousState: "RUNNING",
        currentState: "TERMINAL_COMPLETED",
        terminal: true,
        resultClass: "success",
      },
    });
  });

  it("replays the same committed event key identically across Runtime replicas", async () => {
    const firstEmitter = new RecordingEmitter();
    const secondEmitter = new RecordingEmitter();
    const first = lifecycleEvent();
    const second = lifecycleEvent();
    second.eventId = "00000000-0000-4000-8000-000000000099";

    await new ProviderOpsOutboxSink(new InternalNoopOutboxSink(), firstEmitter, context).publish([
      first,
    ]);
    await new ProviderOpsOutboxSink(new InternalNoopOutboxSink(), secondEmitter, {
      ...context,
      instanceId: "runtime-b",
    }).publish([second]);

    expect(firstEmitter.envelopes[0]?.recordId).toBe(secondEmitter.envelopes[0]?.recordId);
    expect(firstEmitter.envelopes[0]?.recordHash).toBe(secondEmitter.envelopes[0]?.recordHash);
  });

  it("emits nothing when the transaction produced no committed Outbox event", async () => {
    const repository = new MemoryOutboxRepository([]);
    const emitter = new RecordingEmitter();
    const publisher = new OutboxPublisher(
      repository as unknown as OutboxRepository,
      new ProviderOpsOutboxSink(new InternalNoopOutboxSink(), emitter, context),
    );

    await expect(publisher.tick()).resolves.toEqual({ selected: 0, published: 0 });
    expect(emitter.envelopes).toEqual([]);
  });

  it("does not leak status messages or unrelated payload fields", async () => {
    const emitter = new RecordingEmitter();
    const sink = new ProviderOpsOutboxSink(new InternalNoopOutboxSink(), emitter, context);
    const event = lifecycleEvent();
    event.payload.statusMessage = "token=secret";
    event.payload.adapterPayload = { password: "secret" };

    await sink.publish([event]);

    expect(JSON.stringify(emitter.envelopes)).not.toContain("secret");
  });

  it("keeps committed publication successful when telemetry throws", async () => {
    const repository = new MemoryOutboxRepository([lifecycleEvent()]);
    const publisher = new OutboxPublisher(
      repository as unknown as OutboxRepository,
      new ProviderOpsOutboxSink(
        new InternalNoopOutboxSink(),
        { emitEnvelope: () => void failTelemetry() },
        context,
      ),
    );

    await expect(publisher.tick()).resolves.toEqual({ selected: 1, published: 1 });
  });
});

class RecordingEmitter {
  readonly envelopes: ProviderOpsEnvelope[] = [];
  emitEnvelope(envelope: ProviderOpsEnvelope): void {
    this.envelopes.push(envelope);
  }
}

class MemoryOutboxRepository {
  pendingEvents: OutboxRecord[];
  constructor(events: OutboxRecord[]) {
    this.pendingEvents = events;
  }
  pending(): Promise<OutboxRecord[]> {
    return Promise.resolve(this.pendingEvents);
  }
  markPublished(eventIds: string[]): Promise<number> {
    const before = this.pendingEvents.length;
    this.pendingEvents = this.pendingEvents.filter((event) => !eventIds.includes(event.eventId));
    return Promise.resolve(before - this.pendingEvents.length);
  }
  recordAttempts(): Promise<void> {
    return Promise.resolve();
  }
}

function lifecycleEvent(): OutboxRecord {
  return {
    eventId: "00000000-0000-4000-8000-000000000001",
    eventKey: "task-1:created",
    aggregateId: "task-1",
    eventType: "task.completed",
    payload: {
      taskId: "task-1",
      internalState: "TERMINAL_COMPLETED",
      status: "completed",
      previousState: "RUNNING",
      currentState: "TERMINAL_COMPLETED",
      previousSubstate: "running",
      currentSubstate: null,
      reasonCode: null,
      terminal: true,
      resultClass: "success",
      observationRevision: 4,
      occurredAt: "2026-07-17T23:59:00.000Z",
    },
    createdAt: new Date("2026-07-18T00:00:00.000Z"),
  };
}

function failTelemetry(): never {
  throw new Error("collector unavailable");
}
