import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import * as grpc from "@grpc/grpc-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdapterBusinessEventSourceClient } from "../../../apps/runtime/src/business-events/source-client.js";
import { createMockAdapterServer } from "../../../examples/mock-adapter-typescript/src/server.js";
import {
  canonicalSha256,
  GrpcAdapterGateway,
  jsonToProtoStruct,
  type AdapterBusinessEvent,
  type BusinessEventSourceCapability,
} from "../../../packages/adapter-protocol/src/index.js";
import type { AuthorizationContext } from "../../../packages/domain/src/index.js";
import {
  BusinessEventNotificationManager,
  normalizeTaskBusinessSseNotification,
  projectTaskBusinessFeedback,
  Sep2663ProtocolHandler,
} from "../../../packages/mcp-protocol/src/index.js";
import type { ValidatedManifest } from "../../../packages/operation-registry/src/index.js";
import { BusinessEventRepository } from "../../../packages/persistence-postgres/src/index.js";
import { TaskBusinessFeedbackBodySchema } from "../../../packages/vehicle-provider-core/src/task-business-contract.js";
import { BusinessEventsPostgresHarness } from "../postgres-harness.js";
import {
  BUSINESS_EVENT_RETENTION_MS,
  MAPPING_DEADLINE_MS,
  requireLease,
  sourceFact,
} from "../runtime-fixtures.js";

const harness = new BusinessEventsPostgresHarness();
const providerId = "provider.typed.business";
const businessSourceId = "vehicle.business";
const businessStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0801";
const legacyStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0802";
const externalExecutionId = "typed-business-execution-1";
const taskId = randomUUID();
const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "simulation",
  simulationId: "scene-a",
};
const catalog = JSON.parse(
  readFileSync("protocol/task-business/v1/examples/positive-catalog.json", "utf8"),
) as { feedback: unknown[] };
const bodies = catalog.feedback
  .slice(1, 5)
  .map((value) => TaskBusinessFeedbackBodySchema.parse(value));
const eventKinds = [
  "ARTIFACT_CHANGED",
  "ACTION_CHANGED",
  "REQUIRED_INPUT_CHANGED",
  "INTERVENTION_CHANGED",
];
const capability: BusinessEventSourceCapability = {
  sourceId: businessSourceId,
  sourceStreamId: businessStreamId,
  deliverySemantics: "durable_at_least_once",
  replaySupported: true,
  sourceRetentionMs: "604800000",
  maxEventBytes: "65536",
  maxPayloadDepth: 16,
  maxPayloadNodes: 4096,
  maxPayloadStringBytes: "16384",
};
const events: AdapterBusinessEvent[] = bodies.map((body, index) => ({
  sourceEventId: `typed-${index + 1}`,
  sourceSequence: String(index + 1),
  sourceStreamId: businessStreamId,
  scope: "task",
  occurredAt: { seconds: "1784682123", nanos: index + 1 },
  eventType: "vehicle.business.changed",
  description: `${body.kind} source fact`,
  externalExecutionId,
  severityHint: "info",
  reasonCode: "BUSINESS_OBJECT_CHANGED",
  rawPayload: jsonToProtoStruct(body),
}));

let repository: BusinessEventRepository;
let adapterServer: grpc.Server;
let gateway: GrpcAdapterGateway;

beforeAll(async () => {
  await harness.start();
  repository = new BusinessEventRepository(harness.pool);
  await repository.initializeProvider(
    providerId,
    [
      {
        sourceId: "vehicle.execution",
        sourceStreamId: legacyStreamId,
        deliverySemantics: "durable_at_least_once",
      },
      {
        sourceId: businessSourceId,
        sourceStreamId: businessStreamId,
        deliverySemantics: "durable_at_least_once",
      },
    ],
    BUSINESS_EVENT_RETENTION_MS,
  );
  const snapshotId = randomUUID();
  await harness.pool.query(
    `INSERT INTO operation_snapshot
       (snapshot_id,provider_id,provider_version,operation_name,manifest_hash,definition)
     VALUES ($1,$2,'1.0.0','vehicle_area_recon',$3,'{}'::jsonb)`,
    [snapshotId, providerId, "c".repeat(64)],
  );
  await harness.pool.query(
    `INSERT INTO provider_task
       (task_id,provider_id,operation_name,operation_snapshot_id,authorization_context_hash,
        execution_mode,simulation_id,arguments,argument_hash,external_execution_id,
        internal_state,mcp_status,substate,status_message,timing,accepted_at)
     VALUES ($1,$2,'vehicle_area_recon',$3,$4,'simulation','scene-a',$5::jsonb,$6,$7,
             'RUNNING','working','running','Running.','{}'::jsonb,clock_timestamp())`,
    [
      taskId,
      providerId,
      snapshotId,
      authorization.hash,
      JSON.stringify({ resourceId: "vehicle:ugv1" }),
      "b".repeat(64),
      externalExecutionId,
    ],
  );
  const legacyLease = await requireLease(
    repository,
    providerId,
    "vehicle.execution",
    legacyStreamId,
    "legacy-replica",
  );
  await repository.intakeSourceFact(
    legacyLease,
    sourceFact(legacyStreamId, "1"),
    BUSINESS_EVENT_RETENTION_MS,
    MAPPING_DEADLINE_MS,
  );
  expect(await repository.prepareNextSourceEvent(providerId, "vehicle.execution")).toBe("ready");
  await repository.finalizeNextSourceEvent(
    providerId,
    "vehicle.execution",
    BUSINESS_EVENT_RETENTION_MS,
  );
  adapterServer = createMockAdapterServer({
    providerId,
    businessEventSources: [capability],
    businessEvents: { [businessSourceId]: events },
  });
  const port = await new Promise<number>((resolvePort, reject) => {
    adapterServer.bindAsync(
      "127.0.0.1:0",
      grpc.ServerCredentials.createInsecure(),
      (error, bound) => (error === null ? resolvePort(bound) : reject(error)),
    );
  });
  gateway = new GrpcAdapterGateway({ endpoint: `127.0.0.1:${port}`, providerId });
});

