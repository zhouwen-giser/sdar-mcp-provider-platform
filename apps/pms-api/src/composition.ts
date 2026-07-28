import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import {
  ProviderManagementService,
  RuntimeDeploymentApplicationService,
  RuntimeProcessQueryService,
  loadProviderPackageQueryService,
} from "../../../packages/pms-application/src/index.js";
import {
  PostgresAuditRepository,
  PostgresPmsUnitOfWork,
  PostgresRegistrySnapshotRepository,
  PostgresRuntimeDeploymentApplicationUnitOfWork,
  PostgresRuntimeDeploymentPrerequisites,
  PostgresRuntimeProcessRepository,
  PostgresRuntimeRegistrationRepository,
  PostgresRuntimeRegistrationUnitOfWork,
  runPmsMigrations,
} from "../../../packages/pms-persistence-postgres/src/index.js";
import {
  ConfigurationPublicationService,
  RuntimeConfigAcknowledgementService,
  RuntimeConfigQueryService,
  RuntimeConfigWatchHub,
  createDefaultConfigurationCenter,
  type ConfigurationPublishedEvent,
  type RuntimeConfigClientRequest,
  type RuntimeConfigWatchSubscription,
} from "../../../packages/configuration-center/src/index.js";
import { RuntimeRegistrationService } from "../../../packages/runtime-registration/src/index.js";
import { createPmsApi, type PmsApiOptions, type PmsReadiness } from "./app.js";
import {
  FilePmsApiRoleAuthorizer,
  FileRuntimeConfigClientAuthorizer,
  FileRuntimeRegistrationAuthorizer,
} from "./file-authorizers.js";
import { RuntimeDeploymentManagementFacade } from "./runtime-deployment-management.js";
import type { RuntimeConfigWatchPort } from "./runtime-config-routes.js";
import { PmsApiAuthenticationRejectionAudit } from "./authorization.js";
import { PMS_API_FROZEN_PROTOCOL_VERSION, type PmsApiBootstrapConfig } from "./config.js";

export interface PmsApiComposition {
  readonly app: FastifyInstance;
  close(): Promise<void>;
}

export interface PmsApiCompositionDependencies {
  readonly createPool?: (connectionString: string) => Pool;
  readonly runMigrations?: (pool: Pool) => Promise<void>;
  readonly loadProviderPackages?: typeof loadProviderPackageQueryService;
  readonly createApp?: (options: PmsApiOptions) => FastifyInstance;
  readonly afterAppCreated?: (app: FastifyInstance) => void | Promise<void>;
}

/**
 * The only production assembly point for Goal 2 PMS API services. It owns the
 * Postgres pool and all long-lived runtime-config subscriptions it creates.
 */
