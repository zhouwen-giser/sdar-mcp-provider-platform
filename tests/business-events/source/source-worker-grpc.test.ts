import * as grpc from "@grpc/grpc-js";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdapterBusinessEventSourceClient } from "../../../apps/runtime/src/business-events/source-client.js";
import { createMockAdapterServer } from "../../../examples/mock-adapter-typescript/src/server.js";
import {
  GrpcAdapterGateway,
  jsonToProtoStruct,
  type AdapterBusinessEvent,
  type BusinessEventSourceCapability,
} from "../../../packages/adapter-protocol/src/index.js";
import { BusinessEventRepository } from "../../../packages/persistence-postgres/src/index.js";
import { BusinessEventsPostgresHarness } from "../postgres-harness.js";
import {
  BUSINESS_EVENT_RETENTION_MS,
  requireLease,
  sourceFact,
  taskSourceFact,
} from "../runtime-fixtures.js";

const harness = new BusinessEventsPostgresHarness();
const providerId = "provider.source.grpc";
const sourceId = "adapter.vehicle";
const sourceStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0111";
const capability: BusinessEventSourceCapability = {
  sourceId,
  sourceStreamId,
  deliverySemantics: "durable_at_least_once",
  replaySupported: true,
  sourceRetentionMs: "604800000",
  maxEventBytes: "65536",
  maxPayloadDepth: 16,
  maxPayloadNodes: 4096,
  maxPayloadStringBytes: "16384",
};
const events: AdapterBusinessEvent[] = [
  {
    sourceEventId: "grpc-event-1",
    sourceSequence: "1",
    sourceStreamId,
    scope: "resource",
    occurredAt: { seconds: "1784682123", nanos: 123_456_789 },
    eventType: "vehicle.state.changed",
    description: "Vehicle state changed.",
    resourceRef: "vehicle:42",
    severityHint: "info",
    reasonCode: "STATE_CHANGED",
    rawPayload: { state: "ready" },
  },
];

let gateway: GrpcAdapterGateway;
let server: grpc.Server;
let repository: BusinessEventRepository;

beforeAll(async () => {
  await harness.start();
  repository = new BusinessEventRepository(harness.pool);
  await repository.initializeProvider(
    providerId,
    [{ sourceId, sourceStreamId, deliverySemantics: "durable_at_least_once" }],
    BUSINESS_EVENT_RETENTION_MS,
  );
  server = createMockAdapterServer({
    providerId,
    businessEventSources: [capability],
    businessEvents: { [sourceId]: events },
  });
  const port = await new Promise<number>((resolvePort, reject) => {
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (error, bound) =>
      error === null ? resolvePort(bound) : reject(error),
    );
  });
  gateway = new GrpcAdapterGateway({ endpoint: `127.0.0.1:${String(port)}`, providerId });
});
afterAll(async () => {
  gateway.close();
  server.forceShutdown();
  await harness.stop();
});

