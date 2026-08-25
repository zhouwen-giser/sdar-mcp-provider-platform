import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  formatRuntimeConfigProfileLocator,
  runtimeDeploymentProfileLocator,
} from "../../../packages/pms-application/src/index.js";
import { PMS_API_FROZEN_PROTOCOL_VERSION, loadPmsApiBootstrapConfig } from "../src/config.js";
import {
  createPmsApiComposition,
  type PmsApiComposition,
  type PmsApiBootstrapConfig,
} from "../src/index.js";

const providerA = "e2e-provider-a";
const providerB = "e2e-provider-b";
const deploymentId = "e2e-deployment";
const instanceId = "e2e-instance";
const databaseProfileId = "e2e-db-profile";
const runtimeVersion = "2.0.0";
const configGroup = "runtime.e2e";
const configDataId = "main";

describe("PMS API production composition", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const schema = `pms_api_production_${randomUUID().replaceAll("-", "")}`;
  const schemaConnectionString = withSearchPath(connectionString, schema);
  let pool: Pool;
  let credentials: CredentialFixture;
  let config: PmsApiBootstrapConfig;
  let composition: PmsApiComposition | undefined;
  let runtimeConfigRevision: PublishedConfig;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    credentials = await createCredentialFixture(schemaConnectionString);
    config = await loadPmsApiBootstrapConfig(bootstrapEnvironment(credentials));
    composition = await createPmsApiComposition(config);

    const migrationRows = await pool.query<{ count: string }>(
      "SELECT count(*) FROM pms_schema_migration",
    );
    expect(migrationRows.rows[0]?.count).toBe("11");

    await seedProvider(pool, providerA);
    await seedProvider(pool, providerB);
    await seedDatabaseProfile(pool);
    await seedDeploymentPrerequisiteConfig(pool, deploymentId);
    runtimeConfigRevision = await seedRuntimeConfig(pool, deploymentId);
  });

  afterAll(async () => {
    await closeComposition();
    await pool.end();
    await rm(credentials.root, { force: true, recursive: true });
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("uses file credentials to expose every Goal 2 route with the production authorization matrix", async () => {
    const app = requiredComposition().app;

    await expect(app.inject({ method: "GET", url: "/health/live" })).resolves.toMatchObject({
      statusCode: 200,
    });
    await expect(app.inject({ method: "GET", url: "/health/ready" })).resolves.toMatchObject({
      statusCode: 200,
    });

    await expect(
      app.inject({ method: "GET", url: deploymentListUrl(providerA) }),
    ).resolves.toMatchObject({ statusCode: 401 });
    await expect(
      app.inject({
        method: "GET",
        url: deploymentListUrl(providerA),
        headers: managementHeaders("wrong-management-token"),
      }),
    ).resolves.toMatchObject({ statusCode: 401 });

    const createInput = deploymentInput(deploymentId);
    await expect(
      app.inject({
        method: "POST",
        url: "/api/v1/runtime-deployments",
        headers: managementHeaders(credentials.tokens.reader, true),
        payload: createInput,
      }),
    ).resolves.toMatchObject({ statusCode: 403 });

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/runtime-deployments",
      headers: managementHeaders(credentials.tokens.administrator, true),
      payload: createInput,
    });
    expect(created.statusCode).toBe(202);
    expect(created.json()).toMatchObject({ deployment: { deploymentId, desiredRevision: 0 } });
    assertSecretSafe(created.body);

    const list = await app.inject({
      method: "GET",
      url: deploymentListUrl(providerA),
      headers: managementHeaders(credentials.tokens.reader),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ items: readonly { deploymentId: string }[] }>().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ deploymentId })]),
    );

    const get = await app.inject({
      method: "GET",
      url: deploymentGetUrl(providerA, deploymentId),
      headers: managementHeaders(credentials.tokens.reader),
    });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toMatchObject({ deploymentId, providerId: providerA });
    await expect(
      app.inject({
        method: "GET",
        url: deploymentGetUrl(providerB, deploymentId),
        headers: managementHeaders(credentials.tokens.reader),
      }),
    ).resolves.toMatchObject({ statusCode: 404 });

    const staleCommand = await app.inject({
      method: "POST",
      url: `/api/v1/runtime-deployments/${deploymentId}/stop`,
      headers: managementHeaders(credentials.tokens.administrator, true),
      payload: { providerId: providerA, expectedDesiredRevision: 99 },
    });
    expect(staleCommand.statusCode).toBe(409);
    const stop = await app.inject({
      method: "POST",
      url: `/api/v1/runtime-deployments/${deploymentId}/stop`,
      headers: managementHeaders(credentials.tokens.administrator, true),
      payload: { providerId: providerA, expectedDesiredRevision: 0 },
    });
    expect(stop.statusCode).toBe(202);

    const deploymentCommit = await pool.query<{
      deployments: string;
      jobs: string;
      audits: string;
    }>(
      `SELECT
         (SELECT count(*) FROM runtime_deployment WHERE deployment_id=$1)::text AS deployments,
         (SELECT count(*) FROM job_lease WHERE payload->>'deploymentId'=$1)::text AS jobs,
         (SELECT count(*) FROM audit WHERE subject_id=$1 AND action='runtime_deployment.created')::text AS audits`,
      [deploymentId],
    );
    expect(deploymentCommit.rows[0]).toEqual({ deployments: "1", jobs: "2", audits: "1" });

    await seedRuntimeProcess(pool, deploymentId, instanceId);
    const processes = await app.inject({
      method: "GET",
      url: processListUrl(),
      headers: managementHeaders(credentials.tokens.reader),
    });
    expect(processes.statusCode).toBe(200);
    expect(processes.json()).toMatchObject({ items: [expect.objectContaining({ instanceId })] });

    const configLatest = await app.inject({
      method: "GET",
      url: runtimeConfigUrl("latest"),
      headers: runtimeHeaders(credentials.tokens.configRead),
    });
    expect(configLatest.statusCode).toBe(200);
    expect(configLatest.json()).toMatchObject({ revisionId: runtimeConfigRevision.revisionId });
    assertSecretSafe(configLatest.body);

    await expect(
      app.inject({
        method: "GET",
        url: runtimeConfigUrl("latest"),
        headers: runtimeHeaders(credentials.tokens.configWatch),
      }),
    ).resolves.toMatchObject({ statusCode: 403 });
    await expect(
      app.inject({
        method: "GET",
        url: runtimeConfigUrl("latest", "other-deployment", instanceId),
        headers: runtimeHeaders(credentials.tokens.configRead),
      }),
    ).resolves.toMatchObject({ statusCode: 403 });
    await expect(
      app.inject({
        method: "GET",
        url: runtimeConfigUrl("latest", deploymentId, "other-instance"),
        headers: runtimeHeaders(credentials.tokens.configRead),
      }),
    ).resolves.toMatchObject({ statusCode: 403 });

    const ack = await app.inject({
      method: "POST",
      url: runtimeConfigUrl(`revisions/${runtimeConfigRevision.revisionId}/acks`),
      headers: runtimeHeaders(credentials.tokens.configAck),
      payload: { status: "applied", appliedChecksum: runtimeConfigRevision.checksum },
    });
    expect(ack.statusCode).toBe(200);
    assertSecretSafe(ack.body);

    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const watch = await fetch(`${address}${runtimeConfigUrl("watch")}`, {
      headers: runtimeHeaders(credentials.tokens.configWatch),
      signal: AbortSignal.timeout(5_000),
    });
    expect(watch.status).toBe(200);
    const reader = watch.body?.getReader();
    if (reader === undefined) throw new Error("PMS_API_E2E_WATCH_STREAM_MISSING");
    const frame = await reader.read();
    await reader.cancel();
    expect(new TextDecoder().decode(frame.value)).toContain("event: revision");
  });

  it("commits RuntimeDeployment, reconcile job, and Audit atomically through the production API", async () => {
    const app = requiredComposition().app;
    const jobFailureDeployment = "e2e-job-rollback";
    await seedDeploymentPrerequisiteConfig(pool, jobFailureDeployment);
    await installFailureTrigger(
      pool,
      "job_lease",
      "e2e_job_failure",
      "RAISE EXCEPTION 'E2E_JOB_FAILURE';",
    );
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/runtime-deployments",
        headers: managementHeaders(credentials.tokens.administrator, true),
        payload: deploymentInput(jobFailureDeployment),
      });
      expect(response.statusCode).toBe(500);
      assertSecretSafe(response.body);
      await expectDeploymentRollback(pool, jobFailureDeployment);
    } finally {
      await removeFailureTrigger(pool, "job_lease", "e2e_job_failure");
    }

    const auditFailureDeployment = "e2e-audit-rollback";
    await seedDeploymentPrerequisiteConfig(pool, auditFailureDeployment);
    await installFailureTrigger(
      pool,
      "audit",
      "e2e_audit_failure",
      "IF NEW.action = 'runtime_deployment.created' THEN RAISE EXCEPTION 'E2E_AUDIT_FAILURE'; END IF;",
    );
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/runtime-deployments",
        headers: managementHeaders(credentials.tokens.administrator, true),
        payload: deploymentInput(auditFailureDeployment),
      });
      expect(response.statusCode).toBe(500);
      assertSecretSafe(response.body);
      await expectDeploymentRollback(pool, auditFailureDeployment);
    } finally {
      await removeFailureTrigger(pool, "audit", "e2e_audit_failure");
    }
  });

  it("routes Console creation through production Application, Job, Audit, and rollback", async () => {
    const app = requiredComposition().app;
    const consoleDeployment = "e2e-console-deployment";
    await seedDeploymentPrerequisiteConfig(pool, consoleDeployment);
    const created = await app.inject({
      method: "POST",
      url: "/api/console/v1/runtime-deployments",
      headers: {
        "x-actor-id": "prototype-user",
        "x-correlation-id": "console-production-create",
      },
      payload: deploymentInput(consoleDeployment),
    });
    expect(created.statusCode).toBe(202);
    expect(created.json()).toMatchObject({
      operationId: "console-production-create",
      deployment: { deploymentId: consoleDeployment },
    });
    const committed = await pool.query<{
      deployments: string;
      jobs: string;
      audits: string;
    }>(
      `SELECT
         (SELECT count(*) FROM runtime_deployment WHERE deployment_id=$1)::text AS deployments,
         (SELECT count(*) FROM job_lease WHERE payload->>'deploymentId'=$1)::text AS jobs,
         (SELECT count(*) FROM audit WHERE subject_id=$1 AND action='runtime_deployment.created')::text AS audits`,
      [consoleDeployment],
    );
    expect(committed.rows[0]).toEqual({ deployments: "1", jobs: "1", audits: "1" });

    const rollbackDeployment = "e2e-console-rollback";
    await seedDeploymentPrerequisiteConfig(pool, rollbackDeployment);
    await installFailureTrigger(
      pool,
      "job_lease",
      "e2e_console_job_failure",
      "RAISE EXCEPTION 'E2E_CONSOLE_JOB_FAILURE';",
    );
    try {
      const failed = await app.inject({
        method: "POST",
        url: "/api/console/v1/runtime-deployments",
        headers: {
          "x-actor-id": "prototype-user",
          "x-correlation-id": "console-production-rollback",
        },
        payload: deploymentInput(rollbackDeployment),
      });
      expect(failed.statusCode).toBe(500);
      expect(failed.headers["content-type"]).toContain("application/problem+json");
      expect(failed.json()).toMatchObject({ code: "INTERNAL_ERROR" });
      await expectDeploymentRollback(pool, rollbackDeployment);
    } finally {
      await removeFailureTrigger(pool, "job_lease", "e2e_console_job_failure");
    }
  });

  it("persists Registration across composition recreation, enforces CAS, and derives freshness", async () => {
    const app = requiredComposition().app;
    const registerBody = registrationBody("e2e-session", 7);

    await expect(
      app.inject({
        method: "POST",
        url: registrationUrl("register"),
        payload: registerBody,
      }),
    ).resolves.toMatchObject({ statusCode: 401 });
    await expect(
      app.inject({
        method: "POST",
        url: registrationUrl("register"),
        headers: runtimeHeaders(credentials.tokens.registrationHeartbeat),
        payload: registerBody,
      }),
    ).resolves.toMatchObject({ statusCode: 403 });
    await expect(
      app.inject({
        method: "POST",
        url: registrationUrl("register"),
        headers: runtimeHeaders(credentials.tokens.registrationRegister),
        payload: { ...registerBody, providerId: providerB },
      }),
    ).resolves.toMatchObject({ statusCode: 403 });
    await expect(
      app.inject({
        method: "POST",
        url: registrationUrl("register", "other-deployment"),
        headers: runtimeHeaders(credentials.tokens.registrationRegister),
        payload: registerBody,
      }),
    ).resolves.toMatchObject({ statusCode: 403 });
    await expect(
      app.inject({
        method: "POST",
        url: registrationUrl("register", deploymentId, "other-instance"),
        headers: runtimeHeaders(credentials.tokens.registrationRegister),
        payload: registerBody,
      }),
    ).resolves.toMatchObject({ statusCode: 403 });

    const registered = await app.inject({
      method: "POST",
      url: registrationUrl("register"),
      headers: runtimeHeaders(credentials.tokens.registrationRegister),
      payload: registerBody,
    });
    expect(registered.statusCode).toBe(200);
    expect(registered.json()).toMatchObject({
      outcome: "created",
      registration: { sessionId: "e2e-session", heartbeatSequence: 0, revision: 0 },
    });
    const duplicateRegister = await app.inject({
      method: "POST",
      url: registrationUrl("register"),
      headers: runtimeHeaders(credentials.tokens.registrationRegister),
      payload: registerBody,
    });
    expect(duplicateRegister.json()).toMatchObject({ outcome: "unchanged" });

    const heartbeatOne = await app.inject({
      method: "POST",
      url: registrationUrl("heartbeat"),
      headers: runtimeHeaders(credentials.tokens.registrationHeartbeat),
      payload: { ...registerBody, configRevision: 8, sequence: 1 },
    });
    expect(heartbeatOne.statusCode).toBe(200);
    expect(heartbeatOne.json()).toMatchObject({
      outcome: "updated",
      registration: { heartbeatSequence: 1, revision: 1 },
    });
    const duplicateHeartbeat = await app.inject({
      method: "POST",
      url: registrationUrl("heartbeat"),
      headers: runtimeHeaders(credentials.tokens.registrationHeartbeat),
      payload: { ...registerBody, configRevision: 8, sequence: 1 },
    });
    expect(duplicateHeartbeat.json()).toMatchObject({ outcome: "unchanged" });
    const replayConflict = await app.inject({
      method: "POST",
      url: registrationUrl("heartbeat"),
      headers: runtimeHeaders(credentials.tokens.registrationHeartbeat),
      payload: { ...registerBody, configRevision: 9, sequence: 1 },
    });
    expect(replayConflict.statusCode).toBe(409);
    expect(replayConflict.json()).toMatchObject({
      error: { code: "RUNTIME_REGISTRATION_REPLAY_CONFLICT" },
    });

    await closeComposition();
    composition = await createPmsApiComposition(config);
    const restoredHeartbeat = await requiredComposition().app.inject({
      method: "POST",
      url: registrationUrl("heartbeat"),
      headers: runtimeHeaders(credentials.tokens.registrationHeartbeat),
      payload: { ...registerBody, configRevision: 9, sequence: 2 },
    });
    expect(restoredHeartbeat.statusCode).toBe(200);
    expect(restoredHeartbeat.json()).toMatchObject({
      outcome: "updated",
      registration: { sessionId: "e2e-session", heartbeatSequence: 2, revision: 2 },
    });

    const durable = await pool.query<{
      session_id: string;
      heartbeat_sequence: string;
      revision: string;
      expires_at: Date;
      observed_revision: string;
      pid: number;
      port: number;
      process_state: string;
      liveness_state: string;
      catalog_state: string;
      restart_count: number;
    }>(
      `SELECT reg.session_id,reg.heartbeat_sequence,reg.revision,reg.expires_at,
              process.observed_revision,process.pid,process.port,process.process_state,
              process.liveness_state,process.catalog_state,process.restart_count
         FROM runtime_registration reg
         JOIN runtime_process process
           ON process.deployment_id=reg.deployment_id
          AND process.runtime_instance_id=reg.runtime_instance_id
        WHERE reg.deployment_id=$1 AND reg.runtime_instance_id=$2`,
      [deploymentId, instanceId],
    );
    expect(durable.rows[0]).toMatchObject({
      session_id: "e2e-session",
      heartbeat_sequence: "2",
      revision: "2",
      observed_revision: "3",
      pid: 4242,
      port: 31234,
      process_state: "online",
      liveness_state: "live",
      catalog_state: "valid",
      restart_count: 5,
    });
    expect(durable.rows[0]?.expires_at.getTime()).toBeGreaterThan(Date.now());

    await installFailureTrigger(
      pool,
      "runtime_registration",
      "e2e_registration_cas",
      "RETURN NULL;",
    );
    try {
      const conflict = await requiredComposition().app.inject({
        method: "POST",
        url: registrationUrl("heartbeat"),
        headers: runtimeHeaders(credentials.tokens.registrationHeartbeat),
        payload: { ...registerBody, configRevision: 10, sequence: 3 },
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json()).toMatchObject({
        error: { code: "RUNTIME_REGISTRATION_REPLAY_CONFLICT" },
      });
    } finally {
      await removeFailureTrigger(pool, "runtime_registration", "e2e_registration_cas");
    }

    await installFirstProjectionConflict(pool, "e2e_projection_once", "e2e_projection_once_seq");
    try {
      const retried = await requiredComposition().app.inject({
        method: "POST",
        url: registrationUrl("heartbeat"),
        headers: runtimeHeaders(credentials.tokens.registrationHeartbeat),
        payload: { ...registerBody, configRevision: 10, sequence: 3 },
      });
      expect(retried.statusCode).toBe(200);
      expect(retried.json()).toMatchObject({
        outcome: "updated",
        registration: { heartbeatSequence: 3, revision: 3 },
      });
    } finally {
      await removeFailureTrigger(
        pool,
        "runtime_process",
        "e2e_projection_once",
        "e2e_projection_once_seq",
      );
    }

    await installFailureTrigger(pool, "runtime_process", "e2e_projection_always", "RETURN NULL;");
    try {
      const projectionConflict = await requiredComposition().app.inject({
        method: "POST",
        url: registrationUrl("heartbeat"),
        headers: runtimeHeaders(credentials.tokens.registrationHeartbeat),
        payload: { ...registerBody, configRevision: 11, sequence: 4 },
      });
      expect(projectionConflict.statusCode).toBe(409);
      expect(projectionConflict.json()).toMatchObject({
        error: { code: "RUNTIME_REGISTRATION_PROJECTION_CONFLICT" },
      });
    } finally {
      await removeFailureTrigger(pool, "runtime_process", "e2e_projection_always");
    }

    const successAudits = await pool.query<{ count: string }>(
      `SELECT count(*) FROM audit
        WHERE subject_id=$1 AND action IN ('runtime.register','runtime.heartbeat')
          AND metadata->>'outcome' IN ('created','updated')`,
      [`${deploymentId}:${instanceId}`],
    );
    expect(Number(successAudits.rows[0]?.count)).toBeGreaterThanOrEqual(4);

    const registeredProcess = await requiredComposition().app.inject({
      method: "GET",
      url: processListUrl(),
      headers: managementHeaders(credentials.tokens.reader),
    });
    expect(registeredProcess.statusCode).toBe(200);
    expect(registeredProcess.json()).toMatchObject({
      items: [expect.objectContaining({ registrationFreshness: "registered" })],
    });

    await pool.query(
      `UPDATE runtime_registration
          SET registered_at=clock_timestamp() - interval '3 seconds',
              last_heartbeat_at=clock_timestamp() - interval '2 seconds',
              expires_at=clock_timestamp() - interval '1 second'
        WHERE runtime_instance_id=$1`,
      [instanceId],
    );
    const stale = await requiredComposition().app.inject({
      method: "GET",
      url: processListUrl(),
      headers: managementHeaders(credentials.tokens.reader),
    });
    expect(stale.json()).toMatchObject({
      items: [expect.objectContaining({ registrationFreshness: "stale" })],
    });

    await closeComposition();
    composition = await createPmsApiComposition(config);
    const restoredStale = await requiredComposition().app.inject({
      method: "GET",
      url: processListUrl(),
      headers: managementHeaders(credentials.tokens.reader),
    });
    expect(restoredStale.json()).toMatchObject({
      items: [expect.objectContaining({ registrationFreshness: "stale" })],
    });

    await closeComposition();
    await pool.query("DELETE FROM runtime_process WHERE runtime_instance_id=$1", [instanceId]);
    const cascaded = await pool.query<{ count: string }>(
      "SELECT count(*) FROM runtime_registration WHERE runtime_instance_id=$1",
      [instanceId],
    );
    expect(cascaded.rows[0]?.count).toBe("0");
  });

  async function closeComposition(): Promise<void> {
    if (composition === undefined) return;
    const value = composition;
    composition = undefined;
    await value.close();
    await value.close();
  }

  function requiredComposition(): PmsApiComposition {
    if (composition === undefined) throw new Error("PMS_API_E2E_COMPOSITION_MISSING");
    return composition;
  }
});

