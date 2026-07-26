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
  await repository.initializeProvider(
    "provider.poison.decoded",
    [
      {
        sourceId: "durable.source",
        sourceStreamId: "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0301",
        deliverySemantics: "durable_at_least_once",
      },
    ],
    BUSINESS_EVENT_RETENTION_MS,
  );
  await repository.initializeProvider(
    "provider.poison.undecodable",
    [
      {
        sourceId: "durable.source",
        sourceStreamId: "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0302",
        deliverySemantics: "durable_at_least_once",
      },
    ],
    BUSINESS_EVENT_RETENTION_MS,
  );
});
afterAll(() => harness.stop());

describe("Business Event poison handling", () => {
  it("stores decoded poison and advances its identifiable source sequence", async () => {
    const providerId = "provider.poison.decoded";
    const sourceStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0301";
    const lease = await requireLease(
      repository,
      providerId,
      "durable.source",
      sourceStreamId,
      "replica-a",
    );
    await expect(
      repository.intakeSourceFact(
        lease,
        sourceFact(sourceStreamId, "1", { description: "" }),
        BUSINESS_EVENT_RETENTION_MS,
        MAPPING_DEADLINE_MS,
      ),
    ).resolves.toMatchObject({ disposition: "rejected" });
    const result = await harness.pool.query<{
      status: string;
      last_persisted_source_sequence: string;
      raw_envelope_hash: string;
      normalized_source_sequence: string;
    }>(
      `SELECT state.status,state.last_persisted_source_sequence,
              inbox.raw_envelope_hash,inbox.normalized_source_sequence
       FROM adapter_business_event_source_state state
       JOIN adapter_business_event_inbox inbox USING (provider_id,source_id)
       WHERE state.provider_id=$1`,
      [providerId],
    );
    expect(result.rows[0]).toMatchObject({
      status: "continuity_loss_pending",
      last_persisted_source_sequence: "1",
      normalized_source_sequence: "1",
    });
    expect(result.rows[0]?.raw_envelope_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("stores undecodable poison without moving the cursor and blocks reconnect", async () => {
    const providerId = "provider.poison.undecodable";
    const sourceStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0302";
    const lease = await requireLease(
      repository,
      providerId,
      "durable.source",
      sourceStreamId,
      "replica-a",
    );
    await repository.persistUndecodablePoison(
      lease,
      `sha256:${"d".repeat(64)}`,
      BUSINESS_EVENT_RETENTION_MS,
    );
    const result = await harness.pool.query<{
      status: string;
      last_persisted_source_sequence: string;
      decode_status: string;
      normalized_source_sequence: string | null;
    }>(
      `SELECT state.status,state.last_persisted_source_sequence,
              inbox.decode_status,inbox.normalized_source_sequence
       FROM adapter_business_event_source_state state
       JOIN adapter_business_event_inbox inbox USING (provider_id,source_id)
       WHERE state.provider_id=$1`,
      [providerId],
    );
    expect(result.rows[0]).toEqual({
      status: "blocked_contract_violation",
      last_persisted_source_sequence: "0",
      decode_status: "undecodable",
      normalized_source_sequence: null,
    });
    await expect(
      repository.acquireSourceLease(
        providerId,
        "durable.source",
        sourceStreamId,
        "replica-b",
        30_000,
      ),
    ).resolves.toBeUndefined();
  });
});
