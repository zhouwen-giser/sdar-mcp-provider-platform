import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthorizationContext } from "../../../packages/domain/src/index.js";
import {
  BusinessEventRelationManager,
  type FrozenJsonRpcRequest,
} from "../../../packages/mcp-protocol/src/index.js";
import { BusinessEventRepository } from "../../../packages/persistence-postgres/src/index.js";
import { BusinessEventsPostgresHarness } from "../postgres-harness.js";
import {
  BUSINESS_EVENT_RETENTION_MS,
  MAPPING_DEADLINE_MS,
  requireLease,
  sourceFact,
} from "../runtime-fixtures.js";

const harness = new BusinessEventsPostgresHarness();
const providerId = "provider.relation";
const sourceId = "relation.source";
const sourceStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0801";
const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "live",
  simulationId: null,
};
let repository: BusinessEventRepository;
let manager: BusinessEventRelationManager;
let streamId: string;
let eventId: string;
let taskIds: string[];

beforeAll(async () => {
  await harness.start();
  repository = new BusinessEventRepository(harness.pool);
  manager = new BusinessEventRelationManager(providerId, repository, 60_000);
  streamId = (
    await repository.initializeProvider(
      providerId,
      [{ sourceId, sourceStreamId, deliverySemantics: "durable_at_least_once" }],
      BUSINESS_EVENT_RETENTION_MS,
    )
  ).streamId;
  taskIds = Array.from({ length: 260 }, () => randomUUID()).sort();
  await harness.pool.query(
    `INSERT INTO provider_task_resource_binding
       (provider_id,task_id,resource_ref,operation_snapshot_id,authorization_context_hash,
        execution_mode,simulation_id,bound_at,terminal_at,retain_until)
     SELECT $1,task_id,'vehicle:42',$2,$3,'live',NULL,'2026-07-22T01:00:00Z',NULL,
            '2026-08-22T01:00:00Z'
     FROM unnest($4::uuid[]) task(task_id)`,
    [providerId, randomUUID(), authorization.hash, taskIds],
  );
  await harness.pool.query(
    `INSERT INTO provider_task_visibility_tombstone
       (provider_id,task_id,authorization_context_hash,execution_mode,simulation_id,
        resource_ref,terminal_at,retain_until)
     SELECT $1,task_id,$2,'live',NULL,'vehicle:42','2026-07-22T02:00:00Z',
            '2026-08-22T02:00:00Z'
     FROM unnest($3::uuid[]) task(task_id)`,
    [providerId, authorization.hash, taskIds],
  );
  const lease = await requireLease(repository, providerId, sourceId, sourceStreamId, "replica-a");
  await repository.intakeSourceFact(
    lease,
    sourceFact(sourceStreamId, "1"),
    BUSINESS_EVENT_RETENTION_MS,
    MAPPING_DEADLINE_MS,
  );
  await repository.prepareNextSourceEvent(providerId, sourceId);
  const finalized = await repository.finalizeNextSourceEvent(
    providerId,
    sourceId,
    BUSINESS_EVENT_RETENTION_MS,
  );
  if (finalized === undefined) throw new Error("Expected relation event");
  eventId = finalized.eventId;
});
afterAll(() => harness.stop());

