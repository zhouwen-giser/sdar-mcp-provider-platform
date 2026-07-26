import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditEventId,
  configRevisionId,
  createAuditEvent,
  createDatabaseProfile,
  createProvider,
  createProviderPackage,
  createProviderType,
  createResource,
  environmentId,
  providerId,
  providerPackageId,
  providerTypeId,
  resourceId,
  secretRef,
  type ConfigurationDefinition,
} from "@sdar/pms-domain";
import {
  PostgresDatabaseProfileRepository,
  PostgresPmsUnitOfWork,
  postgresRepositories,
  runPmsMigrations,
} from "../src/index.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const providerType = providerTypeId("isr.vehicle.ugv");
const packageId = providerPackageId("builtin.isr.vehicle.ugv");
const provider = providerId("ugv-provider-1");
const environment = environmentId("production");
const resource = resourceId("vehicle:ugv-1");

describe("PostgreSQL PMS persistence", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const schema = `pms_persistence_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    await runPmsMigrations(pool, workspaceRoot);
    await runPmsMigrations(pool, workspaceRoot);
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("persists Provider catalog, Resource inventory, and N:N bindings with parameters", async () => {
    const repositories = postgresRepositories(pool);
    await repositories.providerTypes.save(
      createProviderType({
        providerTypeId: providerType,
        displayName: "UGV's control",
        status: "active",
      }),
      { mode: "insert" },
    );
    await repositories.providerPackages.save(
      createProviderPackage({
        packageId,
        packageVersion: "1.0.0",
        providerTypeId: providerType,
        hostingModes: ["vendor_managed", "platform_managed"],
        checksum: "a".repeat(64),
        status: "available",
      }),
      { mode: "insert" },
    );
    await repositories.providers.insert(
      createProvider({
        providerId: provider,
        providerTypeId: providerType,
        packageId,
        packageVersion: "1.0.0",
      }),
    );
    await repositories.resources.insert(
      createResource({
        environment,
        resourceId: resource,
        resourceType: "ugv",
        metadata: { label: "Unit 'One'" },
        status: "available",
      }),
    );
    await repositories.providerResourceBindings.bind({
      providerId: provider,
      environment,
      resourceId: resource,
      boundAt: now(),
    });

    expect(await repositories.providerTypes.get(providerType)).toMatchObject({
      displayName: "UGV's control",
    });
    expect(await repositories.providers.get(provider)).toMatchObject({
      packageId,
      packageVersion: "1.0.0",
      hostingMode: "vendor_managed",
    });
    expect(await repositories.resources.get({ environment, resourceId: resource })).toMatchObject({
      metadata: { label: "Unit 'One'" },
    });
    expect(await repositories.providerResourceBindings.listByProvider(provider)).toHaveLength(1);
  });

  it("maps unique violations and stale updates to stable domain errors", async () => {
    const repositories = postgresRepositories(pool);
    await expect(
      repositories.providers.insert(
        createProvider({ providerId: provider, providerTypeId: providerType }),
      ),
    ).rejects.toMatchObject({ code: "ENTITY_ALREADY_EXISTS" });

    const timestamp = await pool.query<{ updated_at: Date }>(
      "SELECT updated_at FROM provider WHERE provider_id=$1",
      [provider],
    );
    const expectedUpdatedAt = timestamp.rows[0]?.updated_at;
    if (expectedUpdatedAt === undefined) throw new Error("PROVIDER_TIMESTAMP_NOT_RETURNED");
    await repositories.providers.update(
      createProvider({ providerId: provider, providerTypeId: providerType, status: "disabled" }),
      { expectedUpdatedAt },
    );
    await expect(
      repositories.providers.update(
        createProvider({ providerId: provider, providerTypeId: providerType, status: "active" }),
        { expectedUpdatedAt },
      ),
    ).rejects.toMatchObject({ code: "OPTIMISTIC_CONCURRENCY_CONFLICT" });
  });

  it("persists Provider/Environment-scoped DatabaseProfile refs and audited provision results", async () => {
    const repository = new PostgresDatabaseProfileRepository(pool);
    await pool.query(
      `INSERT INTO provider_type(provider_type_id,display_name,status)
       VALUES ($1,'UGV','active') ON CONFLICT (provider_type_id) DO NOTHING`,
      [providerType],
    );
    await pool.query(
      `INSERT INTO provider(provider_id,provider_type_id,hosting_mode,status)
       VALUES ($1,$2,'vendor_managed','active') ON CONFLICT (provider_id) DO NOTHING`,
      [provider, providerType],
    );
    const auditIds = [
      "21111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "23333333-3333-4333-8333-333333333333",
    ];
    for (const [index, auditId] of auditIds.entries()) {
      await pool.query(
        `INSERT INTO audit(
           audit_event_id,action,actor_id,correlation_id,subject_type,subject_id
         ) VALUES ($1,$2,'admin-1',$3,'database_profile','database-profile-1')`,
        [
          auditId,
          index === 0 ? "database_profile.created" : "database_profile.provision_updated",
          `database-profile-${index}`,
        ],
      );
    }
    const profile = createDatabaseProfile({
      profileId: "database-profile-1",
      providerId: provider,
      environment,
      clusterRef: "postgres-primary",
      host: "postgres.internal",
      adminSecretRef: secretRef("vault/postgres/provisioner"),
      runtimeSecretRef: secretRef("vault/runtime/ugv-provider-1"),
    });
    await repository.insert(profile, auditIds[0] as string);

    expect(await repository.get(provider, environment)).toMatchObject({
      profile: {
        providerId: provider,
        environment,
        databaseName: profile.databaseName,
        runtimeRoleName: profile.runtimeRoleName,
        adminSecretRef: { secretRef: "vault/postgres/provisioner" },
        runtimeSecretRef: { secretRef: "vault/runtime/ugv-provider-1" },
      },
      provisionStatus: "pending",
      createdAuditEventId: auditIds[0],
      revision: 0,
    });
    expect(await repository.get("another-provider", environment)).toBeNull();
    expect(await repository.get(provider, "staging")).toBeNull();

    const provisioning = await repository.updateProvisionResult({
      profileId: profile.profileId,
      providerId: provider,
      environment,
      status: "provisioning",
      auditEventId: auditIds[1] as string,
      expectedRevision: 0,
    });
    const ready = await repository.updateProvisionResult({
      profileId: profile.profileId,
      providerId: provider,
      environment,
      status: "ready",
      provisionedAt: new Date("2026-07-26T00:00:00.000Z"),
      auditEventId: auditIds[2] as string,
      expectedRevision: provisioning.revision,
    });
    expect(ready).toMatchObject({
      provisionStatus: "ready",
      lastAuditEventId: auditIds[2],
      revision: 2,
    });
    await expect(
      repository.updateProvisionResult({
        profileId: profile.profileId,
        providerId: provider,
        environment,
        status: "failed",
        lastErrorCode: "DATABASE_UNAVAILABLE",
        auditEventId: auditIds[2] as string,
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ code: "OPTIMISTIC_CONCURRENCY_CONFLICT" });

    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name='database_profile'
        ORDER BY ordinal_position`,
    );
    expect(columns.rows.map(({ column_name }) => column_name)).toEqual(
      expect.arrayContaining(["admin_secret_ref", "runtime_secret_ref"]),
    );
    expect(
      columns.rows
        .map(({ column_name }) => column_name)
        .filter((name) => /password|credential|connection|database_url/i.test(name)),
    ).toEqual([]);
  });

  it("commits and rolls back one shared Unit of Work", async () => {
    const unitOfWork = new PostgresPmsUnitOfWork(pool);
    const rolledBackId = providerTypeId("isr.vehicle.rollback");
    const committedId = providerTypeId("isr.vehicle.committed");

    await unitOfWork.transaction(async (repositories) => {
      await repositories.providerTypes.save(
        createProviderType({
          providerTypeId: committedId,
          displayName: "Committed",
          status: "active",
        }),
        { mode: "insert" },
      );
    });

    await expect(
      unitOfWork.transaction(async (repositories) => {
        await repositories.providerTypes.save(
          createProviderType({
            providerTypeId: rolledBackId,
            displayName: "Rollback",
            status: "active",
          }),
          { mode: "insert" },
        );
        throw new Error("ROLL_BACK");
      }),
    ).rejects.toThrow("ROLL_BACK");

    expect(await postgresRepositories(pool).providerTypes.get(committedId)).not.toBeNull();
    expect(await postgresRepositories(pool).providerTypes.get(rolledBackId)).toBeNull();
  });

  it("creates revisions with an optimistic latest-revision precondition and stores Ack", async () => {
    const repository = postgresRepositories(pool).configuration;
    const target = {
      environment,
      targetType: "provider" as const,
      targetId: provider,
      configGroup: "provider.ugv",
      dataId: "runtime",
    };
    const definition: ConfigurationDefinition = {
      definitionId: randomUUID(),
      target,
      schema: { type: "object" },
      defaultContent: {},
      secretPaths: [],
      fieldMetadata: {},
      status: "active",
    };
    await repository.saveDefinition(definition, { mode: "insert" });
    const revision = await repository.createRevision(
      {
        revisionId: configRevisionId(randomUUID()),
        target,
        checksum: "b".repeat(64),
        applyMode: "restart_required",
        content: { OTEL_ENABLED: false },
        createdBy: "admin-1",
        createdAt: now(),
      },
      { expectedRevision: null },
    );

    await expect(
      repository.createRevision(
        {
          revisionId: configRevisionId(randomUUID()),
          target,
          checksum: "c".repeat(64),
          applyMode: "restart_required",
          content: {},
          createdBy: "admin-1",
          createdAt: now(),
        },
        { expectedRevision: null },
      ),
    ).rejects.toMatchObject({ code: "OPTIMISTIC_CONCURRENCY_CONFLICT" });

    const validated = await repository.transitionRevision(
      revision.revisionId,
      "validated",
      "draft",
    );
    const published = await repository.transitionRevision(
      validated.revisionId,
      "published",
      "validated",
    );
    await repository.appendAck({
      ackId: randomUUID(),
      revisionId: published.revisionId,
      runtimeInstanceId: "runtime-1",
      status: "restart_required",
      details: {},
      acknowledgedAt: now(),
    });

    expect((await repository.listAcks(published.revisionId, { limit: 10 })).items).toHaveLength(1);
    expect(await repository.getPublishedRevision(target)).toMatchObject({ revision: 1 });
  });

  it("appends Audit and claims fenced jobs without Runtime tables", async () => {
    const repositories = postgresRepositories(pool);
    await repositories.audit.append(
      createAuditEvent({
        auditEventId: auditEventId(randomUUID()),
        action: "provider.created",
        actorId: "admin-1",
        correlationId: "request-1",
        subjectType: "provider",
        subjectId: provider,
        occurredAt: now(),
        metadata: {},
      }),
    );
    await repositories.jobs.enqueue({
      jobId: "job-1",
      jobType: "config.publish",
      payload: { revision: 1 },
    });
    const leases = await repositories.jobs.claim({
      owner: "worker-1",
      jobTypes: ["config.publish"],
      limit: 1,
      leaseDurationMs: 30_000,
    });

    expect(
      (await repositories.audit.list({ correlationId: "request-1", limit: 10 })).items,
    ).toHaveLength(1);
    expect(leases).toHaveLength(1);
    expect(leases[0]?.fencingToken).toBe(1n);

    const runtimeTables = await pool.query(
      `SELECT tablename FROM pg_tables
        WHERE schemaname=$1 AND tablename=ANY($2::text[])`,
      [schema, ["provider_task", "task_command", "task_observation", "runtime_schema_migration"]],
    );
    expect(runtimeTables.rows).toEqual([]);
  });
});

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("TEST_DATABASE_URL is required");
  return value;
}

function now(): Date {
  return new Date("2026-07-26T00:00:00.000Z");
}
