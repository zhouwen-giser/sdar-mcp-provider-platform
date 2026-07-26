import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BusinessEventRepository } from "../../../packages/persistence-postgres/src/index.js";
import { BusinessEventsPostgresHarness } from "../postgres-harness.js";
import {
  BUSINESS_EVENT_RETENTION_MS,
  MAPPING_DEADLINE_MS,
  requireLease,
  sourceFact,
  taskSourceFact,
} from "../runtime-fixtures.js";

const harness = new BusinessEventsPostgresHarness();
let repository: BusinessEventRepository;

beforeAll(async () => {
  await harness.start();
  repository = new BusinessEventRepository(harness.pool);
  await initialize(
    "provider.rotation.operator",
    "durable.source",
    "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0501",
  );
  await initialize(
    "provider.rotation.roster",
    "old.source",
    "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0502",
  );
  await initialize(
    "provider.rotation.mapping",
    "mapping.source",
    "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0503",
  );
});
afterAll(() => harness.stop());

describe("Business Event atomic rotation", () => {
  it("closes the replay boundary, retries idempotently, and restarts runtime sequence at one", async () => {
    const providerId = "provider.rotation.operator";
    const sourceId = "durable.source";
    const sourceStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0501";
    await publishResource(providerId, sourceId, sourceStreamId, "1");
    const first = await repository.rotateStream(
      providerId,
      "OPERATOR_REQUESTED",
      [],
      "operator:request-42",
      BUSINESS_EVENT_RETENTION_MS,
    );
    const retried = await repository.rotateStream(
      providerId,
      "OPERATOR_REQUESTED",
      [],
      "operator:request-42",
      BUSINESS_EVENT_RETENTION_MS,
    );
    expect(retried).toEqual(first);
    expect(first).toMatchObject({
      reasonCode: "OPERATOR_REQUESTED",
      affectedSourceIds: [sourceId],
      lastReplayableSequence: "1",
      lastContinuousSequence: "1",
    });
    await expect(repository.generation(providerId, first.previousStreamId)).resolves.toMatchObject({
      status: "replayable_closed",
      lastReplayableSequence: "1",
      lastContinuousSequence: "1",
    });
    await expect(repository.currentGeneration(providerId)).resolves.toMatchObject({
      streamId: first.newStreamId,
      currentSequence: "0",
      earliestAvailableSequence: "1",
    });

    await publishResource(providerId, sourceId, sourceStreamId, "2");
    await expect(repository.currentGeneration(providerId)).resolves.toMatchObject({
      currentSequence: "1",
    });
  });

  it("changes source roster only by creating a new generation", async () => {
    const providerId = "provider.rotation.roster";
    const before = await repository.currentGeneration(providerId);
    if (before === undefined) throw new Error("Expected current generation");
    const replacement = [
      {
        sourceId: "new.source",
        sourceStreamId: "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0599",
        deliverySemantics: "best_effort_live" as const,
      },
    ];
    const rotation = await repository.rotateStream(
      providerId,
      "SOURCE_ROSTER_CHANGED",
      ["old.source", "new.source"],
      "roster:manifest-v2",
      BUSINESS_EVENT_RETENTION_MS,
      replacement,
    );
    expect(rotation.previousStreamId).toBe(before.streamId);
    await expect(repository.sourceRoster(providerId, rotation.newStreamId)).resolves.toEqual(
      replacement,
    );
    await expect(repository.currentGeneration(providerId)).resolves.toMatchObject({
      continuityClass: "best_effort_only",
    });
    const oldSource = await harness.pool.query<{ status: string }>(
      `SELECT status FROM adapter_business_event_source_state
       WHERE provider_id=$1 AND source_id='old.source'`,
      [providerId],
    );
    expect(oldSource.rows).toEqual([{ status: "disabled" }]);
  });

  it("rotates a durable mapping failure only after the barrier reaches its deadline", async () => {
    const providerId = "provider.rotation.mapping";
    const sourceId = "mapping.source";
    const sourceStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0503";
    const lease = await requireLease(repository, providerId, sourceId, sourceStreamId, "replica-a");
    await repository.intakeSourceFact(
      lease,
      taskSourceFact(sourceStreamId, "1", "never-created"),
      BUSINESS_EVENT_RETENTION_MS,
      -1,
    );
    await expect(repository.prepareNextSourceEvent(providerId, sourceId)).resolves.toBe("terminal");
    const old = await repository.currentGeneration(providerId);
    const rotation = await repository.rotateStream(
      providerId,
      "SOURCE_MAPPING_FAILED",
      [sourceId],
      `${sourceStreamId}:mapping:1`,
      BUSINESS_EVENT_RETENTION_MS,
    );
    expect(rotation.previousStreamId).toBe(old?.streamId);
    const inbox = await harness.pool.query<{ status: string }>(
      "SELECT status FROM adapter_business_event_inbox WHERE provider_id=$1",
      [providerId],
    );
    expect(inbox.rows).toEqual([{ status: "terminal_skipped" }]);
  });
});

async function initialize(
  providerId: string,
  sourceId: string,
  sourceStreamId: string,
): Promise<void> {
  await repository.initializeProvider(
    providerId,
    [{ sourceId, sourceStreamId, deliverySemantics: "durable_at_least_once" }],
    BUSINESS_EVENT_RETENTION_MS,
  );
}

async function publishResource(
  providerId: string,
  sourceId: string,
  sourceStreamId: string,
  sourceSequence: string,
): Promise<void> {
  const lease = await requireLease(repository, providerId, sourceId, sourceStreamId, "replica-a");
  await repository.intakeSourceFact(
    lease,
    sourceFact(sourceStreamId, sourceSequence),
    BUSINESS_EVENT_RETENTION_MS,
    MAPPING_DEADLINE_MS,
  );
  await repository.prepareNextSourceEvent(providerId, sourceId);
  const finalized = await repository.finalizeNextSourceEvent(
    providerId,
    sourceId,
    BUSINESS_EVENT_RETENTION_MS,
  );
  if (finalized === undefined) throw new Error("Expected finalized Business Event");
}
