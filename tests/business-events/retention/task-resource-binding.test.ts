import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TaskRepository } from "../../../packages/persistence-postgres/src/index.js";
import { TtlCleaner } from "../../../packages/task-engine/src/index.js";
import { BusinessEventsPostgresHarness } from "../postgres-harness.js";

const harness = new BusinessEventsPostgresHarness();
let repository: TaskRepository;
const providerId = "provider.binding";
const taskId = randomUUID();
const snapshotId = randomUUID();

beforeAll(async () => {
  await harness.start();
  repository = new TaskRepository(harness.pool);
  await harness.pool.query(
    `INSERT INTO operation_snapshot
       (snapshot_id, provider_id, provider_version, operation_name, manifest_hash, definition)
     VALUES ($1,$2,'1.0.0','bound_task',$3,$4::jsonb)`,
    [
      snapshotId,
      providerId,
      "b".repeat(64),
      JSON.stringify({
        name: "bound_task",
        resourceBinding: { mode: "ARGUMENT_REFERENCE", resourceIdJsonPointer: "/target/id" },
      }),
    ],
  );
});
afterAll(() => harness.stop());

describe("Task resource binding and visibility retention", () => {
  it("materializes a normalized binding during scheduled admission", async () => {
    const acceptedAt = new Date("2026-07-22T01:00:00Z");
    await repository.publishScheduled({
      taskId,
      providerId,
      operationName: "bound_task",
      operationSnapshotId: snapshotId,
      authorization: { hash: "a".repeat(64), executionMode: "live", simulationId: null },
      arguments: { target: { id: "vehicle:42" } },
      argumentHash: "c".repeat(64),
      acceptedAt,
      notBefore: acceptedAt,
      latestStartAt: new Date(acceptedAt.getTime() + 30_000),
      deadlineAt: null,
      ttlMs: 1,
      timing: {
        start: {
          mode: "scheduled",
          scheduledAt: acceptedAt.toISOString(),
          startToleranceMs: 30_000,
        },
        maxElapsedMs: null,
      },
      reservationRef: null,
    });
    const binding = await harness.pool.query<{
      resource_ref: string;
      authorization_context_hash: string;
      terminal_at: Date | null;
      retain_until: Date;
    }>(
      "SELECT resource_ref,authorization_context_hash,terminal_at,retain_until FROM provider_task_resource_binding WHERE task_id=$1",
      [taskId],
    );
    expect(binding.rows[0]).toEqual(
      expect.objectContaining({
        resource_ref: "vehicle:42",
        authorization_context_hash: "a".repeat(64),
        terminal_at: null,
      }),
    );
    expect(binding.rows[0]?.retain_until.getTime()).toBeGreaterThanOrEqual(
      acceptedAt.getTime() + 1_209_960_000,
    );
  });

  it("atomically extends binding retention on a terminal transition", async () => {
    const completed = await repository.applySnapshot(taskId, 1, {
      internalState: "TERMINAL_COMPLETED",
      mcpStatus: "completed",
      substate: null,
      statusMessage: "Completed.",
      result: { ok: true },
      error: null,
      terminal: true,
      observationType: "task.completed",
    });
    const binding = await harness.pool.query<{ terminal_at: Date; retain_until: Date }>(
      "SELECT terminal_at,retain_until FROM provider_task_resource_binding WHERE task_id=$1",
      [taskId],
    );
    expect(binding.rows[0]?.terminal_at.getTime()).toBe(completed.terminalAt?.getTime());
    expect(binding.rows[0]?.retain_until.getTime()).toBeGreaterThanOrEqual(
      (completed.terminalAt?.getTime() ?? 0) + 1_209_960_000,
    );
  });

  it("writes a visibility tombstone before physical Task purge", async () => {
    const cleaner = new TtlCleaner(repository, { batchSize: 8, purgeGraceMs: 1 });
    const now = new Date(Date.now() + 10_000);
    const expired = await cleaner.tick(now);
    expect(expired.expired).toBe(1);
    await harness.pool.query(
      "UPDATE outbox_event SET published_at=clock_timestamp() WHERE aggregate_id=$1",
      [taskId],
    );
    const purged = await cleaner.tick(new Date(now.getTime() + 2));
    expect(purged.purged).toBe(1);
    expect(await repository.getById(taskId)).toBeNull();
    const tombstone = await harness.pool.query<{
      authorization_context_hash: string;
      resource_ref: string;
      retain_until: Date;
    }>(
      "SELECT authorization_context_hash,resource_ref,retain_until FROM provider_task_visibility_tombstone WHERE provider_id=$1 AND task_id=$2",
      [providerId, taskId],
    );
    expect(tombstone.rows[0]).toEqual(
      expect.objectContaining({
        authorization_context_hash: "a".repeat(64),
        resource_ref: "vehicle:42",
      }),
    );
    expect(tombstone.rows[0]?.retain_until.getTime()).toBeGreaterThan(now.getTime());
  });
});
