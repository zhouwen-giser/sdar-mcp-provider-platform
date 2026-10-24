import { describe, expect, it } from "vitest";
import {
  ZmqObservationObserver,
  type ObserverSettings,
} from "../../packages/vehicle-zmq-observer/src/index.js";
import { buildObservationApi } from "../../apps/ugv-zmq-observer/src/api.js";
import {
  clock,
  jsonFrames,
  localization,
  MemoryArchive,
  profile,
  scope,
  settings,
  sourceFrames,
} from "./helpers.js";

const setup = (override: Partial<ObserverSettings> = {}) => {
  const store = new MemoryArchive(),
    s = settings(override),
    observer = new ZmqObservationObserver(profile(), s, scope(), store);
  return { store, observer };
};
describe("bounded observation journal / durable state", () => {
  it("reports missing position and target publications even when transport and periodic status are healthy", async () => {
    const { observer } = setup();
    await observer.start();
    observer.transport("chassis", "connected", clock(1));
    observer.receive("chassis", sourceFrames("chassis", "systemState"), clock(2));
    await observer.flush();
    const s = observer.snapshot(3_000_000n);
    expect(s.channels.chassis.receiptFresh).toBe(true);
    expect(s.diagnostics).toEqual(
      expect.arrayContaining(["POSITION_NOT_OBSERVED", "TARGET_REPORT_NOT_OBSERVED"]),
    );
    expect(s.observations.every((o) => o.observation.position === null)).toBe(true);
    await observer.stop();
  });
  it("publishes only confirmed commits with a transport-neutral V2 schema", async () => {
    const { store, observer } = setup();
    await observer.start();
    observer.transport("chassis", "connected", clock(1));
    observer.receive("chassis", localization(), clock(2));
    expect(observer.snapshot(3_000_000n).observations).toHaveLength(0);
    await observer.flush();
    const snapshot = observer.snapshot(3_000_000n);
    expect(snapshot).toMatchObject({
      readOnly: true,
      runtimeAdmission: "not_published",
      completeEvidence: false,
      archive: { committedReceptions: 1, receivedMessages: 1 },
      channels: { chassis: { receiptFresh: true, sourceFreshness: "unverified" } },
    });
    expect(snapshot.observations[0]).toMatchObject({
      receiptFresh: true,
      sourceFreshness: "unverified",
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /mqttConnected|deviceMcpConnected|mqttIngressSequence/,
    );
    expect(observer.snapshot(10_000_000_000n).observations[0]?.receiptFresh).toBe(false);
    await observer.stop();
    expect(store.closed).toBe(true);
  });
  it("invalidates disconnected observations and requires a new advancing source report after reconnect", async () => {
    const { observer } = setup();
    await observer.start();
    observer.transport("eo", "connected", clock(1));
    observer.receive("eo", jsonFrames("eo"), clock(2));
    await observer.flush();
    observer.transport("eo", "disconnected", clock(3));
    observer.transport("eo", "connected", clock(4));
    observer.receive("eo", jsonFrames("eo"), clock(5));
    await observer.flush();
    expect(observer.snapshot(6_000_000n).channels.eo.receiptFresh).toBe(false);
    observer.receive("eo", jsonFrames("eo", "device_status", 1792800000001), clock(7));
    await observer.flush();
    expect(observer.snapshot(8_000_000n).channels.eo.receiptFresh).toBe(true);
    expect(observer.snapshot(8_000_000n).channels.eo.sourceFreshness).toBe("unverified");
    await observer.stop();
  });
  it("receives UTC clock regressions using monotonic receipt freshness", async () => {
    const { observer } = setup();
    await observer.start();
    observer.transport("chassis", "connected", clock(1));
    observer.receive("chassis", sourceFrames("chassis", "systemState"), clock(2));
    await observer.flush();
    observer.receive("chassis", sourceFrames("chassis", "systemState"), clock(3, 1792799000000));
    await observer.flush();
    const snapshot = observer.snapshot(4_000_000n);
    expect(snapshot.channels.chassis.receiptFresh).toBe(true);
    expect(snapshot.observations[0]?.diagnostics).toContain("RECEPTION_UTC_CLOCK_REGRESSED");
    await observer.stop();
  });
  it("bounds queued and in-flight bytes/records and persists an explicit local overflow", async () => {
    const { observer, store } = setup({ maxPendingRecords: 2, maxBatchRecords: 1 });
    await observer.start();
    let release: () => void = () => undefined;
    store.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    observer.receive("chassis", localization(1n), clock(1));
    const pending = observer.flush();
    observer.receive("chassis", localization(2n), clock(2));
    expect(observer.receive("chassis", localization(3n), clock(3))).toBe(false);
    expect(observer.health.status).toBe("failed");
    expect(observer.health.pendingRecords).toBe(2);
    release();
    await pending;
    await observer.stop();
    expect(store.entries).toHaveLength(2);
    expect(store.failures).toEqual([{ code: "ZMQ_OBSERVER_QUEUE_EXHAUSTED", lost: 1 }]);
    expect(observer.health).toMatchObject({
      pendingRecords: 0,
      pendingBytes: 0,
      receivedMessages: 3,
      committedReceptions: 2,
      locallyDiscardedMessages: 1,
      failureRecorded: true,
    });
    expect(observer.snapshot().completeEvidence).toBe(false);
  });
  it("does not retry writes whose commit receipt was lost, and keeps failure persistence uncertainty explicit", async () => {
    const { observer, store } = setup();
    await observer.start();
    store.ackLost = true;
    store.failureWriteFails = true;
    observer.receive("chassis", localization(), clock());
    await observer.flush();
    expect(store.appendCalls).toBe(1);
    expect(store.entries).toHaveLength(1);
    expect(observer.health).toMatchObject({
      status: "failed",
      failureCode: "ZMQ_ARCHIVE_WRITE_UNCONFIRMED",
      failureRecorded: false,
      committedReceptions: 0,
    });
    expect(observer.snapshot().observations).toHaveLength(0);
    await observer.stop();
  });
  it("drains tail records received during an active commit before close", async () => {
    const { observer, store } = setup({ maxBatchRecords: 1 });
    await observer.start();
    let release: () => void = () => undefined;
    store.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    observer.receive("chassis", localization(1n), clock(1));
    const flush = observer.flush();
    observer.receive("chassis", localization(2n), clock(2));
    release();
    await flush;
    await observer.stop();
    expect(store.entries).toHaveLength(2);
    expect(observer.health.pendingRecords).toBe(0);
  });
  it("rejects unsafe archive identifiers and makes capability publication explicitly unavailable", async () => {
    expect(() => settings({ schema: "public;DROP SCHEMA public" })).toThrow();
    const { observer } = setup();
    await observer.start();
    expect(observer.state.capabilities()).toMatchObject({
      source: "zmq_contract",
      readOnly: true,
      controlAvailable: false,
      runtimeAdmission: "not_published",
    });
    expect(observer.state.capabilities().intendedOperations.every((o) => !o.qualified)).toBe(true);
    await observer.stop();
  });
});
describe("read-only observation API", () => {
  it("exposes schema/state diagnostics, rejects mutations and arbitrary upstream injection", async () => {
    const { observer } = setup();
    await observer.start();
    const reader = {
      storage: async () => ({
        partitionHash: scope().partitionHash,
        usedCanonicalPayloadBytes: "0",
        payloadBudgetBytes: "1",
        entryCount: "0",
        schemaPhysicalBytes: "0",
        physicalMeasurementScope: "entire_observer_schema_including_other_partitions",
        retentionPolicy: "append_only_no_automatic_pruning",
        upstreamLossCount: null,
      }),
      sessions: async () => [],
      page: async () => {
        throw Error("ZMQ_ARCHIVE_SESSION_NOT_FOUND");
      },
      raw: async () => {
        throw Error("ZMQ_ARCHIVE_RECEPTION_NOT_FOUND");
      },
    };
    const app = buildObservationApi(observer, reader);
    try {
      expect((await app.inject({ url: "/v2/state" })).json()).toMatchObject({
        readOnly: true,
        runtimeAdmission: "not_published",
      });
      expect((await app.inject({ url: "/v2/schemas" })).json()).toHaveProperty("state");
      expect(
        (await app.inject({ method: "POST", url: "/v2/state", payload: { action: "move" } }))
          .statusCode,
      ).toBe(405);
      expect((await app.inject({ url: "/v2/sessions?upstream=tcp://attacker:1" })).statusCode).toBe(
        400,
      );
      expect((await app.inject({ url: "/v2/receptions?sessionId=bad" })).statusCode).toBe(400);
      expect(
        (await app.inject({ url: "/v2/receptions?sessionId=11111111-1111-4111-8111-111111111111" }))
          .statusCode,
      ).toBe(404);
      observer.fail("ZMQ_ARCHIVE_TEST_FAILURE");
      await observer.flush();
      expect((await app.inject({ url: "/health" })).statusCode).toBe(503);
    } finally {
      await app.close();
      await observer.stop();
    }
  });
});