describe("Business Event relation projection", () => {
  it("creates an opaque immutable projection and pages idempotently across replicas", async () => {
    const first = await manager.list(request({ limit: 100 }), authorization);
    expect(first).toMatchObject({
      resultType: "complete",
      streamId,
      eventId,
      items: taskIds.slice(0, 100),
      total: 260,
      nextAfterTaskId: taskIds[99],
    });
    const projectionToken = requiredString(first.projectionToken);
    expect(projectionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await harness.pool.query<{ token_hash: string }>(
      "SELECT token_hash FROM provider_business_event_relation_projection",
    );
    expect(stored.rows[0]?.token_hash).not.toBe(projectionToken);

    const pageRequest = request({
      projectionToken,
      afterTaskId: requiredString(taskIds[99]),
      limit: 100,
    });
    const secondReplica = new BusinessEventRelationManager(providerId, repository, 60_000);
    const [page, retry, crossReplica] = await Promise.all([
      manager.list(pageRequest, authorization),
      manager.list(pageRequest, authorization),
      secondReplica.list(pageRequest, authorization),
    ]);
    expect(page).toEqual(retry);
    expect(page).toEqual(crossReplica);
    expect(page).toMatchObject({ items: taskIds.slice(100, 200), total: 260 });
  });

  it("rejects invalid anchors, tampered tokens, and authorization mismatch distinctly", async () => {
    const first = await manager.list(request({ limit: 2 }), authorization);
    const projectionToken = requiredString(first.projectionToken);
    await expect(
      manager.list(
        request({ projectionToken, afterTaskId: randomUUID(), limit: 2 }),
        authorization,
      ),
    ).rejects.toMatchObject({ data: { reasonCode: "BUSINESS_EVENT_RELATION_CURSOR_INVALID" } });
    await expect(
      manager.list(
        request({
          projectionToken: `${projectionToken.slice(0, -1)}x`,
          afterTaskId: requiredString(taskIds[0]),
          limit: 2,
        }),
        authorization,
      ),
    ).rejects.toMatchObject({ data: { reasonCode: "BUSINESS_EVENT_RELATION_CURSOR_INVALID" } });
    await expect(
      manager.list(
        request({ projectionToken, afterTaskId: requiredString(taskIds[0]), limit: 2 }),
        {
          ...authorization,
          hash: "f".repeat(64),
        },
      ),
    ).rejects.toMatchObject({ data: { reasonCode: "BUSINESS_EVENT_AUTHORIZATION_MISMATCH" } });

    const tokenHash = createHash("sha256").update(projectionToken).digest("hex");
    await harness.pool.query(
      `DELETE FROM provider_business_event_relation_projection_item
       WHERE token_hash=$1 AND ordinal=0`,
      [tokenHash],
    );
    await expect(
      manager.list(
        request({ projectionToken, afterTaskId: requiredString(taskIds[0]), limit: 2 }),
        authorization,
      ),
    ).rejects.toMatchObject({
      data: { reasonCode: "BUSINESS_EVENT_RELATION_PROJECTION_STALE" },
    });

    const expiring = await manager.list(request({ limit: 2 }), authorization);
    const expiringToken = requiredString(expiring.projectionToken);
    await harness.pool.query(
      `UPDATE provider_business_event_relation_projection
       SET expires_at=created_at+interval '1 millisecond' WHERE token_hash=$1`,
      [createHash("sha256").update(expiringToken).digest("hex")],
    );
    await expect(
      manager.list(
        request({
          projectionToken: expiringToken,
          afterTaskId: requiredString(taskIds[1]),
          limit: 2,
        }),
        authorization,
      ),
    ).rejects.toMatchObject({
      data: { reasonCode: "BUSINESS_EVENT_RELATION_CURSOR_EXPIRED" },
    });
  });

  it("keeps a projection usable after stream rotation and rejects it after event expiry", async () => {
    const first = await manager.list(request({ limit: 2 }), authorization);
    const projectionToken = requiredString(first.projectionToken);
    await repository.rotateStream(
      providerId,
      "OPERATOR_ROTATION",
      [],
      "operator:relation-rotation",
      BUSINESS_EVENT_RETENTION_MS,
    );
    await expect(
      manager.list(
        request({ projectionToken, afterTaskId: requiredString(taskIds[1]), limit: 2 }),
        authorization,
      ),
    ).resolves.toMatchObject({ items: taskIds.slice(2, 4) });
    await harness.pool.query(
      "UPDATE provider_business_event SET expires_at=created_at+interval '1 millisecond' WHERE provider_id=$1",
      [providerId],
    );
    await expect(
      manager.list(
        request({ projectionToken, afterTaskId: requiredString(taskIds[1]), limit: 2 }),
        authorization,
      ),
    ).rejects.toMatchObject({ data: { reasonCode: "BUSINESS_EVENT_NOT_FOUND" } });
  });

  it("cleans expired tokens and their projection items", async () => {
    const token = await repository.createRelationProjection(
      {
        providerId,
        streamId,
        eventId,
        authorizationScopeHash: authorization.hash,
        executionMode: authorization.executionMode,
        simulationId: authorization.simulationId,
        candidateRelationHash: `sha256:${"a".repeat(64)}`,
        projectionRelationHash: `sha256:${"b".repeat(64)}`,
      },
      taskIds.slice(0, 4),
      1,
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await repository.cleanupExpiredRelationProjections()).toBeGreaterThan(0);
    const remaining = await harness.pool.query<{ count: string }>(
      "SELECT count(*) FROM provider_business_event_relation_projection_item WHERE token_hash=$1",
      [createHash("sha256").update(token).digest("hex")],
    );
    expect(remaining.rows[0]?.count).toBe("0");
  });
});

function request(page: {
  limit: number;
  projectionToken?: string;
  afterTaskId?: string;
}): FrozenJsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id: "relation-request",
    method: "io.sdar/businessEvents/relatedTasks/list",
    params: { streamId, eventId, ...page, _meta: {} },
    meta: {
      protocolVersion: "2026-07-28",
      clientInfo: { name: "test", version: "1.0.0" },
      clientCapabilities: {
        extensions: { "io.sdar/businessEvents": { profileVersion: "1.0" } },
      },
      raw: {},
    },
  };
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected string");
  return value;
}
