import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRuntimeProcessProjection,
  databaseProfileId,
  requestRuntimeDeployment,
  runtimeConfigProfileId,
  runtimeDeploymentId,
  runtimeEnvironmentId,
  runtimeInstanceId,
  runtimeProviderId,
  updateRuntimeProcessObservation,
  type RuntimeDeployment,
  type RuntimeProcessObservation,
} from "@sdar/runtime-deployment";
import {
  PostgresRuntimeDeploymentUnitOfWork,
  postgresRuntimeDeploymentRepositories,
  runPmsMigrations,
  type RuntimeDeploymentAction,
} from "../src/index.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const providerA = runtimeProviderId("provider:A");
const providerB = runtimeProviderId("provider:B");
const environment = runtimeEnvironmentId("production");
const now = new Date("2026-07-26T00:00:00.000Z");

describe("PostgreSQL RuntimeDeployment persistence", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const schema = `runtime_deployment_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    await runPmsMigrations(pool, workspaceRoot);
    await pool.query(
      `INSERT INTO provider_type(provider_type_id,display_name,status)
       VALUES ('isr.vehicle.ugv','UGV','active')`,
    );
    await pool.query(
      `INSERT INTO provider(provider_id,provider_type_id,hosting_mode,status)
       VALUES
         ($1,'isr.vehicle.ugv','vendor_managed','active'),
         ($2,'isr.vehicle.ugv','vendor_managed','active')`,
      [providerA, providerB],
    );
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("inserts and loads aggregates only inside the requested Provider scope", async () => {
    const repositories = postgresRuntimeDeploymentRepositories(pool);
    const aggregate = deployment("deployment-scope", providerA);
    await repositories.deployments.insert(aggregate.snapshot);

    expect(
      (await repositories.deployments.get(providerA, aggregate.snapshot.deploymentId))?.snapshot,
    ).toEqual(aggregate.snapshot);
    expect(
      await repositories.deployments.get(providerB, aggregate.snapshot.deploymentId),
    ).toBeNull();
    expect(await repositories.deployments.listByProvider(providerA, environment)).toHaveLength(1);
    expect(await repositories.deployments.listByProvider(providerB, environment)).toEqual([]);
  });

  it("allows only one conflicting compare-and-set writer and maps the loser stably", async () => {
    const repositories = postgresRuntimeDeploymentRepositories(pool);
    const aggregate = deployment("deployment-cas", providerA);
    await repositories.deployments.insert(aggregate.snapshot);
    const left = await repositories.deployments.get(providerA, aggregate.snapshot.deploymentId);
    const right = await repositories.deployments.get(providerA, aggregate.snapshot.deploymentId);
    if (left === null || right === null) throw new Error("RUNTIME_DEPLOYMENT_NOT_LOADED");
    left.transition(
      "DATABASE_PROVISIONING",
      { expectedStatus: "REQUESTED", expectedRevision: 0 },
      now,
    );
    right.transition("FAILED", { expectedStatus: "REQUESTED", expectedRevision: 0 }, now);

    const results = await Promise.allSettled([
      repositories.deployments.save(left.snapshot, {
        expectedDesiredRevision: 0,
        expectedObservedRevision: 0,
      }),
      repositories.deployments.save(right.snapshot, {
        expectedDesiredRevision: 0,
        expectedObservedRevision: 0,
      }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.find(({ status }) => status === "rejected")).toMatchObject({
      status: "rejected",
      reason: { code: "OPTIMISTIC_CONCURRENCY_CONFLICT" },
    });
  });

  it("makes an identical aggregate retry a no-op after compare-and-set success", async () => {
    const repositories = postgresRuntimeDeploymentRepositories(pool);
    const aggregate = deployment("deployment-idempotent", providerA);
    await repositories.deployments.insert(aggregate.snapshot);
    aggregate.transition(
      "DATABASE_PROVISIONING",
      { expectedStatus: "REQUESTED", expectedRevision: 0 },
      now,
    );

    await expect(
      repositories.deployments.save(aggregate.snapshot, {
        expectedDesiredRevision: 0,
        expectedObservedRevision: 0,
      }),
    ).resolves.toBe(true);
    await expect(
      repositories.deployments.save(aggregate.snapshot, {
        expectedDesiredRevision: 0,
        expectedObservedRevision: 0,
      }),
    ).resolves.toBe(false);
  });

  it("upserts changed heartbeats with CAS and makes repeated heartbeats idempotent", async () => {
    const repositories = postgresRuntimeDeploymentRepositories(pool);
    const aggregate = deployment("deployment-process", providerA);
    await repositories.deployments.insert(aggregate.snapshot);
    const initial = processProjection(aggregate);

    await expect(repositories.processes.upsert(providerA, initial, null)).resolves.toBe(true);
    await expect(repositories.processes.upsert(providerA, initial, null)).resolves.toBe(false);

    const heartbeat = updateRuntimeProcessObservation(
      initial,
      observation({ lastHeartbeatAt: new Date("2026-07-26T00:00:10.000Z") }),
      0,
    );
    await expect(repositories.processes.upsert(providerA, heartbeat, 0)).resolves.toBe(true);
    await expect(repositories.processes.upsert(providerA, heartbeat, 0)).resolves.toBe(false);
    expect(
      (await repositories.processes.get(providerA, initial.instanceId))?.observedRevision,
    ).toBe(1);
    expect(await repositories.processes.get(providerB, initial.instanceId)).toBeNull();

    const staleChange = updateRuntimeProcessObservation(
      heartbeat,
      observation({
        lastHeartbeatAt: new Date("2026-07-26T00:00:20.000Z"),
        restartCount: 1,
      }),
      1,
    );
    await expect(repositories.processes.upsert(providerA, staleChange, 0)).rejects.toMatchObject({
      code: "OPTIMISTIC_CONCURRENCY_CONFLICT",
    });
  });

  it("persists a direct-container deployment and expected instance without fake PM2 identity", async () => {
    const repositories = postgresRuntimeDeploymentRepositories(pool);
    const aggregate = requestRuntimeDeployment(
      {
        deploymentId: runtimeDeploymentId("deployment-direct"),
        providerId: providerA,
        environment,
        desiredState: "running",
        desiredReplicas: 1,
        runtimeVersion: "2.0.0-rc.1",
        runtimeAuthority: "direct_container",
        adapterEndpoint: "ugv-adapter:50051",
        directContainer: {
          instanceId: runtimeInstanceId("runtime-direct-0"),
          controlEndpoint: "http://ugv-runtime:8080",
          advertisedEndpoint: "http://192.168.1.7:19100",
        },
      },
      now,
    );
    if (aggregate.snapshot.runtimeAuthority !== "direct_container") {
      throw new Error("DIRECT_CONTAINER_SNAPSHOT_EXPECTED");
    }
    const expected = createRuntimeProcessProjection(
      {
        instanceId: aggregate.snapshot.directContainer.instanceId,
        deploymentId: aggregate.snapshot.deploymentId,
        processManager: "direct_container",
        pm2Name: null,
        port: null,
        controlEndpoint: aggregate.snapshot.directContainer.controlEndpoint,
        advertisedEndpoint: aggregate.snapshot.directContainer.advertisedEndpoint,
      },
      {
        ...observation({
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
        }),
      },
    );

    await repositories.deployments.insert(aggregate.snapshot);
    await expect(repositories.processes.upsert(providerA, expected, null)).resolves.toBe(true);
    await expect(
      repositories.deployments.get(providerA, aggregate.snapshot.deploymentId),
    ).resolves.toMatchObject({ snapshot: aggregate.snapshot });
    await expect(repositories.processes.get(providerA, expected.instanceId)).resolves.toMatchObject(
      {
        processManager: "direct_container",
        pm2Name: null,
        port: null,
        controlEndpoint: "http://ugv-runtime:8080",
        advertisedEndpoint: "http://192.168.1.7:19100",
        configState: "externally_managed",
      },
    );

    const raw = await pool.query<{
      database_profile_id: string | null;
      config_profile_id: string | null;
      pm2_name: string | null;
      port: number | null;
    }>(
      `SELECT deployment.database_profile_id,deployment.config_profile_id,
              process.pm2_name,process.port
         FROM runtime_deployment deployment
         JOIN runtime_process process USING (deployment_id)
        WHERE deployment.deployment_id=$1`,
      [aggregate.snapshot.deploymentId],
    );
    expect(raw.rows).toEqual([
      { database_profile_id: null, config_profile_id: null, pm2_name: null, port: null },
    ]);
  });

  it("appends action history idempotently and rejects key reuse with different content", async () => {
    const repositories = postgresRuntimeDeploymentRepositories(pool);
    const aggregate = deployment("deployment-action", providerA);
    await repositories.deployments.insert(aggregate.snapshot);
    const action = deploymentAction(aggregate.snapshot.deploymentId);

    await expect(repositories.actions.append(providerA, action)).resolves.toBe(true);
    await expect(repositories.actions.append(providerA, action)).resolves.toBe(false);
    await expect(
      repositories.actions.append(providerA, {
        ...action,
        actionId: randomUUID(),
        correlationId: "request-different",
      }),
    ).rejects.toMatchObject({ code: "ENTITY_ALREADY_EXISTS" });
    expect(
      await repositories.actions.listByDeployment(providerA, aggregate.snapshot.deploymentId),
    ).toEqual([action]);
    expect(
      await repositories.actions.listByDeployment(providerB, aggregate.snapshot.deploymentId),
    ).toEqual([]);
  });

  it("commits or rolls back deployment, process, and action changes as one transaction", async () => {
    const unitOfWork = new PostgresRuntimeDeploymentUnitOfWork(pool);
    const committed = deployment("deployment-committed", providerA);
    await unitOfWork.transaction(async (repositories) => {
      await repositories.deployments.insert(committed.snapshot);
      await repositories.processes.upsert(providerA, processProjection(committed), null);
      await repositories.actions.append(
        providerA,
        deploymentAction(committed.snapshot.deploymentId),
      );
    });
    const committedRepositories = postgresRuntimeDeploymentRepositories(pool);
    expect(
      await committedRepositories.deployments.get(providerA, committed.snapshot.deploymentId),
    ).not.toBeNull();
    expect(
      await committedRepositories.processes.listByDeployment(
        providerA,
        committed.snapshot.deploymentId,
      ),
    ).toHaveLength(1);

    const rolledBack = deployment("deployment-rolled-back", providerA);
    await expect(
      unitOfWork.transaction(async (repositories) => {
        await repositories.deployments.insert(rolledBack.snapshot);
        await repositories.actions.append(
          providerA,
          deploymentAction(rolledBack.snapshot.deploymentId),
        );
        throw new Error("ROLL_BACK_RUNTIME_DEPLOYMENT");
      }),
    ).rejects.toThrow("ROLL_BACK_RUNTIME_DEPLOYMENT");
    expect(
      await committedRepositories.deployments.get(providerA, rolledBack.snapshot.deploymentId),
    ).toBeNull();
  });
});

function deployment(id: string, providerId: typeof providerA): RuntimeDeployment {
  return requestRuntimeDeployment(
    {
      deploymentId: runtimeDeploymentId(id),
      providerId,
      environment,
      desiredState: "running",
      desiredReplicas: 1,
      runtimeVersion: "2.0.0-rc.1",
      databaseProfileId: databaseProfileId(`database-${id}`),
      configProfileId: runtimeConfigProfileId(`config-${id}`),
      adapterEndpoint: "127.0.0.1:50051",
    },
    now,
  );
}

function processProjection(deployment: RuntimeDeployment) {
  return createRuntimeProcessProjection(
    {
      instanceId: runtimeInstanceId(`${deployment.snapshot.deploymentId}:instance-01`),
      deploymentId: deployment.snapshot.deploymentId,
      pm2Name: `sdar-runtime-production-${deployment.snapshot.deploymentId.replaceAll("_", "-")}`,
      port: 31_000 + deployment.snapshot.deploymentId.length,
    },
    observation(),
  );
}

function observation(
  overrides: Partial<RuntimeProcessObservation> = {},
): RuntimeProcessObservation {
  return {
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
  };
}

function deploymentAction(deploymentId: string): RuntimeDeploymentAction {
  return {
    actionId: randomUUID(),
    deploymentId,
    actionType: "START",
    idempotencyKey: `${deploymentId}:start:0`,
    status: "succeeded",
    expectedRevision: 0,
    resultingRevision: 1,
    resultDetails: { processState: "online" },
    actorId: "admin-1",
    correlationId: `${deploymentId}:request`,
    occurredAt: now,
    completedAt: now,
  };
}

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("TEST_DATABASE_URL is required");
  return value;
}
