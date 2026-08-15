import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type QueryResultRow } from "pg";
import {
  auditEventId,
  createAuditEvent,
  createDatabaseProfile,
  environmentId,
  providerId,
  secretRef,
} from "../packages/pms-domain/src/index.js";
import {
  formatRuntimeConfigProfileLocator,
  runtimeDeploymentProfileLocator,
  synchronizeWorkspaceProviderPackages,
} from "../packages/pms-application/src/index.js";
import {
  PostgresAuditRepository,
  PostgresConfigurationRepository,
  PostgresDatabaseProfileRepository,
  PostgresPmsUnitOfWork,
} from "../packages/pms-persistence-postgres/src/index.js";
import {
  PostgresProvisioner,
  type ProvisioningSqlClient,
  type RuntimeDatabaseConnectionFactory,
} from "../packages/postgres-provisioner/src/index.js";
import type { PostgresProvisioningSpec } from "../packages/runtime-deployment/src/index.js";
import {
  resolveLivePmsOnboardingConfig,
  type LivePmsOnboardingProviderConfig,
} from "./live-pms-onboarding-config.js";

const CONFIG = resolveLivePmsOnboardingConfig();
const ROOT = CONFIG.root;
const API_BASE_URL = CONFIG.apiBaseUrl;
const ENVIRONMENT = "home-lab";
const RUNTIME_VERSION = "2.0.0-rc.1";
const ACTOR_ID = "smpp-continuation-admin";
const PATHS = CONFIG.paths;
const PROVIDERS = CONFIG.providers;

interface LocalResources {
  readonly homeAssistantUrl: string;
}

interface ProvisioningCredentials {
  readonly clusterRef: string;
  readonly adminSecretRef: string;
  readonly adminDatabaseUrl: string;
  readonly runtimePassword: string;
}

interface ProviderTypeRecord {
  readonly providerTypeId: string;
  readonly status: string;
  readonly updatedAt: string;
}

interface ProviderRecord {
  readonly providerId: string;
  readonly status: string;
  readonly updatedAt: string;
}

interface ResourceRecord {
  readonly environment: string;
  readonly resourceId: string;
  readonly status: string;
  readonly updatedAt: string;
}

interface BindingRecord {
  readonly providerId: string;
  readonly environment: string;
  readonly resourceId: string;
}

interface ConfigDraftRecord {
  readonly draftId: string;
  readonly version: number;
  readonly content: Record<string, unknown>;
}

interface ConfigRevisionRecord {
  readonly revision: number;
  readonly checksum: string;
}

interface RuntimeDeploymentRecord {
  readonly deploymentId: string;
  readonly providerId: string;
  readonly status: string;
  readonly desiredRevision: number;
  readonly observedRevision: number;
}

interface ApiPage<T> {
  readonly items: readonly T[];
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly code?: string,
  ) {
    super(`PMS_API_${String(status)}_${method}_${path}${code === undefined ? "" : `_${code}`}`);
    this.name = "ApiError";
  }
}

