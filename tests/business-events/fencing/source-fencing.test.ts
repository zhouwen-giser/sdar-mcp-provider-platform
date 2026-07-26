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
const providerId = "provider.source.fencing";
const sourceId = "durable.source";
const sourceStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0201";
let repository: BusinessEventRepository;

beforeAll(async () => {
  await harness.start();
  repository = new BusinessEventRepository(harness.pool);
  await repository.initializeProvider(
    providerId,
    [{ sourceId, sourceStreamId, deliverySemantics: "durable_at_least_once" }],
    BUSINESS_EVENT_RETENTION_MS,
  );
});
afterAll(() => harness.stop());

describe("Business Event source fencing", () => {
  it("rejects every stale-writer intake after lease takeover", async () => {
    const stale = await requireLease(repository, providerId, sourceId, sourceStreamId, "replica-a");
    await harness.pool.query(
      `UPDATE adapter_business_event_source_state
       SET lease_until=clock_timestamp()-interval '1 millisecond'
       WHERE provider_id=$1 AND source_id=$2`,
      [providerId, sourceId],
    );
    const current = await requireLease(
      repository,
      providerId,
      sourceId,
      sourceStreamId,
      "replica-b",
    );
    expect(BigInt(current.fencingToken)).toBeGreaterThan(BigInt(stale.fencingToken));

    await expect(
      repository.intakeSourceFact(
        stale,
        sourceFact(sourceStreamId, "1"),
        BUSINESS_EVENT_RETENTION_MS,
        MAPPING_DEADLINE_MS,
      ),
    ).rejects.toThrow("BUSINESS_EVENT_STALE_FENCE");
    await expect(
      repository.intakeSourceFact(
        current,
        sourceFact(sourceStreamId, "1"),
        BUSINESS_EVENT_RETENTION_MS,
        MAPPING_DEADLINE_MS,
      ),
    ).resolves.toMatchObject({ disposition: "received" });
  });
});
