import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BusinessEventProviderOpsRecorder,
  BusinessEventRepository,
} from "../../../packages/persistence-postgres/src/index.js";
import { BusinessEventsPostgresHarness } from "../postgres-harness.js";
import { BUSINESS_EVENT_RETENTION_MS } from "../runtime-fixtures.js";

const harness = new BusinessEventsPostgresHarness();
beforeAll(() => harness.start());
afterAll(() => harness.stop());

describe("Business Event rotation audit", () => {
  it("commits continuity and stream audits once for an idempotent operator rotation", async () => {
    const providerId = "provider.telemetry.rotation";
    const repository = new BusinessEventRepository(harness.pool, {
      providerOpsRecorder: new BusinessEventProviderOpsRecorder({
        runtimeVersion: "2.0.0-rc.1",
        instanceId: "a",
      }),
    });
    await repository.initializeProvider(
      providerId,
      [
        {
          sourceId: "source-a",
          sourceStreamId: "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0710",
          deliverySemantics: "durable_at_least_once",
        },
      ],
      BUSINESS_EVENT_RETENTION_MS,
    );
    const first = await repository.rotateStream(
      providerId,
      "OPERATOR_REQUESTED",
      [],
      "operator:42",
      BUSINESS_EVENT_RETENTION_MS,
    );
    await expect(
      repository.rotateStream(
        providerId,
        "OPERATOR_REQUESTED",
        [],
        "operator:42",
        BUSINESS_EVENT_RETENTION_MS,
      ),
    ).resolves.toEqual(first);
    const result = await harness.pool.query<{ record_type: string }>(
      `SELECT record_type FROM provider_ops_delivery WHERE aggregate_id=$1
       AND record_type IN ('provider.business_event.continuity','provider.business_event.stream.lifecycle')`,
      [providerId],
    );
    expect(
      result.rows.filter((row) => row.record_type === "provider.business_event.continuity"),
    ).toHaveLength(1);
    expect(
      result.rows.filter((row) => row.record_type === "provider.business_event.stream.lifecycle"),
    ).toHaveLength(2);
  });
});
