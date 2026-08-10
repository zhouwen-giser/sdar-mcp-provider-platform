import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { canonicalize } from "../../../packages/catalog-manager/src/index.js";
import { PostgresRegistrySnapshotRepository } from "../../../packages/pms-persistence-postgres/src/index.js";
import type { RegistrySnapshotDocument } from "../../../packages/registry-snapshot/src/index.js";

export const PMS_CONSOLE_REAL_E2E = Object.freeze({
  apiHost: "127.0.0.1",
  apiPort: 18_090,
  webHost: "127.0.0.1",
  webPort: 4_176,
  environment: "production",
  providerTypeId: "test.fixture",
  providerId: "pms-e2e-provider",
  resourceId: "pms-e2e-resource",
  deploymentId: "pms-e2e-deployment",
  instanceId: "pms-e2e-instance",
  configurationDraftId: "pms-e2e-draft",
  configurationDefinitionId: "runtime.observability",
  registryCorrelationId: "pms-gate-f-registry-4",
});

export interface PmsApiCredentialFixture {
  readonly root: string;
  readonly databaseUrlFile: string;
  readonly managementDescriptor: string;
  readonly runtimeDescriptor: string;
}

export interface IsolatedPmsDatabase {
  readonly schema: string;
  readonly connectionString: string;
  readonly pool: Pool;
  readonly credentials: PmsApiCredentialFixture;
  cleanup(): Promise<void>;
}

export async function createIsolatedPmsDatabase(
  adminConnectionString: string,
): Promise<IsolatedPmsDatabase> {
  const schema = `pms_web_e2e_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: adminConnectionString });
  let pool: Pool | undefined;
  let credentials: PmsApiCredentialFixture | undefined;
  let schemaCreated = false;

  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    const connectionString = withSearchPath(adminConnectionString, schema);
    pool = new Pool({ connectionString });
    credentials = await createCredentialFixture(connectionString);
    let cleaned = false;
    return {
      schema,
      connectionString,
      pool,
      credentials,
      async cleanup() {
        if (cleaned) return;
        cleaned = true;
        await pool?.end().catch(() => undefined);
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
        await admin.end().catch(() => undefined);
        if (credentials !== undefined) {
          await rm(credentials.root, { force: true, recursive: true }).catch(() => undefined);
        }
      },
    };
  } catch (error) {
    await pool?.end().catch(() => undefined);
    if (schemaCreated) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    }
    await admin.end().catch(() => undefined);
    if (credentials !== undefined) {
      await rm(credentials.root, { force: true, recursive: true }).catch(() => undefined);
    }
    throw error;
  }
}

export async function seedSyntheticConsoleData(pool: Pool, app: FastifyInstance): Promise<void> {
  const fixture = PMS_CONSOLE_REAL_E2E;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO provider_type(provider_type_id,display_name,status)
       VALUES ($1,'PMS E2E Synthetic Fixture','active')`,
      [fixture.providerTypeId],
    );
    await client.query(
      `INSERT INTO provider(
         provider_id,provider_type_id,hosting_mode,adapter_endpoint,status
       ) VALUES ($1,$2,'vendor_managed',NULL,'draft')`,
      [fixture.providerId, fixture.providerTypeId],
    );
    await client.query(
      `INSERT INTO resource(environment,resource_id,resource_type,metadata,status)
       VALUES ($1,$2,'test.fixture',$3::jsonb,'available')`,
      [
        fixture.environment,
        fixture.resourceId,
        JSON.stringify({ displayName: "PMS E2E Synthetic Resource", synthetic: true }),
      ],
    );
    await client.query(
      `INSERT INTO runtime_deployment(
         deployment_id,provider_id,environment,desired_state,desired_replicas,
         runtime_version,database_profile_id,config_profile_id,adapter_endpoint,
         status,desired_revision,observed_revision
       ) VALUES (
         $1,$2,$3,'stopped',0,'2.0.0','pms-e2e-db-unused',
         $4,NULL,'STOPPED',0,0
       )`,
      [
        fixture.deploymentId,
        fixture.providerId,
        fixture.environment,
        `${fixture.environment}:runtime_deployment:${fixture.deploymentId}:runtime:process`,
      ],
    );
    await client.query(
      `INSERT INTO runtime_process(
         runtime_instance_id,deployment_id,environment,pm2_name,pid,port,
         process_state,liveness_state,readiness_state,registration_state,catalog_state,
         config_state,last_heartbeat_at,runtime_version,config_revision,restart_count,
         observed_revision
       ) VALUES (
         $1,$2,$3,'sdar-runtime-production-pms-e2e-1',NULL,41999,
         'stopped','unknown','unknown','unregistered','unknown','unknown',NULL,
         '2.0.0',0,0,0
       )`,
      [fixture.instanceId, fixture.deploymentId, fixture.environment],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const registry = new PostgresRegistrySnapshotRepository(pool);
  await publishRegistryDocument(
    registry,
    { environment: fixture.environment, providers: [] },
    "pms-gate-f-registry-1",
    new Date("2026-08-10T07:58:00.000Z"),
  );
  await publishRegistryDocument(
    registry,
    {
      environment: fixture.environment,
      providers: [syntheticRegistryProvider(1, [])],
    },
    "pms-gate-f-registry-2",
    new Date("2026-08-10T07:59:00.000Z"),
  );
  await publishRegistryDocument(
    registry,
    {
      environment: fixture.environment,
      providers: [syntheticRegistryProvider(2, [syntheticReadOnlyTool("pms.e2e/readOnly-v1")])],
    },
    "pms-gate-f-registry-3",
    new Date("2026-08-10T08:00:00.000Z"),
  );
  await publishRegistryDocument(
    registry,
    {
      environment: fixture.environment,
      providers: [
        syntheticRegistryProvider(3, [
          syntheticReadOnlyTool("pms.e2e/readOnly-v1"),
          syntheticReadOnlyTool("pms.e2e/readOnly-v2"),
        ]),
      ],
    },
    fixture.registryCorrelationId,
    new Date("2026-08-10T08:01:00.000Z"),
  );

  const draft = await app.inject({
    method: "POST",
    url: "/api/console/v1/configuration-drafts",
    headers: {
      "x-actor-id": "pms-gate-f-bootstrap",
      "x-correlation-id": "pms-gate-f-configuration-bootstrap",
    },
    payload: {
      draftId: fixture.configurationDraftId,
      definitionId: fixture.configurationDefinitionId,
      environment: fixture.environment,
      targetType: "runtime_deployment",
      targetId: fixture.deploymentId,
      configGroup: "runtime.observability",
      dataId: "read-only-ui",
      content: { LOG_LEVEL: "info", OTEL_ENABLED: false },
    },
  });
  if (draft.statusCode !== 201) {
    throw new Error(`PMS_WEB_E2E_CONFIGURATION_SEED_FAILED:${draft.statusCode}`);
  }

  await assertNoRuntimeJobs(pool);
}

