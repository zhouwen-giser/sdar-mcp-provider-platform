import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as grpc from "@grpc/grpc-js";
import type { Pool } from "pg";
import { GrpcAdapterGateway } from "../../../packages/adapter-protocol/src/index.js";
import {
  RuntimeDeploymentReconciler,
  parseRuntimeConfigProfileLocator,
  toConfigurationTarget,
  verifyProviderIdentity,
  type RuntimeReconcileAdapterTlsConfiguration,
  type RuntimeReconcileDirectInstance,
  type RuntimeReconcileProviderIdentityVerification,
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
  type RuntimePortRange,
  type RuntimeProcessObservation,
  type RuntimeProcessProjection,
} from "../../../packages/runtime-deployment/src/index.js";
import {
  CatalogRegistryPublicationPhase,
  CatalogRegistryReconcileDecorator,
  HttpCatalogRegistryDiscovery,
} from "./catalog-registry-phase.js";
import type { PmsWorkerConfig } from "./config.js";
import { requirePmsWorkerRuntimeConfig } from "./config.js";
import {
  ExternalRuntimeCatalogCredentialResolver,
  NoExternalRuntimeCatalogCredentialResolver,
} from "./external-runtime-catalog-credentials.js";
import { ExternalRuntimeHealthProbe } from "./external-runtime-health.js";
import { PeriodicReconcileScheduler } from "./reconcile-scheduler.js";
import { buildRegistryProviderProjection } from "./registry-provider-projection.js";
import { createRuntimeDatabasePreparation } from "./runtime-database-preparation-job.js";
import {
  RuntimeControlPlaneCredentialResolver,
  type RuntimeControlPlaneCredentialResolverContract,
} from "./runtime-control-plane-credentials.js";

