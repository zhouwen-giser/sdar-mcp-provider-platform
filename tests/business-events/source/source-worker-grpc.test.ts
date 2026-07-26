import * as grpc from "@grpc/grpc-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdapterBusinessEventSourceClient } from "../../../apps/runtime/src/business-events/source-client.js";
import { createMockAdapterServer } from "../../../examples/mock-adapter-typescript/src/server.js";
import {
  GrpcAdapterGateway,
  type AdapterBusinessEvent,
  type BusinessEventSourceCapability,
} from "../../../packages/adapter-protocol/src/index.js";
import { BusinessEventRepository } from "../../../packages/persistence-postgres/src/index.js";
import { BusinessEventsPostgresHarness } from "../postgres-harness.js";
import { BUSINESS_EVENT_RETENTION_MS } from "../runtime-fixtures.js";

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
});
