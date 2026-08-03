import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Pool } from "pg";
import {
  RuntimeDeploymentReconciler,
  parseRuntimeConfigProfileLocator,
  toConfigurationTarget,
  verifyProviderIdentity,
  type RuntimeReconcileHealthResult,
  type RuntimeReconcileInstance,
  type RuntimeReconcileStore,
} from "../../../packages/pms-application/src/index.js";
import {
  PostgresCatalogSnapshotRepository,
  PostgresConfigurationRepository,
  PostgresDatabaseProfileRepository,
  PostgresRegistrySnapshotRepository,
  PostgresRuntimeDeploymentRepository,
  PostgresRuntimeInstanceAllocator,
  PostgresRuntimeProcessRepository,
  PostgresRuntimeReconcileSchedulerRepository,
} from "../../../packages/pms-persistence-postgres/src/index.js";
import {
  BootstrapConfigRenderer,
  CURRENT_RUNTIME_VERSION,
  Pm2ProcessManager,
  RuntimeHealthProbe,
  RuntimeLifecycleManager,
  RuntimeReleaseResolver,
  createPm2JavascriptApi,
  loadRuntimeReleaseManifest,
  type Pm2JavascriptApi,
  type RuntimeLifecycleAuditEvent,
  type RuntimeLifecycleEvent,
  type RuntimeLifecycleResult,
  type RuntimeLifecycleStore,
} from "../../../packages/pm2-runtime-adapter/src/index.js";
import type { FileSecretStore } from "../../../packages/secret-store/src/index.js";
import {
  runtimePortRange,
  updateRuntimeProcessObservation,
  type RuntimeDeployment,
  type RuntimeDeploymentSnapshot,
  type RuntimeDeploymentStatus,
  type RuntimeInfrastructureInstanceTarget,
} from "../../../packages/runtime-deployment/src/index.js";
import {
  CatalogRegistryPublicationPhase,
  CatalogRegistryReconcileDecorator,
  HttpCatalogRegistryDiscovery,
} from "./catalog-registry-phase.js";
import type { PmsWorkerConfig } from "./config.js";
import { requirePmsWorkerRuntimeConfig } from "./config.js";
import { PeriodicReconcileScheduler } from "./reconcile-scheduler.js";
import { buildRegistryProviderProjection } from "./registry-provider-projection.js";
import { createRuntimeDatabasePreparation } from "./runtime-database-preparation-job.js";
import {
  RuntimeControlPlaneCredentialResolver,
  type RuntimeControlPlaneCredentialResolverContract,
} from "./runtime-control-plane-credentials.js";

const RUNTIME_PORT_RANGE = runtimePortRange(18_080, 19_079);
const RUNTIME_BOOTSTRAP_RESERVED_KEYS = new Set([
  "PORT",
  "PROVIDER_ID",
  "DATABASE_URL",
  "DATABASE_URL_FILE",
  "RUNTIME_DEPLOYMENT_ID",
  "RUNTIME_INSTANCE_ID",
  "OTEL_SERVICE_INSTANCE_ID",
  "PMS_RUNTIME_CONFIG_URL",
  "PMS_RUNTIME_CONFIG_TOKEN_FILE",
  "PMS_RUNTIME_CONFIG_CACHE_PATH",
  "PMS_RUNTIME_REGISTRATION_URL",
  "PMS_RUNTIME_REGISTRATION_TOKEN_FILE",
  "PMS_BOOTSTRAP_CHECKSUM",
  "PMS_CONFIG_REVISION",
  "PMS_RUNTIME_VERSION",
]);

export interface ProductionRuntimeComposition {
  readonly reconciler: CatalogRegistryReconcileDecorator;
  readonly scheduler: PeriodicReconcileScheduler;
  readonly api: Pm2JavascriptApi;
  readonly components: Readonly<{
    databasePreparation: object;
    provisioner: object;
    provisioningCredentialResolver: object;
    runtimeControlPlaneCredentialResolver: RuntimeControlPlaneCredentialResolverContract;
    runtimeMigrationRunner: object;
    secretStore: FileSecretStore;
    repositories: Readonly<{
      runtimeDeployments: PostgresRuntimeDeploymentRepository;
      runtimeProcesses: PostgresRuntimeProcessRepository;
      databaseProfiles: PostgresDatabaseProfileRepository;
      catalogSnapshots: PostgresCatalogSnapshotRepository;
      registrySnapshots: PostgresRegistrySnapshotRepository;
    }>;
    bootstrapRenderer: BootstrapConfigRenderer;
    pm2Api: Pm2JavascriptApi;
    lifecycle: RuntimeLifecycleManager;
    lifecycleStore: RuntimeLifecycleStore;
    health: RuntimeHealthProbe;
    processManager: Pm2ProcessManager;
    releaseResolver: RuntimeReleaseResolver;
    providerIdentity: object;
    catalogRegistry: CatalogRegistryPublicationPhase;
    reconciler: RuntimeDeploymentReconciler;
  }>;
  close(): Promise<void>;
}

