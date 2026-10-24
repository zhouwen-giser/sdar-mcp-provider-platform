import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { Publisher } from "zeromq";
import { z } from "zod";
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  PostgresObservationArchive,
  installObservationArchive,
  ObservationNormalizer,
  ZmqObservationObserver,
  ZmqSubscriptionDriver,
  reconstructFrames,
  sha256,
  type Component,
  type ObserverSettings,
} from "../../packages/vehicle-zmq-observer/src/index.js";
import {
  clock,
  localization,
  jsonFrames,
  profile,
  scope,
  settings,
} from "../ugv-zmq-observer/helpers.js";

const configFile = process.env.SMPP_ZMQ_TEST_CONFIG_FILE;
const schema = "zmq_observer_test_" + randomUUID().replaceAll("-", "");
const applicationName = "zmq-test-" + randomUUID();
let pool: Pool;
const stores: PostgresObservationArchive[] = [];
function store(override: Partial<ObserverSettings> = {}, partition = "SIMULATED:" + randomUUID()) {
  const s = settings({ schema, ...override }),
    identity = scope(profile(), partition);
  const archive = new PostgresObservationArchive(pool, identity, s);
  stores.push(archive);
  return { archive, s, identity };
}
describe.skipIf(!configFile)("SIMULATED real PostgreSQL and native ZMQ observation", () => {
  beforeAll(async () => {
    const configuration = z
      .object({ databaseUrl: z.string() })
      .loose()
      .parse(JSON.parse(readFileSync(configFile ?? "", "utf8")) as unknown);
    pool = new Pool({
      connectionString: configuration.databaseUrl,
      max: 8,
      application_name: applicationName,
      connectionTimeoutMillis: 3000,
      query_timeout: 5000,
      statement_timeout: 5000,
    });
    await installObservationArchive(pool, schema);
  });
  afterEach(async () => {
    for (const archive of stores.splice(0)) await archive.close();
  });
  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
    }
  });
  it("requires an explicit owner install and rejects migration drift", async () => {
    const missing = new PostgresObservationArchive(
      pool,
      scope(),
      settings({ schema: "zmq_not_installed_" + randomUUID().slice(0, 8) }),
    );
    await expect(missing.start()).rejects.toThrow("OWNER_INSTALL_REQUIRED");
    await installObservationArchive(pool, schema);
    await pool.query(`UPDATE "${schema}".install_history SET checksum='bad' WHERE version=1`);
    try {
      await expect(store().archive.start()).rejects.toThrow("MIGRATION_DRIFT");
    } finally {
      const source = readFileSync("deploy/ugv-zmq/migrations/001_observation_archive.sql");
      await pool.query(`UPDATE "${schema}".install_history SET checksum=$1 WHERE version=1`, [
        sha256(source),
      ]);
    }
  });
  it("archives exact multipart bytes, verifies pages and enforces immutability/partition scope", async () => {
    const { archive, s } = store(),
      session = await archive.start(),
      n = new ObservationNormalizer(profile(), s);
    const a = n.receive("chassis", localization(1n), clock(1)),
      b = n.receive("eo", jsonFrames("eo"), clock(2));
    await archive.append([a, b]);
    const first = await archive.page(session.sessionId, "0", 1);
    expect(first.entries).toHaveLength(1);
    expect(first.nextCursor).toBe("1");
    const second = await archive.page(session.sessionId, first.nextCursor ?? "0", 1);
    expect(second.nextCursor).toBeNull();
    expect(second.entries[0]?.previousHash).toBe(first.entries[0]?.entryHash);
    expect(reconstructFrames(first.entries[0]?.payload)).toEqual(localization(1n));
    const raw = await archive.raw(session.sessionId, "2");
    expect(raw.frames.map((f) => Buffer.from(f.base64, "base64"))).toEqual(jsonFrames("eo"));
    await expect(
      pool.query(`UPDATE "${schema}".archive_entry SET entry_hash='bad' WHERE session_id=$1`, [
        session.sessionId,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      pool.query(`DELETE FROM "${schema}".archive_entry WHERE session_id=$1`, [session.sessionId]),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(store().archive.page(session.sessionId)).rejects.toThrow("SESSION_NOT_FOUND");
    await expect(archive.page(session.sessionId, "99")).rejects.toThrow("CURSOR_NOT_FOUND");
  });
  it("allows one archive writer per partition and starts an independent receiver session on clean restart", async () => {
    const { archive, s, identity } = store(),
      old = await archive.start();
    const second = new PostgresObservationArchive(pool, identity, s);
    stores.push(second);
    await expect(second.start()).rejects.toThrow("WRITER_ALREADY_ACTIVE");
    await archive.close();
    const fresh = await second.start();
    expect(fresh.sessionId).not.toBe(old.sessionId);
    expect((await second.sessions()).map((r) => r.status)).toEqual(["open", "closed"]);
  });
  it("records an unclean predecessor and does not reuse its receiver or producer identity", async () => {
    const { archive, s, identity } = store(),
      old = await archive.start();
    await archive.append([
      new ObservationNormalizer(profile(), s).receive("chassis", localization(), clock()),
    ]);
    const leases = await pool.query<{ pid: number }>(
      "SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND query LIKE 'SELECT pg_try_advisory_lock%'",
      [applicationName],
    );
    expect(leases.rows).toHaveLength(1);
    await pool.query("SELECT pg_terminate_backend($1)", [leases.rows[0]?.pid]);
    await delay(20);
    const next = new PostgresObservationArchive(pool, identity, s);
    stores.push(next);
    const fresh = await next.start();
    expect(fresh.sessionId).not.toBe(old.sessionId);
    const oldPage = await next.page(old.sessionId);
    expect(oldPage.entries.at(-1)?.payload).toMatchObject({
      type: "gap",
      code: "UNCLEAN_RECEIVER_SESSION_PREDECESSOR",
      sourceLossCount: null,
      locallyDiscardedMessages: null,
    });
    const rows = await next.sessions();
    expect(rows.find((r) => r.sessionId === old.sessionId)?.status).toBe("abandoned");
    expect(identity.identity.sourceProducerEpoch).toBeNull();
  });
  it("enforces the cumulative canonical payload budget and reserves an explicit failure marker", async () => {
    const { archive, s } = store({ maxArchivePayloadBytes: 1024 }),
      session = await archive.start();
    await expect(
      archive.append([
        new ObservationNormalizer(profile(), s).receive("chassis", localization(), clock()),
      ]),
    ).rejects.toThrow("PAYLOAD_BUDGET_EXHAUSTED");
    await archive.fail("ZMQ_ARCHIVE_PAYLOAD_BUDGET_EXHAUSTED", 1);
    const page = await archive.page(session.sessionId);
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]?.payload).toMatchObject({
      type: "gap",
      locallyDiscardedMessages: 1,
      sourceLossCount: null,
    });
    expect((await archive.sessions())[0]).toMatchObject({ status: "failed" });
  });
  it("bounds a blocked database transaction and records a local overflow without blocking reception", async () => {
    const { archive, s, identity } = store({
      maxPendingRecords: 2,
      maxBatchRecords: 1,
      databaseTimeoutMs: 1000,
    });
    const observer = new ZmqObservationObserver(profile(), s, identity, archive);
    await observer.start();
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        `SELECT * FROM "${schema}".archive_partition WHERE partition_hash=$1 FOR UPDATE`,
        [identity.partitionHash],
      );
      observer.receive("chassis", localization(1n), clock(1));
      const flushing = observer.flush();
      observer.receive("chassis", localization(2n), clock(2));
      expect(observer.receive("chassis", localization(3n), clock(3))).toBe(false);
      expect(observer.health.status).toBe("failed");
      await blocker.query("ROLLBACK");
      await flushing;
      expect(observer.health).toMatchObject({
        failureRecorded: true,
        locallyDiscardedMessages: 1,
        committedReceptions: 2,
        pendingRecords: 0,
      });
      const page = await archive.page(observer.sessionId ?? "");
      expect(page.entries.at(-1)?.payload).toMatchObject({
        type: "gap",
        code: "ZMQ_OBSERVER_QUEUE_EXHAUSTED",
        locallyDiscardedMessages: 1,
      });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await observer.stop();
    }
  });
  it("uses bounded SQL wait time and preserves session reconciliation after a failed write", async () => {
    const { archive, s, identity } = store({ databaseTimeoutMs: 100 });
    await archive.start();
    const blocker = await pool.connect();
    const begin = performance.now();
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        `SELECT * FROM "${schema}".archive_partition WHERE partition_hash=$1 FOR UPDATE`,
        [identity.partitionHash],
      );
      await expect(
        archive.append([
          new ObservationNormalizer(profile(), s).receive("chassis", localization(), clock()),
        ]),
      ).rejects.toHaveProperty("code");
      expect(performance.now() - begin).toBeLessThan(1500);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    await archive.fail("ZMQ_ARCHIVE_WRITE_UNCONFIRMED", 0);
    expect((await archive.sessions())[0]?.failureCode).toBe("ZMQ_ARCHIVE_WRITE_UNCONFIRMED");
  });
  it("receives all three loopback components, handles reconnect, and archives scheduled 100Hz input", async () => {
    const publishers = new Map<Component, Publisher>(),
      p = profile();
    const s = settings({ schema }),
      partition = "SIMULATED-native:" + randomUUID();
    for (const component of ["chassis", "eo", "simulationEffect"] as const) {
      const publisher = new Publisher({ linger: 0, sendTimeout: 1000, sendHighWaterMark: 10000 });
      await publisher.bind("tcp://127.0.0.1:*");
      if (!publisher.lastEndpoint) throw Error("TEST_BIND_FAILED");
      p.components[component].publicationEndpoint = publisher.lastEndpoint;
      publishers.set(component, publisher);
    }
    const identity = scope(p, partition),
      archive = new PostgresObservationArchive(pool, identity, s);
    stores.push(archive);
    const observer = new ZmqObservationObserver(p, s, identity, archive),
      driver = new ZmqSubscriptionDriver(observer, s);
    try {
      await observer.start();
      await driver.start();
      await vi.waitFor(
        () =>
          expect(
            Object.values(observer.snapshot().channels).every((c) => c.state === "connected"),
          ).toBe(true),
        { timeout: 3000 },
      );
      await delay(150);
      await publishers.get("chassis")?.send(localization(0n));
      await publishers.get("eo")?.send(jsonFrames("eo", "device_status", Date.now()));
      await publishers
        .get("simulationEffect")
        ?.send(jsonFrames("simulationEffect", "device_status", Date.now()));
      await vi.waitFor(() => expect(observer.health.committedReceptions).toBe(3), {
        timeout: 3000,
      });
      const endpoint = p.components.eo.publicationEndpoint;
      publishers.get("eo")?.close();
      publishers.delete("eo");
      await vi.waitFor(() => expect(observer.snapshot().channels.eo.state).toBe("disconnected"), {
        timeout: 3000,
      });
      const replacement = new Publisher({ linger: 0 });
      await replacement.bind(endpoint);
      publishers.set("eo", replacement);
      await vi.waitFor(() => expect(observer.snapshot().channels.eo.state).toBe("connected"), {
        timeout: 3000,
      });
      await delay(150);
      expect(observer.snapshot().channels.eo.receiptFresh).toBe(false);
      await replacement.send(jsonFrames("eo", "device_status", Date.now()));
      await vi.waitFor(() => expect(observer.snapshot().channels.eo.receiptFresh).toBe(true), {
        timeout: 3000,
      });
      const before = observer.health.receivedMessages,
        sent = 500,
        begin = performance.now();
      for (let i = 1; i <= sent; i++) {
        const wait = begin + i * 10 - performance.now();
        if (wait > 0) await delay(wait);
        await publishers.get("chassis")?.send(localization(BigInt(i)));
      }
      const elapsedMs = performance.now() - begin;
      await vi.waitFor(() => expect(observer.health.committedReceptions).toBe(before + sent), {
        timeout: 3000,
      });
      await driver.stop();
      await observer.stop();
      expect(observer.health).toMatchObject({
        status: "stopped",
        pendingRecords: 0,
        locallyDiscardedMessages: 0,
        unconfirmedReceptions: 0,
        receivedMessages: before + sent,
      });
      let cursor = "0",
        receptions = 0,
        bytes = 0;
      const hashes: string[] = [];
      do {
        const page = await archive.page(observer.sessionId ?? "", cursor, 100);
        for (const entry of page.entries) {
          hashes.push(entry.entryHash);
          if (entry.payload.type === "reception") {
            reconstructFrames(entry.payload);
            receptions++;
            bytes += entry.payload.wireBytes;
          }
        }
        cursor = page.nextCursor ?? "";
      } while (cursor);
      expect(receptions).toBe(observer.health.receivedMessages);
      expect(receptions).toBe(before + sent);
      const record = {
        test: "SIMULATED native loopback + real isolated PostgreSQL",
        scheduledHz: 100,
        sent,
        elapsedMs,
        measuredSendHz: sent / (elapsedMs / 1000),
        receivedTotal: observer.health.receivedMessages,
        committedReceptions: receptions,
        wireBytes: bytes,
        locallyDiscardedMessages: 0,
        upstreamContinuity: "unverified",
        sourceProducerEpoch: null,
        proof: "local_hash_chain_unsigned",
        sessionId: observer.sessionId,
        partitionHash: identity.partitionHash,
        headHash: hashes.at(-1),
        businessCommandsSent: 0,
      };
      if (process.env.SMPP_ZMQ_EVIDENCE_DIR)
        writeFileSync(
          resolve(process.env.SMPP_ZMQ_EVIDENCE_DIR, "native-postgres-capacity.json"),
          JSON.stringify(record, null, 2) + "\n",
        );
      console.log(JSON.stringify(record));
    } finally {
      await driver.stop();
      await observer.stop();
      for (const publisher of publishers.values()) publisher.close();
    }
  }, 25000);
});
