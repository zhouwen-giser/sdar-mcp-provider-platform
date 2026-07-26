import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BusinessEventRepository } from "../../../packages/persistence-postgres/src/index.js";
import { BusinessEventsPostgresHarness } from "../postgres-harness.js";

const harness = new BusinessEventsPostgresHarness();
let repository: BusinessEventRepository;
let streamId: string;

beforeAll(async () => {
  await harness.start();
  repository = new BusinessEventRepository(harness.pool);
  const generation = await repository.initializeProvider(
    "provider.persistence",
    [
      {
        sourceId: "adapter.durable",
        sourceStreamId: "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0001",
        deliverySemantics: "durable_at_least_once",
      },
      {
        sourceId: "adapter.live",
        sourceStreamId: "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0002",
        deliverySemantics: "best_effort_live",
      },
    ],
    604_800_000,
  );
  streamId = generation.streamId;
});
afterAll(() => harness.stop());

describe("Business Event durable authorities", () => {
  it("initializes one current generation and a stable sorted mixed roster", async () => {
    const generation = await repository.currentGeneration("provider.persistence");
    expect(generation).toEqual(
      expect.objectContaining({ streamId, currentSequence: "0", continuityClass: "mixed" }),
    );
    expect(await repository.sourceRoster("provider.persistence", streamId)).toEqual([
      expect.objectContaining({ sourceId: "adapter.durable" }),
      expect.objectContaining({ sourceId: "adapter.live" }),
    ]);
    const repeated = await repository.initializeProvider(
      "provider.persistence",
      [
        {
          sourceId: "ignored.after.initialization",
          sourceStreamId: "018f0d4e-7b3a-7cc1-8d57-2f4d9e2affff",
          deliverySemantics: "best_effort_live",
        },
      ],
      604_800_000,
    );
    expect(repeated.streamId).toBe(streamId);
  });

  it("uses database time, a single cursor row, and fencing on lease takeover", async () => {
    const first = await repository.acquireSourceLease(
      "provider.persistence",
      "adapter.durable",
      "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0001",
      "replica-a",
      30_000,
    );
    expect(first).toBeDefined();
    if (first === undefined) throw new Error("Expected first lease");
    const blocked = await repository.acquireSourceLease(
      "provider.persistence",
      "adapter.durable",
      "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0001",
      "replica-b",
      30_000,
    );
    expect(blocked).toBeUndefined();
    await harness.pool.query(
      `UPDATE adapter_business_event_source_state SET lease_until=clock_timestamp()-interval '1 second'
       WHERE provider_id='provider.persistence' AND source_id='adapter.durable'`,
    );
    const takeover = await repository.acquireSourceLease(
      "provider.persistence",
      "adapter.durable",
      "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0001",
      "replica-b",
      30_000,
    );
    if (takeover === undefined) throw new Error("Expected lease takeover");
    expect(BigInt(takeover.fencingToken)).toBeGreaterThan(BigInt(first.fencingToken));
    await expect(repository.renewSourceLease(first, 30_000)).rejects.toThrow(
      "BUSINESS_EVENT_STALE_FENCE",
    );
    const authority = await harness.pool.query<{ count: string }>(
      `SELECT count(*) FROM adapter_business_event_source_state
       WHERE provider_id='provider.persistence' AND source_id='adapter.durable'`,
    );
    expect(authority.rows[0]?.count).toBe("1");
  });

  it("persists undecodable poison without normalized identity fields", async () => {
    await harness.pool.query(
      `INSERT INTO adapter_business_event_inbox
         (provider_id, source_id, source_stream_id, status, raw_envelope_hash,
          decode_status, reject_reason, retain_until)
       VALUES ('provider.persistence','adapter.live',$1,'rejected',$2,'undecodable',
               'BUSINESS_EVENT_PAYLOAD_INVALID',clock_timestamp()+interval '1 day')`,
      ["018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0002", `sha256:${"a".repeat(64)}`],
    );
    const row = await harness.pool.query<{
      decode_status: string;
      normalized_source_sequence: string | null;
    }>("SELECT decode_status, normalized_source_sequence FROM adapter_business_event_inbox");
    expect(row.rows[0]).toEqual({ decode_status: "undecodable", normalized_source_sequence: null });
  });
});