afterAll(async () => {
  gateway?.close();
  adapterServer?.forceShutdown();
  await harness.stop();
});

describe("typed vehicle.business source to public SSE", () => {
  it("persists four typed facts and replays them over actual HTTP SSE with Runtime sequences", async () => {
    const worker = new AdapterBusinessEventSourceClient(repository, gateway, {
      providerId,
      sourceId: businessSourceId,
      sourceStreamId: businessStreamId,
      deliverySemantics: "durable_at_least_once",
      replicaId: "typed-replica",
    });
    expect(await worker.runOnce()).toBe("completed");
    const persisted = await harness.pool.query<{
      stream_id: string;
      sequence: string;
      source_sequence: string;
      source_canonical_hash: string;
      event_type: string;
      task_id: string;
      raw_payload: unknown;
    }>(
      `SELECT stream_id,sequence,source_sequence,source_canonical_hash,event_type,
              task_id::text,raw_payload FROM provider_business_event
       WHERE provider_id=$1 AND source_id=$2 ORDER BY sequence`,
      [providerId, businessSourceId],
    );
    expect(persisted.rows).toHaveLength(4);
    expect(persisted.rows.map((row) => row.sequence)).toEqual(["2", "3", "4", "5"]);
    expect(persisted.rows.map((row) => row.source_sequence)).toEqual(["1", "2", "3", "4"]);
    expect(persisted.rows.every((row) => row.task_id === taskId)).toBe(true);
    expect(persisted.rows.map((row) => (row.raw_payload as { kind: string }).kind)).toEqual(
      eventKinds,
    );
    const inbox = await harness.pool.query<{ source_canonical_hash: string }>(
      `SELECT source_canonical_hash FROM adapter_business_event_inbox
       WHERE provider_id=$1 AND source_id=$2 ORDER BY normalized_source_sequence`,
      [providerId, businessSourceId],
    );
    expect(persisted.rows.map((row) => row.source_canonical_hash)).toEqual(
      inbox.rows.map((row) => row.source_canonical_hash),
    );
    const streamId = persisted.rows[0]?.stream_id;
    if (!streamId) throw new Error("PUBLIC_STREAM_MISSING");
    const authorized = await readHttpSse(streamId, authorization);
    expect(authorized.status).toBe(200);
    expect(authorized.contentType).toContain("text/event-stream");
    const notifications = authorized.messages.filter(
      (message) => message.method === "notifications/io.sdar/businessEvents",
    );
    expect(notifications).toHaveLength(4);
    const eventParams = notifications.map((message) => message.params as Record<string, unknown>);
    expect(eventParams.map((item) => item.sequence)).toEqual(["2", "3", "4", "5"]);
    expect(eventParams.map((item) => (item.rawPayload as { kind: string }).kind)).toEqual(
      eventKinds,
    );
    expect(eventParams.every((item) => item.taskId === taskId)).toBe(true);
    const identity = {
      taskId,
      executionId: externalExecutionId,
      providerId,
      resourceId: "vehicle:ugv1",
      operationName: "vehicle_area_recon",
      simulationId: "scene-a",
    };
    const normalized = notifications.map((notification) =>
      normalizeTaskBusinessSseNotification(notification, identity),
    );
    expect(normalized.map((message) => message.kind)).toEqual(eventKinds);
    expect(normalized.map((message) => message.resumeFrom.afterSequence)).toEqual([
      "2",
      "3",
      "4",
      "5",
    ]);
    expect(normalized.map((message) => message.sourceCursor.sourceSequence)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(() =>
      normalizeTaskBusinessSseNotification(notifications[0], {
        ...identity,
        taskId: randomUUID(),
      }),
    ).toThrow("BUSINESS_EVENT_TASK_BINDING_INVALID");
    const otherScene = await readHttpSse(streamId, { ...authorization, simulationId: "scene-b" });
    expect(
      otherScene.messages.filter(
        (message) => message.method === "notifications/io.sdar/businessEvents",
      ),
    ).toHaveLength(0);
    const finalized = await repository.replayEvents(providerId, streamId, "1", "5", 10);
    const first = finalized[0];
    if (!first) throw new Error("FINALIZED_BUSINESS_EVENT_MISSING");
    const projected = projectTaskBusinessFeedback(first, identity);
    expect(projected).toMatchObject({
      kind: "ARTIFACT_CHANGED",
      messageId: eventParams[0]?.eventId,
      resumeFrom: { streamId, afterSequence: "2" },
      sourceCursor: { sourceId: businessSourceId, sourceSequence: "1" },
    });
  });

  it("quarantines an invalid typed Body with its original envelope hash", async () => {
    const badProvider = "provider.typed.poison";
    const badStream = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0803";
    await repository.initializeProvider(
      badProvider,
      [
        {
          sourceId: businessSourceId,
          sourceStreamId: badStream,
          deliverySemantics: "durable_at_least_once",
        },
      ],
      BUSINESS_EVENT_RETENTION_MS,
    );
    const lease = await requireLease(
      repository,
      badProvider,
      businessSourceId,
      badStream,
      "poison-replica",
    );
    const fact = {
      sourceEventId: "bad-typed-1",
      sourceSequence: "1",
      sourceStreamId: badStream,
      scope: "task" as const,
      externalExecutionId: "bad-execution",
      occurredAt: "2026-07-22T01:02:03.123456789Z",
      eventType: "vehicle.business.changed",
      description: "Invalid typed payload",
      rawPayload: { ...bodies[0], taskId: "forged" },
    };
    const result = await repository.intakeSourceFact(
      lease,
      fact,
      BUSINESS_EVENT_RETENTION_MS,
      MAPPING_DEADLINE_MS,
    );
    expect(result.disposition).toBe("rejected");
    expect(result.rejectReason).toBe("TASK_BUSINESS_PAYLOAD_INVALID");
    const inbox = await harness.pool.query<{
      status: string;
      reject_reason: string;
      raw_envelope_hash: string;
      source_canonical_hash: string;
      raw_envelope_json: unknown;
    }>(
      `SELECT status,reject_reason,raw_envelope_hash,source_canonical_hash,raw_envelope_json
       FROM adapter_business_event_inbox WHERE provider_id=$1 AND source_id=$2`,
      [badProvider, businessSourceId],
    );
    expect(inbox.rows[0]).toMatchObject({
      status: "rejected",
      reject_reason: "TASK_BUSINESS_PAYLOAD_INVALID",
      raw_envelope_hash: canonicalSha256(fact),
      source_canonical_hash: result.sourceCanonicalHash,
      raw_envelope_json: fact,
    });
    expect(await repository.prepareNextSourceEvent(badProvider, businessSourceId)).toBe("terminal");
    const publicEvents = await harness.pool.query(
      "SELECT 1 FROM provider_business_event WHERE provider_id=$1",
      [badProvider],
    );
    expect(publicEvents.rowCount).toBe(0);
  });
});

async function readHttpSse(
  streamId: string,
  currentAuthorization: AuthorizationContext,
): Promise<{ status: number; contentType: string | null; messages: Record<string, unknown>[] }> {
  const manager = new BusinessEventNotificationManager(providerId, repository, {
    pollIntervalMs: 20,
    maxStreamDurationMs: 120,
  });
  const handler = new Sep2663ProtocolHandler(
    { providerId } as ValidatedManifest,
    "1.0.0",
    undefined,
    () => currentAuthorization,
    undefined,
    manager,
  );
  const server: Server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
      await handler.handle(request, response, JSON.parse(Buffer.concat(chunks).toString("utf8")));
    })().catch((error: unknown) => response.destroy(error as Error));
  });
  const port = await new Promise<number>((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("HTTP_BIND_FAILED"));
      else resolvePort(address.port);
    });
  });
  try {
    const method = "io.sdar/businessEvents/listen";
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "typed-business-listen",
        method,
        params: {
          cursor: { streamId, afterSequence: "0" },
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { name: "typed-business-test", version: "1.0.0" },
            "io.modelcontextprotocol/clientCapabilities": {
              extensions: { "io.sdar/businessEvents": { profileVersion: "1.0" } },
            },
          },
        },
      }),
    });
    const body = await response.text();
    const messages = body
      .split("\n\n")
      .map((frame) => frame.split("\n").find((line) => line.startsWith("data: ")))
      .filter((line): line is string => line !== undefined)
      .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
    return { status: response.status, contentType: response.headers.get("content-type"), messages };
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
}
