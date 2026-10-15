import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGowmPool } from "../../packages/gowm-shared-storage-adapter/src/connection.js";
import { PostgresReceptionStore } from "../../packages/trajectory-history/src/postgres-store.js";
import { captureTrajectoryReceipt } from "../../packages/trajectory-history/src/capture.js";
import { VehicleMqttIngress } from "../../packages/vehicle-mqtt-ingress/src/index.js";
import {
  installGowmTrajectoryHistory,
  trajectoryHistoryMigration,
} from "../../deploy/gowm-trajectory-history/install.mjs";

const file = process.env.SMPP_TRAJECTORY_TEST_CONFIG_FILE;
const database = "history_gowm_test_" + randomUUID().replaceAll("-", "");
const firstBinding = randomUUID(),
  secondBinding = randomUUID();
const password = randomUUID();
let root: Pool,
  owner: Pool,
  first: Pool,
  second: Pool,
  firstStore: PostgresReceptionStore,
  secondStore: PostgresReceptionStore;
let createdDatabase = false,
  createdRole = false,
  session: string;
const ingress = new VehicleMqttIngress("direct_domain_json", {
  maxPayloadBytes: 65536,
  maxDepth: 16,
  maxNodes: 4096,
  maxStringBytes: 16384,
});

describe.skipIf(!file)(
  "SIMULATED optional history owner installation / real isolated PostgreSQL GOWM namespace",
  () => {
    beforeAll(async () => {
      if (!file) throw Error("ISOLATED_HISTORY_CONFIG_REQUIRED");
      const config = JSON.parse(readFileSync(file, "utf8")) as { databaseUrl: string };
      if (!new URL(config.databaseUrl).pathname.includes("test"))
        throw Error("ISOLATED_HISTORY_DATABASE_REQUIRED");
      root = new Pool({ connectionString: config.databaseUrl });
      const exists = await root.query("SELECT 1 FROM pg_roles WHERE rolname='ugv_smpp_app'");
      if (exists.rowCount) throw Error("ISOLATED_HISTORY_OWNER_ROLE_ALREADY_EXISTS");
      await root.query(`CREATE DATABASE ${database}`);
      createdDatabase = true;
      await root.query(
        `CREATE ROLE ugv_smpp_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`,
      );
      createdRole = true;
      const ownerUrl = new URL(config.databaseUrl);
      ownerUrl.pathname = "/" + database;
      owner = new Pool({ connectionString: ownerUrl.toString() });
      await owner.query(`CREATE SCHEMA ugv_smpp; CREATE SCHEMA gowm_device;
      CREATE TABLE gowm_device.device_service_binding(binding_id uuid PRIMARY KEY);
      CREATE TABLE ugv_smpp.gowm_install_history(family text,file text,checksum text NOT NULL,PRIMARY KEY(family,file));
      INSERT INTO ugv_smpp.gowm_install_history VALUES('UGV_PROVIDER','030_task_business_versions.sql','SIMULATED-owner-prerequisite');
      GRANT USAGE ON SCHEMA ugv_smpp,gowm_device TO ugv_smpp_app;
      GRANT SELECT ON ugv_smpp.gowm_install_history TO ugv_smpp_app;`);
      await owner.query("INSERT INTO gowm_device.device_service_binding VALUES($1),($2)", [
        firstBinding,
        secondBinding,
      ]);
      const appUrl = new URL(ownerUrl);
      appUrl.username = "ugv_smpp_app";
      appUrl.password = password;
      const shared = {
        mode: "gowm-shared" as const,
        databaseUrl: appUrl.toString(),
        serviceKey: "history-simulated",
        sourceSessionKey: "history-session",
        contractDir: "contracts/gowm-shared-storage/current",
      };
      first = createGowmPool(
        { ...shared, allowedDeviceIds: ["history-device-a"], bindingId: firstBinding },
        3,
      );
      second = createGowmPool(
        { ...shared, allowedDeviceIds: ["history-device-b"], bindingId: secondBinding },
        3,
      );
      firstStore = new PostgresReceptionStore(first, {
        providerId: "isr.vehicle.ugv.history-hosted",
        resourceId: "vehicle:a",
        deviceId: "history-device-a",
        deviceIdentityAuthority: "GOWM_DEVICE_BINDING",
        sourceSessionKey: shared.sourceSessionKey,
        smppServiceKey: shared.serviceKey,
        bindingId: firstBinding,
      });
      secondStore = new PostgresReceptionStore(second, {
        ...firstStore.identity,
        resourceId: "vehicle:b",
        deviceId: "history-device-b",
        bindingId: secondBinding,
      });
    });
    afterAll(async () => {
      await firstStore?.releaseWriterLease();
      await secondStore?.releaseWriterLease();
      await first?.end();
      await second?.end();
      await owner?.end();
      if (root) {
        if (createdDatabase) await root.query(`DROP DATABASE ${database}`);
        if (createdRole) await root.query("DROP ROLE ugv_smpp_app");
        await root.end();
      }
    });
    async function install(apply: boolean, migration = trajectoryHistoryMigration()) {
      const client = await owner.connect();
      try {
        return await installGowmTrajectoryHistory(client, migration, apply);
      } finally {
        client.release();
      }
    }
    it("preflights without DDL and refuses enabled startup on an old database", async () => {
      expect(await install(false)).toMatchObject({ installed: false });
      await expect(firstStore.initialize()).rejects.toThrow("HISTORY_OWNER_SCHEMA_NOT_INSTALLED");
    });
    it("rolls back DDL and its marker on a late installation failure", async () => {
      const migration = trajectoryHistoryMigration();
      migration.sql += "\nSELECT 1/0;";
      migration.contract.installedSha256 = createHash("sha256").update(migration.sql).digest("hex");
      await expect(install(true, migration)).rejects.toThrow("division by zero");
      expect(
        (
          await owner.query<{ relation: string | null }>(
            "SELECT to_regclass('ugv_smpp.ugv_trajectory_history_reception') relation",
          )
        ).rows[0]?.relation,
      ).toBeNull();
    });
    it("installs forward bytes, qualifies app startup and isolates every history table by device and binding", async () => {
      expect(await install(true)).toMatchObject({ installed: true });
      await firstStore.initialize();
      session = await firstStore.beginSession();
      await secondStore.initialize();
      const receipt = captureTrajectoryReceipt(
        ingress,
        "/ugv/gnss",
        Buffer.from('{"entity_id":"ugv1","longitude":114,"latitude":30}'),
        {
          receptionId: randomUUID(),
          sessionId: session,
          receivedUtc: new Date().toISOString(),
          monotonicNanoseconds: "123",
          clockId: "SIMULATED-hosted",
          qos: 1,
          packetId: 1,
          duplicateDeliveryHint: false,
          retainedDelivery: false,
        },
        "SIMULATED",
      );
      await firstStore.append(receipt);
      expect(await firstStore.count("1", "1")).toBe("1");
      expect(await secondStore.count("1", "1")).toBe("0");
      await expect(
        second.query(
          "INSERT INTO ugv_trajectory_history_session(session_id,stream_id,state) VALUES($1,$2,'OPEN')",
          [randomUUID(), firstStore.scope.streamId],
        ),
      ).rejects.toThrow("row-level security");
      const roleState = await first.query<{ executable: boolean }>(
        "SELECT has_function_privilege(current_user,'ugv_smpp.ugv_trajectory_history_prune(text,bigint)','EXECUTE') executable",
      );
      expect(roleState.rows[0]?.executable).toBe(false);
      await expect(
        first.query(
          "UPDATE ugv_trajectory_history_stream SET scope_payload=jsonb_set(scope_payload,'{deviceId}','\"history-device-b\"')",
        ),
      ).rejects.toThrow("TRAJECTORY_HISTORY_SCOPE_IMMUTABLE");
    });
    it("keeps existing data on retry and repairs broad bootstrap grants", async () => {
      await owner.query(
        "GRANT DELETE,UPDATE ON ugv_smpp.ugv_trajectory_history_reception TO ugv_smpp_app",
      );
      const client = await first.connect();
      try {
        await client.query("BEGIN; SET LOCAL smpp.history_owner_prune='on'");
        await expect(client.query("DELETE FROM ugv_trajectory_history_reception")).rejects.toThrow(
          "TRAJECTORY_HISTORY_IMMUTABLE",
        );
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      expect(await install(true)).toMatchObject({ installed: true });
      expect(await firstStore.count("1", "1")).toBe("1");
      await expect(first.query("DELETE FROM ugv_trajectory_history_reception")).rejects.toThrow(
        "permission denied",
      );
      const drift = trajectoryHistoryMigration();
      drift.sql += "\n-- changed";
      drift.contract.installedSha256 = createHash("sha256").update(drift.sql).digest("hex");
      await expect(install(true, drift)).rejects.toThrow("HISTORY_OWNER_MIGRATION_CHECKSUM_DRIFT");
    });
  },
);
