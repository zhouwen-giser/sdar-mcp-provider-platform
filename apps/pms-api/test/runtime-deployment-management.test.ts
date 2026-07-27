import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  formatRuntimeConfigProfileLocator,
  RuntimeDeploymentApplicationService,
  runtimeDeploymentProfileLocator,
  type RuntimeConfigProfileLocator,
} from "../../../packages/pms-application/src/index.js";
import { environmentId } from "../../../packages/pms-domain/src/index.js";
import {
  PostgresRuntimeDeploymentApplicationUnitOfWork,
  PostgresRuntimeDeploymentPrerequisites,
  runPmsMigrations,
} from "../../../packages/pms-persistence-postgres/src/index.js";
import { runtimeProviderId } from "../../../packages/runtime-deployment/src/index.js";
import { RuntimeDeploymentManagementFacade } from "../src/runtime-deployment-management.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const providerA = runtimeProviderId("provider:facade-a");
const providerB = runtimeProviderId("provider:facade-b");
const environment = environmentId("production");
const now = new Date("2026-07-28T00:00:00.000Z");

describe("RuntimeDeploymentManagementFacade", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const schema = `runtime_facade_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool;
  let facade: RuntimeDeploymentManagementFacade;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    await runPmsMigrations(pool, workspaceRoot);
    await seedProvider(pool, providerA, "active");
    await seedProvider(pool, providerB, "active");

    const uow = new PostgresRuntimeDeploymentApplicationUnitOfWork(pool);
    const prerequisites = new PostgresRuntimeDeploymentPrerequisites(pool);
    const service = new RuntimeDeploymentApplicationService(uow, prerequisites, {
      now: () => now,
      newId: () => randomUUID(),
    });
    facade = new RuntimeDeploymentManagementFacade(pool, service);
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("rejects create when provider does not exist", async () => {
    await expect(
      facade.create(
        {
          deploymentId: "facade-no-provider",
          providerId: "provider:nonexistent",
          environment: "production",
          runtimeVersion: "2.0.0-rc.1",
          databaseProfileId: "db-facade-1",
          configProfileId: "cfg-facade-1",
        },
        { actorId: "admin-1", correlationId: "corr-1" },
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_DEPLOYMENT_PROVIDER_UNAVAILABLE" });
  });

  it("rejects create when provider is retired", async () => {
    const retiredId = "provider:facade-retired";
    await seedProvider(pool, retiredId, "retired");
    await expect(
      facade.create(
        {
          deploymentId: "facade-retired-provider",
          providerId: retiredId,
          environment: "production",
          runtimeVersion: "2.0.0-rc.1",
          databaseProfileId: "db-facade-retired",
          configProfileId: "cfg-facade-retired",
        },
        { actorId: "admin-1", correlationId: "corr-retired" },
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_DEPLOYMENT_PROVIDER_UNAVAILABLE" });
  });

  it("rejects create when database profile does not exist", async () => {
    const target = makeConfigTarget("facade-no-db");
    await seedPublishedConfig(pool, target, "v1");
    await expect(
      facade.create(
        {
          deploymentId: "facade-no-db",
          providerId: providerA,
          environment: "production",
          runtimeVersion: "2.0.0-rc.1",
          databaseProfileId: "db-nonexistent",
          configProfileId: formatRuntimeConfigProfileLocator(target),
        },
        { actorId: "admin-1", correlationId: "corr-no-db" },
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_DEPLOYMENT_DATABASE_PROFILE_UNAVAILABLE" });
  });

  it("rejects create when database profile secret ref is invalid (not ready)", async () => {
    const target = makeConfigTarget("facade-db-not-ready");
    await seedPublishedConfig(pool, target, "v1");
    const profileId = "db-facade-not-ready";
    await seedDatabaseProfile(pool, profileId, providerA, "pending");
    await expect(
      facade.create(
        {
          deploymentId: "facade-db-not-ready",
          providerId: providerA,
          environment: "production",
          runtimeVersion: "2.0.0-rc.1",
          databaseProfileId: profileId,
          configProfileId: formatRuntimeConfigProfileLocator(target),
        },
        { actorId: "admin-1", correlationId: "corr-db-pending" },
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_DEPLOYMENT_DATABASE_PROFILE_UNAVAILABLE" });
  });

  it("rejects create when config profile does not exist", async () => {
    const profileId = "db-facade-no-cfg";
    await seedDatabaseProfile(pool, profileId, providerA, "ready");
    await expect(
      facade.create(
        {
          deploymentId: "facade-no-cfg",
          providerId: providerA,
          environment: "production",
          runtimeVersion: "2.0.0-rc.1",
          databaseProfileId: profileId,
          configProfileId: "rtcfg.v1.invalid",
        },
        { actorId: "admin-1", correlationId: "corr-no-cfg" },
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_DEPLOYMENT_CONFIG_PROFILE_UNAVAILABLE" });
  });

  it("rejects create when config profile has no published revision", async () => {
    const target = makeConfigTarget("facade-no-pub");
    await seedDraftConfig(pool, target, "v1");
    const profileId = "db-facade-no-pub";
    await seedDatabaseProfile(pool, profileId, providerA, "ready");
    await expect(
      facade.create(
        {
          deploymentId: "facade-no-pub",
          providerId: providerA,
          environment: "production",
          runtimeVersion: "2.0.0-rc.1",
          databaseProfileId: profileId,
          configProfileId: formatRuntimeConfigProfileLocator(target),
        },
        { actorId: "admin-1", correlationId: "corr-no-pub" },
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_DEPLOYMENT_CONFIG_PROFILE_UNAVAILABLE" });
  });

  it("rejects create when config profile targets a different environment", async () => {
    const prodTarget = makeConfigTarget("facade-env-x");
    await seedPublishedConfig(pool, prodTarget, "v1");
    const profileId = "db-facade-env";
    await seedDatabaseProfile(pool, profileId, providerA, "ready");
    const stagingTarget = runtimeDeploymentProfileLocator({
      environment: environmentId("staging"),
      targetId: "facade-env-x",
      configGroup: "runtime",
      dataId: "process",
    });
    await expect(
      facade.create(
        {
          deploymentId: "facade-env-x",
          providerId: providerA,
          environment: "production",
          runtimeVersion: "2.0.0-rc.1",
          databaseProfileId: profileId,
          configProfileId: formatRuntimeConfigProfileLocator(stagingTarget),
        },
        { actorId: "admin-1", correlationId: "corr-env" },
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_DEPLOYMENT_CONFIG_PROFILE_UNAVAILABLE" });
  });

  it("rejects create when config profile targets a different configGroup/dataId", async () => {
    const target = makeConfigTarget("facade-group-x");
    await seedPublishedConfig(pool, target, "v1");
    const profileId = "db-facade-group";
    await seedDatabaseProfile(pool, profileId, providerA, "ready");
    const wrongGroup = runtimeDeploymentProfileLocator({
      environment,
      targetId: "facade-group-x",
      configGroup: "network",
      dataId: "process",
    });
    await expect(
      facade.create(
        {
          deploymentId: "facade-group-x",
          providerId: providerA,
          environment: "production",
          runtimeVersion: "2.0.0-rc.1",
          databaseProfileId: profileId,
          configProfileId: formatRuntimeConfigProfileLocator(wrongGroup),
        },
        { actorId: "admin-1", correlationId: "corr-group" },
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_DEPLOYMENT_CONFIG_PROFILE_UNAVAILABLE" });
  });

  it("creates a runtime deployment successfully and enqueues reconcile + audit", async () => {
    const deploymentId = "facade-create-ok";
    const target = makeConfigTarget(deploymentId);
    await seedPublishedConfig(pool, target, "v1");
    const profileId = `db-${deploymentId}`;
    await seedDatabaseProfile(pool, profileId, providerA, "ready");

    const view = await facade.create(
      {
        deploymentId,
        providerId: providerA,
        environment: "production",
        runtimeVersion: "2.0.0-rc.1",
        databaseProfileId: profileId,
        configProfileId: formatRuntimeConfigProfileLocator(target),
      },
      { actorId: "admin-1", correlationId: "corr-create-ok" },
    );

    expect(view).toMatchObject({
      deploymentId,
      providerId: providerA,
      environment: "production",
      desiredState: "running",
      desiredReplicas: 1,
      status: "REQUESTED",
      desiredRevision: 0,
      observedRevision: 0,
    });

    const jobRow = await pool.query("SELECT job_type FROM job_lease WHERE payload->>'deploymentId'=$1", [deploymentId]);
    expect(jobRow.rows).toHaveLength(1);
    expect(jobRow.rows[0].job_type).toBe("runtime_deployment.reconcile");

    const auditRow = await pool.query("SELECT action FROM audit WHERE subject_id=$1", [deploymentId]);
    expect(auditRow.rows).toHaveLength(1);
    expect(auditRow.rows[0].action).toBe("runtime_deployment.created");
  });

  it("rejects duplicate deployment creation", async () => {
    const deploymentId = "facade-duplicate";
    const target = makeConfigTarget(deploymentId);
    await seedPublishedConfig(pool, target, "v1");
    const profileId = `db-${deploymentId}`;
    await seedDatabaseProfile(pool, profileId, providerA, "ready");

    await facade.create(
      {
        deploymentId,
        providerId: providerA,
        environment: "production",
        runtimeVersion: "2.0.0-rc.1",
        databaseProfileId: profileId,
        configProfileId: formatRuntimeConfigProfileLocator(target),
      },
      { actorId: "admin-1", correlationId: "corr-dup-1" },
    );

    await expect(
      facade.create(
        {
          deploymentId,
          providerId: providerA,
          environment: "production",
          runtimeVersion: "2.0.0-rc.1",
          databaseProfileId: profileId,
          configProfileId: formatRuntimeConfigProfileLocator(target),
        },
        { actorId: "admin-1", correlationId: "corr-dup-2" },
      ),
    ).rejects.toThrow();
  });

  it("get returns the deployment within the same provider scope", async () => {
    const deploymentId = "facade-get";
    const target = makeConfigTarget(deploymentId);
    await seedPublishedConfig(pool, target, "v1");
    const profileId = `db-${deploymentId}`;
    await seedDatabaseProfile(pool, profileId, providerA, "ready");
    await facade.create(
      {
        deploymentId,
        providerId: providerA,
        environment: "production",
        runtimeVersion: "2.0.0-rc.1",
        databaseProfileId: profileId,
        configProfileId: formatRuntimeConfigProfileLocator(target),
      },
      { actorId: "admin-1", correlationId: "corr-get" },
    );

    const view = await facade.get(providerA, deploymentId);
    expect(view).not.toBeNull();
    expect(view?.deploymentId).toBe(deploymentId);
    expect(view?.providerId).toBe(providerA);
  });

  it("get returns null for a cross-provider query", async () => {
    const view = await facade.get(providerB, "facade-get");
    expect(view).toBeNull();
  });

  it("list returns deployments scoped to the provider", async () => {
    const result = await facade.list({ providerId: providerA, limit: 100 });
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.providerId).toBe(providerA);
    }
  });

  it("list supports environment filter", async () => {
    const result = await facade.list({ providerId: providerA, environment: "production", limit: 100 });
    for (const item of result.items) {
      expect(item.environment).toBe("production");
    }
  });

  it("list supports cursor pagination", async () => {
    const first = await facade.list({ providerId: providerA, limit: 2 });
    if (first.nextCursor !== undefined) {
      const second = await facade.list({ providerId: providerA, limit: 2, cursor: first.nextCursor });
      expect(second.items.length).toBeGreaterThan(0);
      const firstIds = new Set(first.items.map((i) => i.deploymentId));
      for (const item of second.items) {
        expect(firstIds.has(item.deploymentId)).toBe(false);
      }
    }
  });

  it("list supports status filter", async () => {
    const deploymentId = "facade-list-status";
    const target = makeConfigTarget(deploymentId);
    await seedPublishedConfig(pool, target, "v1");
    const profileId = `db-${deploymentId}`;
    await seedDatabaseProfile(pool, profileId, providerA, "ready");

    await facade.create(
      {
        deploymentId,
        providerId: providerA,
        environment: "production",
        runtimeVersion: "2.0.0-rc.1",
        databaseProfileId: profileId,
        configProfileId: formatRuntimeConfigProfileLocator(target),
      },
      { actorId: "admin-1", correlationId: "corr-list-status" },
    );

    await pool.query(
      `UPDATE runtime_deployment SET status='STOPPED' WHERE deployment_id=$1 AND provider_id=$2`,
      [deploymentId, providerA],
    );

    const stopped = await facade.list({
      providerId: providerA,
      status: "STOPPED",
      limit: 100,
    });

    expect(stopped.items.some((item) => item.deploymentId === deploymentId)).toBe(true);
    for (const item of stopped.items) {
      expect(item.status).toBe("STOPPED");
    }
  });

  it("list filters by provider scope", async () => {
    const deploymentId = "facade-list-provider-b";
    const target = makeConfigTarget(deploymentId);
    await seedPublishedConfig(pool, target, "v1");
    const profileId = `db-${deploymentId}`;
    await seedDatabaseProfile(pool, profileId, providerB, "ready");

    await facade.create(
      {
        deploymentId,
        providerId: providerB,
        environment: "production",
        runtimeVersion: "2.0.0-rc.1",
        databaseProfileId: profileId,
        configProfileId: formatRuntimeConfigProfileLocator(target),
      },
      { actorId: "admin-1", correlationId: "corr-list-provider-b" },
    );

    const providerAList = await facade.list({ providerId: providerA, limit: 100 });
    expect(providerAList.items.every((item) => item.providerId !== providerB)).toBe(true);

    const providerBList = await facade.list({ providerId: providerB, limit: 100 });
    expect(providerBList.items.some((item) => item.deploymentId === deploymentId)).toBe(true);
  });

  it("rejects invalid cursor", async () => {
    await expect(
      facade.list({ providerId: providerA, limit: 10, cursor: "not-a-number" }),
    ).rejects.toMatchObject({ name: "RangeError" });
  });

  it("command start/stop/restart/scale/reconcile preserves existing semantics", async () => {
    const deploymentId = "facade-commands";
    const target = makeConfigTarget(deploymentId);
    await seedPublishedConfig(pool, target, "v1");
    const profileId = `db-${deploymentId}`;
    await seedDatabaseProfile(pool, profileId, providerA, "ready");

    await facade.create(
      {
        deploymentId,
        providerId: providerA,
        environment: "production",
        runtimeVersion: "2.0.0-rc.1",
        databaseProfileId: profileId,
        configProfileId: formatRuntimeConfigProfileLocator(target),
      },
      { actorId: "admin-1", correlationId: "corr-commands-create" },
    );

    const stopped = await facade.command(
      { providerId: providerA, deploymentId, command: "stop", expectedDesiredRevision: 0 },
      { actorId: "admin-1", correlationId: "corr-stop" },
    );
    expect(stopped.desiredState).toBe("draining");
    expect(stopped.desiredRevision).toBe(1);

    const started = await facade.command(
      { providerId: providerA, deploymentId, command: "start", expectedDesiredRevision: 1 },
      { actorId: "admin-1", correlationId: "corr-start" },
    );
    expect(started.desiredState).toBe("running");
    expect(started.desiredRevision).toBe(2);

    await facade.command(
      { providerId: providerA, deploymentId, command: "restart", expectedDesiredRevision: 2 },
      { actorId: "admin-1", correlationId: "corr-restart" },
    );

    await facade.command(
      { providerId: providerA, deploymentId, command: "reconcile", expectedDesiredRevision: 2 },
      { actorId: "admin-1", correlationId: "corr-reconcile" },
    );

    const scaled = await facade.command(
      { providerId: providerA, deploymentId, command: "scale", expectedDesiredRevision: 2, desiredReplicas: 0 },
      { actorId: "admin-1", correlationId: "corr-scale" },
    );
    expect(scaled.desiredState).toBe("draining");
    expect(scaled.desiredReplicas).toBe(0);
    expect(scaled.desiredRevision).toBe(3);
  });

  it("command rejects stale optimistic revision", async () => {
    const deploymentId = "facade-rev-conflict";
    const target = makeConfigTarget(deploymentId);
    await seedPublishedConfig(pool, target, "v1");
    const profileId = `db-${deploymentId}`;
    await seedDatabaseProfile(pool, profileId, providerA, "ready");

    await facade.create(
      {
        deploymentId,
        providerId: providerA,
        environment: "production",
        runtimeVersion: "2.0.0-rc.1",
        databaseProfileId: profileId,
        configProfileId: formatRuntimeConfigProfileLocator(target),
      },
      { actorId: "admin-1", correlationId: "corr-rev-create" },
    );

    await expect(
      facade.command(
        { providerId: providerA, deploymentId, command: "stop", expectedDesiredRevision: 99 },
        { actorId: "admin-1", correlationId: "corr-rev-conflict" },
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_DEPLOYMENT_REVISION_CONFLICT" });
  });

  it("command returns not found for cross-provider access", async () => {
    await expect(
      facade.command(
        { providerId: providerB, deploymentId: "facade-create-ok", command: "reconcile", expectedDesiredRevision: 0 },
        { actorId: "admin-1", correlationId: "corr-cross" },
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_DEPLOYMENT_NOT_FOUND" });
  });
});

function makeConfigTarget(deploymentId: string): RuntimeConfigProfileLocator {
  return runtimeDeploymentProfileLocator({
    environment,
    targetId: deploymentId,
    configGroup: "runtime",
    dataId: "process",
  });
}

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
): Promise<void> {
  const auditId = randomUUID();
  await pool.query(
    `INSERT INTO audit(audit_event_id,action,actor_id,correlation_id,subject_type,subject_id,occurred_at,metadata)
     VALUES ($1,'database_profile.created','admin-1','seed','database_profile',$2,$3,'{}')`,
    [auditId, profileId, now],
  );
  const slug = profileId.replace(/[^a-z0-9]/gi, "_").toLowerCase().slice(0, 20);
  await pool.query(
    `INSERT INTO database_profile(
       profile_id,provider_id,environment,cluster_ref,host,port,database_mode,
       database_name,runtime_role_name,ssl_mode,admin_secret_ref,runtime_secret_ref,
       provision_status,last_error_code,provisioned_at,
       created_audit_event_id,last_audit_event_id
     ) VALUES ($1,$2,'production','cluster-1','localhost',5432,'preexisting',
       'sdar_rt_${slug}','sdar_rt_${slug}_app','disable','secret:admin-${slug}','secret:runtime-${slug}',
       $3,CASE WHEN $3='failed' THEN 'ERR' ELSE NULL END,CASE WHEN $3='ready' THEN $4 ELSE NULL END,
       $5,$5)`,
    [profileId, providerId, provisionStatus, now, auditId],
  );
}

async function seedPublishedConfig(
  pool: Pool,
  target: { environment: string; targetType: string; targetId: string; configGroup: string; dataId: string },
  versionTag: string,
): Promise<void> {
  const defId = randomUUID();
  await pool.query(
    `INSERT INTO config_definition(
       definition_id,environment,target_type,target_id,config_group,data_id,
       schema_document,default_content,secret_paths,field_metadata,status
     ) VALUES ($1,$2,$3,$4,$5,$6,'{}','{}','[]','{}','active')`,
    [defId, target.environment, target.targetType, target.targetId, target.configGroup, target.dataId],
  );
  const revId = randomUUID();
  const checksum = "a".repeat(64 - versionTag.length) + versionTag;
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
  target: { environment: string; targetType: string; targetId: string; configGroup: string; dataId: string },
  versionTag: string,
): Promise<void> {
  const defId = randomUUID();
  await pool.query(
    `INSERT INTO config_definition(
       definition_id,environment,target_type,target_id,config_group,data_id,
       schema_document,default_content,secret_paths,field_metadata,status
     ) VALUES ($1,$2,$3,$4,$5,$6,'{}','{}','[]','{}','active')`,
    [defId, target.environment, target.targetType, target.targetId, target.configGroup, target.dataId],
  );
  const revId = randomUUID();
  const checksum = "b".repeat(64 - versionTag.length) + versionTag;
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
