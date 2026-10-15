import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { PostgresReceptionStore } from "../../packages/trajectory-history/src/postgres-store.js";
import type { ReceptionReceipt } from "../../packages/trajectory-history/src/contract.js";
import { TrajectoryReceptionJournal } from "../../packages/trajectory-history/src/journal.js";
import { VehicleMqttIngress } from "../../packages/vehicle-mqtt-ingress/src/index.js";

const configurationFile = process.env.SMPP_TRAJECTORY_TEST_CONFIG_FILE;
const enabled = configurationFile !== undefined;
const schema = "trajectory_history_" + randomUUID().replaceAll("-", "");
let admin: Pool, pool: Pool, store: PostgresReceptionStore, session: string;

function receipt(sessionId = session): ReceptionReceipt {
  return {
    schemaVersion: "ugv.trajectory-reception/1.0",
    receptionId: randomUUID(),
    sessionId,
    sourceTopic: "/ugv/gnss",
    originalMessageSha256: "a".repeat(64),
    originalMessageBytes: 64,
    originalMessageReference: "mqtt-wire:sha256:" + "a".repeat(64),
    providerReceivedAt: {
      utc: "2026-10-12T00:00:00.001Z",
      owner: "PROVIDER_MQTT_MESSAGE_CALLBACK",
      clockId: "SIMULATED-postgres-fixture",
      resolution: "MILLISECOND",
      synchronization: "UNVERIFIED",
      accuracyBoundMilliseconds: null,
      processMonotonicNanoseconds: "123456789",
    },
    reportedTime: null,
    deviceAcquisitionTime: null,
    deviceClockAttribution: "NOT_ATTESTED_BY_PRODUCER_CONTRACT",
    sourceReportedSequence: null,
    sourceProducerEpoch: null,
    transport: { qos: 1, packetId: 1, duplicateDeliveryHint: false, retainedDelivery: false },
    disposition: "POSITION_OBSERVATION",
    reasonCode: "POSITION_NORMALIZED",
    position: {
      longitude: 113,
      latitude: 23,
      crs: "OGC:CRS84",
      derivation: "VERSIONED_PROVIDER_NORMALIZER",
    },
    reportedMission: null,
    evidenceClass: "SIMULATED",
    diagnostics: [],
  };
}

