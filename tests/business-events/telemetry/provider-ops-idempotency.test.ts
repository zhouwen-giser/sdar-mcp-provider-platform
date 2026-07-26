import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BusinessEventProviderOpsRecorder } from "../../../packages/persistence-postgres/src/index.js";
import { BusinessEventsPostgresHarness } from "../postgres-harness.js";

const harness = new BusinessEventsPostgresHarness();
beforeAll(() => harness.start());
afterAll(() => harness.stop());

describe("Business Event audit idempotency", () => {
  it("deduplicates the same stable identity across replicas", async () => {
    const client = await harness.pool.connect();
    try {
      await client.query("BEGIN");
      const input = {
        client,
        providerId: "provider.telemetry.idempotency",
        recordType: "provider.business_event.publication.lifecycle" as const,
        aggregateId: "provider.telemetry.idempotency",
        stableAggregateIdentity: "event-1",
        eventIdentity: "published",
        revision: "900719925474099312345",
        occurredAt: "2026-07-22T01:02:03Z",
        payload: {
          event: "published",
          eventId: "event-1",
          runtimeSequence: "900719925474099312345",
        },
      };
      const first = new BusinessEventProviderOpsRecorder({
        runtimeVersion: "2.0.0-rc.1",
        instanceId: "a",
      });
      const second = new BusinessEventProviderOpsRecorder({
        runtimeVersion: "2.0.0-rc.1",
        instanceId: "b",
      });
      await expect(first.capture(input)).resolves.toBe(true);
      await expect(second.capture(input)).resolves.toBe(false);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const count = await harness.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM provider_ops_delivery",
    );
    expect(count.rows[0]?.count).toBe("1");
  });
});