interface CredentialFixture {
  readonly root: string;
  readonly managementDescriptor: string;
  readonly runtimeDescriptor: string;
  readonly databaseUrlFile: string;
  readonly tokens: {
    readonly reader: string;
    readonly administrator: string;
    readonly configRead: string;
    readonly configWatch: string;
    readonly configAck: string;
    readonly registrationRegister: string;
    readonly registrationHeartbeat: string;
  };
}

interface PublishedConfig {
  readonly revisionId: string;
  readonly checksum: string;
}

async function createCredentialFixture(databaseUrl: string): Promise<CredentialFixture> {
  const root = await mkdtemp(join(tmpdir(), "pms-api-production-"));
  const tokens = {
    reader: "e2e-management-reader-token",
    administrator: "e2e-management-administrator-token",
    configRead: "e2e-runtime-config-read-token",
    configWatch: "e2e-runtime-config-watch-token",
    configAck: "e2e-runtime-config-ack-token",
    registrationRegister: "e2e-runtime-registration-register-token",
    registrationHeartbeat: "e2e-runtime-registration-heartbeat-token",
  };
  const paths = Object.fromEntries(
    await Promise.all(
      Object.entries(tokens).map(async ([name, token]) => {
        const path = join(root, `${name}.token`);
        await writeSecure(path, token);
        return [name, path] as const;
      }),
    ),
  ) as Record<keyof typeof tokens, string>;
  const managementDescriptor = join(root, "management.json");
  const runtimeDescriptor = join(root, "runtime.json");
  const databaseUrlFile = join(root, "database-url");

  await writeSecure(databaseUrlFile, databaseUrl);
  await writeSecure(
    managementDescriptor,
    JSON.stringify({
      management: {
        reader: [{ subjectId: "e2e-reader", tokenFile: paths.reader }],
        administrator: [{ subjectId: "e2e-administrator", tokenFile: paths.administrator }],
      },
    }),
  );
  await writeSecure(
    runtimeDescriptor,
    JSON.stringify({
      runtimeConfig: [
        runtimeConfigCredential("e2e-config-read", paths.configRead, ["runtime:config:read"]),
        runtimeConfigCredential("e2e-config-watch", paths.configWatch, ["runtime:config:watch"]),
        runtimeConfigCredential("e2e-config-ack", paths.configAck, ["runtime:config:ack"]),
      ],
      runtimeRegistration: [
        runtimeRegistrationCredential("e2e-register", paths.registrationRegister, [
          "runtime:register",
        ]),
        runtimeRegistrationCredential("e2e-heartbeat", paths.registrationHeartbeat, [
          "runtime:heartbeat",
        ]),
      ],
    }),
  );
  return { root, managementDescriptor, runtimeDescriptor, databaseUrlFile, tokens };
}