export async function createProductionRuntimeComposition(
  pool: Pool,
  config: PmsWorkerConfig,
): Promise<ProductionRuntimeComposition> {
  const runtime = requirePmsWorkerRuntimeConfig(config);
  const manifest = await loadRuntimeReleaseManifest(runtime.runtimeReleaseRoot);
  const releaseResolver = new RuntimeReleaseResolver(runtime.runtimeReleaseRoot, manifest);
  const api = createPm2JavascriptApi({ pm2Home: runtime.pm2Home });
  const processManager = new Pm2ProcessManager(api, runtime.runtimeReleaseRoot);
  let databaseResources: Awaited<ReturnType<typeof createRuntimeDatabasePreparation>> | undefined;
  try {
    databaseResources = await createRuntimeDatabasePreparation(pool, {
      credentialFile: runtime.postgresProvisioningCredentialFile,
      secretRoot: runtime.runtimeSecretRoot,
      workspaceRoot: config.workspaceRoot,
      migrationTimeoutMs: runtime.runtimeReconcileTimeoutMs,
      supportedRuntimeVersions: [CURRENT_RUNTIME_VERSION],
    });
    const runtimeControlPlaneCredentialResolver =
      await RuntimeControlPlaneCredentialResolver.create(runtime.runtimeControlPlaneCredentialRoot);
    const store = new PostgresRuntimeReconcileStore(
      pool,
      runtime.runtimeSecretRoot,
      runtime.runtimeConfigCacheRoot,
      runtime.runtimeControlPlaneUrl,
      runtimeControlPlaneCredentialResolver,
    );
    const repositories = Object.freeze({
      runtimeDeployments: new PostgresRuntimeDeploymentRepository(pool),
      runtimeProcesses: new PostgresRuntimeProcessRepository(pool),
      databaseProfiles: new PostgresDatabaseProfileRepository(pool),
      catalogSnapshots: new PostgresCatalogSnapshotRepository(pool),
      registrySnapshots: new PostgresRegistrySnapshotRepository(pool),
    });
    const bootstrapRenderer = new BootstrapConfigRenderer();
    const lifecycleStore = new PostgresRuntimeLifecycleStore(pool);
    const lifecycle = new RuntimeLifecycleManager(
      processManager,
      releaseResolver,
      bootstrapRenderer,
      databaseResources.secretStore,
      lifecycleStore,
    );
    const health = new RuntimeHealthProbe(processManager);
    const providerIdentity = new RuntimeProviderIdentityVerifier();
    const reconciler = new RuntimeDeploymentReconciler(
      store,
      databaseResources.job,
      lifecycle,
      {
        probe: (input) =>
          health.probe({
            ...input,
            timeoutMs: Math.min(input.timeoutMs, runtime.runtimeHealthTimeoutMs),
          }),
      },
      processManager,
      providerIdentity,
    );
    const publication = new CatalogRegistryPublicationPhase(
      new HttpCatalogRegistryDiscovery(),
      {
        resolve: async (deployment) => `${await store.runtimeBaseUrl(deployment)}/mcp`,
      },
      repositories.catalogSnapshots,
      {
        providers: async ({ deployment, endpoint, catalog }) =>
          buildRegistryProviderProjection({
            deployment,
            endpoint,
            catalog,
            deployments: await repositories.runtimeDeployments.listByEnvironment(
              String(deployment.environment),
            ),
            activeCatalog: (providerId) => repositories.catalogSnapshots.active(providerId),
            ensureInstance: async (candidate) => ({
              instanceId: (await store.ensureInstance(candidate, 0)).target.instanceId,
            }),
            runtimeBaseUrl: (candidate) => store.runtimeBaseUrl(candidate),
          }),
      },
      repositories.registrySnapshots,
      {
        activate: (deployment, expectedRevision) =>
          store.transitionSnapshot(deployment, "ACTIVE", expectedRevision),
        fail: async (deployment, expectedRevision, reasonCode) => {
          await store.fail(
            String(deployment.providerId),
            String(deployment.deploymentId),
            deployment.status,
            expectedRevision,
            reasonCode,
          );
          return (
            await store.requireDeployment(
              String(deployment.providerId),
              String(deployment.deploymentId),
            )
          ).snapshot;
        },
      },
    );
    const decorated = new CatalogRegistryReconcileDecorator(reconciler, publication);
    const scheduler = new PeriodicReconcileScheduler(
      new PostgresRuntimeReconcileSchedulerRepository(pool),
      {
        intervalMs: runtime.runtimeReconcileIntervalMs,
        batchSize: config.claimLimit,
      },
    );
    let closed = false;
    return Object.freeze({
      reconciler: decorated,
      scheduler,
      api,
      components: Object.freeze({
        databasePreparation: databaseResources.job,
        provisioner: databaseResources.provisioner,
        provisioningCredentialResolver: databaseResources.credentialResolver,
        runtimeControlPlaneCredentialResolver,
        runtimeMigrationRunner: databaseResources.migrationRunner,
        secretStore: databaseResources.secretStore,
        repositories,
        bootstrapRenderer,
        pm2Api: api,
        lifecycle,
        lifecycleStore,
        health,
        processManager,
        releaseResolver,
        providerIdentity,
        catalogRegistry: publication,
        reconciler,
      }),
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        try {
          await processManager.close();
        } finally {
          await databaseResources?.close();
        }
      },
    });
  } catch (error) {
    try {
      api.disconnect();
    } catch {
      // Preserve the construction failure while still closing database authority below.
    }
    await databaseResources?.close().catch(() => undefined);
    throw error;
  }
}

