import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  formatRuntimeConfigProfileLocator,
  runtimeDeploymentProfileLocator,
} from "../../pms-application/src/index.js";
import { environmentId } from "@sdar/pms-domain";
import { runtimeProviderId } from "@sdar/runtime-deployment";
import { PostgresRuntimeDeploymentPrerequisites, runPmsMigrations } from "../src/index.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const providerA = runtimeProviderId("provider:prereq-a");
const environment = environmentId("production");
const now = new Date("2026-07-28T00:00:00.000Z");

describe("PostgresRuntimeDeploymentPrerequisites", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const schema = `runtime_prereq_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool;
  let prerequisites: PostgresRuntimeDeploymentPrerequisites;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    await runPmsMigrations(pool, workspaceRoot);
    await seedProvider(pool, providerA, "active");
    prerequisites = new PostgresRuntimeDeploymentPrerequisites(pool);
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  describe("providerAvailable", () => {
    it("returns true for an active provider", async () => {
      await expect(prerequisites.providerAvailable(providerA)).resolves.toBe(true);
    });

    it("returns false for a non-existent provider", async () => {
      await expect(prerequisites.providerAvailable("provider:nonexistent")).resolves.toBe(false);
    });

    it("returns false for a retired provider", async () => {
      const retiredId = "provider:retired";
      await seedProvider(pool, retiredId, "retired");
      await expect(prerequisites.providerAvailable(retiredId)).resolves.toBe(false);
    });

    it("returns false for a disabled provider", async () => {
      const disabledId = "provider:disabled";
      await seedProvider(pool, disabledId, "disabled");
      await expect(prerequisites.providerAvailable(disabledId)).resolves.toBe(false);
    });

    it("returns false for a draft provider", async () => {
      const draftId = "provider:draft";
      await seedProvider(pool, draftId, "draft");
      await expect(prerequisites.providerAvailable(draftId)).resolves.toBe(false);
    });
  });

  describe("databaseProfileAvailable", () => {
    it("returns true for a ready database profile with valid secret refs", async () => {
      const profileId = "db-ready-1";
      await seedDatabaseProfile(
        pool,
        profileId,
        providerA,
        "ready",
        "secret:admin-1",
        "secret:runtime-1",
      );
      await expect(
        prerequisites.databaseProfileAvailable(databaseProfileScope(profileId)),
      ).resolves.toBe(true);
    });

    it("returns false for a non-existent database profile", async () => {
      await expect(
        prerequisites.databaseProfileAvailable(databaseProfileScope("db-nonexistent")),
      ).resolves.toBe(false);
    });

    it("returns false for a profile outside its Provider or Environment scope", async () => {
      const profileId = "db-scope-1";
      await seedDatabaseProfile(
        pool,
        profileId,
        providerA,
        "ready",
        "secret:admin-scope",
        "secret:runtime-scope",
      );

      await expect(
        prerequisites.databaseProfileAvailable({
          ...databaseProfileScope(profileId),
          providerId: "provider:other",
        }),
      ).resolves.toBe(false);
      await expect(
        prerequisites.databaseProfileAvailable({
          ...databaseProfileScope(profileId),
          environment: "staging",
        }),
      ).resolves.toBe(false);
    });

    it("returns false for an invalid SecretRef persisted by a legacy database", async () => {
      await pool.query(
        "ALTER TABLE database_profile DROP CONSTRAINT IF EXISTS database_profile_admin_secret_ref_check",
      );
      const profileId = "db-invalid-secret-1";
      await seedDatabaseProfile(
        pool,
        profileId,
        providerA,
        "ready",
        "invalid secret ref",
        "secret:runtime-invalid",
      );
      await expect(
        prerequisites.databaseProfileAvailable(databaseProfileScope(profileId)),
      ).resolves.toBe(false);
    });

    it("returns false for a pending database profile", async () => {
      const profileId = "db-pending-1";
      await seedDatabaseProfile(
        pool,
        profileId,
        providerA,
        "pending",
        "secret:admin-2",
        "secret:runtime-2",
      );
      await expect(
        prerequisites.databaseProfileAvailable(databaseProfileScope(profileId)),
      ).resolves.toBe(false);
    });

    it("returns false for a failed database profile", async () => {
      const profileId = "db-failed-1";
      await seedDatabaseProfile(
        pool,
        profileId,
        providerA,
        "failed",
        "secret:admin-3",
        "secret:runtime-3",
        "PROVISION_ERROR",
      );
      await expect(
        prerequisites.databaseProfileAvailable(databaseProfileScope(profileId)),
      ).resolves.toBe(false);
    });

    it("returns false for a provisioning database profile", async () => {
      const profileId = "db-provisioning-1";
      await seedDatabaseProfile(
        pool,
        profileId,
        providerA,
        "provisioning",
        "secret:admin-4",
        "secret:runtime-4",
      );
      await expect(
        prerequisites.databaseProfileAvailable(databaseProfileScope(profileId)),
      ).resolves.toBe(false);
    });
  });

  describe("configProfileAvailable", () => {
    it("returns true when a published revision exists for the locator target", async () => {
      const target = runtimeDeploymentProfileLocator({
        environment,
        targetId: "deployment-cfg-ok",
        configGroup: "runtime",
        dataId: "process",
      });
      const configProfileId = formatRuntimeConfigProfileLocator(target);
      await seedPublishedConfig(pool, target);
      await expect(prerequisites.configProfileAvailable(configProfileId)).resolves.toBe(true);
    });

    it("returns false when the configProfileId is not a valid locator", async () => {
      await expect(prerequisites.configProfileAvailable("not-a-locator")).resolves.toBe(false);
      await expect(prerequisites.configProfileAvailable("rtcfg.v1.invalid")).resolves.toBe(false);
    });

    it("returns false when no config definition exists for the target", async () => {
      const target = runtimeDeploymentProfileLocator({
        environment,
        targetId: "deployment-no-def",
        configGroup: "runtime",
        dataId: "process",
      });
      const configProfileId = formatRuntimeConfigProfileLocator(target);
      await expect(prerequisites.configProfileAvailable(configProfileId)).resolves.toBe(false);
    });

    it("returns false when the config definition exists but has no published revision", async () => {
      const target = runtimeDeploymentProfileLocator({
        environment,
        targetId: "deployment-no-pub",
        configGroup: "runtime",
        dataId: "process",
      });
      const configProfileId = formatRuntimeConfigProfileLocator(target);
      await seedDraftConfig(pool, target);
      await expect(prerequisites.configProfileAvailable(configProfileId)).resolves.toBe(false);
    });

    it("does not match across different environments", async () => {
      const staging = environmentId("staging");
      const targetStaging = runtimeDeploymentProfileLocator({
        environment: staging,
        targetId: "deployment-env-x",
        configGroup: "runtime",
        dataId: "process",
      });
      const targetProduction = runtimeDeploymentProfileLocator({
        environment,
        targetId: "deployment-env-x",
        configGroup: "runtime",
        dataId: "process",
      });
      await seedPublishedConfig(pool, targetProduction);
      const stagingId = formatRuntimeConfigProfileLocator(targetStaging);
      await expect(prerequisites.configProfileAvailable(stagingId)).resolves.toBe(false);
      const productionId = formatRuntimeConfigProfileLocator(targetProduction);
      await expect(prerequisites.configProfileAvailable(productionId)).resolves.toBe(true);
    });

    it("does not match across different config groups", async () => {
      const target = runtimeDeploymentProfileLocator({
        environment,
        targetId: "deployment-group-x",
        configGroup: "runtime",
        dataId: "process",
      });
      const differentGroup = runtimeDeploymentProfileLocator({
        environment,
        targetId: "deployment-group-x",
        configGroup: "network",
        dataId: "process",
      });
      await seedPublishedConfig(pool, target);
      const wrongId = formatRuntimeConfigProfileLocator(differentGroup);
      await expect(prerequisites.configProfileAvailable(wrongId)).resolves.toBe(false);
    });

    it("does not match across different data ids", async () => {
      const target = runtimeDeploymentProfileLocator({
        environment,
        targetId: "deployment-data-x",
        configGroup: "runtime",
        dataId: "process",
      });
      const differentData = runtimeDeploymentProfileLocator({
        environment,
        targetId: "deployment-data-x",
        configGroup: "runtime",
        dataId: "secrets",
      });
      await seedPublishedConfig(pool, target);
      const wrongId = formatRuntimeConfigProfileLocator(differentData);
      await expect(prerequisites.configProfileAvailable(wrongId)).resolves.toBe(false);
    });
  });
});

async function seedProvider(pool: Pool, providerId: string, status: string): Promise<void> {
  await pool.query(
    `INSERT INTO provider_type(provider_type_id,display_name,status)
     VALUES ('isr.vehicle.ugv','UGV','active')
     ON CONFLICT (provider_type_id) DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO provider(provider_id,provider_type_id,hosting_mode,status)
     VALUES ($1,'isr.vehicle.ugv','vendor_managed',$2)
     ON CONFLICT (provider_id) DO UPDATE SET status=$2`,
    [providerId, status],
  );
}

async function seedDatabaseProfile(
  pool: Pool,
  profileId: string,
  providerId: string,
  provisionStatus: string,
  adminSecretRef: string,
  runtimeSecretRef: string,
  lastErrorCode?: string,
): Promise<void> {
  const auditId = randomUUID();
  const slug = profileId
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase()
    .slice(0, 48);
  const profileEnvironment = databaseProfileScope(profileId).environment;
  await pool.query(
    `INSERT INTO audit(audit_event_id,action,actor_id,correlation_id,subject_type,subject_id,occurred_at,metadata)
     VALUES ($1,'database_profile.created','admin-1','seed','database_profile',$2,$3,'{}')`,
    [auditId, profileId, now],
  );
  await pool.query(
    `INSERT INTO database_profile(
       profile_id,provider_id,environment,cluster_ref,host,port,database_mode,
       database_name,runtime_role_name,ssl_mode,admin_secret_ref,runtime_secret_ref,
       provision_status,last_error_code,provisioned_at,
       created_audit_event_id,last_audit_event_id
     ) VALUES ($1,$2,$11,'cluster-1','localhost',5432,'preexisting',
       $9,$10,'disable',$3,$4,
       $5,$6,$7,$8,$8)`,
    [
      profileId,
      providerId,
      adminSecretRef,
      runtimeSecretRef,
      provisionStatus,
      lastErrorCode ?? null,
      provisionStatus === "ready" ? now : null,
      auditId,
      `sdar_rt_${slug}`,
      `sdar_rt_${slug}_app`,
      profileEnvironment,
    ],
  );
}

function databaseProfileScope(profileId: string) {
  const suffix = profileId
    .replace(/[^a-z0-9]/gi, "-")
    .toLowerCase()
    .slice(0, 58);
  return {
    databaseProfileId: profileId,
    providerId: providerA,
    environment: environmentId(`db-${suffix}`),
  };
}

async function seedPublishedConfig(
  pool: Pool,
  target: {
    environment: string;
    targetType: string;
    targetId: string;
    configGroup: string;
    dataId: string;
  },
): Promise<void> {
  const defId = randomUUID();
  await pool.query(
    `INSERT INTO config_definition(
       definition_id,environment,target_type,target_id,config_group,data_id,
       schema_document,default_content,secret_paths,field_metadata,status
     ) VALUES ($1,$2,$3,$4,$5,$6,'{}','{}','[]','{}','active')`,
    [
      defId,
      target.environment,
      target.targetType,
      target.targetId,
      target.configGroup,
      target.dataId,
    ],
  );
  const revId = randomUUID();
  const checksum = "0".repeat(64);
  await pool.query(
    `INSERT INTO config_revision(
       revision_id,definition_id,revision,checksum,apply_mode,status,
       content,created_by,created_at,published_at
     ) VALUES ($1,$2,1,$3,'hot_reload','published','{}','admin-1',$4,$4)`,
    [revId, defId, checksum, now],
  );
}

async function seedDraftConfig(
  pool: Pool,
  target: {
    environment: string;
    targetType: string;
    targetId: string;
    configGroup: string;
    dataId: string;
  },
): Promise<void> {
  const defId = randomUUID();
  await pool.query(
    `INSERT INTO config_definition(
       definition_id,environment,target_type,target_id,config_group,data_id,
       schema_document,default_content,secret_paths,field_metadata,status
     ) VALUES ($1,$2,$3,$4,$5,$6,'{}','{}','[]','{}','active')`,
    [
      defId,
      target.environment,
      target.targetType,
      target.targetId,
      target.configGroup,
      target.dataId,
    ],
  );
  const revId = randomUUID();
  const checksum = "0".repeat(64);
  await pool.query(
    `INSERT INTO config_revision(
       revision_id,definition_id,revision,checksum,apply_mode,status,
       content,created_by,created_at
     ) VALUES ($1,$2,1,$3,'hot_reload','draft','{}','admin-1',$4)`,
    [revId, defId, checksum, now],
  );
}

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("TEST_DATABASE_URL is required");
  return value;
}