function bootstrapEnvironment(fixture: CredentialFixture): NodeJS.ProcessEnv {
  return {
    PMS_API_HOST: "127.0.0.1",
    PMS_API_PORT: "8090",
    PMS_API_RUNTIME_HEARTBEAT_TTL_MS: "30000",
    PMS_DATABASE_URL_FILE: fixture.databaseUrlFile,
    PMS_MANAGEMENT_CREDENTIAL_FILE: fixture.managementDescriptor,
    PMS_RUNTIME_CREDENTIAL_FILE: fixture.runtimeDescriptor,
  };
}

function runtimeConfigCredential(subjectId: string, tokenFile: string, scopes: readonly string[]) {
  return {
    subjectId,
    providerId: providerA,
    deploymentId,
    instanceId,
    environment: "production",
    runtimeVersion,
    protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    scopes,
    tokenFile,
  };
}

function runtimeRegistrationCredential(
  subjectId: string,
  tokenFile: string,
  scopes: readonly string[],
) {
  return {
    subjectId,
    providerId: providerA,
    deploymentId,
    instanceId,
    runtimeVersion,
    protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    scopes,
    tokenFile,
  };
}

async function writeSecure(path: string, value: string): Promise<void> {
  await writeFile(path, value, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function seedProvider(pool: Pool, providerId: string): Promise<void> {
  await pool.query(
    `INSERT INTO provider_type(provider_type_id,display_name,status)
     VALUES ('isr.vehicle.ugv','UGV','active')
     ON CONFLICT (provider_type_id) DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO provider(provider_id,provider_type_id,hosting_mode,status)
     VALUES ($1,'isr.vehicle.ugv','vendor_managed','active')`,
    [providerId],
  );
}

async function seedDatabaseProfile(pool: Pool): Promise<void> {
  const auditEventId = randomUUID();
  await pool.query(
    `INSERT INTO audit(audit_event_id,action,actor_id,correlation_id,subject_type,subject_id,occurred_at,metadata)
     VALUES ($1,'database_profile.created','e2e-admin','e2e-seed','database_profile',$2,clock_timestamp(),'{}')`,
    [auditEventId, databaseProfileId],
  );
  await pool.query(
    `INSERT INTO database_profile(
       profile_id,provider_id,environment,cluster_ref,host,port,database_mode,
       database_name,runtime_role_name,ssl_mode,admin_secret_ref,runtime_secret_ref,
       provision_status,last_error_code,provisioned_at,created_audit_event_id,last_audit_event_id
     ) VALUES (
       $1,$2,'production','e2e-cluster','localhost',5432,'preexisting',
       'e2e_runtime_db','e2e_runtime_role','disable','secret:e2e-admin','secret:e2e-runtime',
       'ready',NULL,clock_timestamp(),$3,$3
     )`,
    [databaseProfileId, providerA, auditEventId],
  );
}

async function seedDeploymentPrerequisiteConfig(pool: Pool, targetId: string): Promise<void> {
  await seedPublishedConfig(pool, "runtime", "process", targetId, "{}");
}

async function seedRuntimeConfig(pool: Pool, targetId: string): Promise<PublishedConfig> {
  return seedPublishedConfig(pool, configGroup, configDataId, targetId, '{"FEATURE_ENABLED":true}');
}

async function seedPublishedConfig(
  pool: Pool,
  group: string,
  dataId: string,
  targetId: string,
  content: string,
): Promise<PublishedConfig> {
  const definitionId = randomUUID();
  const revisionId = randomUUID();
  const checksum = createChecksum(revisionId);
  await pool.query(
    `INSERT INTO config_definition(
       definition_id,environment,target_type,target_id,config_group,data_id,
       schema_document,default_content,secret_paths,field_metadata,status
     ) VALUES ($1,'production','runtime_deployment',$2,$3,$4,'{}','{}','[]','{}','active')`,
    [definitionId, targetId, group, dataId],
  );
  await pool.query(
    `INSERT INTO config_revision(
       revision_id,definition_id,revision,checksum,apply_mode,status,content,created_by,created_at,published_at
     ) VALUES ($1,$2,1,$3,'hot_reload','published',$4::jsonb,'e2e-admin',clock_timestamp(),clock_timestamp())`,
    [revisionId, definitionId, checksum, content],
  );
  return { revisionId, checksum };
}

async function seedRuntimeProcess(
  pool: Pool,
  deploymentId: string,
  instanceId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO runtime_process(
       runtime_instance_id,deployment_id,environment,pm2_name,pid,port,
       process_state,liveness_state,readiness_state,registration_state,catalog_state,
       config_state,last_heartbeat_at,runtime_version,config_revision,restart_count,observed_revision
     ) VALUES (
       $1,$2,'production','sdar-runtime-production-e2e-1',4242,31234,
       'online','live','unknown','unregistered','valid','current',NULL,$3,0,5,0
     )`,
    [instanceId, deploymentId, runtimeVersion],
  );
}

function deploymentInput(targetDeploymentId: string) {
  return {
    deploymentId: targetDeploymentId,
    providerId: providerA,
    environment: "production",
    runtimeVersion,
    databaseProfileId,
    configProfileId: formatRuntimeConfigProfileLocator(
      runtimeDeploymentProfileLocator({
        environment: "production",
        targetId: targetDeploymentId,
        configGroup: "runtime",
        dataId: "process",
      }),
    ),
  };
}

function registrationBody(sessionId: string, configRevision: number) {
  return {
    providerId: providerA,
    sessionId,
    runtimeVersion,
    protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    configRevision,
    readinessState: "ready",
  };
}

function managementHeaders(token: string, write = false): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    ...(write ? { "x-actor-id": "e2e-administrator" } : {}),
  };
}

function runtimeHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function deploymentListUrl(providerId: string): string {
  return `/api/v1/runtime-deployments?providerId=${providerId}`;
}

function deploymentGetUrl(providerId: string, targetDeploymentId: string): string {
  return `/api/v1/runtime-deployments/${targetDeploymentId}?providerId=${providerId}`;
}

function processListUrl(): string {
  return `/api/v1/runtime-processes?providerId=${providerA}&deploymentId=${deploymentId}`;
}

function registrationUrl(
  action: "register" | "heartbeat",
  targetDeploymentId = deploymentId,
  targetInstanceId = instanceId,
): string {
  return `/api/v1/runtime-registration/deployments/${targetDeploymentId}/instances/${targetInstanceId}/${action}`;
}

function runtimeConfigUrl(
  action: string,
  targetDeploymentId = deploymentId,
  targetInstanceId = instanceId,
): string {
  return `/api/v1/runtime-config/deployments/${targetDeploymentId}/instances/${targetInstanceId}/${action}?environment=production&configGroup=${configGroup}&dataId=${configDataId}`;
}

async function installFailureTrigger(
  pool: Pool,
  table: "audit" | "job_lease" | "runtime_registration" | "runtime_process",
  trigger: string,
  statement: string,
): Promise<void> {
  await pool.query(
    `CREATE FUNCTION ${trigger}_function() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         ${statement}
         RETURN NEW;
       END;
     $$`,
  );
  await pool.query(
    `CREATE TRIGGER ${trigger} BEFORE INSERT OR UPDATE ON ${table}
       FOR EACH ROW EXECUTE FUNCTION ${trigger}_function()`,
  );
}

async function installFirstProjectionConflict(
  pool: Pool,
  trigger: string,
  sequence: string,
): Promise<void> {
  await pool.query(`CREATE SEQUENCE ${sequence}`);
  await pool.query(
    `CREATE FUNCTION ${trigger}_function() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF nextval('${sequence}') = 1 THEN RETURN NULL; END IF;
         RETURN NEW;
       END;
     $$`,
  );
  await pool.query(
    `CREATE TRIGGER ${trigger} BEFORE UPDATE ON runtime_process
       FOR EACH ROW EXECUTE FUNCTION ${trigger}_function()`,
  );
}

async function removeFailureTrigger(
  pool: Pool,
  table: "audit" | "job_lease" | "runtime_registration" | "runtime_process",
  trigger: string,
  sequence?: string,
): Promise<void> {
  await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}`);
  await pool.query(`DROP FUNCTION IF EXISTS ${trigger}_function()`);
  if (sequence !== undefined) await pool.query(`DROP SEQUENCE IF EXISTS ${sequence}`);
}

async function expectDeploymentRollback(pool: Pool, targetDeploymentId: string): Promise<void> {
  const result = await pool.query<{ deployments: string; jobs: string; audits: string }>(
    `SELECT
       (SELECT count(*) FROM runtime_deployment WHERE deployment_id=$1)::text AS deployments,
       (SELECT count(*) FROM job_lease WHERE payload->>'deploymentId'=$1)::text AS jobs,
       (SELECT count(*) FROM audit WHERE subject_id=$1 AND action='runtime_deployment.created')::text AS audits`,
    [targetDeploymentId],
  );
  expect(result.rows[0]).toEqual({ deployments: "0", jobs: "0", audits: "0" });
}

function createChecksum(source: string): string {
  return source.replaceAll("-", "").padEnd(64, "0").slice(0, 64);
}

function withSearchPath(connectionString: string, schema: string): string {
  const separator = connectionString.includes("?") ? "&" : "?";
  return `${connectionString}${separator}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
}

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("TEST_DATABASE_URL is required");
  return value;
}

function assertSecretSafe(value: string): void {
  for (const forbidden of ["postgresql://", "Bearer ", "tokenFile", "authorization"]) {
    expect(value).not.toContain(forbidden);
  }
}