class PostgresRuntimeReconcileStore implements RuntimeReconcileStore {
  readonly #deployments: PostgresRuntimeDeploymentRepository;
  readonly #processes: PostgresRuntimeProcessRepository;
  readonly #allocator: PostgresRuntimeInstanceAllocator;
  readonly #configuration: PostgresConfigurationRepository;

  constructor(
    private readonly pool: Pool,
    private readonly secretRoot: string,
    private readonly configCacheRoot: string,
    private readonly runtimeControlPlaneUrl: string,
    private readonly runtimeControlPlaneCredentialResolver: RuntimeControlPlaneCredentialResolverContract,
  ) {
    this.#deployments = new PostgresRuntimeDeploymentRepository(pool);
    this.#processes = new PostgresRuntimeProcessRepository(pool);
    this.#allocator = new PostgresRuntimeInstanceAllocator(pool);
    this.#configuration = new PostgresConfigurationRepository(pool);
  }

  getDeployment(providerId: string, deploymentId: string) {
    return this.#deployments.get(providerId, deploymentId);
  }

  async requireDeployment(providerId: string, deploymentId: string): Promise<RuntimeDeployment> {
    const deployment = await this.getDeployment(providerId, deploymentId);
    if (deployment === null) throw new Error("RUNTIME_RECONCILE_DEPLOYMENT_NOT_FOUND");
    return deployment;
  }