async function main(): Promise<void> {
  const correlationId = `smpp-live-onboarding-${randomUUID()}`;
  const resources = await readJson<LocalResources>(PATHS.resources);
  const managementToken = (await readFile(PATHS.managementToken, "utf8")).trim();
  const databaseUrl = (await readFile(PATHS.databaseUrl, "utf8")).trim();
  const credentials = await readJson<ProvisioningCredentials>(PATHS.provisioning);
  const pool = new Pool({ connectionString: databaseUrl });
  const api = new PmsApiClient(managementToken, correlationId);
  sharedPmsPool = pool;
  try {
    const packageSync = await synchronizeWorkspaceProviderPackages(
      new PostgresPmsUnitOfWork(pool),
      { actorId: ACTOR_ID, correlationId },
      ROOT,
    );

    const climateType = await ensureProviderType(api, PROVIDERS.climate.providerTypeId);
    const lightType = await ensureProviderType(api, PROVIDERS.light.providerTypeId);
    const climateProvider = await ensureProvider(api, PROVIDERS.climate);
    const lightProvider = await ensureProvider(api, PROVIDERS.light);

    const climateResource = await ensureResource(api, {
      resourceId: "living-room-air-conditioner",
      resourceType: "home_assistant.climate",
      metadata: { displayName: "Living room air conditioner", capability: "climate" },
    });
    const mainLight = await ensureResource(api, {
      resourceId: "living-room-main-light",
      resourceType: "home_assistant.light",
      metadata: { displayName: "Main light", capability: "light" },
    });
    const auxLight = await ensureResource(api, {
      resourceId: "living-room-aux-light",
      resourceType: "home_assistant.light",
      metadata: { displayName: "Auxiliary light", capability: "light" },
    });

    await ensureProviderActive(api, climateProvider);
    await ensureProviderActive(api, lightProvider);
    await ensureResourceAvailable(api, climateResource);
    await ensureResourceAvailable(api, mainLight);
    await ensureResourceAvailable(api, auxLight);

    const climateBinding = await ensureBinding(api, PROVIDERS.climate.providerId, climateResource);
    const mainBinding = await ensureBinding(api, PROVIDERS.light.providerId, mainLight);
    const auxBinding = await ensureBinding(api, PROVIDERS.light.providerId, auxLight);

    const climateProfile = await ensureDatabaseProfile(
      pool,
      PROVIDERS.climate,
      credentials,
      correlationId,
    );
    const lightProfile = await ensureDatabaseProfile(
      pool,
      PROVIDERS.light,
      credentials,
      correlationId,
    );

    const climateConfig = await ensureProviderConfiguration(
      api,
      resources.homeAssistantUrl,
      "climate",
    );
    const lightConfig = await ensureProviderConfiguration(api, resources.homeAssistantUrl, "light");

    const climateRuntimeConfig = await ensureRuntimeConfiguration(
      api,
      PROVIDERS.climate,
      climateConfig.runtimeConfig,
    );
    const lightRuntimeConfig = await ensureRuntimeConfiguration(
      api,
      PROVIDERS.light,
      lightConfig.runtimeConfig,
    );

    const climateDeployment = await ensureDeployment(api, PROVIDERS.climate, climateRuntimeConfig);
    const lightDeployment = await ensureDeployment(api, PROVIDERS.light, lightRuntimeConfig);

    console.log(
      JSON.stringify({
        evidenceClass: "real",
        environment: ENVIRONMENT,
        packageSync,
        providerTypes: [climateType.providerTypeId, lightType.providerTypeId],
        providers: [climateProvider.providerId, lightProvider.providerId],
        resources: [climateResource.resourceId, mainLight.resourceId, auxLight.resourceId],
        bindings: [climateBinding.resourceId, mainBinding.resourceId, auxBinding.resourceId],
        databaseProfiles: [
          {
            profileId: String(climateProfile.profile.profileId),
            status: climateProfile.provisionStatus,
          },
          {
            profileId: String(lightProfile.profile.profileId),
            status: lightProfile.provisionStatus,
          },
        ],
        runtimeConfigurations: [climateRuntimeConfig, lightRuntimeConfig],
        deployments: [summarizeDeployment(climateDeployment), summarizeDeployment(lightDeployment)],
        next: "pms-worker-reconcile",
      }),
    );
  } finally {
    sharedPmsPool = undefined;
    await pool.end();
  }
}

class PmsApiClient {
  constructor(
    private readonly token: string,
    private readonly correlationId: string,
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "x-actor-id": ACTOR_ID,
        "x-correlation-id": this.correlationId,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const payload = await response.text();
      let code: string | undefined;
      try {
        const parsed = JSON.parse(payload) as { readonly error?: { readonly code?: unknown } };
        code = typeof parsed.error?.code === "string" ? parsed.error.code : undefined;
      } catch {
        code = undefined;
      }
      throw new ApiError(response.status, method, path.split("?", 1)[0] ?? path, code);
    }
    return (await response.json()) as T;
  }

  async getOrNull<T>(path: string): Promise<T | null> {
    try {
      return await this.request<T>("GET", path);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }
}

async function ensureProviderType(
  api: PmsApiClient,
  providerTypeId: string,
): Promise<ProviderTypeRecord> {
  const existing = await api.getOrNull<ProviderTypeRecord>(
    `/api/v1/provider-types/${providerTypeId}`,
  );
  if (existing !== null) return existing;
  return api.request<ProviderTypeRecord>("POST", "/api/v1/provider-types", {
    providerTypeId,
    displayName: providerTypeId,
  });
}