export async function createPmsApiComposition(
  config: PmsApiBootstrapConfig,
  dependencies: PmsApiCompositionDependencies = {},
): Promise<PmsApiComposition> {
  const pool = (dependencies.createPool ?? ((connectionString) => new Pool({ connectionString })))(
    config.databaseUrl,
  );
  const watch = new ManagedRuntimeConfigWatchHub();
  let app: FastifyInstance | undefined;

  try {
    const workspaceRoot = pmsWorkspaceRoot();
    await (dependencies.runMigrations ?? runPmsMigrations)(pool, workspaceRoot);
    const providerPackages = await (
      dependencies.loadProviderPackages ?? loadProviderPackageQueryService
    )(workspaceRoot);
    const unitOfWork = new PostgresPmsUnitOfWork(pool);
    const audit = new PostgresAuditRepository(pool);
    const configurationCenter = createDefaultConfigurationCenter();
    const configurationPublication = new ConfigurationPublicationService(
      configurationCenter,
      unitOfWork,
      { onPublished: (event) => watch.publish(event) },
    );
    const runtimeDeploymentApplication = new RuntimeDeploymentApplicationService(
      new PostgresRuntimeDeploymentApplicationUnitOfWork(pool),
      new PostgresRuntimeDeploymentPrerequisites(pool),
    );
    const runtimeRegistration = new RuntimeRegistrationService(
      new PostgresRuntimeRegistrationUnitOfWork(pool, {
        protocolVersion: PMS_API_FROZEN_PROTOCOL_VERSION,
      }),
      { heartbeatTtlMs: config.runtimeHeartbeatTtlMs },
    );
    const authenticationRejectionAudit = new PmsApiAuthenticationRejectionAudit(audit);

    app = (dependencies.createApp ?? createPmsApi)({
      managementAuthorizer: new FilePmsApiRoleAuthorizer(config.management),
      providerPackages,
      management: new ProviderManagementService(unitOfWork),
      runtimeDeployments: new RuntimeDeploymentManagementFacade(pool, runtimeDeploymentApplication),
      runtimeProcesses: new RuntimeProcessQueryService(new PostgresRuntimeProcessRepository(pool), {
        registrations: new PostgresRuntimeRegistrationRepository(pool),
      }),
      runtimeRegistration,
      runtimeRegistrationAuthorizer: new FileRuntimeRegistrationAuthorizer(config.runtime),
      configurationCenter,
      configurationPublication,
      runtimeConfigQuery: new RuntimeConfigQueryService(unitOfWork),
      runtimeConfigAuthorizer: new FileRuntimeConfigClientAuthorizer(config.runtime),
      runtimeConfigWatch: watch,
      runtimeConfigAcknowledgements: new RuntimeConfigAcknowledgementService(unitOfWork),
      registrySnapshots: new PostgresRegistrySnapshotRepository(pool),
      audit,
      authenticationRejectionAudit,
      readiness: () => readiness(pool),
    });
    await dependencies.afterAppCreated?.(app);
    return composition(app, pool, watch);
  } catch (error) {
    if (app !== undefined) await app.close().catch(() => undefined);
    watch.close();
    await pool.end().catch(() => undefined);
    throw error;
  }
}

function pmsWorkspaceRoot(): string {
  let candidate = process.cwd();
  while (candidate !== dirname(candidate)) {
    if (existsSync(resolve(candidate, "migrations/pms"))) return candidate;
    candidate = dirname(candidate);
  }
  if (existsSync(resolve(candidate, "migrations/pms"))) return candidate;
  throw new Error("PMS_MIGRATION_WORKSPACE_ROOT_UNAVAILABLE");
}

function composition(
  app: FastifyInstance,
  pool: Pool,
  watch: ManagedRuntimeConfigWatchHub,
): PmsApiComposition {
  let closing: Promise<void> | undefined;
  return Object.freeze({
    app,
    close() {
      closing ??= closeComposition(app, pool, watch);
      return closing;
    },
  });
}

async function closeComposition(
  app: FastifyInstance,
  pool: Pool,
  watch: ManagedRuntimeConfigWatchHub,
): Promise<void> {
  try {
    await stopAcceptingHttp(app);
  } finally {
    watch.close();
    try {
      await app.close();
    } finally {
      await pool.end();
    }
  }
}

async function stopAcceptingHttp(app: FastifyInstance): Promise<void> {
  if (!app.server.listening) return;
  app.server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    app.server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

async function readiness(pool: Pool): Promise<PmsReadiness> {
  try {
    await pool.query("SELECT 1");
    return { ready: true, checks: { database: "ready" } };
  } catch {
    return { ready: false, checks: { database: "unavailable" } };
  }
}

class ManagedRuntimeConfigWatchHub implements RuntimeConfigWatchPort {
  readonly #hub = new RuntimeConfigWatchHub();
  readonly #subscriptions = new Set<RuntimeConfigWatchSubscription>();
  #closed = false;

  subscribe(request: RuntimeConfigClientRequest): RuntimeConfigWatchSubscription {
    if (this.#closed) throw new Error("RUNTIME_CONFIG_WATCH_CLOSED");
    const subscription = this.#hub.subscribe(request);
    const managed: RuntimeConfigWatchSubscription = {
      next: () => subscription.next(),
      close: () => {
        subscription.close();
        this.#subscriptions.delete(managed);
      },
    };
    this.#subscriptions.add(managed);
    return managed;
  }

  publish(event: ConfigurationPublishedEvent): void {
    if (!this.#closed) this.#hub.publish(event);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const subscription of [...this.#subscriptions]) subscription.close();
  }
}