describe.skipIf(!enabled)("SIMULATED trajectory receipt history / real isolated PostgreSQL", () => {
  beforeAll(async () => {
    if (!configurationFile) throw Error("ISOLATED_HISTORY_CONFIG_REQUIRED");
    const config = JSON.parse(readFileSync(configurationFile, "utf8")) as { databaseUrl: string };
    admin = new Pool({ connectionString: config.databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 10,
      options: "-c search_path=" + schema + ",public",
    });
    await pool.query(
      readFileSync("migrations/providers/ugv/033_trajectory_reception_history.sql", "utf8"),
    );
    store = new PostgresReceptionStore(pool, {
      providerId: "isr.vehicle.ugv.pg-fixture",
      resourceId: "vehicle:fixture",
      deviceId: "ugv:fixture",
      deviceIdentityAuthority: "GOWM_DEVICE_BINDING",
      sourceSessionKey: "SIMULATED-postgres-fixture",
    });
    await store.initialize();
    session = await store.beginSession();
  });
  afterAll(async () => {
    await store?.releaseWriterLease();
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });

  it("commits receipt, insertion clock and chain head together with microsecond recording precision", async () => {
    const body = receipt();
    const saved = await store.append(body);
    expect(saved.sequence).toBe("1");
    expect(saved.receipt.providerReceivedAt.utc).toBe(body.providerReceivedAt.utc);
    expect(saved.recordedAt).toMatch(/\.\d{6}Z$/);
    expect(saved.exactTransactionCommittedAt).toBeNull();
    expect((await store.state()).headHash).toBe(saved.hash);
    expect(await store.read("1", "1", 1)).toEqual([saved]);
  });

  it("retries one reception idempotently and rejects content replacement", async () => {
    const body = receipt(),
      saved = await store.append(body);
    expect(await store.append(body)).toEqual(saved);
    expect((await store.state()).highWatermark).toBe(saved.sequence);
    await expect(
      store.append({ ...body, originalMessageBytes: body.originalMessageBytes + 1 }),
    ).rejects.toThrow("HISTORY_RECEPTION_ID_CONFLICT");
    expect((await store.state()).highWatermark).toBe(saved.sequence);
  });

  it("serializes concurrent admission without collapsing equal clocks or identical payload digests", async () => {
    const start = BigInt((await store.state()).highWatermark);
    const entries = await Promise.all(Array.from({ length: 12 }, () => store.append(receipt())));
    expect(new Set(entries.map((e) => e.sequence)).size).toBe(12);
    const ordered = entries.sort((a, b) => Number(BigInt(a.sequence) - BigInt(b.sequence)));
    expect(ordered.map((e) => e.sequence)).toEqual(
      Array.from({ length: 12 }, (_, i) => String(start + BigInt(i + 1))),
    );
    for (let i = 1; i < ordered.length; i++)
      expect(ordered[i]?.previousHash).toBe(ordered[i - 1]?.hash);
    expect(new Set(ordered.map((e) => e.receipt.providerReceivedAt.utc)).size).toBe(1);
  });

  it("does not allow two active writers to preempt each other's process session", async () => {
    const competing = new PostgresReceptionStore(pool, store.identity);
    await competing.initialize();
    await expect(competing.beginSession()).rejects.toThrow("HISTORY_WRITER_ALREADY_ACTIVE");
    expect((await store.recovery()).uncleanSessionCount).toBe(0);
    expect((await store.append(receipt())).receipt.sessionId).toBe(session);
  });

  it("rolls back a failed admission without a sequence hole or forged chain head", async () => {
    const state = await store.state();
    await expect(store.append(receipt(randomUUID()))).rejects.toThrow(
      "HISTORY_RECEPTION_SESSION_INVALID",
    );
    expect(await store.state()).toEqual(state);
    const next = await store.append(receipt());
    expect(next.sequence).toBe(String(BigInt(state.highWatermark) + 1n));
  });

  it("keeps old receipt bytes and the stable stream through repeated forward installation", async () => {
    const state = await store.state(),
      entries = await store.read("1", state.highWatermark, 256);
    await pool.query(
      readFileSync("migrations/providers/ugv/033_trajectory_reception_history.sql", "utf8"),
    );
    expect(await store.state()).toEqual(state);
    expect(await store.read("1", state.highWatermark, 256)).toEqual(entries);
  });

  it("rejects updates and deletes of receipt history", async () => {
    await expect(
      pool.query("UPDATE ugv_trajectory_history_reception SET receipt='{}' WHERE stream_id=$1", [
        store.scope.streamId,
      ]),
    ).rejects.toThrow("TRAJECTORY_HISTORY_IMMUTABLE");
    await expect(
      pool.query("DELETE FROM ugv_trajectory_history_reception WHERE stream_id=$1", [
        store.scope.streamId,
      ]),
    ).rejects.toThrow("TRAJECTORY_HISTORY_IMMUTABLE");
  });

  it("retains disconnect/capture failure diagnostics and marks an interrupted writer as unclean on recovery", async () => {
    await store.recordDisconnect(session);
    await store.recordCaptureFailure();
    await store.releaseWriterLease(); // Simulates loss of the old DB lease without a clean session close.
    const restarted = new PostgresReceptionStore(pool, store.identity);
    await restarted.initialize();
    const nextSession = await restarted.beginSession();
    expect(restarted.scope).toEqual(store.scope);
    expect(await restarted.recovery()).toEqual({
      uncleanSessionCount: 1,
      disconnectCount: 1,
      captureFailureCount: 1,
    });
    const saved = await restarted.append(receipt(nextSession));
    expect(saved.sequence).toBe((await restarted.state()).highWatermark);
    await restarted.closeSession(nextSession);
  });
  it("bounds pending capture and retains explicit failure/recovery diagnostics after overload", async () => {
    const isolated = new PostgresReceptionStore(pool, {
      ...store.identity,
      resourceId: "vehicle:queue-bound",
      deviceId: "SIMULATED-queue-bound",
    });
    const receiver = new VehicleMqttIngress("direct_domain_json", {
      maxPayloadBytes: 65536,
      maxDepth: 16,
      maxNodes: 4096,
      maxStringBytes: 16384,
    });
    const journal = new TrajectoryReceptionJournal(isolated, receiver, "SIMULATED", 1);
    await journal.initialize();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const append = isolated.append.bind(isolated);
    const blocked = vi.spyOn(isolated, "append").mockImplementation(async (receipt) => {
      entered();
      await gate;
      return append(receipt);
    });
    const raw = () => ({
      receptionId: randomUUID(),
      receivedAt: new Date().toISOString(),
      monotonicNanoseconds: "123",
      topic: "/ugv/gnss",
      payload: Buffer.from('{"entity_id":"ugv1","longitude":114,"latitude":30}'),
      qos: 1 as const,
      packetId: 1,
      duplicateDeliveryHint: false,
      retainedDelivery: false,
    });
    try {
      const first = journal.record(raw());
      await started;
      await expect(journal.record(raw())).rejects.toThrow("HISTORY_CAPTURE_QUEUE_EXHAUSTED");
      await journal.failed();
      release();
      expect(await first).toBe(true);
      expect((await isolated.state()).highWatermark).toBe("1");
      expect((await isolated.recovery()).captureFailureCount).toBe(1);
      await expect(journal.record(raw())).rejects.toThrow("HISTORY_CAPTURE_UNAVAILABLE");
    } finally {
      release();
      blocked.mockRestore();
      await journal.stopped();
    }
    const recovered = new PostgresReceptionStore(pool, isolated.identity);
    await recovered.initialize();
    const next = await recovered.beginSession();
    expect((await recovered.recovery()).uncleanSessionCount).toBe(1);
    await recovered.closeSession(next);
  });
});
