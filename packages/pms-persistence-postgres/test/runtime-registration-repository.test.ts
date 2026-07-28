import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRuntimeProcessProjection,
  requestRuntimeDeployment,
  databaseProfileId,
  runtimeConfigProfileId,
  runtimeDeploymentId,
  runtimeEnvironmentId,
  runtimeInstanceId,
  runtimeProviderId,
  type RuntimeDeployment,
  type RuntimeProcessObservation,
  type RuntimeProcessProjection,
} from "@sdar/runtime-deployment";
import {
  PostgresRuntimeDeploymentRepository,
  PostgresRuntimeProcessRepository,
  PostgresRuntimeRegistrationRepository,
  runPmsMigrations,
  type RuntimeRegistrationRecordValue,
  type RuntimeRegistrationProjectionPatch,
} from "../src/index.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const providerA = runtimeProviderId("provider:A");
const providerB = runtimeProviderId("provider:B");
const environment = runtimeEnvironmentId("production");
const now = new Date("2026-07-28T00:00:00.000Z");

describe("PostgreSQL RuntimeRegistration persistence", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const schema = `runtime_registration_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    await runPmsMigrations(pool, workspaceRoot);
    await pool.query(
      `INSERT INTO provider_type(provider_type_id,display_name,status)
       VALUES ('isr.vehicle.ugv','UGV','active')
       ON CONFLICT (provider_type_id) DO NOTHING`,
    );
    await Promise.all([ensureProvider(pool, providerA), ensureProvider(pool, providerB)]);
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("inserts and loads full provider-scoped registration snapshot from join", async () => {
    const repositories = postgresDeploymentRepositories(pool);
    const deployment = deploymentSnapshot("provider-scope");
    await repositories.deployments.insert(deployment.snapshot);
    const process = processProjection(deployment.snapshot.deploymentId, "inst-01");
    await repositories.processes.upsert(providerA, process, null);

    const registration = registrationRecord({
      runtimeInstanceId: process.instanceId,
      sessionId: "session-scope-01",
      protocolVersion: "2.0.0-rc.1",
      heartbeatSequence: 1,
      registeredAt: now,
      lastHeartbeatAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      revision: 0,
    });

    const repository = new PostgresRuntimeRegistrationRepository(pool);
    await repository.insert(providerA, deployment.snapshot.deploymentId, registration);

    const snapshot = await repository.get(
      providerA,
      deployment.snapshot.deploymentId,
      process.instanceId,
    );
    expect(snapshot).toEqual({
      providerId: providerA,
      deploymentId: deployment.snapshot.deploymentId,
      instanceId: process.instanceId,
      sessionId: "session-scope-01",
      runtimeVersion: process.runtimeVersion,
      protocolVersion: "2.0.0-rc.1",
      configRevision: process.configRevision,
      readinessState: process.readinessState,
      heartbeatSequence: 1,
      registeredAt: now,
      lastHeartbeatAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      revision: 0,
    });
    expect(snapshot).not.toBeNull();

    expect(
      await repository.get(providerB, deployment.snapshot.deploymentId, process.instanceId),
    ).toBeNull();
    expect(
      await repository.get(providerA, deploymentId("other-deployment"), process.instanceId),
    ).toBeNull();
  });

  it("updates registration and enforces CAS on revision", async () => {
    const repository = new PostgresRuntimeRegistrationRepository(pool);
    const deployment = deploymentSnapshot("registration-update");
    const deploymentRepo = postgresDeploymentRepositories(pool);
    await deploymentRepo.deployments.insert(deployment.snapshot);

    const process = processProjection(deployment.snapshot.deploymentId, "inst-02", {
      readinessState: "not_ready",
      registrationState: "unregistered",
    });
    await deploymentRepo.processes.upsert(providerA, process, null);

    const base = registrationRecord({
      runtimeInstanceId: process.instanceId,
      sessionId: "session-reg-update",
      protocolVersion: "2.0.0-rc.1",
      heartbeatSequence: 1,
      registeredAt: now,
      lastHeartbeatAt: now,
      expiresAt: new Date(now.getTime() + 30_000),
      revision: 0,
    });
    await repository.insert(providerA, deployment.snapshot.deploymentId, base);

    const next = registrationRecord({
      ...base,
      sessionId: "session-reg-update",
      heartbeatSequence: 2,
      revision: 1,
    });
    await repository.update(
      providerA,
      deployment.snapshot.deploymentId,
      process.instanceId,
      0,
      next,
    );

    const updated = await repository.get(
      providerA,
      deployment.snapshot.deploymentId,
      process.instanceId,
    );
    expect(updated?.heartbeatSequence).toBe(2);
    expect(updated?.revision).toBe(1);

    await expect(
      repository.update(providerA, deployment.snapshot.deploymentId, process.instanceId, 0, next),
    ).rejects.toMatchObject({ code: "OPTIMISTIC_CONCURRENCY_CONFLICT" });
  });

  it("requires provider and deployment scope for get/updateRegistrationProjection", async () => {
    const deploymentA = deploymentSnapshot("scope-a");
    const deploymentB = deploymentSnapshot("scope-b");
    const repositories = postgresDeploymentRepositories(pool);
    const repository = new PostgresRuntimeRegistrationRepository(pool);
    await repositories.deployments.insert(deploymentA.snapshot);
    await repositories.deployments.insert(deploymentB.snapshot);

    const processA = processProjection(deploymentA.snapshot.deploymentId, "inst-03");
    const processB = processProjection(deploymentB.snapshot.deploymentId, "inst-03", {
      readinessState: "ready",
    });
    await repositories.processes.upsert(providerA, processA, null);
    await repositories.processes.upsert(providerB, processB, null);

    await repository.insert(
      providerA,
      deploymentA.snapshot.deploymentId,
      registrationRecord({
        runtimeInstanceId: processA.instanceId,
        sessionId: "session-scoped-a",
        protocolVersion: "2.0.0",
        heartbeatSequence: 0,
        registeredAt: now,
        lastHeartbeatAt: now,
        expiresAt: new Date(now.getTime() + 30_000),
        revision: 0,
      }),
    );
    await repository.insert(
      providerB,
      deploymentB.snapshot.deploymentId,
      registrationRecord({
        runtimeInstanceId: processB.instanceId,
        sessionId: "session-scoped-b",
        protocolVersion: "2.0.0",
        heartbeatSequence: 0,
        registeredAt: now,
        lastHeartbeatAt: now,
        expiresAt: new Date(now.getTime() + 30_000),
        revision: 0,
      }),
    );

    expect(
      await repository.get(providerA, deploymentB.snapshot.deploymentId, processB.instanceId),
    ).toBeNull();
    expect(
      await repository.get(providerB, deploymentA.snapshot.deploymentId, processA.instanceId),
    ).toBeNull();

    await expect(
      repository.updateRegistrationProjection(
        providerB,
        deploymentA.snapshot.deploymentId,
        processA.instanceId,
        processA.observedRevision,
        {
          registrationState: "registered",
          readinessState: "ready",
          lastHeartbeatAt: new Date(now.getTime() + 1_000),
          runtimeVersion: "2.0.0-rc.1",
          configRevision: 1,
          observedRevision: processA.observedRevision + 1,
        },
      ),
    ).rejects.toMatchObject({ code: "OPTIMISTIC_CONCURRENCY_CONFLICT" });

    expect((await loadProcess(pool, processA.instanceId)).observed_revision).toBe("0");
  });

  it("updates only registration-related process projection fields and uses observed revision CAS", async () => {
    const deployment = deploymentSnapshot("projection-update");
    const repositories = postgresDeploymentRepositories(pool);
    const registrationRepository = new PostgresRuntimeRegistrationRepository(pool);
    await repositories.deployments.insert(deployment.snapshot);

    const process = processProjection(deployment.snapshot.deploymentId, "inst-04", {
      runtimeVersion: "2.0.0-rc.1",
      configRevision: 1,
      readinessState: "ready",
      registrationState: "unregistered",
    });
    await repositories.processes.upsert(providerA, process, null);

    const before = await loadProcess(pool, process.instanceId);
    await registrationRepository.insert(
      providerA,
      deployment.snapshot.deploymentId,
      registrationRecord({
        runtimeInstanceId: process.instanceId,
        sessionId: "session-proj",
        protocolVersion: "2.0.0-rc.1",
        heartbeatSequence: 0,
        registeredAt: now,
        lastHeartbeatAt: now,
        expiresAt: new Date(now.getTime() + 30_000),
        revision: 0,
      }),
    );

    const patch: RuntimeRegistrationProjectionPatch = {
      registrationState: "registered",
      readinessState: "not_ready",
      lastHeartbeatAt: new Date(now.getTime() + 10_000),
      runtimeVersion: "2.0.0",
      configRevision: 3,
      observedRevision: process.observedRevision + 1,
    };
    await registrationRepository.updateRegistrationProjection(
      providerA,
      deployment.snapshot.deploymentId,
      process.instanceId,
      process.observedRevision,
      patch,
    );

    const after = await loadProcess(pool, process.instanceId);
    expect(after).toMatchObject({
      registration_state: "registered",
      readiness_state: "not_ready",
      runtime_version: "2.0.0",
      config_revision: "3",
      observed_revision: "1",
      last_heartbeat_at: patch.lastHeartbeatAt,
      pid: before.pid,
      pm2_name: before.pm2_name,
      port: before.port,
      process_state: before.process_state,
      liveness_state: before.liveness_state,
      catalog_state: before.catalog_state,
      config_state: before.config_state,
      restart_count: before.restart_count,
    });

    await expect(
      registrationRepository.updateRegistrationProjection(
        providerA,
        deployment.snapshot.deploymentId,
        process.instanceId,
        process.observedRevision,
        patch,
      ),
    ).rejects.toMatchObject({ code: "OPTIMISTIC_CONCURRENCY_CONFLICT" });
  });

  it("deletes registration row when RuntimeProcess is removed", async () => {
    const deployment = deploymentSnapshot("cascade-delete");
    const repositories = postgresDeploymentRepositories(pool);
    const registrationRepository = new PostgresRuntimeRegistrationRepository(pool);
    await repositories.deployments.insert(deployment.snapshot);

    const process = processProjection(deployment.snapshot.deploymentId, "inst-05");
    await repositories.processes.upsert(providerA, process, null);
    await registrationRepository.insert(
      providerA,
      deployment.snapshot.deploymentId,
      registrationRecord({
        runtimeInstanceId: process.instanceId,
        sessionId: "session-cascade",
        protocolVersion: "2.0.0-rc.1",
        heartbeatSequence: 0,
        registeredAt: now,
        lastHeartbeatAt: now,
        expiresAt: new Date(now.getTime() + 30_000),
        revision: 0,
      }),
    );

    await pool.query("DELETE FROM runtime_process WHERE runtime_instance_id=$1", [
      process.instanceId,
    ]);

    expect(
      await registrationRepository.get(
        providerA,
        deployment.snapshot.deploymentId,
        process.instanceId,
      ),
    ).toBeNull();
  });
});

function deploymentSnapshot(name: string): RuntimeDeployment {
  return requestRuntimeDeployment(
    {
      deploymentId: runtimeDeploymentId(`${name}-${randomUUID().replaceAll("-", "")}`),
      providerId: name.includes("scope-b") || name.endsWith("-b") ? providerB : providerA,
      environment,
      desiredState: "running",
      desiredReplicas: 1,
      runtimeVersion: "2.0.0-rc.1",
      databaseProfileId: databaseProfileId(`database-${name}`),
      configProfileId: runtimeConfigProfileId(`config-${name}`),
      adapterEndpoint: "127.0.0.1:50051",
    },
    now,
  );
}

let nextProcessPort = 31_000;

function allocateProcessPort(): number {
  const port = nextProcessPort;
  nextProcessPort += 1;
  return port;
}

function processProjection(
  deploymentId: RuntimeDeployment["snapshot"]["deploymentId"],
  instanceTag: string,
  overrides: Partial<RuntimeProcessObservation> = {},
): RuntimeProcessProjection {
  return createRuntimeProcessProjection(
    {
      instanceId: runtimeInstanceId(`${deploymentId}:instance-${instanceTag}`),
      deploymentId,
      pm2Name: `sdar-runtime-production-${deploymentId.toString().replaceAll("_", "-")}-${instanceTag}`,
      port: allocateProcessPort(),
    },
    {
      pid: 101,
      processState: "online",
      livenessState: "live",
      readinessState: "ready",
      registrationState: "registered",
      catalogState: "valid",
      configState: "current",
      lastHeartbeatAt: now,
      runtimeVersion: "2.0.0-rc.1",
      configRevision: 1,
      restartCount: 0,
      ...overrides,
    },
  );
}

function registrationRecord(
  overrides: Partial<RuntimeRegistrationRecordValue>,
): RuntimeRegistrationRecordValue {
  return {
    runtimeInstanceId: runtimeInstanceId("instance-missing"),
    sessionId: "session",
    protocolVersion: "2.0.0",
    heartbeatSequence: 0,
    registeredAt: now,
    lastHeartbeatAt: now,
    expiresAt: new Date(now.getTime() + 30_000),
    revision: 0,
    ...overrides,
  };
}

async function loadProcess(pool: Pool, instanceId: string) {
  const result = await pool.query<{
    registration_state: string;
    readiness_state: string;
    runtime_version: string;
    config_revision: string;
    observed_revision: string;
    last_heartbeat_at: Date;
    pid: number;
    pm2_name: string;
    port: number;
    process_state: string;
    liveness_state: string;
    catalog_state: string;
    config_state: string;
    restart_count: number;
  }>(
    `SELECT registration_state,readiness_state,runtime_version,config_revision,observed_revision,
            last_heartbeat_at,pid,pm2_name,port,process_state,liveness_state,catalog_state,
            config_state,restart_count
       FROM runtime_process
      WHERE runtime_instance_id=$1`,
    [instanceId],
  );
  if (result.rows[0] === undefined) {
    throw new Error("PROCESS_RECORD_NOT_FOUND");
  }
  return result.rows[0];
}

function deploymentId(value: string): RuntimeDeployment["snapshot"]["deploymentId"] {
  return runtimeDeploymentId(value);
}

async function ensureProvider(pool: Pool, providerId: string): Promise<void> {
  await pool.query(
    `INSERT INTO provider(provider_id,provider_type_id,hosting_mode,status)
     VALUES ($1,'isr.vehicle.ugv','vendor_managed','active')
     ON CONFLICT (provider_id) DO NOTHING`,
    [providerId],
  );
}

function postgresDeploymentRepositories(pool: Pool) {
  return {
    deployments: new PostgresRuntimeDeploymentRepository(pool),
    processes: new PostgresRuntimeProcessRepository(pool),
  };
}

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("TEST_DATABASE_URL is required");
  return value;
}
