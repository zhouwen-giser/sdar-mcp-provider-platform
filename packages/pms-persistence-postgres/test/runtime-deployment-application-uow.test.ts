import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  databaseProfileId,
  createRuntimeProcessProjection,
  requestRuntimeDeployment,
  runtimeConfigProfileId,
  runtimeDeploymentId,
  runtimeEnvironmentId,
  runtimeInstanceId,
  runtimeProviderId,
} from "@sdar/runtime-deployment";
import { PostgresRuntimeDeploymentApplicationUnitOfWork, runPmsMigrations } from "../src/index.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const providerA = runtimeProviderId("provider:uow-a");
const environment = runtimeEnvironmentId("production");
const now = new Date("2026-07-28T00:00:00.000Z");

describe("PostgresRuntimeDeploymentApplicationUnitOfWork", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const schema = `runtime_uow_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    await runPmsMigrations(pool, workspaceRoot);
    await seedProvider(pool, providerA);
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("atomically commits deployment insert, job enqueue, and audit append", async () => {
    const uow = new PostgresRuntimeDeploymentApplicationUnitOfWork(pool);
    const deploymentId = "uow-commit";
    const snapshot = deploymentSnapshot(deploymentId);

    const result = await uow.transaction(async (repos) => {
      await repos.deployments.insert(snapshot);
      await repos.jobs.enqueue({
        jobId: `job-${deploymentId}`,
        jobType: "runtime_deployment.reconcile",
        payload: { deploymentId, intent: "create" },
      });
      await repos.audit.append({
        auditEventId: randomUUID() as never,
        action: "runtime_deployment.created",
        actorId: "admin-1",
        correlationId: "corr-1",
        subjectType: "runtime_deployment",
        subjectId: deploymentId,
        occurredAt: now,
        metadata: { desiredReplicas: 1 },
      });
      return "ok";
    });

    expect(result).toBe("ok");
    const checkPool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    try {
      const dep = await checkPool.query(
        "SELECT deployment_id FROM runtime_deployment WHERE deployment_id=$1",
        [deploymentId],
      );
      expect(dep.rows).toHaveLength(1);
      const job = await checkPool.query<{ job_type: string }>(
        "SELECT job_type FROM job_lease WHERE job_id=$1",
        [`job-${deploymentId}`],
      );
      expect(job.rows).toHaveLength(1);
      const persistedJob = job.rows[0];
      if (persistedJob === undefined) throw new Error("RUNTIME_DEPLOYMENT_JOB_NOT_PERSISTED");
      expect(persistedJob.job_type).toBe("runtime_deployment.reconcile");
      const audit = await checkPool.query<{ action: string }>(
        "SELECT action FROM audit WHERE subject_id=$1",
        [deploymentId],
      );
      expect(audit.rows).toHaveLength(1);
      const persistedAudit = audit.rows[0];
      if (persistedAudit === undefined) {
        throw new Error("RUNTIME_DEPLOYMENT_AUDIT_NOT_PERSISTED");
      }
      expect(persistedAudit.action).toBe("runtime_deployment.created");
    } finally {
      await checkPool.end();
    }
  });

  it("commits direct-container deployment and expected process in the same transaction", async () => {
    const uow = new PostgresRuntimeDeploymentApplicationUnitOfWork(pool);
    const snapshot = requestRuntimeDeployment(
      {
        deploymentId: runtimeDeploymentId("uow-direct"),
        providerId: providerA,
        environment,
        desiredState: "running",
        desiredReplicas: 1,
        runtimeVersion: "2.0.0-rc.1",
        runtimeAuthority: "direct_container",
        adapterEndpoint: "ugv-adapter:50051",
        directContainer: {
          instanceId: runtimeInstanceId("uow-direct-instance"),
          controlEndpoint: "http://ugv-runtime:8080",
          advertisedEndpoint: "http://192.168.1.7:19100",
        },
      },
      now,
    ).snapshot;
    if (snapshot.runtimeAuthority !== "direct_container") {
      throw new Error("DIRECT_CONTAINER_SNAPSHOT_EXPECTED");
    }

    await uow.transaction(async (repos) => {
      await repos.deployments.insert(snapshot);
      await repos.processes.insertExpected(
        providerA,
        createRuntimeProcessProjection(
          {
            instanceId: snapshot.directContainer.instanceId,
            deploymentId: snapshot.deploymentId,
            processManager: "direct_container",
            pm2Name: null,
            port: null,
            controlEndpoint: snapshot.directContainer.controlEndpoint,
            advertisedEndpoint: snapshot.directContainer.advertisedEndpoint,
          },
          {
            pid: null,
            processState: "missing",
            livenessState: "unknown",
            readinessState: "unknown",
            registrationState: "unregistered",
            catalogState: "unknown",
            configState: "externally_managed",
            lastHeartbeatAt: null,
            runtimeVersion: null,
            configRevision: 0,
            restartCount: 0,
          },
        ),
      );
    });

    const result = await pool.query<{
      runtime_authority: string;
      process_manager: string;
    }>(
      `SELECT deployment.runtime_authority,process.process_manager
         FROM runtime_deployment deployment
         JOIN runtime_process process USING (deployment_id)
        WHERE deployment.deployment_id='uow-direct'`,
    );
    expect(result.rows).toEqual([
      { runtime_authority: "direct_container", process_manager: "direct_container" },
    ]);
  });

  it("rolls back deployment, job, and audit when the transaction rejects", async () => {
    const uow = new PostgresRuntimeDeploymentApplicationUnitOfWork(pool);
    const deploymentId = "uow-rollback";
    const snapshot = deploymentSnapshot(deploymentId);

    await expect(
      uow.transaction(async (repos) => {
        await repos.deployments.insert(snapshot);
        await repos.jobs.enqueue({
          jobId: `job-${deploymentId}`,
          jobType: "runtime_deployment.reconcile",
          payload: { deploymentId, intent: "create" },
        });
        await repos.audit.append({
          auditEventId: randomUUID() as never,
          action: "runtime_deployment.created",
          actorId: "admin-1",
          correlationId: "corr-2",
          subjectType: "runtime_deployment",
          subjectId: deploymentId,
          occurredAt: now,
          metadata: { desiredReplicas: 1 },
        });
        throw new Error("SIMULATED_FAILURE");
      }),
    ).rejects.toThrow("SIMULATED_FAILURE");

    const checkPool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    try {
      const dep = await checkPool.query(
        "SELECT deployment_id FROM runtime_deployment WHERE deployment_id=$1",
        [deploymentId],
      );
      expect(dep.rows).toHaveLength(0);
      const job = await checkPool.query("SELECT job_type FROM job_lease WHERE job_id=$1", [
        `job-${deploymentId}`,
      ]);
      expect(job.rows).toHaveLength(0);
      const audit = await checkPool.query("SELECT action FROM audit WHERE subject_id=$1", [
        deploymentId,
      ]);
      expect(audit.rows).toHaveLength(0);
    } finally {
      await checkPool.end();
    }
  });

  it("rolls back job and audit when deployment insert fails (duplicate)", async () => {
    const uow = new PostgresRuntimeDeploymentApplicationUnitOfWork(pool);
    const deploymentId = "uow-duplicate";
    const snapshot = deploymentSnapshot(deploymentId);

    await uow.transaction(async (repos) => {
      await repos.deployments.insert(snapshot);
    });

    await expect(
      uow.transaction(async (repos) => {
        await repos.deployments.insert(snapshot);
        await repos.jobs.enqueue({
          jobId: `job-dup-${deploymentId}`,
          jobType: "runtime_deployment.reconcile",
          payload: { deploymentId, intent: "create" },
        });
        await repos.audit.append({
          auditEventId: randomUUID() as never,
          action: "runtime_deployment.created",
          actorId: "admin-1",
          correlationId: "corr-dup",
          subjectType: "runtime_deployment",
          subjectId: deploymentId,
          occurredAt: now,
          metadata: {},
        });
      }),
    ).rejects.toThrow();

    const checkPool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    try {
      const job = await checkPool.query("SELECT job_type FROM job_lease WHERE job_id=$1", [
        `job-dup-${deploymentId}`,
      ]);
      expect(job.rows).toHaveLength(0);
      const audit = await checkPool.query("SELECT action FROM audit WHERE correlation_id=$1", [
        "corr-dup",
      ]);
      expect(audit.rows).toHaveLength(0);
    } finally {
      await checkPool.end();
    }
  });

  it("rolls back deployment and audit when job enqueue fails", async () => {
    const uow = new PostgresRuntimeDeploymentApplicationUnitOfWork(pool);
    const deploymentId = "uow-job-fail";

    await expect(
      uow.transaction(async (repos) => {
        await repos.deployments.insert(deploymentSnapshot(deploymentId));
        await repos.jobs.enqueue({
          jobId: "",
          jobType: "runtime_deployment.reconcile",
          payload: {},
        });
      }),
    ).rejects.toThrow();

    const checkPool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    try {
      const dep = await checkPool.query(
        "SELECT deployment_id FROM runtime_deployment WHERE deployment_id=$1",
        [deploymentId],
      );
      expect(dep.rows).toHaveLength(0);
    } finally {
      await checkPool.end();
    }
  });

  it("rolls back deployment and job when audit append fails", async () => {
    const uow = new PostgresRuntimeDeploymentApplicationUnitOfWork(pool);
    const deploymentId = "uow-audit-fail";

    await expect(
      uow.transaction(async (repos) => {
        await repos.deployments.insert(deploymentSnapshot(deploymentId));
        await repos.jobs.enqueue({
          jobId: `job-${deploymentId}`,
          jobType: "runtime_deployment.reconcile",
          payload: { deploymentId },
        });
        await repos.audit.append({
          auditEventId: "not-a-uuid" as never,
          action: "runtime_deployment.created",
          actorId: "admin-1",
          correlationId: "corr-audit-fail",
          subjectType: "runtime_deployment",
          subjectId: deploymentId,
          occurredAt: now,
          metadata: {},
        });
      }),
    ).rejects.toThrow();

    const checkPool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    try {
      const dep = await checkPool.query(
        "SELECT deployment_id FROM runtime_deployment WHERE deployment_id=$1",
        [deploymentId],
      );
      expect(dep.rows).toHaveLength(0);
      const job = await checkPool.query("SELECT job_type FROM job_lease WHERE job_id=$1", [
        `job-${deploymentId}`,
      ]);
      expect(job.rows).toHaveLength(0);
    } finally {
      await checkPool.end();
    }
  });

  it("supports command with save and job/audit in one transaction", async () => {
    const uow = new PostgresRuntimeDeploymentApplicationUnitOfWork(pool);
    const deploymentId = "uow-command";
    const snapshot = deploymentSnapshot(deploymentId);

    await uow.transaction(async (repos) => {
      await repos.deployments.insert(snapshot);
    });

    const updated = await uow.transaction(async (repos) => {
      const aggregate = await repos.deployments.get(providerA, deploymentId);
      if (aggregate === null) throw new Error("not found");
      aggregate.changeDesiredState("draining", 0, 0, now);
      await repos.deployments.save(aggregate.snapshot, {
        expectedDesiredRevision: 0,
        expectedObservedRevision: 0,
      });
      await repos.jobs.enqueue({
        jobId: `job-stop-${deploymentId}`,
        jobType: "runtime_deployment.reconcile",
        payload: { deploymentId, intent: "stop" },
      });
      await repos.audit.append({
        auditEventId: randomUUID() as never,
        action: "runtime_deployment.stop_requested",
        actorId: "admin-1",
        correlationId: "corr-stop",
        subjectType: "runtime_deployment",
        subjectId: deploymentId,
        occurredAt: now,
        metadata: { desiredReplicas: 0 },
      });
      return aggregate.snapshot;
    });

    expect(updated.desiredState).toBe("draining");
    expect(updated.desiredRevision).toBe(1);
  });
});

function deploymentSnapshot(deploymentId: string) {
  return requestRuntimeDeployment(
    {
      deploymentId: runtimeDeploymentId(deploymentId),
      providerId: providerA,
      environment,
      desiredState: "running",
      desiredReplicas: 1,
      runtimeVersion: "2.0.0-rc.1",
      databaseProfileId: databaseProfileId(`db-${deploymentId}`),
      configProfileId: runtimeConfigProfileId(`cfg-${deploymentId}`),
      adapterEndpoint: "127.0.0.1:50051",
    },
    now,
  ).snapshot;
}

async function seedProvider(pool: Pool, providerId: string): Promise<void> {
  await pool.query(
    `INSERT INTO provider_type(provider_type_id,display_name,status)
     VALUES ('isr.vehicle.ugv','UGV','active')`,
  );
  await pool.query(
    `INSERT INTO provider(provider_id,provider_type_id,hosting_mode,status)
     VALUES ($1,'isr.vehicle.ugv','vendor_managed','active')`,
    [providerId],
  );
}

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("TEST_DATABASE_URL is required");
  return value;
}
