import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BusinessEventProviderOpsRecorder,
  BusinessEventRepository,
} from "../../../packages/persistence-postgres/src/index.js";
import { BusinessEventsPostgresHarness } from "../postgres-harness.js";
import { BUSINESS_EVENT_RETENTION_MS, requireLease } from "../runtime-fixtures.js";

const harness = new BusinessEventsPostgresHarness();
beforeAll(() => harness.start());
afterAll(() => harness.stop());

describe("Business Event lease audit", () => {
  it("audits acquisition and takeover but not same-owner renewal", async () => {
    const providerId = "provider.telemetry.lease";
    const sourceId = "source-a";
    const sourceStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0711";
    const repository = new BusinessEventRepository(harness.pool, {
      providerOpsRecorder: new BusinessEventProviderOpsRecorder({
        runtimeVersion: "2.0.0-rc.1",
        instanceId: "a",
      }),
    });
    await repository.initializeProvider(
      providerId,
      [{ sourceId, sourceStreamId, deliverySemantics: "durable_at_least_once" }],
      BUSINESS_EVENT_RETENTION_MS,
    );
    await requireLease(repository, providerId, sourceId, sourceStreamId, "replica-a");
    await requireLease(repository, providerId, sourceId, sourceStreamId, "replica-a");
    await harness.pool.query(
      "UPDATE adapter_business_event_source_state SET lease_until=clock_timestamp()-interval '1 second' WHERE provider_id=$1",
      [providerId],
    );
    await requireLease(repository, providerId, sourceId, sourceStreamId, "replica-b");
    const result = await harness.pool.query<{ event: string }>(
      `SELECT record_body->'payload'->>'event' AS event FROM provider_ops_delivery
       WHERE aggregate_id=$1 AND record_type='provider.business_event.source.lifecycle' ORDER BY created_at`,
      [providerId],
    );
    expect(result.rows.map((row) => row.event)).toEqual(["lease_acquired", "lease_takeover"]);
  });
});
