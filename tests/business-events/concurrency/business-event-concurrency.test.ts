import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BusinessEventRepository } from "../../../packages/persistence-postgres/src/index.js";
import { BusinessEventsPostgresHarness } from "../postgres-harness.js";
import {
  BUSINESS_EVENT_RETENTION_MS,
  MAPPING_DEADLINE_MS,
  requireLease,
  sourceFact,
} from "../runtime-fixtures.js";

const harness = new BusinessEventsPostgresHarness();
let repository: BusinessEventRepository;

beforeAll(async () => {
  await harness.start();
  repository = new BusinessEventRepository(harness.pool);
});
afterAll(() => harness.stop());

describe("Business Event finalizer and rotation concurrency", () => {
  it("serializes cross-source finalization into a gap-free generation sequence", async () => {
    const providerId = "provider.concurrency.cross-source";
    const sources = [
      { sourceId: "source.a", sourceStreamId: "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0601" },
      { sourceId: "source.b", sourceStreamId: "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0602" },
    ];
    await repository.initializeProvider(
      providerId,
      sources.map((source) => ({ ...source, deliverySemantics: "durable_at_least_once" as const })),
      BUSINESS_EVENT_RETENTION_MS,
    );
    for (const source of sources) await ready(providerId, source.sourceId, source.sourceStreamId);
    const finalized = await Promise.all(
      sources.map((source) =>
        repository.finalizeNextSourceEvent(
          providerId,
          source.sourceId,
          BUSINESS_EVENT_RETENTION_MS,
        ),
      ),
    );
    expect(finalized.map((event) => event?.sequence).sort()).toEqual(["1", "2"]);
  });

  it("allows only one finalizer to publish the same ready source fact", async () => {
    const providerId = "provider.concurrency.finalizer";
    const sourceId = "source.a";
    const sourceStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0611";
    await initialize(providerId, sourceId, sourceStreamId);
    await ready(providerId, sourceId, sourceStreamId);
    const results = await Promise.all([
      repository.finalizeNextSourceEvent(providerId, sourceId, BUSINESS_EVENT_RETENTION_MS),
      repository.finalizeNextSourceEvent(providerId, sourceId, BUSINESS_EVENT_RETENTION_MS),
    ]);
    expect(results.filter((event) => event !== undefined)).toHaveLength(1);
  });

  it("serializes finalization against rotation without losing a published event", async () => {
    const providerId = "provider.concurrency.finalizer-rotation";
    const sourceId = "source.a";
    const sourceStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0621";
    await initialize(providerId, sourceId, sourceStreamId);
    await ready(providerId, sourceId, sourceStreamId);
    const [event, rotation] = await Promise.all([
      repository.finalizeNextSourceEvent(providerId, sourceId, BUSINESS_EVENT_RETENTION_MS),
      repository.rotateStream(
        providerId,
        "CONCURRENT_TEST",
        [sourceId],
        "concurrent:finalizer-rotation",
        BUSINESS_EVENT_RETENTION_MS,
      ),
    ]);
    const persisted = await harness.pool.query<{ count: string }>(
      "SELECT count(*) FROM provider_business_event WHERE provider_id=$1",
      [providerId],
    );
    expect(Number(persisted.rows[0]?.count)).toBe(event === undefined ? 0 : 1);
    expect(BigInt(rotation.lastReplayableSequence)).toBe(event === undefined ? 0n : 1n);
  });

  it("coalesces concurrent operator retries to one continuity record", async () => {
    const providerId = "provider.concurrency.rotation";
    const sourceId = "source.a";
    const sourceStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0631";
    await initialize(providerId, sourceId, sourceStreamId);
    const rotations = await Promise.all([
      repository.rotateStream(
        providerId,
        "OPERATOR_REQUESTED",
        [],
        "operator:concurrent-request",
        BUSINESS_EVENT_RETENTION_MS,
      ),
      repository.rotateStream(
        providerId,
        "OPERATOR_REQUESTED",
        [],
        "operator:concurrent-request",
        BUSINESS_EVENT_RETENTION_MS,
      ),
    ]);
    expect(rotations[1]).toEqual(rotations[0]);
    const records = await harness.pool.query<{ count: string }>(
      "SELECT count(*) FROM provider_business_event_continuity_record WHERE provider_id=$1",
      [providerId],
    );
    expect(records.rows[0]?.count).toBe("1");
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

async function ready(providerId: string, sourceId: string, sourceStreamId: string): Promise<void> {
  const lease = await requireLease(repository, providerId, sourceId, sourceStreamId, "replica-a");
  await repository.intakeSourceFact(
    lease,
    sourceFact(sourceStreamId, "1", { sourceEventId: `${sourceId}-event-1` }),
    BUSINESS_EVENT_RETENTION_MS,
    MAPPING_DEADLINE_MS,
  );
  await expect(repository.prepareNextSourceEvent(providerId, sourceId)).resolves.toBe("ready");
}