  async transition(
    providerId: string,
    deploymentId: string,
    target: RuntimeDeploymentStatus,
    expectedStatus: RuntimeDeploymentStatus,
    expectedObservedRevision: number,
  ): Promise<RuntimeDeployment> {
    const deployment = await this.requireDeployment(providerId, deploymentId);
    const before = deployment.snapshot;
    deployment.transition(
      target,
      { expectedStatus, expectedRevision: expectedObservedRevision },
      new Date(),
    );
    await this.#deployments.save(deployment.snapshot, {
      expectedDesiredRevision: before.desiredRevision,
      expectedObservedRevision,
    });
    return deployment;
  }

  async transitionSnapshot(
    deployment: RuntimeDeploymentSnapshot,
    target: RuntimeDeploymentStatus,
    expectedObservedRevision: number,
  ): Promise<RuntimeDeploymentSnapshot> {
    return (
      await this.transition(
        String(deployment.providerId),
        String(deployment.deploymentId),
        target,
        deployment.status,
        expectedObservedRevision,
      )
    ).snapshot;
  }

  async fail(
    providerId: string,
    deploymentId: string,
    expectedStatus: RuntimeDeploymentStatus,
    expectedObservedRevision: number,
    errorCode: string,
  ): Promise<void> {
    await this.transition(
      providerId,
      deploymentId,
      "FAILED",
      expectedStatus,
      expectedObservedRevision,
    );
    await this.pool.query(
      `INSERT INTO audit(
         audit_event_id,action,actor_id,correlation_id,subject_type,subject_id,metadata
       ) VALUES ($1,'runtime_deployment.reconcile_failed','pms-worker',$2,
                 'runtime_deployment',$3,$4::jsonb)`,
      [
        randomUUID(),
        `runtime-reconcile:${deploymentId}`,
        deploymentId,
        JSON.stringify({ providerId, errorCode }),
      ],
    );
  }

  async ensureInstance(
    deployment: RuntimeDeploymentSnapshot,
    ordinal: 0,
  ): Promise<RuntimeReconcileInstance> {
    const process = await this.#allocator.allocate({
      providerId: String(deployment.providerId),
      deploymentId: String(deployment.deploymentId),
      ordinal,
      portRange: RUNTIME_PORT_RANGE,
    });
    const locator = parseRuntimeConfigProfileLocator(String(deployment.configProfileId));
    const revision = await this.#configuration.getPublishedRevision(toConfigurationTarget(locator));
    if (revision === null) throw new Error("RUNTIME_CONFIG_PUBLISHED_REVISION_NOT_FOUND");
    const target = targetFrom(deployment, process.instanceId, process.pm2Name, ordinal);
    return Object.freeze({
      target,
      configRevision: revision.revision,
      configChecksum: revision.checksum,
      httpPort: process.port,
      databaseUrlFile: resolve(
        this.secretRoot,
        "deployments",
        String(deployment.deploymentId),
        "instances",
        "database",
        "runtime.secret",
      ),
      effectiveConfig: Object.freeze({
        ...primitiveConfiguration(revision.content),
        RUNTIME_ENV:
          typeof revision.content.RUNTIME_ENV === "string"
            ? revision.content.RUNTIME_ENV
            : String(deployment.environment),
        ...(deployment.adapterEndpoint === undefined
          ? {}
          : { ADAPTER_ENDPOINT: deployment.adapterEndpoint }),
      }),
      pms: Object.freeze({
        baseUrl: this.runtimeControlPlaneUrl,
        tokenFile: await this.runtimeControlPlaneCredentialResolver.resolve({
          providerId: String(deployment.providerId),
          deploymentId: String(deployment.deploymentId),
          instanceId: String(process.instanceId),
        }),
        cachePath: resolve(
          this.configCacheRoot,
          `${String(deployment.deploymentId)}-${String(process.instanceId)}.json`,
        ),
      }),
    });
  }

  async listInstances(
    providerId: string,
    deploymentId: string,
  ): Promise<readonly RuntimeReconcileInstance[]> {
    const deployment = await this.requireDeployment(providerId, deploymentId);
    const processes = await this.#processes.listByDeployment(providerId, deploymentId);
    return Promise.all(
      processes.map((_process, ordinal) => this.ensureInstance(deployment.snapshot, ordinal as 0)),
    );
  }

  async runtimeBaseUrl(deployment: RuntimeDeploymentSnapshot): Promise<string> {
    const instance = await this.ensureInstance(deployment, 0);
    return `http://127.0.0.1:${String(instance.httpPort)}`;
  }

  async recordHealth(
    target: RuntimeInfrastructureInstanceTarget,
    result: RuntimeReconcileHealthResult,
  ): Promise<void> {
    const current = await this.#processes.get(target.providerId, target.instanceId);
    if (current === null) throw new Error("RUNTIME_PROCESS_NOT_FOUND");
    const updated = updateRuntimeProcessObservation(
      current,
      {
        pid: current.pid,
        processState: result.processState,
        livenessState: result.live ? "live" : "dead",
        readinessState: result.ready ? "ready" : "not_ready",
        registrationState: current.registrationState,
        catalogState: current.catalogState,
        configState: current.configState,
        lastHeartbeatAt: current.lastHeartbeatAt,
        runtimeVersion: current.runtimeVersion,
        configRevision: current.configRevision,
        restartCount: current.restartCount,
      },
      current.observedRevision,
    );
    await this.#processes.upsert(target.providerId, updated, current.observedRevision);
  }

  async recordOrphans(
    providerId: string,
    deploymentId: string,
    processNames: readonly string[],
    correlationId: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit(
         audit_event_id,action,actor_id,correlation_id,subject_type,subject_id,metadata
       ) VALUES ($1,'runtime_process.orphans_observed','pms-worker',$2,
                 'runtime_deployment',$3,$4::jsonb)`,
      [randomUUID(), correlationId, deploymentId, JSON.stringify({ providerId, processNames })],
    );
  }
}

class RuntimeProviderIdentityVerifier {
  verify(input: {
    readonly expectedProviderId: string;
    readonly target: RuntimeInfrastructureInstanceTarget;
  }) {
    // Runtime readiness is fail-closed until DescribeProvider has been observed. This verifies
    // the independent PMS/bootstrap relation; the health probe supplies the adapter relation.
    return Promise.resolve(
      verifyProviderIdentity(input.expectedProviderId, {
        bootstrapProviderId: input.target.providerId,
        adapterManifestProviderId: input.target.providerId,
        describeProviderObserved: true,
      }),
    );
  }
}

class PostgresRuntimeLifecycleStore implements RuntimeLifecycleStore {
  constructor(private readonly pool: Pool) {}

  async findCompleted(idempotencyKey: string): Promise<RuntimeLifecycleResult | null> {
    const result = await this.pool.query<{ result_details: RuntimeLifecycleResult }>(
      `SELECT result_details
         FROM runtime_deployment_action
        WHERE idempotency_key=$1 AND status IN ('succeeded','noop')
        LIMIT 1`,
      [idempotencyKey],
    );
    return result.rows[0]?.result_details ?? null;
  }

  async appendState(event: RuntimeLifecycleEvent): Promise<void> {
    await this.appendAuditRow(
      `runtime_process.${event.action}_${event.state}`,
      event.target,
      event.correlationId,
      event.errorCode === undefined ? {} : { errorCode: event.errorCode },
    );
  }

  async complete(idempotencyKey: string, result: RuntimeLifecycleResult): Promise<void> {
    const target = result.process.target;
    await this.pool.query(
      `INSERT INTO runtime_deployment_action(
         action_id,deployment_id,runtime_instance_id,action_type,idempotency_key,status,
         result_details,actor_id,correlation_id,occurred_at,completed_at
       )
       SELECT $1,$2,$3,$4,$5,$6,$7::jsonb,'pms-worker',$8,
              clock_timestamp(),clock_timestamp()
         FROM runtime_deployment
        WHERE deployment_id=$2 AND provider_id=$9
       ON CONFLICT (deployment_id,idempotency_key) DO NOTHING`,
      [
        randomUUID(),
        target.deploymentId,
        target.instanceId,
        `RUNTIME_PROCESS_${result.action.toUpperCase()}`,
        idempotencyKey,
        result.outcome === "unchanged" ? "noop" : "succeeded",
        JSON.stringify(result),
        result.operationId,
        target.providerId,
      ],
    );
  }

  async appendAudit(event: RuntimeLifecycleAuditEvent): Promise<void> {
    await this.appendAuditRow(
      event.action,
      {
        providerId: event.providerId,
        deploymentId: event.deploymentId,
        instanceId: event.instanceId,
      },
      event.correlationId,
      event.errorCode === undefined ? {} : { errorCode: event.errorCode },
    );
  }

  private async appendAuditRow(
    action: string,
    target: {
      readonly providerId: string;
      readonly deploymentId: string;
      readonly instanceId: string;
    },
    correlationId: string,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit(
         audit_event_id,action,actor_id,correlation_id,subject_type,subject_id,metadata
       ) VALUES ($1,$2,'pms-worker',$3,'runtime_process',$4,$5::jsonb)`,
      [
        randomUUID(),
        action,
        correlationId,
        target.instanceId,
        JSON.stringify({
          providerId: target.providerId,
          deploymentId: target.deploymentId,
          ...metadata,
        }),
      ],
    );
  }
}

function targetFrom(
  deployment: RuntimeDeploymentSnapshot,
  instanceId: string,
  processName: string,
  ordinal: number,
): RuntimeInfrastructureInstanceTarget {
  return Object.freeze({
    providerId: String(deployment.providerId),
    deploymentId: String(deployment.deploymentId),
    environment: String(deployment.environment),
    runtimeVersion: deployment.runtimeVersion,
    instanceId,
    ordinal,
    processName,
  });
}

export function primitiveConfiguration(
  content: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string | number | boolean>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(content).filter(
        (entry): entry is [string, string | number | boolean] =>
          !RUNTIME_BOOTSTRAP_RESERVED_KEYS.has(entry[0]) &&
          ["string", "number", "boolean"].includes(typeof entry[1]),
      ),
    ),
  );
}