describe("AdapterBusinessEventSourceClient", () => {
  it("rotates successive buffered mapping barriers even when the received cursor does not change", async () => {
    const id = "provider.source.successive-barriers";
    await repository.initializeProvider(
      id,
      [{ sourceId, sourceStreamId, deliverySemantics: "durable_at_least_once" }],
      BUSINESS_EVENT_RETENTION_MS,
    );
    const lease = await requireLease(repository, id, sourceId, sourceStreamId, "barrier-replica");
    await repository.intakeSourceFact(
      lease,
      taskSourceFact(sourceStreamId, "1", "missing-first"),
      BUSINESS_EVENT_RETENTION_MS,
      -1,
    );
    await repository.intakeSourceFact(
      lease,
      taskSourceFact(sourceStreamId, "2", "missing-second"),
      BUSINESS_EVENT_RETENTION_MS,
      3600000,
    );
    const heldGateway = {
      streamBusinessEvents: () => {
        const held = new EventEmitter();
        Object.assign(held, {
          pause: () => undefined,
          resume: () => undefined,
          cancel: () => queueMicrotask(() => held.emit("end")),
        });
        return held;
      },
    } as unknown as GrpcAdapterGateway;
    const worker = new AdapterBusinessEventSourceClient(repository, heldGateway, {
      providerId: id,
      sourceId,
      sourceStreamId,
      deliverySemantics: "durable_at_least_once",
      replicaId: "barrier-replica",
      pendingRetryMs: 10,
    });
    await expect(worker.runOnce()).resolves.toBe("rotated");
    await harness.pool.query(
      "UPDATE adapter_business_event_inbox SET mapping_deadline=clock_timestamp()-interval '1 second' WHERE provider_id=$1 AND normalized_source_sequence=2",
      [id],
    );
    await expect(worker.runOnce()).resolves.toBe("rotated");
    const rows = await harness.pool.query<{ status: string }>(
      "SELECT status FROM adapter_business_event_inbox WHERE provider_id=$1 ORDER BY normalized_source_sequence",
      [id],
    );
    expect(rows.rows).toEqual([{ status: "terminal_skipped" }, { status: "terminal_skipped" }]);
    const generations = await harness.pool.query(
      "SELECT continuity_reason_identity FROM provider_business_event_continuity_record WHERE provider_id=$1",
      [id],
    );
    expect(generations.rowCount).toBe(2);
    const resumed = await requireLease(repository, id, sourceId, sourceStreamId, "barrier-replica");
    await repository.intakeSourceFact(
      resumed,
      sourceFact(sourceStreamId, "3"),
      BUSINESS_EVENT_RETENTION_MS,
      1000,
    );
    await expect(repository.prepareNextSourceEvent(id, sourceId)).resolves.toBe("ready");
    await expect(
      repository.finalizeNextSourceEvent(id, sourceId, BUSINESS_EVENT_RETENTION_MS),
    ).resolves.toMatchObject({ sourceSequence: "3" });
  });

  it("holds no database transaction while waiting on gRPC and publishes the received fact", async () => {
    const worker = new AdapterBusinessEventSourceClient(repository, gateway, {
      providerId,
      sourceId,
      sourceStreamId,
      deliverySemantics: "durable_at_least_once",
      replicaId: "replica-a",
    });
    await expect(worker.runOnce()).resolves.toBe("completed");
    const result = await harness.pool.query<{
      sequence: string;
      source_sequence: string;
      resource_ref: string;
    }>(
      `SELECT sequence,source_sequence,resource_ref FROM provider_business_event
       WHERE provider_id=$1`,
      [providerId],
    );
    expect(result.rows).toEqual([
      { sequence: "1", source_sequence: "1", resource_ref: "vehicle:42" },
    ]);
  });

  it("publishes a pending Task event after its execution binding appears without another source event", async () => {
    const retryProviderId = "provider.source.pending-retry";
    const retrySourceId = "adapter.task";
    const retryStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0112";
    const externalExecutionId = "pending-retry-execution";
    const taskId = randomUUID();
    await repository.initializeProvider(
      retryProviderId,
      [
        {
          sourceId: retrySourceId,
          sourceStreamId: retryStreamId,
          deliverySemantics: "durable_at_least_once",
        },
      ],
      BUSINESS_EVENT_RETENTION_MS,
    );
    const held = Object.assign(new EventEmitter(), {
      pause: () => undefined,
      resume: () => undefined,
      cancel: () => undefined,
    });
    const stream = held as unknown as ReturnType<GrpcAdapterGateway["streamBusinessEvents"]>;
    let signalOpened: () => void = () => undefined;
    const opened = new Promise<void>((resolveOpened) => {
      signalOpened = resolveOpened;
    });
    const heldGateway = {
      streamBusinessEvents: () => {
        queueMicrotask(signalOpened);
        return stream;
      },
    } as unknown as GrpcAdapterGateway;
    const worker = new AdapterBusinessEventSourceClient(repository, heldGateway, {
      providerId: retryProviderId,
      sourceId: retrySourceId,
      sourceStreamId: retryStreamId,
      deliverySemantics: "durable_at_least_once",
      replicaId: "pending-retry-replica",
      pendingRetryMs: 50,
    });
    const running = worker.runOnce();
    try {
      await opened;
      held.emit("data", {
        sourceEventId: "pending-retry-1",
        sourceSequence: "1",
        sourceStreamId: retryStreamId,
        scope: "task",
        occurredAt: { seconds: "1784682123", nanos: 0 },
        eventType: "vehicle.mission.started",
        description: "Task started",
        externalExecutionId,
        severityHint: "info",
        reasonCode: "TASK_STARTED",
        rawPayload: jsonToProtoStruct({ state: "STARTING" }),
      } satisfies AdapterBusinessEvent);
      await waitForRow(async () => {
        const result = await harness.pool.query<{ status: string }>(
          "SELECT status FROM adapter_business_event_inbox WHERE provider_id=$1 AND source_id=$2",
          [retryProviderId, retrySourceId],
        );
        return result.rows[0]?.status === "pending_mapping" ? result.rows[0] : undefined;
      });
      const snapshotId = randomUUID();
      await harness.pool.query(
        `INSERT INTO operation_snapshot
           (snapshot_id,provider_id,provider_version,operation_name,manifest_hash,definition)
         VALUES ($1,$2,'1.0.0','task_operation',$3,'{}'::jsonb)`,
        [snapshotId, retryProviderId, "b".repeat(64)],
      );
      await harness.pool.query(
        `INSERT INTO provider_task
           (task_id,provider_id,operation_name,operation_snapshot_id,authorization_context_hash,
            execution_mode,simulation_id,arguments,argument_hash,external_execution_id,
            internal_state,mcp_status,substate,status_message,timing,accepted_at)
         VALUES ($1,$2,'task_operation',$3,$4,'live',NULL,'{}'::jsonb,$5,$6,
                 'RUNNING','working','running','Running.','{}'::jsonb,clock_timestamp())`,
        [taskId, retryProviderId, snapshotId, "c".repeat(64), "d".repeat(64), externalExecutionId],
      );
      const published = await waitForRow(async () => {
        const result = await harness.pool.query<{ task_id: string; source_sequence: string }>(
          "SELECT task_id::text,source_sequence::text FROM provider_business_event WHERE provider_id=$1 AND source_id=$2",
          [retryProviderId, retrySourceId],
        );
        return result.rows[0];
      });
      expect(published).toEqual({ task_id: taskId, source_sequence: "1" });
    } finally {
      held.emit("end");
      await running;
    }
  });

  it("closes the old source subscription when an unmapped Task event expires without a later event", async () => {
    const timeoutProviderId = "provider.source.mapping-timeout";
    const timeoutSourceId = "adapter.task-timeout";
    const timeoutStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0113";
    await repository.initializeProvider(
      timeoutProviderId,
      [
        {
          sourceId: timeoutSourceId,
          sourceStreamId: timeoutStreamId,
          deliverySemantics: "durable_at_least_once",
        },
      ],
      BUSINESS_EVENT_RETENTION_MS,
    );
    const held = new EventEmitter();
    let cancelled = 0;
    Object.assign(held, {
      pause: () => undefined,
      resume: () => undefined,
      cancel: () => {
        cancelled += 1;
        queueMicrotask(() => held.emit("end"));
      },
    });
    const stream = held as unknown as ReturnType<GrpcAdapterGateway["streamBusinessEvents"]>;
    let signalOpened: () => void = () => undefined;
    const opened = new Promise<void>((resolveOpened) => {
      signalOpened = resolveOpened;
    });
    const heldGateway = {
      streamBusinessEvents: () => {
        queueMicrotask(signalOpened);
        return stream;
      },
    } as unknown as GrpcAdapterGateway;
    const worker = new AdapterBusinessEventSourceClient(repository, heldGateway, {
      providerId: timeoutProviderId,
      sourceId: timeoutSourceId,
      sourceStreamId: timeoutStreamId,
      deliverySemantics: "durable_at_least_once",
      replicaId: "mapping-timeout-replica",
      mappingDeadlineMs: 250,
      pendingRetryMs: 25,
    });
    const running = worker.runOnce();
    await opened;
    held.emit("data", {
      sourceEventId: "mapping-timeout-1",
      sourceSequence: "1",
      sourceStreamId: timeoutStreamId,
      scope: "task",
      occurredAt: { seconds: "1784682123", nanos: 0 },
      eventType: "vehicle.mission.started",
      description: "Unmapped Task started",
      externalExecutionId: "mapping-timeout-execution",
      severityHint: "info",
      reasonCode: "TASK_STARTED",
      rawPayload: jsonToProtoStruct({ state: "STARTING" }),
    } satisfies AdapterBusinessEvent);
    await waitForRow(async () => {
      const result = await harness.pool.query<{ status: string }>(
        "SELECT status FROM adapter_business_event_inbox WHERE provider_id=$1 AND source_id=$2",
        [timeoutProviderId, timeoutSourceId],
      );
      return result.rows[0]?.status === "pending_mapping" ? result.rows[0] : undefined;
    });
    await expect(running).resolves.toBe("rotated");
    expect(cancelled).toBe(1);
    const continuity = await harness.pool.query<{ reason_code: string }>(
      "SELECT reason_code FROM provider_business_event_continuity_record WHERE provider_id=$1",
      [timeoutProviderId],
    );
    expect(continuity.rows).toEqual([{ reason_code: "SOURCE_MAPPING_FAILED" }]);
    const inbox = await harness.pool.query<{ status: string }>(
      "SELECT status FROM adapter_business_event_inbox WHERE provider_id=$1 AND source_id=$2",
      [timeoutProviderId, timeoutSourceId],
    );
    expect(inbox.rows).toEqual([{ status: "terminal_skipped" }]);
  });
});

async function waitForRow<T>(read: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const row = await read();
    if (row !== undefined) return row;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error("SOURCE_PENDING_RETRY_TIMEOUT");
}