const DEFAULT_RUNTIME_PORT_RANGE = runtimePortRange(18_080, 19_079);
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
  const portRange =
    runtime.runtimePortRange === undefined
      ? DEFAULT_RUNTIME_PORT_RANGE
      : runtimePortRange(runtime.runtimePortRange.start, runtime.runtimePortRange.end);
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
    const externalRuntimeCatalogCredentialResolver =
      runtime.externalRuntimeCatalogCredentialFile === undefined
        ? new NoExternalRuntimeCatalogCredentialResolver()
        : await ExternalRuntimeCatalogCredentialResolver.create(
            runtime.externalRuntimeCatalogCredentialFile,
          );
    const store = new PostgresRuntimeReconcileStore(
      pool,
      runtime.runtimeSecretRoot,
      runtime.runtimeConfigCacheRoot,
      runtime.runtimeControlPlaneUrl,
      runtimeControlPlaneCredentialResolver,
      portRange,
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
    const externalHealth = new ExternalRuntimeHealthProbe({
      allowInsecureInternalTransport: runtime.allowInsecureInternalTransport,
    });
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
      {
        probe: (input) =>
          externalHealth.probe({
            ...input,
            timeoutMs: Math.min(input.timeoutMs, runtime.runtimeHealthTimeoutMs),
          }),
      },
    );
    const publication = new CatalogRegistryPublicationPhase(
      new HttpCatalogRegistryDiscovery({
        allowInsecureInternalTransport: runtime.allowInsecureInternalTransport,
      }),
      {
        resolve: async (deployment) => {
          const target = await store.runtimeControlTarget(deployment);
          const authorization = await externalRuntimeCatalogCredentialResolver.authorization(
            deployment,
            target.instanceId,
          );
          return {
            endpoint: runtimeMcpEndpoint(target.baseUrl),
            ...(authorization === undefined ? {} : { authorization }),
          };
        },
      },
      repositories.catalogSnapshots,
      {
        providers: async ({ deployment, catalog }) =>
          buildRegistryProviderProjection({
            deployment,
            catalog,
            deployments: await repositories.runtimeDeployments.listByEnvironment(
              String(deployment.environment),
            ),
            activeCatalog: (providerId) => repositories.catalogSnapshots.active(providerId),
            ensureInstance: async (candidate) => ({
              instanceId: (await store.runtimeControlTarget(candidate)).instanceId,
            }),
            advertisedBaseUrl: (candidate) => store.runtimeAdvertisedBaseUrl(candidate),
          }),
      },
      repositories.registrySnapshots,
      {
        recordCatalogState: (deployment, state) => store.recordCatalogState(deployment, state),
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
      { allowInsecureInternalTransport: runtime.allowInsecureInternalTransport },
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
  readonly #portRange: RuntimePortRange;

  constructor(
    private readonly pool: Pool,
    private readonly secretRoot: string,
    private readonly configCacheRoot: string,
    private readonly runtimeControlPlaneUrl: string,
    private readonly runtimeControlPlaneCredentialResolver: RuntimeControlPlaneCredentialResolverContract,
    portRange: RuntimePortRange,
  ) {
    this.#deployments = new PostgresRuntimeDeploymentRepository(pool);
    this.#processes = new PostgresRuntimeProcessRepository(pool);
    this.#allocator = new PostgresRuntimeInstanceAllocator(pool);
    this.#configuration = new PostgresConfigurationRepository(pool);
    this.#portRange = portRange;
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
    if (deployment.runtimeAuthority === "direct_container") {
      throw new Error("DIRECT_CONTAINER_INSTANCE_REQUIRES_OBSERVATION");
    }
    const process = await this.#allocator.allocate({
      providerId: String(deployment.providerId),
      deploymentId: String(deployment.deploymentId),
      ordinal,
      portRange: this.#portRange,
    });
    if (process.processManager === "direct_container") {
      throw new Error("PLATFORM_MANAGED_INSTANCE_ALLOCATION_INVALID");
    }
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

  async getDirectInstance(
    deployment: RuntimeDeploymentSnapshot,
    ordinal: 0,
  ): Promise<RuntimeReconcileDirectInstance> {
    if (deployment.runtimeAuthority !== "direct_container") {
      throw new Error("DIRECT_CONTAINER_INSTANCE_INVALID");
    }
    const process = await this.#processes.get(
      String(deployment.providerId),
      String(deployment.directContainer.instanceId),
    );
    if (
      process?.processManager !== "direct_container" ||
      String(process.deploymentId) !== String(deployment.deploymentId) ||
      process.controlEndpoint !== deployment.directContainer.controlEndpoint ||
      process.advertisedEndpoint !== deployment.directContainer.advertisedEndpoint
    ) {
      throw new Error("DIRECT_CONTAINER_EXPECTED_INSTANCE_NOT_FOUND");
    }
    const freshness = await this.pool.query<{ readonly fresh: boolean }>(
      `SELECT EXISTS(
         SELECT 1
           FROM runtime_registration
          WHERE deployment_id=$1 AND runtime_instance_id=$2
            AND expires_at > clock_timestamp()
       ) AS fresh`,
      [String(deployment.deploymentId), String(process.instanceId)],
    );
    return Object.freeze({
      target: targetFrom(
        deployment,
        String(process.instanceId),
        `direct-container-${String(process.instanceId)}`,
        ordinal,
      ),
      controlEndpoint: process.controlEndpoint,
      advertisedEndpoint: process.advertisedEndpoint,
      registrationState: process.registrationState,
      registrationFresh: freshness.rows[0]?.fresh === true,
    });
  }

  async listInstances(
    providerId: string,
    deploymentId: string,
  ): Promise<readonly (RuntimeReconcileInstance | RuntimeReconcileDirectInstance)[]> {
    const deployment = await this.requireDeployment(providerId, deploymentId);
    if (deployment.snapshot.runtimeAuthority === "direct_container") {
      return [await this.getDirectInstance(deployment.snapshot, 0)];
    }
    const processes = await this.#processes.listByDeployment(providerId, deploymentId);
    return Promise.all(
      processes.map((_process, ordinal) => this.ensureInstance(deployment.snapshot, ordinal as 0)),
    );
  }

  async runtimeControlTarget(
    deployment: RuntimeDeploymentSnapshot,
  ): Promise<{ readonly instanceId: string; readonly baseUrl: string }> {
    if (deployment.runtimeAuthority === "direct_container") {
      const instance = await this.getDirectInstance(deployment, 0);
      return { instanceId: instance.target.instanceId, baseUrl: instance.controlEndpoint };
    }
    const instance = await this.ensureInstance(deployment, 0);
    return {
      instanceId: instance.target.instanceId,
      baseUrl: `http://127.0.0.1:${String(instance.httpPort)}`,
    };
  }

  async runtimeAdvertisedBaseUrl(deployment: RuntimeDeploymentSnapshot): Promise<string> {
    if (deployment.runtimeAuthority === "direct_container") {
      return (await this.getDirectInstance(deployment, 0)).advertisedEndpoint;
    }
    return (await this.runtimeControlTarget(deployment)).baseUrl;
  }

  async recordCatalogState(
    deployment: RuntimeDeploymentSnapshot,
    catalogState: "pending" | "valid" | "invalid",
  ): Promise<void> {
    const instanceId =
      deployment.runtimeAuthority === "direct_container"
        ? String(deployment.directContainer.instanceId)
        : (await this.ensureInstance(deployment, 0)).target.instanceId;
    await updateRuntimeProcessObservationWithRetry({
      load: () => this.#processes.get(String(deployment.providerId), instanceId),
      save: (updated, expectedRevision) =>
        this.#processes.upsert(String(deployment.providerId), updated, expectedRevision),
      patch: (current) => observation(current, { catalogState }),
      failureCode: "RUNTIME_CATALOG_STATE_CONFLICT",
    });
  }

  async recordHealth(
    target: RuntimeInfrastructureInstanceTarget,
    result: RuntimeReconcileHealthResult,
  ): Promise<void> {
    await updateRuntimeProcessObservationWithRetry({
      load: () => this.#processes.get(target.providerId, target.instanceId),
      save: (updated, expectedRevision) =>
        this.#processes.upsert(target.providerId, updated, expectedRevision),
      patch: (current) =>
        observation(current, {
          processState: result.processState,
          livenessState: result.live ? "live" : "dead",
          readinessState: result.ready ? "ready" : "not_ready",
        }),
      failureCode: "RUNTIME_HEALTH_STATE_CONFLICT",
    });
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

interface ProviderManifestGateway {
  describeProvider(): Promise<{ readonly providerId: string }>;
  close(): void;
}

export class RuntimeProviderIdentityVerifier {
  constructor(
    private readonly gateway: (input: {
      readonly endpoint: string;
      readonly providerId: string;
      readonly timeoutMs: number;
      readonly credentials: grpc.ChannelCredentials;
    }) => ProviderManifestGateway = (input) => new GrpcAdapterGateway(input),
    private readonly credentials: (
      input: RuntimeReconcileAdapterTlsConfiguration,
    ) => grpc.ChannelCredentials = adapterIdentityCredentials,
  ) {}

  async verify(input: {
    readonly expectedProviderId: string;
    readonly target: RuntimeInfrastructureInstanceTarget;
    readonly bootstrapProviderId: string;
    readonly adapterEndpoint: string;
    readonly adapterTls: RuntimeReconcileAdapterTlsConfiguration;
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
  }): Promise<RuntimeReconcileProviderIdentityVerification> {
    assertProviderIdentitySignal(input.signal);
    const gateway = this.gateway({
      endpoint: input.adapterEndpoint,
      providerId: input.expectedProviderId,
      timeoutMs: input.timeoutMs,
      credentials: this.credentials(input.adapterTls),
    });
    try {
      const manifest = await gateway.describeProvider();
      assertProviderIdentitySignal(input.signal);
      return verifyProviderIdentity(input.expectedProviderId, {
        bootstrapProviderId: input.bootstrapProviderId,
        adapterManifestProviderId: manifest.providerId,
        describeProviderObserved: true,
      });
    } catch {
      assertProviderIdentitySignal(input.signal);
      return Object.freeze({
        valid: false,
        reasonCode: "PROVIDER_IDENTITY_UNAVAILABLE",
        mismatchRelations: Object.freeze([]),
        retryable: true,
      });
    } finally {
      gateway.close();
    }
  }
}

function adapterIdentityCredentials(
  input: RuntimeReconcileAdapterTlsConfiguration,
): grpc.ChannelCredentials {
  if (input.mode === "disabled") return grpc.credentials.createInsecure();
  return grpc.credentials.createSsl(
    readFileSync(input.caPath),
    readFileSync(input.keyPath),
    readFileSync(input.certPath),
  );
}

function assertProviderIdentitySignal(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("RUNTIME_PROVIDER_IDENTITY_ABORTED");
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

export function runtimeMcpEndpoint(baseUrl: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(baseUrl);
  } catch (error) {
    throw new Error("RUNTIME_CONTROL_ENDPOINT_INVALID", { cause: error });
  }
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.pathname !== "/" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    throw new Error("RUNTIME_CONTROL_ENDPOINT_INVALID");
  }
  endpoint.pathname = "/mcp";
  return endpoint.toString();
}

