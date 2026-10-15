import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createGowmPool,
  verifyGowmStorage,
  verifyGowmTaskBusinessStorage,
  type GowmStorageConfig,
} from "../../packages/gowm-shared-storage-adapter/src/index.js";
import { PostgresReceptionStore } from "../../packages/trajectory-history/src/postgres-store.js";
import { VehicleMqttIngress } from "../../packages/vehicle-mqtt-ingress/src/index.js";
import { captureTrajectoryReceipt } from "../../packages/trajectory-history/src/capture.js";
const file = process.env.SMPP_GOWM_SHARED_OPEN_TEST_CONFIG_FILE;
const enabled = process.env.SMPP_TRAJECTORY_FULL_GOWM_ENABLE === "true";
let pool: Pool, other: Pool, store: PostgresReceptionStore, session: string;
describe.skipIf(!enabled)(
  "SIMULATED history extension on full pinned GOWM owner / non-bypass app role",
  () => {
    beforeAll(async () => {
      if (!file) throw Error("ISOLATED_FULL_GOWM_FIXTURE_REQUIRED");
      const fixture = JSON.parse(readFileSync(file, "utf8")) as {
        databaseUrl: string;
        contractDir: string;
        serviceKey: string;
        sourceSessionKey: string;
        providerId: string;
        deviceIds: [string, string];
        bindingIds: [string, string];
        resourceIds: [string, string];
      };
      if (!new URL(fixture.databaseUrl).pathname.includes("test"))
        throw Error("ISOLATED_FULL_GOWM_DATABASE_REQUIRED");
      const config: GowmStorageConfig = {
        mode: "gowm-shared",
        databaseUrl: fixture.databaseUrl,
        contractDir: fixture.contractDir,
        serviceKey: fixture.serviceKey,
        sourceSessionKey: fixture.sourceSessionKey,
        allowedDeviceIds: [fixture.deviceIds[0]],
        bindingId: fixture.bindingIds[0],
      };
      pool = createGowmPool(config, 3);
      other = createGowmPool(
        { ...config, allowedDeviceIds: [fixture.deviceIds[1]], bindingId: fixture.bindingIds[1] },
        2,
      );
      await verifyGowmStorage(pool, config);
      await verifyGowmTaskBusinessStorage(pool, config);
      store = new PostgresReceptionStore(pool, {
        providerId: fixture.providerId,
        resourceId: fixture.resourceIds[0],
        deviceId: fixture.deviceIds[0],
        deviceIdentityAuthority: "GOWM_DEVICE_BINDING",
        sourceSessionKey: config.sourceSessionKey,
        smppServiceKey: config.serviceKey,
        bindingId: config.bindingId,
      });
      await store.initialize();
      session = await store.beginSession();
    });
    afterAll(async () => {
      await store?.releaseWriterLease();
      await pool?.end();
      await other?.end();
    });
    it("qualifies the unchanged core/TaskBusiness contract and proves scoped immutable retention", async () => {
      const receiver = new VehicleMqttIngress("direct_domain_json", {
        maxPayloadBytes: 65536,
        maxDepth: 16,
        maxNodes: 4096,
        maxStringBytes: 16384,
      });
      const body = captureTrajectoryReceipt(
        receiver,
        "/ugv/gnss",
        Buffer.from('{"entity_id":"ugv1","longitude":114,"latitude":30}'),
        {
          receptionId: randomUUID(),
          sessionId: session,
          receivedUtc: new Date().toISOString(),
          monotonicNanoseconds: "1234",
          clockId: "SIMULATED-full-GOWM",
          qos: 1,
          packetId: 1,
          duplicateDeliveryHint: false,
          retainedDelivery: false,
        },
        "SIMULATED",
      );
      const saved = await store.append(body);
      expect((await store.read(saved.sequence, saved.sequence, 1))[0]).toEqual(saved);
      expect(
        (
          await other.query<{ n: string }>(
            "SELECT count(*)::text n FROM ugv_trajectory_history_reception WHERE stream_id=$1",
            [store.scope.streamId],
          )
        ).rows[0]?.n,
      ).toBe("0");
      await expect(
        pool.query("UPDATE ugv_trajectory_history_reception SET hash=hash WHERE stream_id=$1", [
          store.scope.streamId,
        ]),
      ).rejects.toThrow("permission denied");
      const role = await pool.query(
        "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      );
      expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    });
  },
);
