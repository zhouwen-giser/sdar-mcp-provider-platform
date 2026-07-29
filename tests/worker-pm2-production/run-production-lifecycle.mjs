import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers";
import { URL } from "node:url";
import { Pool } from "pg";
import {
  createPmsApiComposition,
  loadPmsApiBootstrapConfig,
  PMS_API_FROZEN_PROTOCOL_VERSION,
} from "../../apps/pms-api/src/index.ts";
import {
  bootstrapPmsWorker,
  createPmsWorkerProductionComposition,
} from "../../apps/pms-worker/src/index.ts";
import {
  formatRuntimeConfigProfileLocator,
  runtimeDeploymentProfileLocator,
} from "../../packages/pms-application/src/index.ts";
import { PostgresJobLeaseRepository } from "../../packages/pms-persistence-postgres/src/index.ts";
import { deriveRuntimeInstanceIdentity } from "../../packages/runtime-deployment/src/index.ts";
import { providerDatabaseNames } from "../../packages/pms-domain/src/index.ts";
import {
  CatalogDiscoveryClient,
  HttpCatalogDiscoveryTransport,
} from "../../packages/catalog-manager/src/index.ts";

const root = process.cwd();
const adminDatabaseUrl = requiredEnvironment("TEST_DATABASE_URL");
const runtimeVersion = "2.0.0-rc.1";
const providerId = `worker-e2e-${randomUUID().slice(0, 8)}`;
const deploymentId = `deployment-${randomUUID().slice(0, 8)}`;
const databaseProfileId = `database-${randomUUID().slice(0, 8)}`;
const isolatedProviderId = `worker-e2e-isolated-${randomUUID().slice(0, 8)}`;
const isolatedDeploymentId = `deployment-isolated-${randomUUID().slice(0, 8)}`;
const isolatedDatabaseProfileId = `database-isolated-${randomUUID().slice(0, 8)}`;
const environment = "test";
const clusterRef = `cluster-${randomUUID().slice(0, 8)}`;
const adminSecretRef = `file/test/${clusterRef}/admin`;
const runtimePassword = `runtime-${randomUUID()}-secret`;
const identity = deriveRuntimeInstanceIdentity({ providerId, deploymentId, ordinal: 0 });
const isolatedIdentity = deriveRuntimeInstanceIdentity({
  providerId: isolatedProviderId,
  deploymentId: isolatedDeploymentId,
  ordinal: 0,
});
const databaseNames = providerDatabaseNames(providerId);
const isolatedDatabaseNames = providerDatabaseNames(isolatedProviderId);
const temporaryRoot = await mkdtemp(resolve(root, "tests/worker-pm2-production/.runtime-release-"));
const schema = `worker_pm2_${randomUUID().replaceAll("-", "")}`;
const pmsDatabaseUrl = withSearchPath(adminDatabaseUrl, schema);
const releaseRoot = join(temporaryRoot, "releases");
const releaseDirectory = join(releaseRoot, runtimeVersion);
const secretRoot = join(temporaryRoot, "runtime-secrets");
const cacheRoot = join(temporaryRoot, "runtime-cache");
const pm2Home = await mkdtemp(join(tmpdir(), "sdar-pm2-"));
const credentialRoot = join(temporaryRoot, "credentials");
const runtimeControlPlaneCredentialRoot = join(temporaryRoot, "runtime-control-plane-credentials");
const databaseUrlFile = join(credentialRoot, "pms-database-url");
const managementTokenFile = join(credentialRoot, "management.token");
const runtimeTokenFile = runtimeCredentialPath(providerId, deploymentId, identity.instanceId);
const isolatedRuntimeTokenFile = runtimeCredentialPath(
  isolatedProviderId,
  isolatedDeploymentId,
  isolatedIdentity.instanceId,
);
const managementDescriptor = join(credentialRoot, "management.json");
const runtimeDescriptor = join(credentialRoot, "runtime.json");
const provisioningCredentialFile = join(credentialRoot, "provisioning.json");
const managementToken = `management-${randomUUID()}`;
const runtimeToken = `runtime-control-${randomUUID()}`;
const isolatedRuntimeToken = `runtime-control-isolated-${randomUUID()}`;
let currentRuntimeToken = runtimeToken;
const admin = new Pool({ connectionString: adminDatabaseUrl });
const pmsPool = new Pool({ connectionString: pmsDatabaseUrl });
const timeline = [];
let apiComposition;
let apiAddress;
let worker;
let workerComposition;
let pm2Api;
let processes;
let adapter;
let isolatedAdapter;
let adapterDiagnostics = "";
let runtimeProcessObserved = false;