async function ensureProvider(
  api: PmsApiClient,
  input: LivePmsOnboardingProviderConfig,
): Promise<ProviderRecord> {
  const existing = await api.getOrNull<ProviderRecord>(`/api/v1/providers/${input.providerId}`);
  if (existing !== null) return existing;
  return api.request<ProviderRecord>("POST", "/api/v1/providers", {
    providerId: input.providerId,
    providerTypeId: input.providerTypeId,
    packageId: input.packageId,
    packageVersion: input.packageVersion,
    hostingMode: "vendor_managed",
    adapterEndpoint: input.adapterEndpoint,
  });
}

async function ensureResource(
  api: PmsApiClient,
  input: {
    readonly resourceId: string;
    readonly resourceType: string;
    readonly metadata: Record<string, string>;
  },
): Promise<ResourceRecord> {
  const path = `/api/v1/resources/${ENVIRONMENT}/${input.resourceId}`;
  const existing = await api.getOrNull<ResourceRecord>(path);
  if (existing !== null) return existing;
  return api.request<ResourceRecord>("POST", "/api/v1/resources", {
    environment: ENVIRONMENT,
    resourceId: input.resourceId,
    resourceType: input.resourceType,
    metadata: input.metadata,
  });
}

async function ensureProviderActive(api: PmsApiClient, provider: ProviderRecord): Promise<void> {
  if (provider.status === "active") return;
  await api.request<ProviderRecord>("PATCH", `/api/v1/providers/${provider.providerId}/status`, {
    status: "active",
    expectedUpdatedAt: provider.updatedAt,
  });
}

async function ensureResourceAvailable(api: PmsApiClient, resource: ResourceRecord): Promise<void> {
  if (resource.status === "available") return;
  await api.request<ResourceRecord>(
    "PATCH",
    `/api/v1/resources/${resource.environment}/${resource.resourceId}/status`,
    { status: "available", expectedUpdatedAt: resource.updatedAt },
  );
}

async function ensureBinding(
  api: PmsApiClient,
  providerIdValue: string,
  resource: ResourceRecord,
): Promise<BindingRecord> {
  const page = await api.request<ApiPage<BindingRecord>>(
    "GET",
    `/api/v1/providers/${providerIdValue}/resource-bindings`,
  );
  const existing = page.items.find(
    (item) => item.environment === ENVIRONMENT && item.resourceId === resource.resourceId,
  );
  if (existing !== undefined) return existing;
  return api.request<BindingRecord>(
    "POST",
    `/api/v1/providers/${providerIdValue}/resource-bindings`,
    {
      environment: ENVIRONMENT,
      resourceId: resource.resourceId,
    },
  );
}

async function ensureProviderConfiguration(
  api: PmsApiClient,
  homeAssistantUrl: string,
  kind: "climate" | "light",
): Promise<{ readonly runtimeConfig: string }> {
  const provider = kind === "climate" ? PROVIDERS.climate : PROVIDERS.light;
  const definitionId =
    kind === "climate" ? "provider.homeAssistantClimate" : "provider.homeAssistantLight";
  const configGroup = definitionId;
  const content =
    kind === "climate"
      ? {
          ADAPTER_HOST: provider.adapterHost,
          ADAPTER_PORT: provider.adapterPort,
          ADAPTER_TLS_MODE: "disabled",
          HOME_ASSISTANT_URL: homeAssistantUrl,
          HOME_ASSISTANT_TOKEN_FILE: { secretRef: "file/v1/home-lab/ha-climate-lab/token" },
          HOME_ASSISTANT_ALLOW_INSECURE_HTTP: true,
          CLIMATE_RESOURCES_FILE: PATHS.climateResources,
          PROVIDER_STATE_PATH: PATHS.climateState,
          PROVIDER_TELEMETRY_ENABLED: false,
          RUNTIME_ENV: "development",
        }
      : {
          ADAPTER_HOST: provider.adapterHost,
          ADAPTER_PORT: provider.adapterPort,
          ADAPTER_TLS_MODE: "disabled",
          HOME_ASSISTANT_URL: homeAssistantUrl,
          HOME_ASSISTANT_TOKEN_FILE: { secretRef: "file/v1/home-lab/ha-light-lab/token" },
          HOME_ASSISTANT_ALLOW_INSECURE_HTTP: true,
          LIGHT_RESOURCES_FILE: PATHS.lightResources,
          PROVIDER_STATE_PATH: PATHS.lightState,
          PROVIDER_TELEMETRY_ENABLED: false,
          RUNTIME_ENV: "development",
        };
  const draftId = kind === "climate" ? "ha-climate-provider-config" : "ha-light-provider-config";
  await ensurePublishedDraft(api, {
    draftId,
    definitionId,
    environment: ENVIRONMENT,
    targetType: "provider",
    targetId: provider.providerId,
    configGroup,
    dataId: "main",
    content,
  });
  return {
    runtimeConfig: formatRuntimeConfigProfileLocator(
      runtimeDeploymentProfileLocator({
        environment: ENVIRONMENT,
        targetId: provider.deploymentId,
        configGroup: "runtime.bootstrap",
        dataId: "process",
      }),
    ),
  };
}