function observation(
  current: RuntimeProcessProjection,
  overrides: Partial<RuntimeProcessObservation>,
): RuntimeProcessObservation {
  return {
    pid: current.pid,
    processState: current.processState,
    livenessState: current.livenessState,
    readinessState: current.readinessState,
    registrationState: current.registrationState,
    catalogState: current.catalogState,
    configState: current.configState,
    lastHeartbeatAt: current.lastHeartbeatAt,
    runtimeVersion: current.runtimeVersion,
    configRevision: current.configRevision,
    restartCount: current.restartCount,
    ...overrides,
  };
}

export async function updateRuntimeProcessObservationWithRetry(input: {
  readonly load: () => Promise<RuntimeProcessProjection | null>;
  readonly save: (updated: RuntimeProcessProjection, expectedRevision: number) => Promise<unknown>;
  readonly patch: (current: RuntimeProcessProjection) => RuntimeProcessObservation;
  readonly failureCode: string;
  readonly maxAttempts?: number;
}): Promise<void> {
  const maxAttempts = input.maxAttempts ?? 5;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new Error("RUNTIME_PROCESS_OBSERVATION_RETRY_INVALID");
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const current = await input.load();
    if (current === null) throw new Error("RUNTIME_PROCESS_NOT_FOUND");
    const updated = updateRuntimeProcessObservation(
      current,
      input.patch(current),
      current.observedRevision,
    );
    if (updated === current) return;
    try {
      await input.save(updated, current.observedRevision);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(input.failureCode, { cause: lastError });
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