function syntheticRegistryProvider(
  catalogRevision: number,
  tools: RegistrySnapshotDocument["providers"][number]["tools"],
): RegistrySnapshotDocument["providers"][number] {
  return {
    providerId: PMS_CONSOLE_REAL_E2E.providerId,
    serverId: "pms-e2e-server",
    protocolMode: "frozen_v1",
    effectiveEndpoint: "http://127.0.0.1:1/not-used",
    catalogRevision,
    tools,
  };
}

function syntheticReadOnlyTool(
  name: string,
): RegistrySnapshotDocument["providers"][number]["tools"][number] {
  return {
    name,
    description: "Synthetic read-only Gate F fixture",
    inputSchema: { type: "object", additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: { observed: { type: "boolean" } },
      required: ["observed"],
      additionalProperties: false,
    },
    taskExecution: {
      profileVersion: "1.0",
      taskBehavior: "synchronous_only",
      availability: "not_supported",
      supportsScheduling: false,
      supportsMaxElapsed: false,
      supportsObservations: false,
      supportsInputRequired: false,
      idempotency: "none",
    },
  };
}

export async function assertNoRuntimeJobs(pool: Pool): Promise<void> {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM job_lease",
  );
  if (result.rows[0]?.count !== "0") {
    throw new Error("PMS_WEB_E2E_RUNTIME_JOB_INVARIANT_FAILED");
  }
}

async function publishRegistryDocument(
  repository: PostgresRegistrySnapshotRepository,
  document: RegistrySnapshotDocument,
  correlationId: string,
  publishedAt: Date,
): Promise<void> {
  const canonicalJson = canonicalize(document);
  await repository.publish({
    candidate: {
      document,
      canonicalJson,
      checksum: createHash("sha256").update(canonicalJson).digest("hex"),
    },
    actorId: "pms-gate-f-bootstrap",
    correlationId,
    publishedAt,
  });
}

async function createCredentialFixture(databaseUrl: string): Promise<PmsApiCredentialFixture> {
  const root = await mkdtemp(join(tmpdir(), "pms-web-real-e2e-"));
  await chmod(root, 0o700);
  const databaseUrlFile = join(root, "database-url");
  const managementDescriptor = join(root, "management.json");
  const runtimeDescriptor = join(root, "runtime.json");
  await Promise.all([
    writeSecure(databaseUrlFile, databaseUrl),
    writeSecure(
      managementDescriptor,
      JSON.stringify({ management: { reader: [], administrator: [] } }),
    ),
    writeSecure(runtimeDescriptor, JSON.stringify({ runtimeConfig: [], runtimeRegistration: [] })),
  ]);
  return { root, databaseUrlFile, managementDescriptor, runtimeDescriptor };
}

async function writeSecure(path: string, value: string): Promise<void> {
  await writeFile(path, value, { mode: 0o600 });
  await chmod(path, 0o600);
}

function withSearchPath(connectionString: string, schema: string): string {
  const separator = connectionString.includes("?") ? "&" : "?";
  return `${connectionString}${separator}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
}
