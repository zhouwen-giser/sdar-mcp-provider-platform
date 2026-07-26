import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BusinessEventRepository } from "../../../packages/persistence-postgres/src/index.js";
import { BusinessEventsPostgresHarness } from "../postgres-harness.js";
import {
  BUSINESS_EVENT_RETENTION_MS,
  MAPPING_DEADLINE_MS,
  requireLease,
  sourceFact,
  taskSourceFact,
} from "../runtime-fixtures.js";

const harness = new BusinessEventsPostgresHarness();
let repository: BusinessEventRepository;

beforeAll(async () => {
  await harness.start();
  repository = new BusinessEventRepository(harness.pool);
  await initialize(
    "provider.finalizer.barrier",
    "barrier.source",
    "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0401",
  );
  await initialize(
    "provider.finalizer.resource",
    "resource.source",
    "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0402",
  );
  await initialize(
    "provider.finalizer.task",
    "task.source",
    "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0403",
  );
});
afterAll(() => harness.stop());

describe("Business Event mapping and publication", () => {
  it("keeps source sequence 11 behind pending sequence 10", async () => {
    const providerId = "provider.finalizer.barrier";
    const sourceId = "barrier.source";
    const sourceStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0401";
    const lease = await requireLease(repository, providerId, sourceId, sourceStreamId, "replica-a");
    for (const sequence of ["10", "11"]) {
      await repository.intakeSourceFact(
        lease,
        taskSourceFact(sourceStreamId, sequence, sequence === "10" ? "missing-10" : "missing-11"),
        BUSINESS_EVENT_RETENTION_MS,
        MAPPING_DEADLINE_MS,
      );
    }
    await expect(repository.prepareNextSourceEvent(providerId, sourceId)).resolves.toBe("pending");
    await expect(
      repository.finalizeNextSourceEvent(providerId, sourceId, BUSINESS_EVENT_RETENTION_MS),
    ).resolves.toBeUndefined();
    const rows = await harness.pool.query<{ normalized_source_sequence: string; status: string }>(
      `SELECT normalized_source_sequence,status FROM adapter_business_event_inbox
       WHERE provider_id=$1 ORDER BY normalized_source_sequence`,
      [providerId],
    );
    expect(rows.rows).toEqual([
      { normalized_source_sequence: "10", status: "pending_mapping" },
      { normalized_source_sequence: "11", status: "received" },
    ]);
  });

  it("associates a resource event at occurredAt and writes stable relations", async () => {
    const providerId = "provider.finalizer.resource";
    const sourceId = "resource.source";
    const sourceStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0402";
    const included = [randomUUID(), randomUUID()].sort();
    const excluded = randomUUID();
    for (const [taskId, terminalAt] of [
      [included[1], null],
      [included[0], "2026-07-22T01:03:00Z"],
      [excluded, "2026-07-22T01:00:00Z"],
    ] as const) {
      await harness.pool.query(
        `INSERT INTO provider_task_resource_binding
           (provider_id,task_id,resource_ref,operation_snapshot_id,authorization_context_hash,
            execution_mode,simulation_id,bound_at,terminal_at,retain_until)
         VALUES ($1,$2,'vehicle:42',$3,$4,'live',NULL,'2026-07-22T01:00:00Z',$5,
                 '2026-08-22T01:00:00Z')`,
        [providerId, taskId, randomUUID(), "a".repeat(64), terminalAt],
      );
    }
    const lease = await requireLease(repository, providerId, sourceId, sourceStreamId, "replica-a");
    await repository.intakeSourceFact(
      lease,
      sourceFact(sourceStreamId, "1"),
      BUSINESS_EVENT_RETENTION_MS,
      MAPPING_DEADLINE_MS,
    );
    await expect(repository.prepareNextSourceEvent(providerId, sourceId)).resolves.toBe("ready");
    const event = await repository.finalizeNextSourceEvent(
      providerId,
      sourceId,
      BUSINESS_EVENT_RETENTION_MS,
    );
    expect(event).toMatchObject({
      sequence: "1",
      scope: "resource",
      resourceRef: "vehicle:42",
      candidateRelatedTaskCount: 2,
    });
    const relations = await harness.pool.query<{ task_id: string; ordinal: number }>(
      `SELECT task_id::text,ordinal FROM provider_business_event_relation
       WHERE provider_id=$1 ORDER BY ordinal`,
      [providerId],
    );
    expect(relations.rows).toEqual(
      included.map((taskId, ordinal) => ({ task_id: taskId, ordinal })),
    );
  });

  it("maps task-scope external execution identity to the MCP task id", async () => {
    const providerId = "provider.finalizer.task";
    const sourceId = "task.source";
    const sourceStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0403";
    const taskId = randomUUID();
    const snapshotId = randomUUID();
    await harness.pool.query(
      `INSERT INTO operation_snapshot
         (snapshot_id,provider_id,provider_version,operation_name,manifest_hash,definition)
       VALUES ($1,$2,'1.0.0','task_operation',$3,'{}'::jsonb)`,
      [snapshotId, providerId, "b".repeat(64)],
    );
    await harness.pool.query(
      `INSERT INTO provider_task
         (task_id,provider_id,operation_name,operation_snapshot_id,authorization_context_hash,
          execution_mode,simulation_id,arguments,argument_hash,external_execution_id,
          internal_state,mcp_status,substate,status_message,timing,accepted_at)
       VALUES ($1,$2,'task_operation',$3,$4,'live',NULL,'{}'::jsonb,$5,'external-42',
               'RUNNING','working','running','Running.','{}'::jsonb,clock_timestamp())`,
      [taskId, providerId, snapshotId, "c".repeat(64), "d".repeat(64)],
    );
    const lease = await requireLease(repository, providerId, sourceId, sourceStreamId, "replica-a");
    await repository.intakeSourceFact(
      lease,
      taskSourceFact(sourceStreamId, "1", "external-42"),
      BUSINESS_EVENT_RETENTION_MS,
      MAPPING_DEADLINE_MS,
    );
    await expect(repository.prepareNextSourceEvent(providerId, sourceId)).resolves.toBe("ready");
    await expect(
      repository.finalizeNextSourceEvent(providerId, sourceId, BUSINESS_EVENT_RETENTION_MS),
    ).resolves.toMatchObject({ sequence: "1", scope: "task", taskId });
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
