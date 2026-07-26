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
const providerId = "provider.source.intake";
const sourceId = "durable.source";
const sourceStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0101";
let repository: BusinessEventRepository;

beforeAll(async () => {
  await harness.start();
  repository = new BusinessEventRepository(harness.pool);
  await repository.initializeProvider(
    providerId,
    [
      { sourceId, sourceStreamId, deliverySemantics: "durable_at_least_once" },
      {
        sourceId: "identity.source",
        sourceStreamId: "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0102",
        deliverySemantics: "durable_at_least_once",
      },
      {
        sourceId: "regression.source",
        sourceStreamId: "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0103",
        deliverySemantics: "durable_at_least_once",
      },
    ],
    BUSINESS_EVENT_RETENTION_MS,
  );
});
afterAll(() => harness.stop());

describe("Business Event source intake", () => {
  it("persists before advancing the durable cursor and accepts an exact duplicate", async () => {
    const lease = await requireLease(repository, providerId, sourceId, sourceStreamId, "replica-a");
    const fact = sourceFact(sourceStreamId, "1");
    await expect(
      repository.intakeSourceFact(lease, fact, BUSINESS_EVENT_RETENTION_MS, MAPPING_DEADLINE_MS),
    ).resolves.toMatchObject({ disposition: "received" });
    await expect(
      repository.intakeSourceFact(lease, fact, BUSINESS_EVENT_RETENTION_MS, MAPPING_DEADLINE_MS),
    ).resolves.toMatchObject({ disposition: "duplicate" });

    const state = await harness.pool.query<{ last_persisted_source_sequence: string }>(
      `SELECT last_persisted_source_sequence FROM adapter_business_event_source_state
       WHERE provider_id=$1 AND source_id=$2`,
      [providerId, sourceId],
    );
    const inbox = await harness.pool.query<{ count: string }>(
      "SELECT count(*) FROM adapter_business_event_inbox WHERE provider_id=$1",
      [providerId],
    );
    expect(state.rows[0]?.last_persisted_source_sequence).toBe("1");
    expect(inbox.rows[0]?.count).toBe("1");
  });

  it("resumes a durable source after the persisted cursor", async () => {
    const reconnect = await requireLease(
      repository,
      providerId,
      sourceId,
      sourceStreamId,
      "replica-a",
    );
    expect(reconnect.lastPersistedSourceSequence).toBe("1");
    await expect(
      repository.intakeSourceFact(
        reconnect,
        sourceFact(sourceStreamId, "2"),
        BUSINESS_EVENT_RETENTION_MS,
        MAPPING_DEADLINE_MS,
      ),
    ).resolves.toMatchObject({ disposition: "received" });
  });

  it("blocks a conflicting source event identity without moving its cursor", async () => {
    const identitySourceId = "identity.source";
    const identityStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0102";
    const lease = await requireLease(
      repository,
      providerId,
      identitySourceId,
      identityStreamId,
      "replica-a",
    );
    await repository.intakeSourceFact(
      lease,
      sourceFact(identityStreamId, "1", { sourceEventId: "shared-id" }),
      BUSINESS_EVENT_RETENTION_MS,
      MAPPING_DEADLINE_MS,
    );
    await expect(
      repository.intakeSourceFact(
        lease,
        sourceFact(identityStreamId, "2", { sourceEventId: "shared-id" }),
        BUSINESS_EVENT_RETENTION_MS,
        MAPPING_DEADLINE_MS,
      ),
    ).rejects.toThrow("BUSINESS_EVENT_IDEMPOTENCY_CONFLICT");
    const state = await harness.pool.query<{
      status: string;
      last_persisted_source_sequence: string;
    }>(
      `SELECT status,last_persisted_source_sequence FROM adapter_business_event_source_state
       WHERE provider_id=$1 AND source_id=$2`,
      [providerId, identitySourceId],
    );
    expect(state.rows[0]).toEqual({
      status: "blocked_identity_conflict",
      last_persisted_source_sequence: "1",
    });
  });

  it("blocks sequence regression without persisting the regressed fact", async () => {
    const regressionSourceId = "regression.source";
    const regressionStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0103";
    const lease = await requireLease(
      repository,
      providerId,
      regressionSourceId,
      regressionStreamId,
      "replica-a",
    );
    await repository.intakeSourceFact(
      lease,
      sourceFact(regressionStreamId, "2"),
      BUSINESS_EVENT_RETENTION_MS,
      MAPPING_DEADLINE_MS,
    );
    await expect(
      repository.intakeSourceFact(
        lease,
        sourceFact(regressionStreamId, "1"),
        BUSINESS_EVENT_RETENTION_MS,
        MAPPING_DEADLINE_MS,
      ),
    ).rejects.toThrow("BUSINESS_EVENT_SOURCE_SEQUENCE_REGRESSION");
    const inbox = await harness.pool.query<{ source_sequence: string }>(
      `SELECT normalized_source_sequence AS source_sequence FROM adapter_business_event_inbox
       WHERE provider_id=$1 AND source_id=$2`,
      [providerId, regressionSourceId],
    );
    expect(inbox.rows).toEqual([{ source_sequence: "2" }]);
  });
});