async function ensureRuntimeConfiguration(
  api: PmsApiClient,
  provider: LivePmsOnboardingProviderConfig,
  configProfileId: string,
): Promise<string> {
  const content = {
    RUNTIME_ENV: "development",
    HOST: "127.0.0.1",
    DATABASE_POOL_MAX: 10,
    ADAPTER_ENDPOINT: provider.adapterEndpoint,
    ADAPTER_TLS_MODE: "disabled",
    ADAPTER_RPC_TIMEOUT_MS: 5_000,
  };
  const draft = await ensurePublishedDraft(api, {
    draftId: provider.configDraftId,
    definitionId: "runtime.bootstrap",
    environment: ENVIRONMENT,
    targetType: "runtime_deployment",
    targetId: provider.deploymentId,
    configGroup: "runtime.bootstrap",
    dataId: "process",
    content,
  });
  void configProfileId;
  return draft.configProfileId;
}

async function ensurePublishedDraft(
  api: PmsApiClient,
  input: {
    readonly draftId: string;
    readonly definitionId: string;
    readonly environment: string;
    readonly targetType: "provider" | "runtime_deployment";
    readonly targetId: string;
    readonly configGroup: string;
    readonly dataId: string;
    readonly content: Record<string, unknown>;
  },
): Promise<{ readonly configProfileId: string; readonly revision: ConfigRevisionRecord | null }> {
  const draft = await api.getOrNull<ConfigDraftRecord>(`/api/v1/config-drafts/${input.draftId}`);
  if (draft === null) {
    await api.request<ConfigDraftRecord>("POST", "/api/v1/config-drafts", {
      draftId: input.draftId,
      definitionId: input.definitionId,
      environment: input.environment,
      targetType: input.targetType,
      targetId: input.targetId,
      configGroup: input.configGroup,
      dataId: input.dataId,
      content: input.content,
    });
  } else if (JSON.stringify(draft.content) !== JSON.stringify(input.content)) {
    await api.request<ConfigDraftRecord>("PATCH", `/api/v1/config-drafts/${input.draftId}`, {
      expectedVersion: draft.version,
      content: input.content,
    });
  }
  const validated = await api.request<ConfigDraftRecord>(
    "POST",
    `/api/v1/config-drafts/${input.draftId}/validate`,
  );
  if (validated.version < 1) throw new Error("PMS_CONFIG_DRAFT_VERSION_INVALID");

  if (sharedPmsPool === undefined) throw new Error("PMS_CONFIGURATION_POOL_UNAVAILABLE");
  const configRepository = new PostgresConfigurationRepository(sharedPmsPool);
  const current = await configRepository.getPublishedRevision({
    environment: environmentId(input.environment),
    targetType: input.targetType,
    targetId: input.targetId,
    configGroup: input.configGroup,
    dataId: input.dataId,
  });
  const published = await api.request<{ revision: ConfigRevisionRecord }>(
    "POST",
    `/api/v1/config-drafts/${input.draftId}/publish`,
    {
      expectedDraftVersion: validated.version,
      expectedPublishedRevision: current?.revision ?? null,
    },
  );
  return {
    configProfileId:
      input.targetType === "runtime_deployment"
        ? formatRuntimeConfigProfileLocator(
            runtimeDeploymentProfileLocator({
              environment: input.environment,
              targetId: input.targetId,
              configGroup: input.configGroup,
              dataId: input.dataId,
            }),
          )
        : "",
    revision: published.revision,
  };
}

let sharedPmsPool: Pool | undefined;

