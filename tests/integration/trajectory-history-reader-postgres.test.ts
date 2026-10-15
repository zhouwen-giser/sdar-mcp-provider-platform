import { generateKeyPairSync, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  VehicleMqttIngress,
  ugvMqttProfile,
} from "../../packages/vehicle-mqtt-ingress/src/index.js";
import { captureTrajectoryReceipt } from "../../packages/trajectory-history/src/capture.js";
import { PostgresReceptionStore } from "../../packages/trajectory-history/src/postgres-store.js";
import { TrajectoryHistoryReader } from "../../packages/trajectory-history/src/reader.js";
import {
  RetainedHistoryVerifier,
  verifyHistoryManifest,
} from "../../packages/trajectory-history/src/proof.js";

const file = process.env.SMPP_TRAJECTORY_TEST_CONFIG_FILE;
const schema = "trajectory_reader_" + randomUUID().replaceAll("-", "");
const keys = generateKeyPairSync("ed25519");
let admin: Pool,
  pool: Pool,
  store: PostgresReceptionStore,
  session: string,
  reader: TrajectoryHistoryReader;
const ingress = new VehicleMqttIngress(
  "ros_bridge_json",
  { maxPayloadBytes: 65536, maxDepth: 16, maxNodes: 4096, maxStringBytes: 16384 },
  ugvMqttProfile({
    providerId: "isr.vehicle.ugv.fixture",
    resourceId: "vehicle:fixture",
    entityId: "ugv1",
    vehicleType: "ugv",
    executionMode: "simulation",
  }),
);
async function append() {
  return store.append(
    captureTrajectoryReceipt(
      ingress,
      "/ugv/gnss",
      Buffer.from(JSON.stringify({ entity_id: "ugv1", longitude: 113, latitude: 23 })),
      {
        receptionId: randomUUID(),
        sessionId: session,
        receivedUtc: "2026-10-12T01:00:00.001Z",
        monotonicNanoseconds: "12345",
        clockId: "SIMULATED-reader-clock",
        qos: 1,
        packetId: 1,
        duplicateDeliveryHint: false,
        retainedDelivery: false,
      },
      "SIMULATED",
    ),
  );
}
const query = { resourceId: "vehicle:fixture", historyVersion: "1.0" as const, limit: 2 };

