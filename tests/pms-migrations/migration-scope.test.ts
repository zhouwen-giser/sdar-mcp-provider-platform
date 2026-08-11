import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { resolveMigrationSet } from "../../packages/database-migration-runner/src/index.js";

describe("PMS migration set scope and upgrade behavior", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });

  afterAll(async () => {
    await admin.end();
  });

  it("resolves only PMS migration files", async () => {
    const files = await resolveMigrationSet(process.cwd(), "pms");

    expect(files.every(({ relativePath }) => relativePath.startsWith("migrations/pms/"))).toBe(
      true,
    );
    expect(files.some(({ relativePath }) => relativePath.startsWith("migrations/runtime/"))).toBe(
      false,
    );
    expect(files.some(({ relativePath }) => relativePath.startsWith("migrations/providers/"))).toBe(
      false,
    );
  });

  it("upgrades a populated 009 schema to direct-container support without dropping rows", async () => {
    const upgradeSchema = `pms_upgrade_${randomUUID().replaceAll("-", "")}`;
    const upgradePool = new Pool({
      connectionString,
      options: `-c search_path=${upgradeSchema}`,
    });
    try {
      await admin.query(`CREATE SCHEMA ${upgradeSchema}`);
      const files = await resolveMigrationSet(process.cwd(), "pms");
      const sql = await Promise.all(
        files.map(({ absolutePath }) => readFile(absolutePath, "utf8")),
      );
      for (const migration of sql.slice(0, 8)) {
        await upgradePool.query(migration);
      }

      await upgradePool.query(
        `INSERT INTO provider_type(provider_type_id, display_name, status)
         VALUES ('isr.vehicle.ugv', 'UGV', 'active')`,
      );
      await upgradePool.query(
        `INSERT INTO provider(provider_id, provider_type_id, hosting_mode, status)
         VALUES ('provider:scope', 'isr.vehicle.ugv', 'vendor_managed', 'active')`,
      );
      await upgradePool.query(
        `INSERT INTO runtime_deployment(
           deployment_id, provider_id, environment, desired_state, desired_replicas,
           runtime_version, database_profile_id, config_profile_id, status
         ) VALUES (
           'deployment-upgrade', 'provider:scope', 'production', 'running', 1,
           '2.0.0-rc.1', 'db-profile-1', 'config-profile-1', 'REQUESTED'
         )`,
      );
      await upgradePool.query(
        `INSERT INTO runtime_process(
           runtime_instance_id, deployment_id, environment, pm2_name, pid, port,
           process_state, liveness_state, readiness_state, registration_state,
           catalog_state, config_state, runtime_version, config_revision
         ) VALUES (
           'legacy-instance', 'deployment-upgrade', 'production',
           'sdar-runtime-production-upgrade-01', 11, 30001,
           'online', 'live', 'ready', 'registered', 'valid', 'current',
           '2.0.0-rc.1', 0
         )`,
      );
      const migration009 = sql[8];
      if (migration009 === undefined) {
        throw new Error("MIGRATION_009_NOT_FOUND");
      }
      await upgradePool.query(migration009);
      const migration010 = sql[9];
      if (migration010 === undefined) {
        throw new Error("MIGRATION_010_NOT_FOUND");
      }
      await upgradePool.query(migration010);

      const processRows = await upgradePool.query<{ runtime_instance_id: string }>(
        `SELECT runtime_instance_id FROM runtime_process WHERE runtime_instance_id='legacy-instance'`,
      );
      expect(processRows.rows).toEqual([{ runtime_instance_id: "legacy-instance" }]);

      const upgradedDeployment = await upgradePool.query<{
        runtime_authority: string;
        database_profile_id: string | null;
        config_profile_id: string | null;
      }>(
        `SELECT runtime_authority,database_profile_id,config_profile_id
           FROM runtime_deployment WHERE deployment_id='deployment-upgrade'`,
      );
      expect(upgradedDeployment.rows).toEqual([
        {
          runtime_authority: "platform_managed",
          database_profile_id: "db-profile-1",
          config_profile_id: "config-profile-1",
        },
      ]);
      const upgradedProcess = await upgradePool.query<{
        process_manager: string;
        pm2_name: string | null;
        port: number | null;
      }>(
        `SELECT process_manager,pm2_name,port
           FROM runtime_process WHERE runtime_instance_id='legacy-instance'`,
      );
      expect(upgradedProcess.rows).toEqual([
        {
          process_manager: "pm2",
          pm2_name: "sdar-runtime-production-upgrade-01",
          port: 30001,
        },
      ]);

      const providerRows = await upgradePool.query<{ provider_id: string }>(
        `SELECT provider_id FROM provider WHERE provider_id='provider:scope'`,
      );
      expect(providerRows.rows).toEqual([{ provider_id: "provider:scope" }]);

      const registrationRows = await upgradePool.query<{ runtime_instance_id: string }>(
        `SELECT runtime_instance_id FROM runtime_registration`,
      );
      expect(registrationRows.rows).toEqual([]);

      const hasRegistrationTable = await upgradePool.query<{ has_table: boolean }>(
        `SELECT to_regclass('runtime_registration') IS NOT NULL AS has_table`,
      );
      expect(hasRegistrationTable.rows[0]?.has_table).toBe(true);
    } finally {
      await upgradePool.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${upgradeSchema} CASCADE`);
    }
  });
});

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("TEST_DATABASE_URL is required");
  return value;
}
