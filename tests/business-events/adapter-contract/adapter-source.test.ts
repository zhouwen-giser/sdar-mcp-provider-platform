import * as grpc from "@grpc/grpc-js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  businessEventId,
  businessEventReasonFromError,
  canonicalSha256,
  GrpcAdapterGateway,
  normalizeRfc3339Nano,
  validateBusinessEventSourceCapability,
} from "../../../packages/adapter-protocol/src/index.js";
import type {
  AdapterBusinessEvent,
  BusinessEventSourceCapability,
} from "../../../packages/adapter-protocol/src/index.js";
import { createMockAdapterServer } from "../../../examples/mock-adapter-typescript/src/server.js";

const sourceStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0001";
const durable: BusinessEventSourceCapability = {
  sourceId: "adapter.vehicle",
  sourceStreamId,
  deliverySemantics: "durable_at_least_once",
  replaySupported: true,
  sourceRetentionMs: "604800000",
  maxEventBytes: "65536",
  maxPayloadDepth: 16,
  maxPayloadNodes: 4096,
  maxPayloadStringBytes: "16384",
};
const bestEffort: BusinessEventSourceCapability = {
  ...durable,
  sourceId: "adapter.live",
  deliverySemantics: "best_effort_live",
  replaySupported: false,
  sourceRetentionMs: "0",
};
const events: AdapterBusinessEvent[] = [
  {
    sourceEventId: "evt-1",
    sourceSequence: "9007199254740992",
    sourceStreamId,
    scope: "task",
    occurredAt: { seconds: "1784682000", nanos: 0 },
    eventType: "vehicle.started",
    description: "Vehicle started.",
    externalExecutionId: "exec-42",
    severityHint: "info",
    reasonCode: "",
    rawPayload: {},
  },
  {
    sourceEventId: "evt-2",
    sourceSequence: "9007199254740993",
    sourceStreamId,
    scope: "resource",
    occurredAt: { seconds: "1784682001", nanos: 0 },
    eventType: "vehicle.changed",
    description: "Vehicle changed.",
    resourceRef: "vehicle:42",
    severityHint: "warning",
    reasonCode: "STATE_CHANGED",
    rawPayload: { state: "changed" },
  },
];

const cleanup: (() => void)[] = [];
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((close) => close()),
);

describe("Adapter Business Event source contract", () => {
  it("validates durable and best-effort source semantics", () => {
    expect(() => validateBusinessEventSourceCapability(durable)).not.toThrow();
    expect(() => validateBusinessEventSourceCapability(bestEffort)).not.toThrow();
    expect(() =>
      validateBusinessEventSourceCapability({ ...durable, replaySupported: false }),
    ).toThrow("BUSINESS_EVENT_SOURCE_SEMANTICS_INVALID");
  });

  it("durable reconnect sends the exact persisted uint64 cursor", async () => {
    const gateway = await startGateway([durable], { [durable.sourceId]: events });
    const received = await collect(
      gateway.streamBusinessEvents({
        sourceId: durable.sourceId,
        sourceStreamId,
        afterSourceSequence: "9007199254740992",
      }),
    );
    expect(received.map((event) => event.sourceSequence)).toEqual(["9007199254740993"]);
  });

  it("best-effort connects without a cursor and receives live facts", async () => {
    const live = events.map((event) => ({ ...event, sourceStreamId }));
    const gateway = await startGateway([bestEffort], { [bestEffort.sourceId]: live });
    const received = await collect(
      gateway.streamBusinessEvents({ sourceId: bestEffort.sourceId, sourceStreamId }),
    );
    expect(received).toHaveLength(2);
  });

  it("uses stable gRPC metadata for source stream reset", async () => {
    const gateway = await startGateway([durable], {});
    const error = await collectError(
      gateway.streamBusinessEvents({
        sourceId: durable.sourceId,
        sourceStreamId: "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a9999",
      }),
    );
    expect(error.code).toBe(grpc.status.FAILED_PRECONDITION);
    expect(businessEventReasonFromError(error)).toBe("SOURCE_STREAM_RESET");
  });

  it("matches TypeScript, Python, and frozen golden vectors", () => {
    const eventVector = JSON.parse(
      readFileSync(resolve("protocol/business-events-golden/event-id.json"), "utf8"),
    ) as Record<string, string>;
    expect(
      businessEventId(
        eventVector.providerId ?? "",
        eventVector.sourceId ?? "",
        eventVector.sourceStreamId ?? "",
        eventVector.sourceEventId ?? "",
      ),
    ).toBe(eventVector.expectedEventId);

    const sourceVector = JSON.parse(
      readFileSync(resolve("protocol/business-events-golden/source-canonical-hash.json"), "utf8"),
    ) as { input: unknown; expectedHash: string };
    expect(canonicalSha256(sourceVector.input)).toBe(sourceVector.expectedHash);
    expect(normalizeRfc3339Nano("2026-07-22T09:00:00+08:00")).toBe("2026-07-22T01:00:00Z");
    expect(normalizeRfc3339Nano("2026-07-22T01:00:00.123400000Z")).toBe(
      "2026-07-22T01:00:00.1234Z",
    );
    const storedVector = JSON.parse(
      readFileSync(resolve("protocol/business-events-golden/stored-event-hash.json"), "utf8"),
    ) as { input: unknown; expectedHash: string };
    expect(canonicalSha256(storedVector.input)).toBe(storedVector.expectedHash);

    const python = execFileSync(
      "python3",
      [
        "-c",
        "import json,sys;sys.path.insert(0,'examples/mock-adapter-python');from business_events import event_id,canonical_sha256,normalize_rfc3339_nano;v=json.load(open('protocol/business-events-golden/event-id.json'));s=json.load(open('protocol/business-events-golden/source-canonical-hash.json'));print(event_id(v['providerId'],v['sourceId'],v['sourceStreamId'],v['sourceEventId']));print(canonical_sha256(s['input']));print(normalize_rfc3339_nano('2026-07-22T09:00:00+08:00'))",
      ],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n");
    expect(python).toEqual([
      eventVector.expectedEventId,
      sourceVector.expectedHash,
      "2026-07-22T01:00:00Z",
    ]);
  });
});

async function startGateway(
  sources: BusinessEventSourceCapability[],
  businessEvents: Record<string, AdapterBusinessEvent[]>,
): Promise<GrpcAdapterGateway> {
  const server = createMockAdapterServer({
    providerId: "adapter-contract",
    businessEventSources: sources,
    businessEvents,
  });
  const port = await new Promise<number>((resolvePort, reject) => {
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (error, bound) =>
      error === null ? resolvePort(bound) : reject(error),
    );
  });
  const gateway = new GrpcAdapterGateway({
    endpoint: `127.0.0.1:${String(port)}`,
    providerId: "adapter-contract",
  });
  cleanup.push(
    () => gateway.close(),
    () => server.forceShutdown(),
  );
  return gateway;
}

function collect(
  stream: grpc.ClientReadableStream<AdapterBusinessEvent>,
): Promise<AdapterBusinessEvent[]> {
  return new Promise((resolveEvents, reject) => {
    const values: AdapterBusinessEvent[] = [];
    stream.on("data", (event: AdapterBusinessEvent) => values.push(event));
    stream.on("error", reject);
    stream.on("end", () => resolveEvents(values));
  });
}

function collectError(
  stream: grpc.ClientReadableStream<AdapterBusinessEvent>,
): Promise<grpc.ServiceError> {
  return new Promise((resolveError, reject) => {
    stream.on("error", resolveError);
    stream.on("end", () => reject(new Error("Expected stream error")));
  });
}