describe.skipIf(!file)("SIMULATED stable trajectory paging / real isolated PostgreSQL", () => {
  beforeAll(async () => {
    if (!file) throw Error("ISOLATED_HISTORY_CONFIG_REQUIRED");
    const config = JSON.parse(readFileSync(file, "utf8")) as { databaseUrl: string };
    admin = new Pool({ connectionString: config.databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 8,
      options: "-c search_path=" + schema + ",public",
    });
    await pool.query(
      readFileSync("migrations/providers/ugv/033_trajectory_reception_history.sql", "utf8"),
    );
    store = new PostgresReceptionStore(pool, {
      providerId: "isr.vehicle.ugv.fixture",
      resourceId: "vehicle:fixture",
      deviceId: "ugv:fixture",
      deviceIdentityAuthority: "GOWM_DEVICE_BINDING",
      sourceSessionKey: "SIMULATED-reader-source",
    });
    await store.initialize();
    session = await store.beginSession();
    reader = new TrajectoryHistoryReader(store, keys.privateKey, "SIMULATED");
    for (let i = 0; i < 5; i++) await append();
  });
  afterAll(async () => {
    await store?.releaseWriterLease();
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });

  it("seals one watermark and returns all original entries while new receipts are appended", async () => {
    const first = await reader.read(query, "caller-a");
    expect(first.entries).toHaveLength(2);
    expect(first.rangeReadFinished).toBe(false);
    const manifest = verifyHistoryManifest(first.snapshot, keys.publicKey, store.scope);
    expect(manifest.highWatermark).toBe("5");
    expect(manifest.retainedEntryCount).toBe("5");
    const verifier = new RetainedHistoryVerifier(first.snapshot, keys.publicKey, store.scope);
    first.entries.forEach((e) => verifier.accept(e));
    await append();
    let page = first;
    while (page.nextCursor) {
      page = await reader.read({ ...query, pageCursor: page.nextCursor }, "caller-a");
      expect(page.snapshot).toEqual(first.snapshot);
      page.entries.forEach((e) => verifier.accept(e));
    }
    expect(verifier.finish(page.rangeReadFinished)).toEqual({
      retainedSetVerified: true,
      deviceHistoryComplete: false,
    });
  });
  it("rejects cursor tampering, another caller and a changed range or page budget", async () => {
    const page = await reader.read(query, "caller-a");
    const cursor = page.nextCursor;
    if (!cursor) throw Error("EXPECTED_HISTORY_CURSOR_MISSING");
    await expect(
      reader.read(
        { ...query, pageCursor: cursor.slice(0, -1) + (cursor.endsWith("a") ? "b" : "a") },
        "caller-a",
      ),
    ).rejects.toThrow();
    await expect(reader.read({ ...query, pageCursor: cursor }, "caller-b")).rejects.toThrow(
      "HISTORY_CURSOR_SCOPE_OR_AUTHORIZATION_MISMATCH",
    );
    await expect(
      reader.read({ ...query, pageCursor: cursor, limit: 3 }, "caller-a"),
    ).rejects.toThrow("HISTORY_CURSOR_QUERY_CHANGED");
    await expect(
      reader.read({ ...query, pageCursor: cursor, throughSequence: "1" }, "caller-a"),
    ).rejects.toThrow("HISTORY_CURSOR_QUERY_CHANGED");
  });
  it("resumes the persisted snapshot after reader recreation with the same pinned key", async () => {
    const first = await reader.read(query, "caller-a");
    if (!first.nextCursor) throw Error("EXPECTED_HISTORY_CURSOR_MISSING");
    const recovered = new TrajectoryHistoryReader(store, keys.privateKey, "SIMULATED");
    const next = await recovered.read({ ...query, pageCursor: first.nextCursor }, "caller-a");
    expect(next.snapshot).toEqual(first.snapshot);
    expect(next.entries[0]?.sequence).toBe("3");
    const foreign = new TrajectoryHistoryReader(
      store,
      generateKeyPairSync("ed25519").privateKey,
      "SIMULATED",
    );
    await expect(
      foreign.read({ ...query, pageCursor: first.nextCursor }, "caller-a"),
    ).rejects.toThrow("HISTORY_CURSOR_SIGNATURE_INVALID");
  });
  it("rejects another resource and a boundary beyond the committed watermark", async () => {
    await expect(
      reader.read({ ...query, resourceId: "vehicle:other" }, "caller-a"),
    ).rejects.toThrow("HISTORY_RESOURCE_SCOPE_MISMATCH");
    await expect(reader.read({ ...query, throughSequence: "999" }, "caller-a")).rejects.toThrow(
      "HISTORY_RANGE_BOUNDARIES_INVALID",
    );
  });
  it("signs an explicit incomplete range when stored records are missing", async () => {
    // Owner-only fault injection. The application path cannot disable immutable triggers.
    await pool.query(
      "ALTER TABLE ugv_trajectory_history_reception DISABLE TRIGGER ugv_trajectory_reception_immutable",
    );
    try {
      await pool.query(
        "DELETE FROM ugv_trajectory_history_reception WHERE stream_id=$1 AND sequence=4",
        [store.scope.streamId],
      );
    } finally {
      await pool.query(
        "ALTER TABLE ugv_trajectory_history_reception ENABLE TRIGGER ugv_trajectory_reception_immutable",
      );
    }
    const page = await reader.read(query, "caller-a");
    const manifest = verifyHistoryManifest(page.snapshot, keys.publicKey, store.scope);
    expect(manifest.retainedHistory.status).toBe("incomplete");
    expect(manifest.retainedHistory.reasons).toContain("RETAINED_RECEIPT_SEQUENCE_GAP");
    expect(manifest.deviceGenerationHistory.status).toBe("unknown");
    expect(() => new RetainedHistoryVerifier(page.snapshot, keys.publicKey, store.scope)).toThrow(
      "HISTORY_RETAINED_SET_NOT_COMPLETE",
    );
  });
  it("pages long ranges in numeric order and remains within the frozen output complexity and byte budgets", async () => {
    const from = (BigInt((await store.state()).highWatermark) + 1n).toString();
    for (let index = 0; index < 300; index++) await append();
    let page = await reader.read(
      { ...query, fromSequence: from, limit: 256, maxPageBytes: 1048576 },
      "caller-a",
    );
    expect(page.nextCursor).not.toBeNull();
    const verifier = new RetainedHistoryVerifier(page.snapshot, keys.publicKey, store.scope);
    const nodes = (value: unknown): number =>
      value !== null && typeof value === "object"
        ? 1 + Object.values(value).reduce<number>((count, child) => count + nodes(child), 0)
        : 1;
    let count = 0;
    for (;;) {
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(1048576);
      expect(nodes(page)).toBeLessThan(10000);
      for (const entry of page.entries) {
        verifier.accept(entry);
        count++;
      }
      if (!page.nextCursor) break;
      page = await reader.read(
        { ...query, pageCursor: page.nextCursor, limit: 256, maxPageBytes: 1048576 },
        "caller-a",
      );
    }
    expect(count).toBe(300);
    expect(verifier.finish(page.rangeReadFinished).retainedSetVerified).toBe(true);
  });
});
