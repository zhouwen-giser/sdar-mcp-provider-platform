import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BusinessEventProviderOpsRecorder,
  BusinessEventRepository,
} from "../../../packages/persistence-postgres/src/index.js";
import { BusinessEventsPostgresHarness } from "../postgres-harness.js";
import {
  BUSINESS_EVENT_RETENTION_MS,
  MAPPING_DEADLINE_MS,
  requireLease,
  sourceFact,
  taskSourceFact,
} from "../runtime-fixtures.js";

const harness = new BusinessEventsPostgresHarness();
const context = { runtimeVersion: "2.0.0-rc.1", instanceId: "telemetry-test" };

beforeAll(() => harness.start());
afterAll(() => harness.stop());

describe("transactional Business Event Provider Ops", () => {
  it("commits generation, lease, intake, mapping failure and publication audits with authority", async () => {
    const providerId = "provider.telemetry.transaction";
    const sourceId = "source-a";
    const sourceStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0701";
    const repository = auditedRepository();
    await repository.initializeProvider(
      providerId,
      [{ sourceId, sourceStreamId, deliverySemantics: "durable_at_least_once" }],
      BUSINESS_EVENT_RETENTION_MS,
    );
    const lease = await requireLease(repository, providerId, sourceId, sourceStreamId, "replica-a");
    await repository.intakeSourceFact(
      lease,
      sourceFact(sourceStreamId, "1"),
      BUSINESS_EVENT_RETENTION_MS,
      MAPPING_DEADLINE_MS,
    );
    await repository.prepareNextSourceEvent(providerId, sourceId);
    await repository.finalizeNextSourceEvent(providerId, sourceId, BUSINESS_EVENT_RETENTION_MS);

    const types = await auditTypes(providerId);
    expect(types).toEqual(
      expect.arrayContaining([
        "provider.business_event.stream.lifecycle",
        "provider.business_event.source.lifecycle",
        "provider.business_event.ingest.lifecycle",
        "provider.business_event.publication.lifecycle",
      ]),
    );

    const mappingProvider = "provider.telemetry.mapping";
    await repository.initializeProvider(
      mappingProvider,
      [{ sourceId, sourceStreamId, deliverySemantics: "durable_at_least_once" }],
      BUSINESS_EVENT_RETENTION_MS,
    );
    const mappingLease = await requireLease(
      repository,
      mappingProvider,
      sourceId,
      sourceStreamId,
      "replica-a",
    );
    await repository.intakeSourceFact(
      mappingLease,
      taskSourceFact(sourceStreamId, "1", "missing"),
      BUSINESS_EVENT_RETENTION_MS,
      -1,
    );
    await repository.prepareNextSourceEvent(mappingProvider, sourceId);
    const mappingAudit = await harness.pool.query<{ payload: { event: string } }>(
      `SELECT record_body->'payload' AS payload FROM provider_ops_delivery
       WHERE aggregate_id=$1 AND record_type='provider.business_event.ingest.lifecycle'`,
      [mappingProvider],
    );
    expect(mappingAudit.rows.map((row) => row.payload.event)).toContain("mapping_failed");
  });

  it("rolls authority back when mandatory audit capture fails", async () => {
    const providerId = "provider.telemetry.rollback";
    const repository = new BusinessEventRepository(harness.pool, {
      providerOpsRecorder: {
        capture: () => Promise.reject(new Error("AUDIT_INSERT_FAILED")),
      },
    });
    await expect(
      repository.initializeProvider(
        providerId,
        [
          {
            sourceId: "source-a",
            sourceStreamId: "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0702",
            deliverySemantics: "durable_at_least_once",
          },
        ],
        BUSINESS_EVENT_RETENTION_MS,
      ),
    ).rejects.toThrow("AUDIT_INSERT_FAILED");
    await expect(repository.currentGeneration(providerId)).resolves.toBeUndefined();
    expect(await auditTypes(providerId)).toEqual([]);
  });

  it("stores poison hashes and reason codes without raw payload", async () => {
    const providerId = "provider.telemetry.poison";
    const sourceId = "source-a";
    const sourceStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0703";
    const repository = auditedRepository();
    await repository.initializeProvider(
      providerId,
      [{ sourceId, sourceStreamId, deliverySemantics: "durable_at_least_once" }],
      BUSINESS_EVENT_RETENTION_MS,
    );
    const lease = await requireLease(repository, providerId, sourceId, sourceStreamId, "replica-a");
    await repository.persistUndecodablePoison(
      lease,
      `sha256:${"a".repeat(64)}`,
      BUSINESS_EVENT_RETENTION_MS,
    );
    const result = await harness.pool.query<{ record_body: Record<string, unknown> }>(
      `SELECT record_body FROM provider_ops_delivery
       WHERE aggregate_id=$1 AND record_type='provider.business_event.ingest.lifecycle'
       ORDER BY created_at DESC LIMIT 1`,
      [providerId],
    );
    const encoded = JSON.stringify(result.rows[0]?.record_body);
    expect(encoded).toContain("SOURCE_PAYLOAD_UNDECODABLE");
    expect(encoded).not.toContain("rawPayload");
  });
});

function auditedRepository(): BusinessEventRepository {
  return new BusinessEventRepository(harness.pool, {
    providerOpsRecorder: new BusinessEventProviderOpsRecorder(context),
  });
}

async function auditTypes(providerId: string): Promise<string[]> {
  const result = await harness.pool.query<{ record_type: string }>(
    "SELECT record_type FROM provider_ops_delivery WHERE aggregate_id=$1 ORDER BY created_at",
    [providerId],
  );
  return result.rows.map((row) => row.record_type);
}