async function ensureDatabaseProfile(
  pool: Pool,
  provider: LivePmsOnboardingProviderConfig,
  credentials: ProvisioningCredentials,
  correlationId: string,
) {
  const repository = new PostgresDatabaseProfileRepository(pool);
  const existing = await repository.get(provider.providerId, ENVIRONMENT);
  if (
    existing !== null &&
    provider.databaseName !== undefined &&
    (existing.profile.databaseMode !== "preexisting" ||
      existing.profile.databaseName !== provider.databaseName)
  ) {
    throw new Error("PMS_DATABASE_PROFILE_OVERRIDE_MISMATCH");
  }
  const profile =
    existing?.profile ??
    createDatabaseProfile({
      profileId: provider.databaseProfileId,
      providerId: providerId(provider.providerId),
      environment: environmentId(ENVIRONMENT),
      clusterRef: credentials.clusterRef,
      host: "127.0.0.1",
      port: CONFIG.postgresPort,
      databaseMode: provider.databaseMode,
      ...(provider.databaseName === undefined ? {} : { databaseName: provider.databaseName }),
      sslMode: "disable",
      adminSecretRef: secretRef(credentials.adminSecretRef),
      runtimeSecretRef: secretRef(`file/v1/${provider.deploymentId}/database/runtime`),
    });
  if (existing === null) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const audit = new PostgresAuditRepository(client);
      const event = createAuditEvent({
        auditEventId: auditEventId(randomUUID()),
        action: "database_profile.created",
        actorId: ACTOR_ID,
        correlationId,
        subjectType: "database_profile",
        subjectId: provider.databaseProfileId,
        occurredAt: new Date(),
        metadata: { providerId: provider.providerId, environment: ENVIRONMENT },
      });
      await audit.append(event);
      await new PostgresDatabaseProfileRepository(client).insert(profile, event.auditEventId);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  await provisionDatabaseProfile(profile, credentials, provider.deploymentId);
  const current = await repository.get(provider.providerId, ENVIRONMENT);
  if (current === null) throw new Error("PMS_DATABASE_PROFILE_MISSING_AFTER_PROVISION");
  if (current.provisionStatus === "ready") return current;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const audit = new PostgresAuditRepository(client);
    const event = createAuditEvent({
      auditEventId: auditEventId(randomUUID()),
      action: "database_profile.provisioned",
      actorId: ACTOR_ID,
      correlationId,
      subjectType: "database_profile",
      subjectId: provider.databaseProfileId,
      occurredAt: new Date(),
      metadata: { providerId: provider.providerId, environment: ENVIRONMENT },
    });
    await audit.append(event);
    const updated = await new PostgresDatabaseProfileRepository(client).updateProvisionResult({
      profileId: provider.databaseProfileId,
      providerId: provider.providerId,
      environment: ENVIRONMENT,
      status: "ready",
      provisionedAt: new Date(),
      auditEventId: event.auditEventId,
      expectedRevision: current.revision,
    });
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function provisionDatabaseProfile(
  profile: {
    readonly profileId: unknown;
    readonly providerId: unknown;
    readonly environment: unknown;
    readonly clusterRef: unknown;
    readonly host: string;
    readonly port: number;
    readonly databaseMode: "provisioned" | "preexisting";
    readonly databaseName: string;
    readonly runtimeRoleName: string;
    readonly sslMode: string;
    readonly adminSecretRef: { readonly secretRef: string };
    readonly runtimeSecretRef: { readonly secretRef: string };
  },
  credentials: ProvisioningCredentials,
  deploymentId: string,
): Promise<void> {
  const admin = new Pool({ connectionString: credentials.adminDatabaseUrl });
  const provisioner = new PostgresProvisioner(admin, {
    credentialRotation: {
      async ensureRuntimeCredential(spec, _context, adminClient) {
        const result = await adminClient.query<{ statement: string }>(
          "SELECT format('ALTER ROLE %I PASSWORD %L',$1::text,$2::text) AS statement",
          [spec.runtimeRoleName, credentials.runtimePassword],
        );
        const statement = result.rows[0]?.statement;
        if (statement === undefined) throw new Error("PMS_RUNTIME_CREDENTIAL_ROTATION_FAILED");
        await adminClient.query(statement);
        return { changed: true };
      },
    },
    connections: provisioningConnections(credentials),
  });
  const spec: PostgresProvisioningSpec = {
    profileId: String(profile.profileId),
    providerId: String(profile.providerId),
    environment: String(profile.environment),
    clusterRef: String(profile.clusterRef),
    host: profile.host,
    port: profile.port,
    databaseMode: profile.databaseMode,
    databaseName: profile.databaseName,
    runtimeRoleName: profile.runtimeRoleName,
    sslMode: profile.sslMode as PostgresProvisioningSpec["sslMode"],
    adminSecretRef: profile.adminSecretRef,
    runtimeSecretRef: profile.runtimeSecretRef,
  };
  try {
    await provisioner.createRole(spec, {
      operationId: `pms-${deploymentId}`,
      idempotencyKey: `pms-${deploymentId}:role`,
      mode: "apply",
    });
    await provisioner.createDatabase(spec, {
      operationId: `pms-${deploymentId}`,
      idempotencyKey: `pms-${deploymentId}:database`,
      mode: "apply",
    });
    await provisioner.grantRuntimeAccess(spec, {
      operationId: `pms-${deploymentId}`,
      idempotencyKey: `pms-${deploymentId}:grant`,
      mode: "apply",
    });
    await provisioner.verify(spec, {
      operationId: `pms-${deploymentId}`,
      idempotencyKey: `pms-${deploymentId}:verify`,
      mode: "apply",
    });
  } finally {
    await admin.end();
  }
}

function provisioningConnections(
  credentials: ProvisioningCredentials,
): RuntimeDatabaseConnectionFactory {
  return {
    connectDatabase(databaseName) {
      return Promise.resolve(
        new ClosablePool(
          new Pool({
            connectionString: replaceDatabase(credentials.adminDatabaseUrl, databaseName),
          }),
        ),
      );
    },
    connectRuntime(spec) {
      return Promise.resolve(
        new ClosablePool(
          new Pool({ connectionString: runtimeDatabaseUrl(spec, credentials.runtimePassword) }),
        ),
      );
    },
    async close(client) {
      await (client as ClosablePool).close();
    },
  };
}

class ClosablePool implements ProvisioningSqlClient {
  constructor(private readonly pool: Pool) {}

  query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]) {
    return this.pool.query<Row>(sql, values === undefined ? [] : [...values]);
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

function replaceDatabase(source: string, databaseName: string): string {
  const url = new URL(source);
  url.pathname = `/${encodeURIComponent(databaseName)}`;
  return url.toString();
}

function runtimeDatabaseUrl(spec: PostgresProvisioningSpec, password: string): string {
  const url = new URL("postgresql://localhost");
  url.hostname = spec.host;
  url.port = String(spec.port);
  url.pathname = `/${encodeURIComponent(spec.databaseName)}`;
  url.username = spec.runtimeRoleName;
  url.password = password;
  url.searchParams.set("sslmode", spec.sslMode);
  return url.toString();
}

async function ensureDeployment(
  api: PmsApiClient,
  provider: LivePmsOnboardingProviderConfig,
  configProfileId: string,
): Promise<RuntimeDeploymentRecord> {
  const existing = await api.getOrNull<RuntimeDeploymentRecord>(
    `/api/v1/runtime-deployments/${provider.deploymentId}?providerId=${provider.providerId}`,
  );
  if (existing !== null) return existing;
  const response = await api.request<{ deployment: RuntimeDeploymentRecord }>(
    "POST",
    "/api/v1/runtime-deployments",
    {
      deploymentId: provider.deploymentId,
      providerId: provider.providerId,
      environment: ENVIRONMENT,
      runtimeVersion: RUNTIME_VERSION,
      databaseProfileId: provider.databaseProfileId,
      configProfileId,
      adapterEndpoint: provider.adapterEndpoint,
      desiredReplicas: 1,
    },
  );
  return response.deployment;
}

function summarizeDeployment(value: RuntimeDeploymentRecord) {
  return {
    deploymentId: value.deploymentId,
    providerId: value.providerId,
    status: value.status,
    desiredRevision: value.desiredRevision,
    observedRevision: value.observedRevision,
  };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

void main().catch((error: unknown) => {
  if (error instanceof ApiError) {
    console.error(error.message);
  } else if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error("PMS_LIVE_ONBOARDING_FAILED");
  }
  process.exitCode = 1;
});
