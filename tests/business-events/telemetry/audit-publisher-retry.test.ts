import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BusinessEventProviderOpsRecorder,
  ProviderOpsDeliveryRepository,
} from "../../../packages/persistence-postgres/src/index.js";
import { DurableProviderOpsPublisher } from "../../../packages/task-engine/src/index.js";
import { BusinessEventsPostgresHarness } from "../postgres-harness.js";

const harness = new BusinessEventsPostgresHarness();
beforeAll(() => harness.start());
afterAll(() => harness.stop());

describe("Business Event audit publisher isolation", () => {
  it("moves export failure to retry without deleting the committed audit", async () => {
    const client = await harness.pool.connect();
    try {
      await new BusinessEventProviderOpsRecorder({
        runtimeVersion: "2.0.0-rc.1",
        instanceId: "a",
      }).capture({
        client,
        providerId: "provider.telemetry.retry",
        recordType: "provider.business_event.stream.lifecycle",
        aggregateId: "provider.telemetry.retry",
        stableAggregateIdentity: "stream-a",
        eventIdentity: "generation_created",
        revision: "1",
        occurredAt: new Date(),
        payload: {
          event: "generation_created",
          currentStreamId: "stream-a",
          generationStatus: "current",
        },
      });
    } finally {
      client.release();
    }
    const publisher = new DurableProviderOpsPublisher(
      new ProviderOpsDeliveryRepository(harness.pool),
      { export: () => Promise.reject(new Error("collector unavailable")) },
      "replica-a",
    );
    await expect(publisher.tick()).resolves.toMatchObject({ claimed: 1, retried: 1, delivered: 0 });
    const result = await harness.pool.query<{ state: string }>(
      "SELECT state FROM provider_ops_delivery",
    );
    expect(result.rows).toEqual([{ state: "RETRY_WAIT" }]);
  });
});