try {
  await prepareFilesystem();
  await admin.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
  await startApi();
  await seedProviderType();
  await createProviderThroughApi();
  await createProviderThroughApi(isolatedProviderId);
  await seedDatabaseProfile();
  await seedDatabaseProfile({
    providerId: isolatedProviderId,
    deploymentId: isolatedDeploymentId,
    databaseProfileId: isolatedDatabaseProfileId,
    databaseNames: isolatedDatabaseNames,
  });
  await publishConfig("initial-config", "error", null);
  await publishConfig("isolated-initial-config", "error", null, isolatedDeploymentId);

  const adapterPort = await freePort();
  const isolatedAdapterPort = await freePort();
  adapter = await startAdapter(adapterPort, `${providerId}-mismatch`);
  isolatedAdapter = await startAdapter(isolatedAdapterPort, isolatedProviderId);
  await createDeploymentThroughApi(adapterPort);
  await createDeploymentThroughApi(isolatedAdapterPort, {
    providerId: isolatedProviderId,
    deploymentId: isolatedDeploymentId,
    databaseProfileId: isolatedDatabaseProfileId,
  });
  worker = await startWorker();

  await waitForStatus("DEGRADED", 60_000);
  await waitForProcess((value) => value.state === "online", 20_000);
  runtimeProcessObserved = true;
  await waitForMissingIsolatedCredentialFailure();
  await writeSecure(isolatedRuntimeTokenFile, isolatedRuntimeToken);
  await writeRuntimeDescriptor(true);
  await stopApi();
  await startApi();
  await workerComposition.runtime.scheduler.tick();
  await delay(3_000);
  const identityMismatch = await deploymentStatus();
  assert(identityMismatch !== "ACTIVE", "IDENTITY_MISMATCH_BECAME_ACTIVE");
  timeline.push(event("identity_mismatch", identityMismatch));
  await stopAdapter();
  adapter = await startAdapter(adapterPort, providerId);

  await waitForStatus("ACTIVE", 90_000);
  await waitForStatus("ACTIVE", 90_000, isolatedDeploymentId);
  await waitForProcess((value) => value.state === "online", 30_000, isolatedIdentity.pm2Name);
  timeline.push(event("initial_convergence", "ACTIVE"));
  timeline.push(event("isolated_convergence", "ACTIVE"));
  await proveCrossTokenIsolation();
  await assertRuntimeDatabaseMigrated();
  await assertRuntimeDatabaseMigrated(isolatedDeploymentId);
  const registryEndpoint = await assertRegistryConsumerPath();

  const beforeCrash = await onlineProcess();
  const isolatedBeforeCrash = await onlineProcess(isolatedIdentity.pm2Name);
  process.kill(requiredPid(beforeCrash), "SIGKILL");
  await waitForStatus("DEGRADED", 30_000);
  timeline.push(event("runtime_sigkill", "DEGRADED"));
  const recovered = await waitForProcess(
    (value) => value.state === "online" && value.pid !== beforeCrash.pid,
    60_000,
  );
  await waitForStatus("ACTIVE", 60_000);
  await assertProcessUnchanged(isolatedIdentity.pm2Name, isolatedBeforeCrash);
  timeline.push(event("runtime_recovered", "ACTIVE"));

  await stopAdapter();
  await waitForStatus("DEGRADED", 45_000);
  timeline.push(event("adapter_unavailable", "DEGRADED"));
  adapter = await startAdapter(adapterPort, providerId);
  await waitForStatus("ACTIVE", 60_000);
  timeline.push(event("adapter_recovered", "ACTIVE"));

  await stopWorkerGracefully();
  worker = undefined;
  await assertRuntimeRemainsOnline("worker_stopped");
  timeline.push(event("worker_stopped", "runtime_online"));

  await stopApi();
  await assertRuntimeRemainsOnline("pms_api_stopped");
  timeline.push(event("pms_api_stopped", "runtime_online"));
  await startApi();
  await proveCrossTokenIsolation();

  const beforeConfig = await onlineProcess();
  await publishConfig("config-drift", "debug", 1);
  worker = await startWorker();
  const drifted = await waitForProcess(
    (value) =>
      value.state === "online" &&
      value.pid !== beforeConfig.pid &&
      value.fingerprints?.configRevision === "2",
    60_000,
  );
  await waitForStatus("ACTIVE", 60_000);
  await waitForStatus("ACTIVE", 60_000, isolatedDeploymentId);
  await delay(3_000);
  const stable = await onlineProcess();
  assert(
    stable.pid === drifted.pid && stable.restartCount === drifted.restartCount,
    "CONFIG_DRIFT_RESTART_NOT_SINGLE",
  );
  timeline.push(event("config_revision_changed", "one_controlled_restart"));

  const isolatedBeforeRotation = await onlineProcess(isolatedIdentity.pm2Name);
  const rotatedRuntimeToken = `runtime-control-rotated-${randomUUID()}`;
  currentRuntimeToken = rotatedRuntimeToken;
  await writeSecure(runtimeTokenFile, rotatedRuntimeToken);
  await writeRuntimeDescriptor(true);
  await stopApi();
  await startApi();
  process.kill(requiredPid(await onlineProcess()), "SIGKILL");
  await waitForProcess((value) => value.state === "online", 60_000);
  await waitForStatus("ACTIVE", 60_000);
  await assertProcessUnchanged(isolatedIdentity.pm2Name, isolatedBeforeRotation);
  timeline.push(event("instance_token_rotated", "isolated_runtime_unchanged"));

  await stopWorkerGracefully();
  worker = undefined;
  await proveStaleFenceRejected();
  timeline.push(event("stale_fence", "rejected"));

  const packageManifest = JSON.parse(
    await readFile(resolve(root, "node_modules/pm2/package.json"), "utf8"),
  );
  const evidence = {
    schemaVersion: "1.0",
    taskId: "G5-P1-B02",
    generatedAt: new Date().toISOString(),
    resourceClassification: {
      postgres: "real local PostgreSQL",
      pm2: "real repository-pinned JavaScript API",
      runtime: "built Runtime fixed release entry",
      adapter: "built local Mock Provider Adapter",
      qualification: "controlled production-path E2E; not real-provider certification",
    },
    versions: {
      runtime: runtimeVersion,
      protocol: PMS_API_FROZEN_PROTOCOL_VERSION,
      pm2: packageManifest.version,
    },
    authorityPath: [
      "production PMS API Composition",
      "production PMS Worker Composition",
      "RuntimeDeployment reconcile job",
      "Postgres database preparation and Runtime migrations",
      "PM2 JavaScript API",
      "built Runtime",
      "Catalog publication",
      "Registry publication",
    ],
    assertions: {
      identityMismatchNeverActive: true,
      activeAfterCatalogRegistry: true,
      registryConsumerEndpoint: registryEndpoint,
      runtimeSigkillRecovered: recovered.state === "online",
      adapterUnavailableNotActive: true,
      workerStopPreservedRuntime: true,
      pmsApiStopPreservedRuntime: true,
      workerRestartResumedReconcile: true,
      configRevisionSingleRestart: true,
      staleFenceRejected: true,
      twoDeploymentsActive: true,
      crossTokenConfigPullRejected: true,
      crossTokenConfigWatchRejected: true,
      crossTokenConfigAckRejected: true,
      crossTokenRegisterRejected: true,
      crossTokenHeartbeatRejected: true,
      missingCredentialDidNotStartPm2: true,
      identityMappingSurvivedApiWorkerRestart: true,
      isolatedRuntimeUnaffectedByPeerCrashOrRotation: true,
    },
    timeline,
  };
  await mkdir(resolve(root, "reports/evidence"), { recursive: true });
  await writeFile(
    resolve(root, "reports/evidence/G5-P1-B02-runtime-credential-isolation.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  await writeFile(
    resolve(root, "reports/evidence/G4-P3-B01-worker-pm2-production.json"),
    `${JSON.stringify({ ...evidence, taskId: "G4-P3-B01" }, null, 2)}\n`,
  );
  process.stdout.write("WORKER_PM2_PRODUCTION_GATE_OK\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  if (adapterDiagnostics.length > 0) {
    process.stderr.write(`ADAPTER_DIAGNOSTICS:\n${redact(adapterDiagnostics).slice(-4_000)}\n`);
  }
  const pm2Diagnostics = await collectPm2Diagnostics();
  if (pm2Diagnostics.length > 0) {
    process.stderr.write(`PM2_DIAGNOSTICS:\n${redact(pm2Diagnostics).slice(-8_000)}\n`);
  }
  process.exitCode = 1;
} finally {
  await cleanup();
}

async function prepareFilesystem() {
  await Promise.all(
    [releaseRoot, secretRoot, cacheRoot, credentialRoot, runtimeControlPlaneCredentialRoot].map(
      (directory) => mkdir(directory, { recursive: true, mode: 0o700 }),
    ),
  );
  await cp(resolve(root, "dist"), resolve(releaseDirectory, "dist"), {
    recursive: true,
    force: true,
  });
  await cp(resolve(root, "proto"), resolve(releaseDirectory, "proto"), {
    recursive: true,
    force: true,
  });
  await cp(resolve(root, "migrations"), resolve(releaseDirectory, "migrations"), {
    recursive: true,
    force: true,
  });
  await chmod(resolve(releaseDirectory, "dist/apps/runtime/src/main.js"), 0o755);
  await writeSecure(
    join(releaseRoot, "runtime-releases.json"),
    JSON.stringify({
      schemaVersion: 1,
      releases: [{ version: runtimeVersion, directory: runtimeVersion }],
    }),
  );
  await Promise.all([
    writeSecure(databaseUrlFile, pmsDatabaseUrl),
    writeSecure(managementTokenFile, managementToken),
    writeSecure(runtimeTokenFile, runtimeToken),
  ]);
  await writeSecure(
    managementDescriptor,
    JSON.stringify({
      management: {
        administrator: [{ subjectId: "worker-e2e-admin", tokenFile: managementTokenFile }],
      },
    }),
  );
  await writeRuntimeDescriptor(false);
  await writeSecure(
    provisioningCredentialFile,
    JSON.stringify({
      clusterRef,
      adminSecretRef,
      adminDatabaseUrl,
      runtimePassword,
    }),
  );
}

async function writeRuntimeDescriptor(includeIsolated) {
  const principals = [
    {
      providerId,
      deploymentId,
      instanceId: String(identity.instanceId),
      tokenFile: runtimeTokenFile,
      subject: "worker-e2e",
    },
    ...(includeIsolated
      ? [
          {
            providerId: isolatedProviderId,
            deploymentId: isolatedDeploymentId,
            instanceId: String(isolatedIdentity.instanceId),
            tokenFile: isolatedRuntimeTokenFile,
            subject: "worker-e2e-isolated",
          },
        ]
      : []),
  ];
  await writeSecure(
    runtimeDescriptor,
    JSON.stringify({
      runtimeConfig: principals.map(({ subject, ...principal }) => ({
        ...principal,
        subjectId: `${subject}-runtime-config`,
        environment,
        runtimeVersion,
        protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
        scopes: ["runtime:config:read", "runtime:config:watch", "runtime:config:ack"],
      })),
      runtimeRegistration: principals.map(({ subject, ...principal }) => ({
        ...principal,
        subjectId: `${subject}-runtime-registration`,
        runtimeVersion,
        protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
        scopes: ["runtime:register", "runtime:heartbeat"],
      })),
    }),
  );
}

async function startApi() {
  const port = apiAddress === undefined ? await freePort() : Number(new URL(apiAddress).port);
  const config = await loadPmsApiBootstrapConfig({
    PMS_API_HOST: "127.0.0.1",
    PMS_API_PORT: String(port),
    PMS_API_RUNTIME_HEARTBEAT_TTL_MS: "5000",
    PMS_DATABASE_URL_FILE: databaseUrlFile,
    PMS_MANAGEMENT_CREDENTIAL_FILE: managementDescriptor,
    PMS_RUNTIME_CREDENTIAL_FILE: runtimeDescriptor,
  });
  apiComposition = await createPmsApiComposition(config);
  apiAddress = await apiComposition.app.listen({ host: "127.0.0.1", port });
}

async function stopApi() {
  if (apiComposition === undefined) return;
  const value = apiComposition;
  apiComposition = undefined;
  await value.close();
}

async function startWorker() {
  const running = await bootstrapPmsWorker({
    loadConfig: () =>
      Promise.resolve({
        databaseUrlFile,
        workerId: `worker-e2e-${randomUUID().slice(0, 8)}`,
        pollIntervalMs: 100,
        leaseDurationMs: 10_000,
        claimLimit: 1,
        retryDelayMs: 500,
        workspaceRoot: root,
        runtime: {
          postgresProvisioningCredentialFile: provisioningCredentialFile,
          runtimeReleaseRoot: releaseRoot,
          runtimeSecretRoot: secretRoot,
          runtimeConfigCacheRoot: cacheRoot,
          runtimeControlPlaneUrl: apiAddress,
          runtimeControlPlaneCredentialRoot,
          pm2Home,
          runtimeReconcileIntervalMs: 1_000,
          runtimeReconcileTimeoutMs: 30_000,
          runtimeHealthTimeoutMs: 2_000,
        },
      }),
    readDatabaseUrl: () => Promise.resolve(pmsDatabaseUrl),
    createComposition: async (pool, config) => {
      workerComposition = await createPmsWorkerProductionComposition(pool, config);
      return workerComposition;
    },
  });
  await delay(1_100);
  await workerComposition.runtime.scheduler.tick();
  pm2Api = workerComposition.runtime.components.pm2Api;
  processes = workerComposition.runtime.components.processManager;
  return running;
}

async function stopWorkerGracefully() {
  assert(worker !== undefined && workerComposition !== undefined, "WORKER_NOT_RUNNING");
  await workerComposition.runtime.scheduler.stop();
  await waitFor(
    async () => {
      const result = await pmsPool.query(
        `SELECT count(*)::integer AS active
           FROM job_lease
          WHERE job_type='runtime_deployment.reconcile'
            AND payload->>'deploymentId'=ANY($1::text[])
            AND status IN ('pending','leased')`,
        [[deploymentId, isolatedDeploymentId]],
      );
      return result.rows[0]?.active;
    },
    (active) => active === 0,
    60_000,
    "WORKER_RECONCILE_DRAIN_TIMEOUT",
  );
  await worker.stop();
}

async function seedProviderType() {
  await pmsPool.query(
    `INSERT INTO provider_type(provider_type_id,display_name,status)
     VALUES ('test.worker.pm2','Worker PM2 E2E','active')
     ON CONFLICT (provider_type_id) DO NOTHING`,
  );
}

async function createProviderThroughApi(targetProviderId = providerId) {
  const created = await apiRequest("/api/v1/providers", {
    method: "POST",
    body: {
      providerId: targetProviderId,
      providerTypeId: "test.worker.pm2",
      hostingMode: "platform_managed",
    },
  });
  assert(created.status === 201, `PROVIDER_CREATE_FAILED:${String(created.status)}`);
  const provider = await created.json();
  const activated = await apiRequest(`/api/v1/providers/${targetProviderId}/status`, {
    method: "PATCH",
    body: { status: "active", expectedUpdatedAt: provider.updatedAt },
  });
  assert(activated.status === 200, `PROVIDER_ACTIVATE_FAILED:${String(activated.status)}`);
}

async function seedDatabaseProfile(
  target = { providerId, deploymentId, databaseProfileId, databaseNames },
) {
  const url = new URL(adminDatabaseUrl);
  const auditId = randomUUID();
  await pmsPool.query(
    `INSERT INTO audit(
       audit_event_id,action,actor_id,correlation_id,subject_type,subject_id,metadata
     ) VALUES ($1,'database_profile.created','worker-e2e','worker-e2e',
               'database_profile',$2,'{}')`,
    [auditId, target.databaseProfileId],
  );
  await pmsPool.query(
    `INSERT INTO database_profile(
       profile_id,provider_id,environment,cluster_ref,host,port,database_mode,
       database_name,runtime_role_name,ssl_mode,admin_secret_ref,runtime_secret_ref,
       provision_status,provisioned_at,created_audit_event_id,last_audit_event_id
     ) VALUES ($1,$2,$3,$4,$5,$6,'provisioned',$7,$8,'disable',$9,$10,
               'ready',clock_timestamp(),$11,$11)`,
    [
      target.databaseProfileId,
      target.providerId,
      environment,
      clusterRef,
      url.hostname,
      url.port.length === 0 ? 5432 : Number(url.port),
      target.databaseNames.databaseName,
      target.databaseNames.runtimeRoleName,
      adminSecretRef,
      `file/v1/${target.deploymentId}/database/runtime`,
      auditId,
    ],
  );
}

async function publishConfig(
  draftId,
  logLevel,
  expectedPublishedRevision,
  targetDeploymentId = deploymentId,
) {
  const created = await apiRequest("/api/v1/config-drafts", {
    method: "POST",
    body: {
      draftId,
      definitionId: "runtime.observability",
      environment,
      targetType: "runtime_deployment",
      targetId: targetDeploymentId,
      configGroup: "runtime.observability",
      dataId: "main",
      content: { LOG_LEVEL: logLevel, OTEL_ENABLED: false },
    },
  });
  assert(created.status === 201, `CONFIG_DRAFT_CREATE_FAILED:${String(created.status)}`);
  const validated = await apiRequest(`/api/v1/config-drafts/${draftId}/validate`, {
    method: "POST",
    body: {},
  });
  if (validated.status !== 200) {
    throw new Error(
      `CONFIG_VALIDATE_FAILED:${String(validated.status)}:${redact(await validated.text())}`,
    );
  }
  const validation = await validated.json();
  const published = await apiRequest(`/api/v1/config-drafts/${draftId}/publish`, {
    method: "POST",
    body: {
      expectedDraftVersion: validation.version,
      expectedPublishedRevision,
    },
  });
  assert(published.status === 200, `CONFIG_PUBLISH_FAILED:${String(published.status)}`);
}

async function createDeploymentThroughApi(
  adapterPort,
  target = { providerId, deploymentId, databaseProfileId },
) {
  const configProfileId = formatRuntimeConfigProfileLocator(
    runtimeDeploymentProfileLocator({
      environment,
      targetId: target.deploymentId,
      configGroup: "runtime.observability",
      dataId: "main",
    }),
  );
  const response = await apiRequest("/api/v1/runtime-deployments", {
    method: "POST",
    body: {
      deploymentId: target.deploymentId,
      providerId: target.providerId,
      environment,
      runtimeVersion,
      databaseProfileId: target.databaseProfileId,
      configProfileId,
      adapterEndpoint: `127.0.0.1:${String(adapterPort)}`,
    },
  });
  assert(response.status === 202, `DEPLOYMENT_CREATE_FAILED:${String(response.status)}`);
}

async function assertRegistryConsumerPath() {
  const response = await apiRequest(`/api/v1/registry/${environment}/latest`);
  assert(response.status === 200, `REGISTRY_LATEST_FAILED:${String(response.status)}`);
  const snapshot = await response.json();
  const provider = snapshot.document.providers.find(
    (value) => value.providerId === providerId || value.providerId === isolatedProviderId,
  );
  assert(provider !== undefined, "REGISTRY_PROVIDER_MISSING");
  const discovered = await new CatalogDiscoveryClient(
    new HttpCatalogDiscoveryTransport({ endpoint: provider.effectiveEndpoint }),
    { timeoutMs: 5_000, maxAttempts: 3 },
  ).discover();
  assert(discovered.tools.length > 0, "REGISTRY_CONSUMER_DISCOVERY_EMPTY");
  return provider.effectiveEndpoint;
}

async function assertRuntimeDatabaseMigrated(targetDeploymentId = deploymentId) {
  const secretPath = join(
    secretRoot,
    "deployments",
    targetDeploymentId,
    "instances",
    "database",
    "runtime.secret",
  );
  const runtimePool = new Pool({ connectionString: (await readFile(secretPath, "utf8")).trim() });
  try {
    const result = await runtimePool.query(
      "SELECT to_regclass('runtime_schema_migration') IS NOT NULL AS migrated",
    );
    assert(result.rows[0]?.migrated === true, "RUNTIME_MIGRATIONS_MISSING");
  } finally {
    await runtimePool.end();
  }
}

async function proveStaleFenceRejected() {
  const jobs = new PostgresJobLeaseRepository(pmsPool);
  const jobId = `fence-${randomUUID()}`;
  await pmsPool.query(
    `DELETE FROM job_lease
      WHERE job_type='runtime_deployment.reconcile'
        AND status IN ('pending','failed','leased')`,
  );
  await jobs.enqueue({
    jobId,
    jobType: "runtime_deployment.reconcile",
    payload: { providerId, deploymentId, correlationId: jobId },
  });
  const stale = (
    await jobs.claim({
      owner: "stale-worker",
      jobTypes: ["runtime_deployment.reconcile"],
      limit: 1,
      leaseDurationMs: 1,
    })
  ).find((lease) => lease.job.jobId === jobId);
  assert(stale !== undefined, "STALE_FENCE_INITIAL_CLAIM_MISSING");
  await delay(10);
  const current = (
    await jobs.claim({
      owner: "current-worker",
      jobTypes: ["runtime_deployment.reconcile"],
      limit: 1,
      leaseDurationMs: 10_000,
    })
  ).find((lease) => lease.job.jobId === jobId);
  assert(current !== undefined, "STALE_FENCE_RECLAIM_MISSING");
  let rejected = false;
  try {
    await jobs.complete(leaseIdentity(stale));
  } catch (error) {
    rejected = error?.code === "LEASE_NOT_OWNED";
  }
  assert(rejected, "STALE_FENCE_COMPLETION_ACCEPTED");
  await jobs.complete(leaseIdentity(current));
}

async function waitForMissingIsolatedCredentialFailure() {
  await waitFor(
    async () => {
      const [job, process] = await Promise.all([
        pmsPool.query(
          `SELECT status,attempt
             FROM job_lease
            WHERE job_type='runtime_deployment.reconcile'
              AND payload->>'deploymentId'=$1
            ORDER BY created_at DESC
            LIMIT 1`,
          [isolatedDeploymentId],
        ),
        processes.describe(isolatedIdentity.pm2Name),
      ]);
      return {
        attempted: Number(job.rows[0]?.attempt ?? 0) > 0,
        processState: process.state,
      };
    },
    (value) => value.attempted && value.processState === "missing",
    30_000,
    "MISSING_INSTANCE_CREDENTIAL_STARTED_PM2",
  );
  assert(
    (await deploymentStatus(isolatedDeploymentId)) !== "ACTIVE",
    "MISSING_INSTANCE_CREDENTIAL_BECAME_ACTIVE",
  );
  timeline.push(event("missing_instance_credential", "pm2_not_started"));
}

async function proveCrossTokenIsolation() {
  await assertCrossTokenRejected(runtimeToken, {
    providerId: isolatedProviderId,
    deploymentId: isolatedDeploymentId,
    instanceId: String(isolatedIdentity.instanceId),
  });
  await assertCrossTokenRejected(isolatedRuntimeToken, {
    providerId,
    deploymentId,
    instanceId: String(identity.instanceId),
  });
  timeline.push(event("cross_token_isolation", "ten_requests_rejected"));
}

async function assertCrossTokenRejected(token, target) {
  const query = "environment=test&configGroup=runtime.observability&dataId=main";
  const configBase = `/api/v1/runtime-config/deployments/${target.deploymentId}/instances/${target.instanceId}`;
  const registrationBase =
    `/api/v1/runtime-registration/deployments/${target.deploymentId}` +
    `/instances/${target.instanceId}`;
  const registrationBody = {
    providerId: target.providerId,
    sessionId: `cross-token-${randomUUID()}`,
    runtimeVersion,
    protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
    configRevision: 1,
    readinessState: "ready",
  };
  const requests = [
    ["config_pull", `${configBase}/latest?${query}`, { method: "GET" }],
    ["config_watch", `${configBase}/watch?${query}`, { method: "GET" }],
    [
      "config_ack",
      `${configBase}/revisions/${randomUUID()}/acks?${query}`,
      { method: "POST", body: { status: "applied" } },
    ],
    ["register", `${registrationBase}/register`, { method: "POST", body: registrationBody }],
    [
      "heartbeat",
      `${registrationBase}/heartbeat`,
      { method: "POST", body: { ...registrationBody, sequence: 1 } },
    ],
  ];
  for (const [name, path, options] of requests) {
    const response = await runtimeRequest(path, token, options);
    assert(response.status === 403, `CROSS_TOKEN_${name.toUpperCase()}_NOT_FORBIDDEN`);
    const body = await response.text();
    assert(!body.includes(token), `CROSS_TOKEN_${name.toUpperCase()}_LEAKED`);
  }
}

async function startAdapter(port, adapterProviderId) {
  const child = spawn("node", ["dist/examples/mock-adapter-typescript/src/main.js"], {
    cwd: root,
    env: {
      PATH: requiredEnvironment("PATH"),
      LOG_LEVEL: "error",
      ADAPTER_HOST: "127.0.0.1",
      ADAPTER_PORT: String(port),
      PROVIDER_ID: adapterProviderId,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    adapterDiagnostics += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    adapterDiagnostics += String(chunk);
  });
  await waitFor(
    async () => {
      if (child.exitCode !== null) throw new Error("MOCK_ADAPTER_EXITED");
      return tcpAvailable(port);
    },
    (ready) => ready,
    15_000,
    "MOCK_ADAPTER_START_TIMEOUT",
  );
  return child;
}

async function stopAdapter() {
  if (adapter === undefined) return;
  const child = adapter;
  adapter = undefined;
  await stopChild(child);
}

async function stopChild(child) {
  if (child === undefined) return;
  if (child.exitCode === null) child.kill("SIGTERM");
  await waitFor(
    () => Promise.resolve(child.exitCode),
    (exitCode) => exitCode !== null,
    5_000,
    "MOCK_ADAPTER_STOP_TIMEOUT",
  ).catch(() => {
    child.kill("SIGKILL");
  });
}

async function waitForStatus(status, timeoutMs, targetDeploymentId = deploymentId) {
  return waitFor(
    async () => {
      await workerComposition?.runtime.scheduler.tick();
      const result = await pmsPool.query(
        `SELECT d.status,d.observed_revision,
                p.process_state,p.readiness_state,p.registration_state,p.catalog_state,
                p.config_state,p.pid,p.restart_count,
                a.action_type,a.status AS action_status,a.error_code,a.result_details,
                j.status AS job_status,j.attempt AS job_attempt,j.available_at
           FROM runtime_deployment d
           LEFT JOIN runtime_process p ON p.deployment_id=d.deployment_id
           LEFT JOIN LATERAL (
             SELECT action_type,status,error_code,result_details
               FROM runtime_deployment_action
              WHERE deployment_id=d.deployment_id
              ORDER BY occurred_at DESC
              LIMIT 1
           ) a ON true
           LEFT JOIN LATERAL (
             SELECT status,attempt,available_at
               FROM job_lease
              WHERE job_type='runtime_deployment.reconcile'
                AND payload->>'deploymentId'=d.deployment_id
              ORDER BY created_at DESC
              LIMIT 1
           ) j ON true
          WHERE d.deployment_id=$1`,
        [targetDeploymentId],
      );
      return {
        ...result.rows[0],
        workerHealth: worker?.worker.health.snapshot(),
      };
    },
    (row) => row?.status === status,
    timeoutMs,
    `DEPLOYMENT_STATUS_TIMEOUT:${status}`,
  );
}

async function deploymentStatus(targetDeploymentId = deploymentId) {
  const result = await pmsPool.query(
    "SELECT status FROM runtime_deployment WHERE deployment_id=$1",
    [targetDeploymentId],
  );
  return result.rows[0]?.status;
}

function onlineProcess(processName = identity.pm2Name) {
  return waitForProcess((value) => value.state === "online", 20_000, processName);
}

function waitForProcess(predicate, timeoutMs, processName = identity.pm2Name) {
  return waitFor(
    () => processes.describe(processName),
    predicate,
    timeoutMs,
    "RUNTIME_PROCESS_TIMEOUT",
  );
}

async function assertRuntimeRemainsOnline(reason) {
  await delay(1_500);
  const observed = await processes.describe(identity.pm2Name);
  assert(observed.state === "online", `RUNTIME_STOPPED_WITH_CONTROL_PLANE:${reason}`);
}

async function assertProcessUnchanged(processName, before) {
  await delay(1_500);
  const after = await processes.describe(processName);
  assert(
    after.state === "online" &&
      after.pid === before.pid &&
      after.restartCount === before.restartCount,
    "ISOLATED_RUNTIME_CHANGED",
  );
}

async function runtimeRequest(path, token, options) {
  return globalThis.fetch(new URL(path, apiAddress), {
    method: options.method,
    redirect: "error",
    headers: {
      authorization: `Bearer ${token}`,
      "x-correlation-id": randomUUID(),
      "content-type": "application/json",
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function apiRequest(path, options = {}) {
  const response = await globalThis.fetch(new URL(path, apiAddress), {
    method: options.method ?? "GET",
    redirect: "error",
    headers: {
      authorization: `Bearer ${managementToken}`,
      "x-actor-id": "worker-e2e-admin",
      "x-correlation-id": randomUUID(),
      "content-type": "application/json",
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  if (response.status >= 400) {
    const body = await response.clone().text();
    if (body.includes(managementToken) || body.includes(runtimeToken)) {
      throw new Error("CONTROL_PLANE_SECRET_LEAK");
    }
  }
  return response;
}

async function cleanup() {
  await worker?.stop().catch(() => undefined);
  await stopAdapter().catch(() => undefined);
  await stopChild(isolatedAdapter).catch(() => undefined);
  await stopApi().catch(() => undefined);
  if (runtimeProcessObserved && processes !== undefined) {
    await processes.delete(identity.pm2Name).catch(() => undefined);
    await processes.delete(isolatedIdentity.pm2Name).catch(() => undefined);
  }
  try {
    pm2Api?.disconnect();
  } catch {
    // Best-effort cleanup after the product gate has already established its result.
  }
  await pmsPool.end().catch(() => undefined);
  await admin
    .query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",
      [databaseNames.databaseName],
    )
    .catch(() => undefined);
  await admin
    .query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseNames.databaseName)} WITH (FORCE)`)
    .catch(() => undefined);
  await admin
    .query(`DROP ROLE IF EXISTS ${quoteIdentifier(databaseNames.runtimeRoleName)}`)
    .catch(() => undefined);
  await admin
    .query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",
      [isolatedDatabaseNames.databaseName],
    )
    .catch(() => undefined);
  await admin
    .query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(isolatedDatabaseNames.databaseName)} WITH (FORCE)`,
    )
    .catch(() => undefined);
  await admin
    .query(`DROP ROLE IF EXISTS ${quoteIdentifier(isolatedDatabaseNames.runtimeRoleName)}`)
    .catch(() => undefined);
  await admin
    .query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`)
    .catch(() => undefined);
  await admin.end().catch(() => undefined);
  await Promise.all([
    rm(temporaryRoot, { recursive: true, force: true }),
    rm(pm2Home, { recursive: true, force: true }),
  ]);
}

async function collectPm2Diagnostics() {
  const logs = resolve(pm2Home, "logs");
  const entries = await readdir(logs, { withFileTypes: true }).catch(() => []);
  const content = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const path = resolve(logs, entry.name);
        return `${entry.name}:\n${await readFile(path, "utf8")}`;
      }),
  );
  return content.join("\n");
}

function withSearchPath(connectionString, searchPath) {
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${searchPath}`);
  return url.toString();
}

function runtimeCredentialPath(targetProviderId, targetDeploymentId, targetInstanceId) {
  return join(
    runtimeControlPlaneCredentialRoot,
    "providers",
    targetProviderId,
    "deployments",
    targetDeploymentId,
    "instances",
    String(targetInstanceId),
    "control-plane.token",
  );
}

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error("TEST_IDENTIFIER_INVALID");
  return `"${value}"`;
}

function leaseIdentity(lease) {
  return {
    jobId: lease.job.jobId,
    owner: lease.owner,
    token: lease.token,
    fencingToken: lease.fencingToken,
  };
}

function requiredPid(observation) {
  if (!Number.isSafeInteger(observation.pid)) throw new Error("RUNTIME_PID_MISSING");
  return observation.pid;
}

function event(action, outcome) {
  return { action, outcome, at: new Date().toISOString() };
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

async function writeSecure(path, content) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
}

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        rejectPort(new Error("FREE_PORT_UNAVAILABLE"));
        return;
      }
      server.close((error) =>
        error === undefined ? resolvePort(address.port) : rejectPort(error),
      );
    });
  });
}

function tcpAvailable(port) {
  return new Promise((resolveReady) => {
    const socket = createServer();
    socket.once("error", (error) => {
      socket.close();
      resolveReady(error?.code === "EADDRINUSE");
    });
    socket.listen(port, "127.0.0.1", () => {
      socket.close(() => resolveReady(false));
    });
  });
}

async function waitFor(read, predicate, timeoutMs, code) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await read();
      if (predicate(last)) return last;
    } catch (error) {
      last = error;
    }
    await delay(200);
  }
  const diagnostic =
    last instanceof Error
      ? (last.stack ?? last.message)
      : typeof last === "object"
        ? JSON.stringify(last)
        : String(last);
  throw new Error(`${code}:${redact(diagnostic)}`);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

function redact(value) {
  return value
    .replaceAll(adminDatabaseUrl, "<database-url>")
    .replaceAll(managementToken, "<management-token>")
    .replaceAll(runtimeToken, "<runtime-token>")
    .replaceAll(currentRuntimeToken, "<current-runtime-token>")
    .replaceAll(isolatedRuntimeToken, "<isolated-runtime-token>")
    .replaceAll(runtimePassword, "<runtime-password>");
}
