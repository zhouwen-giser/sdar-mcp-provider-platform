import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { Pool, type QueryResultRow } from "pg";
import { assertCatalogPublicData, canonicalize } from "../../packages/catalog-manager/src/index.js";
import {
  auditEventId,
  createAuditEvent,
  createDatabaseProfile,
  environmentId,
  providerId,
  secretRef,
} from "../../packages/pms-domain/src/index.js";
import {
  formatRuntimeConfigProfileLocator,
  runtimeDeploymentProfileLocator,
  synchronizeWorkspaceProviderPackages,
} from "../../packages/pms-application/src/index.js";
import {
  PostgresAuditRepository,
  PostgresConfigurationRepository,
  PostgresDatabaseProfileRepository,
  PostgresPmsUnitOfWork,
} from "../../packages/pms-persistence-postgres/src/index.js";
import {
  PostgresProvisioner,
  type ProvisioningSqlClient,
  type RuntimeDatabaseConnectionFactory,
} from "../../packages/postgres-provisioner/src/index.js";
import {
  deriveRuntimeInstanceIdentity,
  type PostgresProvisioningSpec,
} from "../../packages/runtime-deployment/src/index.js";

const PACKAGE_ID = "builtin.isr.vehicle.npc-tank";
const PACKAGE_VERSION = "0.1.0";
const PROVIDER_TYPE_ID = "isr.vehicle.npc_tank";
const PROVIDER_ID = "isr.vehicle.npc-tank.npc-tank1";
const RESOURCE_ID = "vehicle:npc_tank1";
const RESOURCE_TYPE = "isr.vehicle.npc_tank";
const DEPLOYMENT_ID = "npc-tank-runtime-deployment";
const DATABASE_PROFILE_ID = "npc-tank-runtime-db-profile";
const PROVIDER_CONFIG_DRAFT_ID = "npc-tank-provider-config";
const RUNTIME_CONFIG_DRAFT_ID = "npc-tank-runtime-config";
const RUNTIME_VERSION = "2.0.0-rc.1";
const PROTOCOL_VERSION = "2026-07-28";
const DEFAULT_API_BASE_URL = "http://127.0.0.1:8090";
const DEFAULT_DATABASE_URL_FILE = "/run/pms-secrets/pms-database-url";
const DEFAULT_PROVISIONING_FILE = "/run/pms-secrets/worker/postgres-provisioning.json";
const DEFAULT_RUNTIME_CREDENTIAL_ROOT = "/var/lib/sdar/runtime-control-plane";
const MAX_CREDENTIAL_BYTES = 16_384;
const MAX_API_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUIRED_READ_OPERATIONS = Object.freeze([
  "vehicle_get_state",
  "vehicle_get_capabilities",
  "vehicle_get_payload_status",
  "vehicle_get_targets",
]);

type JsonObject = Record<string, unknown>;

interface Options {
  readonly dryRun: boolean;
  readonly root: string;
  readonly apiBaseUrl: string;
  readonly databaseUrlFile: string;
  readonly provisioningFile: string;
  readonly runtimeCredentialRoot: string;
  readonly managementTokenFile?: string;
  readonly managementTokenStdin: boolean;
  readonly actorId?: string;
  readonly environment: string;
  readonly adapterEndpoint: string;
  readonly wireMode: "ros_message_json" | "direct_domain_json" | "ros_bridge_json";
  readonly waitMs: number;
  readonly pollMs: number;
  readonly onboardingOutput?: string;
  readonly registryOutput?: string;
}

interface ProvisioningCredentials {
  readonly clusterRef: string;
  readonly adminSecretRef: string;
  readonly adminDatabaseUrl: string;
  readonly runtimePassword: string;
}

interface ProviderPackageRecord {
  readonly packageId: string;
  readonly packageVersion: string;
  readonly providerType: string;
  readonly hostingModes: readonly string[];
  readonly compatibleRuntimeVersion: string;
  readonly protocolMode: string;
  readonly qualification: {
    readonly componentStatus: string;
    readonly realResourceStatus: string;
  };
}

interface ProviderTypeRecord {
  readonly providerTypeId: string;
  readonly status: string;
  readonly updatedAt: string;
}

interface ProviderRecord {
  readonly providerId: string;
  readonly providerTypeId?: string;
  readonly packageId?: string;
  readonly packageVersion?: string;
  readonly hostingMode?: string;
  readonly adapterEndpoint?: string;
  readonly status: string;
  readonly updatedAt: string;
}

interface ResourceRecord {
  readonly environment: string;
  readonly resourceId: string;
  readonly resourceType?: string;
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
  readonly content: JsonObject;
}

interface ConfigRevisionRecord {
  readonly revision: number;
  readonly checksum: string;
}

interface EffectiveConfigPreview {
  readonly content: JsonObject;
  readonly valid: boolean;
  readonly issues: readonly unknown[];
}

interface RuntimeDeploymentRecord {
  readonly deploymentId: string;
  readonly providerId: string;
  readonly environment?: string;
  readonly runtimeVersion?: string;
  readonly databaseProfileId?: string;
  readonly configProfileId?: string;
  readonly adapterEndpoint?: string;
  readonly status: string;
  readonly desiredState?: string;
  readonly desiredReplicas?: number;
  readonly desiredRevision: number;
  readonly observedRevision: number;
  readonly lastErrorCode?: string;
}

interface ApiPage<T> {
  readonly items: readonly T[];
}

interface RawApiResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: unknown;
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly code?: string,
  ) {
    super(
      `PMS_API_${String(status)}_${method}_${sanitizePath(path)}${code === undefined ? "" : `_${code}`}`,
    );
    this.name = "ApiError";
  }
}

class PmsApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly actorId: string,
    private readonly correlationId: string,
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.raw(method, path, body);
    if (response.status < 200 || response.status >= 300) {
      throw apiError(response, method, path);
    }
    return response.body as T;
  }

  async getOrNull<T>(path: string): Promise<T | null> {
    const response = await this.raw("GET", path);
    if (response.status === 404) return null;
    if (response.status < 200 || response.status >= 300) {
      throw apiError(response, "GET", path);
    }
    return response.body as T;
  }

  async raw(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Readonly<Record<string, string>> = {},
  ): Promise<RawApiResponse> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.token}`,
        "x-actor-id": this.actorId,
        "x-correlation-id": this.correlationId,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    const source = await boundedResponseText(response, MAX_API_RESPONSE_BYTES);
    let parsed: unknown = null;
    if (source.length > 0) {
      try {
        parsed = JSON.parse(source) as unknown;
      } catch {
        if (response.status !== 304) throw new Error("PMS_API_RESPONSE_JSON_INVALID");
      }
    }
    return { status: response.status, headers: response.headers, body: parsed };
  }
}

export async function run(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const options = parseOptions(argv);
  const identity = deriveRuntimeInstanceIdentity({
    providerId: PROVIDER_ID,
    deploymentId: DEPLOYMENT_ID,
    ordinal: 0,
  });
  const packageDocument = await loadAndValidatePackage(options.root);
  if (options.dryRun) {
    process.stdout.write(
      `${JSON.stringify(dryRunEvidence(options, identity.instanceId, packageDocument), null, 2)}\n`,
    );
    return 0;
  }

  const actorId = requireActorId(options.actorId);
  const token = await loadManagementToken(options);
  const databaseUrl = await readSecureTextFile(
    options.databaseUrlFile,
    "NPC_PMS_DATABASE_URL_FILE_INVALID",
  );
  const credentials = await loadProvisioningCredentials(options.provisioningFile);
  await validateRuntimeControlPlaneCredential(options.runtimeCredentialRoot, identity.instanceId);

  const correlationId = `npc-goal11-onboarding-${randomUUID()}`;
  const api = new PmsApiClient(options.apiBaseUrl, token, actorId, correlationId);
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const startedAt = new Date().toISOString();
  try {
    const packageSync = await synchronizeWorkspaceProviderPackages(
      new PostgresPmsUnitOfWork(pool),
      { actorId, correlationId },
      options.root,
    );
    const packageProjection = await api.request<ProviderPackageRecord>(
      "GET",
      `/api/v1/provider-packages/${encodeURIComponent(PACKAGE_ID)}?version=${encodeURIComponent(PACKAGE_VERSION)}`,
    );
    assertPackageProjection(packageProjection);

    const providerType = await ensureProviderType(api);
    const provider = await ensureProvider(api, options.adapterEndpoint);
    const resource = await ensureResource(api, options.environment);
    await ensureProviderTypeActive(api, providerType);
    await ensureProviderActive(api, provider);
    await ensureResourceAvailable(api, resource);
    const binding = await ensureBinding(api, options.environment);

    const databaseProfile = await ensureDatabaseProfile(
      pool,
      credentials,
      options.environment,
      correlationId,
      actorId,
    );
    const providerConfig = await ensurePublishedConfiguration(pool, api, {
      draftId: PROVIDER_CONFIG_DRAFT_ID,
      definitionId: "provider.npcTank",
      environment: options.environment,
      targetType: "provider",
      targetId: PROVIDER_ID,
      configGroup: "provider.npcTank",
      dataId: "main",
      content: {
        ADAPTER_TLS_MODE: "disabled",
        NPC_TANK_DEVICE_MCP_ALLOW_MOCK_CONTRACT: false,
        NPC_TANK_MQTT_WIRE_MODE: options.wireMode,
        RUNTIME_ENV: "test",
      },
    });
    const runtimeConfig = await ensurePublishedConfiguration(pool, api, {
      draftId: RUNTIME_CONFIG_DRAFT_ID,
      definitionId: "runtime.bootstrap",
      environment: options.environment,
      targetType: "runtime_deployment",
      targetId: DEPLOYMENT_ID,
      configGroup: "runtime.bootstrap",
      dataId: "process",
      content: {
        RUNTIME_ENV: "test",
        HOST: "0.0.0.0",
        DATABASE_POOL_MAX: 10,
        ADAPTER_ENDPOINT: options.adapterEndpoint,
        ADAPTER_TLS_MODE: "disabled",
        ADAPTER_RPC_TIMEOUT_MS: 5_000,
      },
    });
    const deployment = await ensureDeployment(api, options, runtimeConfig.configProfileId);
    const activeDeployment = await waitForActiveDeployment(api, deployment, options);
    const registry = await waitForRegistryAuthority(api, options, identity.instanceId);
    const runtimeReads = await verifyRegistryRuntimeReadOnly(registry.runtimeEndpoint);

    const onboardingEvidence = {
      schemaVersion: "1.0",
      evidenceClass: "real",
      phase: "GOAL11_NPC_PMS_FORMAL_ONBOARDING",
      status: "passed",
      startedAt,
      completedAt: new Date().toISOString(),
      environment: options.environment,
      correlationId,
      safety: {
        simulatorMutationCalls: 0,
        simulatorControlCalls: 0,
        simulatorReconCalls: 0,
        simulatorEffectorCalls: 0,
      },
      authorityPath: {
        packageProjection: "pms-application/ProviderPackageSynchronizer",
        providerType: "PMS API",
        provider: "PMS API",
        resource: "PMS API",
        binding: "PMS API",
        configuration: "PMS API",
        databaseProfile: "pms-domain/repository/PostgresProvisioner",
        deployment: "PMS API",
        runtime: "PMS Worker reconcile/PM2",
        catalog: "PMS Worker discovery",
        registry: "PMS Worker publication",
        directAuthorityTableWrites: false,
      },
      package: {
        packageId: packageProjection.packageId,
        packageVersion: packageProjection.packageVersion,
        providerType: packageProjection.providerType,
        componentStatus: packageProjection.qualification.componentStatus,
        realResourceStatus: packageProjection.qualification.realResourceStatus,
        sync: packageSync,
      },
      providerType: { providerTypeId: PROVIDER_TYPE_ID, status: "active" },
      provider: { providerId: PROVIDER_ID, status: "active" },
      resource: {
        resourceId: RESOURCE_ID,
        resourceType: RESOURCE_TYPE,
        status: "available",
      },
      binding: {
        providerId: binding.providerId,
        resourceId: binding.resourceId,
        environment: binding.environment,
      },
      databaseProfile: {
        profileId: DATABASE_PROFILE_ID,
        provisionStatus: databaseProfile.provisionStatus,
        revision: databaseProfile.revision,
      },
      configuration: {
        provider: providerConfig,
        runtime: runtimeConfig,
      },
      deployment: summarizeDeployment(activeDeployment),
      workerReconcile: {
        status: activeDeployment.status,
        runtimeInstanceId: identity.instanceId,
        catalogPublished: true,
        registryPublished: true,
      },
      nextAuthority: "live Registry snapshot",
    };
    const registryEvidence = {
      schemaVersion: "1.0",
      evidenceClass: "real",
      phase: "GOAL11_NPC_REGISTRY_AUTHORITY",
      status: "passed",
      observedAt: new Date().toISOString(),
      environment: options.environment,
      source: "live PMS Registry API",
      providerId: PROVIDER_ID,
      serverId: registry.serverId,
      runtimeEndpoint: registry.runtimeEndpoint,
      registryRevision: registry.revision,
      registryChecksum: registry.checksum,
      canonicalChecksum: registry.canonicalChecksum,
      etag: registry.etag,
      conditionalStatus: registry.conditionalStatus,
      bootstrapChecksum: registry.bootstrapChecksum,
      catalogRevision: registry.catalogRevision,
      catalogToolCount: registry.toolNames.length,
      catalogTools: registry.toolNames,
      sensitiveFieldScan: registry.sensitiveFieldScan,
      endpointAuthority: "registry",
      runtimeReadOnly: runtimeReads,
      simulatorMutationCalls: 0,
    };
    await writeEvidence(options.onboardingOutput, onboardingEvidence);
    await writeEvidence(options.registryOutput, registryEvidence);
    process.stdout.write(
      `${JSON.stringify({ onboarding: onboardingEvidence, registry: registryEvidence }, null, 2)}\n`,
    );
    return 0;
  } finally {
    await pool.end();
  }
}

function parseOptions(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  let dryRun = false;
  let managementTokenStdin = false;
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (item === "--management-token-stdin") {
      managementTokenStdin = true;
      continue;
    }
    if (!item?.startsWith("--")) throw new Error("NPC_PMS_ARGUMENT_INVALID");
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--"))
      throw new Error("NPC_PMS_ARGUMENT_VALUE_REQUIRED");
    if (values.has(item)) throw new Error("NPC_PMS_ARGUMENT_DUPLICATE");
    values.set(item, value);
    index += 1;
  }
  const known = new Set([
    "--root",
    "--api-base-url",
    "--database-url-file",
    "--provisioning-file",
    "--runtime-credential-root",
    "--management-token-file",
    "--actor-id",
    "--environment",
    "--adapter-endpoint",
    "--wire-mode",
    "--wait-ms",
    "--poll-ms",
    "--onboarding-output",
    "--registry-output",
  ]);
  for (const key of values.keys()) if (!known.has(key)) throw new Error("NPC_PMS_ARGUMENT_UNKNOWN");
  const tokenFile = values.get("--management-token-file");
  const actorId = values.get("--actor-id");
  if (managementTokenStdin && tokenFile !== undefined) {
    throw new Error("NPC_PMS_MANAGEMENT_TOKEN_SOURCE_CONFLICT");
  }
  const root = resolve(values.get("--root") ?? process.cwd());
  const apiBaseUrl = validateApiBaseUrl(values.get("--api-base-url") ?? DEFAULT_API_BASE_URL);
  const environment = validateEnvironment(values.get("--environment") ?? "simulation");
  const adapterEndpoint = validateAdapterEndpoint(
    values.get("--adapter-endpoint") ?? "npc-tank-adapter:7013",
  );
  const wireMode = validateWireMode(values.get("--wire-mode") ?? "ros_bridge_json");
  return Object.freeze({
    dryRun,
    root,
    apiBaseUrl,
    databaseUrlFile: resolve(values.get("--database-url-file") ?? DEFAULT_DATABASE_URL_FILE),
    provisioningFile: resolve(values.get("--provisioning-file") ?? DEFAULT_PROVISIONING_FILE),
    runtimeCredentialRoot: resolve(
      values.get("--runtime-credential-root") ??
        process.env.PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_ROOT ??
        DEFAULT_RUNTIME_CREDENTIAL_ROOT,
    ),
    ...(tokenFile === undefined ? {} : { managementTokenFile: resolve(tokenFile) }),
    managementTokenStdin,
    ...(actorId === undefined ? {} : { actorId }),
    environment,
    adapterEndpoint,
    wireMode,
    waitMs: boundedInteger(values.get("--wait-ms"), 180_000, 10_000, 600_000),
    pollMs: boundedInteger(values.get("--poll-ms"), 2_000, 250, 10_000),
    ...(values.get("--onboarding-output") === undefined
      ? {}
      : { onboardingOutput: resolve(values.get("--onboarding-output") ?? "") }),
    ...(values.get("--registry-output") === undefined
      ? {}
      : { registryOutput: resolve(values.get("--registry-output") ?? "") }),
  });
}

async function loadAndValidatePackage(root: string): Promise<ProviderPackageRecord> {
  const path = resolve(root, "provider-packages/npc-tank/provider-package.json");
  const source = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isObject(source) || !isObject(source.runtime) || !isObject(source.qualification)) {
    throw new Error("NPC_PMS_PROVIDER_PACKAGE_INVARIANT_FAILED");
  }
  const document: ProviderPackageRecord = {
    packageId: requireString(source.packageId, "NPC_PMS_PROVIDER_PACKAGE_INVARIANT_FAILED"),
    packageVersion: requireString(
      source.packageVersion,
      "NPC_PMS_PROVIDER_PACKAGE_INVARIANT_FAILED",
    ),
    providerType: requireString(source.providerType, "NPC_PMS_PROVIDER_PACKAGE_INVARIANT_FAILED"),
    hostingModes: Array.isArray(source.hostingModes)
      ? source.hostingModes.map((value) =>
          requireString(value, "NPC_PMS_PROVIDER_PACKAGE_INVARIANT_FAILED"),
        )
      : [],
    compatibleRuntimeVersion: requireString(
      source.runtime.compatibleRuntimeVersion,
      "NPC_PMS_PROVIDER_PACKAGE_INVARIANT_FAILED",
    ),
    protocolMode: requireString(
      source.runtime.protocolMode,
      "NPC_PMS_PROVIDER_PACKAGE_INVARIANT_FAILED",
    ),
    qualification: {
      componentStatus: requireString(
        source.qualification.componentStatus,
        "NPC_PMS_PROVIDER_PACKAGE_INVARIANT_FAILED",
      ),
      realResourceStatus: requireString(
        source.qualification.realResourceStatus,
        "NPC_PMS_PROVIDER_PACKAGE_INVARIANT_FAILED",
      ),
    },
  };
  assertPackageProjection(document);
  return document;
}

function assertPackageProjection(value: ProviderPackageRecord): void {
  if (
    value.packageId !== PACKAGE_ID ||
    value.packageVersion !== PACKAGE_VERSION ||
    value.providerType !== PROVIDER_TYPE_ID ||
    !value.hostingModes.includes("platform_managed") ||
    value.compatibleRuntimeVersion !== RUNTIME_VERSION ||
    value.protocolMode !== "frozen_v1" ||
    value.qualification.componentStatus !== "passed" ||
    value.qualification.realResourceStatus !== "pending"
  ) {
    throw new Error("NPC_PMS_PROVIDER_PACKAGE_INVARIANT_FAILED");
  }
}

function dryRunEvidence(
  options: Options,
  instanceId: string,
  packageDocument: ProviderPackageRecord,
) {
  return {
    schemaVersion: "1.0",
    evidenceClass: "dry_run",
    status: "passed",
    simulatorCalls: 0,
    environment: options.environment,
    identifiers: {
      packageId: PACKAGE_ID,
      packageVersion: PACKAGE_VERSION,
      providerTypeId: PROVIDER_TYPE_ID,
      providerId: PROVIDER_ID,
      resourceId: RESOURCE_ID,
      deploymentId: DEPLOYMENT_ID,
      runtimeInstanceId: instanceId,
      databaseProfileId: DATABASE_PROFILE_ID,
      runtimeVersion: RUNTIME_VERSION,
      packageRealResourceStatus: packageDocument.qualification.realResourceStatus,
    },
    formalChain: [
      "PMS application Provider Package projection",
      "PMS API Provider Type",
      "PMS API Provider",
      "PMS API Resource",
      "PMS API Binding",
      "PMS API Configuration",
      "PMS repository/PostgresProvisioner Database Profile",
      "PMS API RuntimeDeployment",
      "PMS Worker reconcile",
      "Runtime ready",
      "Catalog publication",
      "Registry publication",
      "Registry-backed read-only Runtime calls",
    ],
    credentialRequirements: {
      management: "administrator token via --management-token-file or --management-token-stdin",
      actorId: "must equal the administrator subjectId",
      pmsDatabaseUrlFile: options.databaseUrlFile,
      postgresProvisioningFile: options.provisioningFile,
      runtimeControlPlaneCredential: runtimeCredentialRelativePath(instanceId),
      apiRuntimeDescriptor: {
        providerId: PROVIDER_ID,
        deploymentId: DEPLOYMENT_ID,
        instanceId,
        environment: options.environment,
        runtimeVersion: RUNTIME_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        requiredConfigScopes: ["runtime:config:read", "runtime:config:watch", "runtime:config:ack"],
        requiredRegistrationScopes: ["runtime:register", "runtime:heartbeat"],
      },
    },
    authorityPolicy: {
      directProviderTableWrite: false,
      directResourceTableWrite: false,
      directDeploymentTableWrite: false,
      directRegistryTableWrite: false,
      registryEndpointRequiredForRuntimeEvidence: true,
    },
  };
}

async function ensureProviderType(api: PmsApiClient): Promise<ProviderTypeRecord> {
  const existing = await api.getOrNull<ProviderTypeRecord>(
    `/api/v1/provider-types/${encodeURIComponent(PROVIDER_TYPE_ID)}`,
  );
  if (existing !== null) return existing;
  return api.request<ProviderTypeRecord>("POST", "/api/v1/provider-types", {
    providerTypeId: PROVIDER_TYPE_ID,
    displayName: "NPC Tank",
  });
}

async function ensureProvider(api: PmsApiClient, adapterEndpoint: string): Promise<ProviderRecord> {
  const existing = await api.getOrNull<ProviderRecord>(
    `/api/v1/providers/${encodeURIComponent(PROVIDER_ID)}`,
  );
  if (existing !== null) {
    if (
      (existing.providerTypeId !== undefined && existing.providerTypeId !== PROVIDER_TYPE_ID) ||
      (existing.packageId !== undefined && existing.packageId !== PACKAGE_ID) ||
      (existing.packageVersion !== undefined && existing.packageVersion !== PACKAGE_VERSION) ||
      (existing.hostingMode !== undefined && existing.hostingMode !== "platform_managed") ||
      (existing.adapterEndpoint !== undefined && existing.adapterEndpoint !== adapterEndpoint)
    ) {
      throw new Error("NPC_PMS_EXISTING_PROVIDER_IDENTITY_MISMATCH");
    }
    return existing;
  }
  return api.request<ProviderRecord>("POST", "/api/v1/providers", {
    providerId: PROVIDER_ID,
    providerTypeId: PROVIDER_TYPE_ID,
    packageId: PACKAGE_ID,
    packageVersion: PACKAGE_VERSION,
    hostingMode: "platform_managed",
    adapterEndpoint,
  });
}

async function ensureResource(api: PmsApiClient, environment: string): Promise<ResourceRecord> {
  const path = `/api/v1/resources/${encodeURIComponent(environment)}/${encodeURIComponent(RESOURCE_ID)}`;
  const existing = await api.getOrNull<ResourceRecord>(path);
  if (existing !== null) {
    if (existing.resourceType !== undefined && existing.resourceType !== RESOURCE_TYPE) {
      throw new Error("NPC_PMS_EXISTING_RESOURCE_TYPE_MISMATCH");
    }
    return existing;
  }
  return api.request<ResourceRecord>("POST", "/api/v1/resources", {
    environment,
    resourceId: RESOURCE_ID,
    resourceType: RESOURCE_TYPE,
    metadata: {
      displayName: "NPC Tank 1",
      capability: "vehicle-reconnaissance",
      simulatorAuthority: "external-real-interface",
    },
  });
}

async function ensureProviderTypeActive(
  api: PmsApiClient,
  providerType: ProviderTypeRecord,
): Promise<void> {
  if (providerType.status === "active") return;
  await api.request<ProviderTypeRecord>(
    "PATCH",
    `/api/v1/provider-types/${encodeURIComponent(PROVIDER_TYPE_ID)}/status`,
    { status: "active", expectedUpdatedAt: providerType.updatedAt },
  );
}

async function ensureProviderActive(api: PmsApiClient, provider: ProviderRecord): Promise<void> {
  if (provider.status === "active") return;
  if (!["draft", "degraded"].includes(provider.status)) {
    throw new Error("NPC_PMS_PROVIDER_STATUS_NOT_ACTIVATABLE");
  }
  await api.request<ProviderRecord>(
    "PATCH",
    `/api/v1/providers/${encodeURIComponent(PROVIDER_ID)}/status`,
    { status: "active", expectedUpdatedAt: provider.updatedAt },
  );
}

async function ensureResourceAvailable(api: PmsApiClient, resource: ResourceRecord): Promise<void> {
  if (resource.status === "available") return;
  if (resource.status === "retired") throw new Error("NPC_PMS_RESOURCE_RETIRED");
  await api.request<ResourceRecord>(
    "PATCH",
    `/api/v1/resources/${encodeURIComponent(resource.environment)}/${encodeURIComponent(resource.resourceId)}/status`,
    { status: "available", expectedUpdatedAt: resource.updatedAt },
  );
}

async function ensureBinding(api: PmsApiClient, environment: string): Promise<BindingRecord> {
  const page = await api.request<ApiPage<BindingRecord>>(
    "GET",
    `/api/v1/providers/${encodeURIComponent(PROVIDER_ID)}/resource-bindings`,
  );
  const existing = page.items.find(
    (item) => item.environment === environment && item.resourceId === RESOURCE_ID,
  );
  if (existing !== undefined) return existing;
  return api.request<BindingRecord>(
    "POST",
    `/api/v1/providers/${encodeURIComponent(PROVIDER_ID)}/resource-bindings`,
    { environment, resourceId: RESOURCE_ID },
  );
}

async function ensurePublishedConfiguration(
  pool: Pool,
  api: PmsApiClient,
  input: {
    readonly draftId: string;
    readonly definitionId: string;
    readonly environment: string;
    readonly targetType: "provider" | "runtime_deployment";
    readonly targetId: string;
    readonly configGroup: string;
    readonly dataId: string;
    readonly content: JsonObject;
  },
): Promise<{
  readonly configProfileId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly publication: "reused" | "published";
}> {
  const repository = new PostgresConfigurationRepository(pool);
  const target = {
    environment: environmentId(input.environment),
    targetType: input.targetType,
    targetId: input.targetId,
    configGroup: input.configGroup,
    dataId: input.dataId,
  } as const;
  const current = await repository.getPublishedRevision(target);
  const configProfileId =
    input.targetType === "runtime_deployment"
      ? formatRuntimeConfigProfileLocator(
          runtimeDeploymentProfileLocator({
            environment: input.environment,
            targetId: input.targetId,
            configGroup: input.configGroup,
            dataId: input.dataId,
          }),
        )
      : "not_applicable";
  const draft = await api.getOrNull<ConfigDraftRecord>(
    `/api/v1/config-drafts/${encodeURIComponent(input.draftId)}`,
  );
  if (draft === null) {
    await api.request<ConfigDraftRecord>("POST", "/api/v1/config-drafts", input);
  } else if (canonicalize(draft.content) !== canonicalize(input.content)) {
    await api.request<ConfigDraftRecord>(
      "PATCH",
      `/api/v1/config-drafts/${encodeURIComponent(input.draftId)}`,
      { expectedVersion: draft.version, content: input.content },
    );
  }
  const preview = await api.request<EffectiveConfigPreview>(
    "GET",
    `/api/v1/config-drafts/${encodeURIComponent(input.draftId)}/effective`,
  );
  if (!preview.valid || preview.issues.length > 0) {
    throw new Error("NPC_PMS_CONFIGURATION_EFFECTIVE_PREVIEW_INVALID");
  }
  if (current !== null && canonicalize(current.content) === canonicalize(preview.content)) {
    return {
      configProfileId,
      revision: current.revision,
      checksum: current.checksum,
      publication: "reused",
    };
  }
  const validated = await api.request<ConfigDraftRecord>(
    "POST",
    `/api/v1/config-drafts/${encodeURIComponent(input.draftId)}/validate`,
  );
  const published = await api.request<{ readonly revision: ConfigRevisionRecord }>(
    "POST",
    `/api/v1/config-drafts/${encodeURIComponent(input.draftId)}/publish`,
    {
      expectedDraftVersion: validated.version,
      expectedPublishedRevision: current?.revision ?? null,
    },
  );
  return {
    configProfileId,
    revision: published.revision.revision,
    checksum: published.revision.checksum,
    publication: "published",
  };
}

async function ensureDatabaseProfile(
  pool: Pool,
  credentials: ProvisioningCredentials,
  environment: string,
  correlationId: string,
  actorId: string,
) {
  const repository = new PostgresDatabaseProfileRepository(pool);
  const adminUrl = new URL(credentials.adminDatabaseUrl);
  const adminPort = adminUrl.port.length === 0 ? 5432 : Number(adminUrl.port);
  const desired = createDatabaseProfile({
    profileId: DATABASE_PROFILE_ID,
    providerId: providerId(PROVIDER_ID),
    environment: environmentId(environment),
    clusterRef: credentials.clusterRef,
    host: adminUrl.hostname,
    port: adminPort,
    databaseMode: "provisioned",
    sslMode: sslModeFromUrl(adminUrl),
    adminSecretRef: secretRef(credentials.adminSecretRef),
    runtimeSecretRef: secretRef(`file/v1/${DEPLOYMENT_ID}/database/runtime`),
  });
  let existing = await repository.get(PROVIDER_ID, environment);
  if (existing !== null && canonicalize(existing.profile) !== canonicalize(desired)) {
    throw new Error("NPC_PMS_DATABASE_PROFILE_IDENTITY_MISMATCH");
  }
  if (existing === null) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const audit = new PostgresAuditRepository(client);
      const event = createAuditEvent({
        auditEventId: auditEventId(randomUUID()),
        action: "database_profile.created",
        actorId,
        correlationId,
        subjectType: "database_profile",
        subjectId: DATABASE_PROFILE_ID,
        occurredAt: new Date(),
        metadata: { providerId: PROVIDER_ID, environment },
      });
      await audit.append(event);
      await new PostgresDatabaseProfileRepository(client).insert(desired, event.auditEventId);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    existing = await repository.get(PROVIDER_ID, environment);
  }
  if (existing === null) throw new Error("NPC_PMS_DATABASE_PROFILE_CREATE_FAILED");
  await provisionDatabase(desired, credentials, correlationId);
  if (existing.provisionStatus === "ready") return existing;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const audit = new PostgresAuditRepository(client);
    const event = createAuditEvent({
      auditEventId: auditEventId(randomUUID()),
      action: "database_profile.provisioned",
      actorId,
      correlationId,
      subjectType: "database_profile",
      subjectId: DATABASE_PROFILE_ID,
      occurredAt: new Date(),
      metadata: { providerId: PROVIDER_ID, environment },
    });
    await audit.append(event);
    const updated = await new PostgresDatabaseProfileRepository(client).updateProvisionResult({
      profileId: DATABASE_PROFILE_ID,
      providerId: PROVIDER_ID,
      environment,
      status: "ready",
      provisionedAt: new Date(),
      auditEventId: event.auditEventId,
      expectedRevision: existing.revision,
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

async function provisionDatabase(
  profile: ReturnType<typeof createDatabaseProfile>,
  credentials: ProvisioningCredentials,
  correlationId: string,
): Promise<void> {
  const admin = new Pool({ connectionString: credentials.adminDatabaseUrl, max: 2 });
  const provisioner = new PostgresProvisioner(admin, {
    credentialRotation: {
      async ensureRuntimeCredential(spec, _context, adminClient) {
        const result = await adminClient.query<{ statement: string }>(
          "SELECT format('ALTER ROLE %I PASSWORD %L',$1::text,$2::text) AS statement",
          [spec.runtimeRoleName, credentials.runtimePassword],
        );
        const statement = result.rows[0]?.statement;
        if (statement === undefined) throw new Error("NPC_PMS_RUNTIME_CREDENTIAL_ROTATION_FAILED");
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
    sslMode: profile.sslMode,
    adminSecretRef: { secretRef: String(profile.adminSecretRef.secretRef) },
    runtimeSecretRef: { secretRef: String(profile.runtimeSecretRef.secretRef) },
  };
  const operationId = `npc-onboard-${createHash("sha256").update(correlationId).digest("hex").slice(0, 16)}`;
  try {
    await provisioner.createRole(spec, context(operationId, "role"));
    await provisioner.createDatabase(spec, context(operationId, "database"));
    await provisioner.grantRuntimeAccess(spec, context(operationId, "grant"));
    await provisioner.verify(spec, context(operationId, "verify"));
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

async function ensureDeployment(
  api: PmsApiClient,
  options: Options,
  configProfileId: string,
): Promise<RuntimeDeploymentRecord> {
  const path = `/api/v1/runtime-deployments/${encodeURIComponent(DEPLOYMENT_ID)}?providerId=${encodeURIComponent(PROVIDER_ID)}`;
  const existing = await api.getOrNull<RuntimeDeploymentRecord>(path);
  if (existing !== null) {
    if (
      (existing.environment !== undefined && existing.environment !== options.environment) ||
      (existing.runtimeVersion !== undefined && existing.runtimeVersion !== RUNTIME_VERSION) ||
      (existing.databaseProfileId !== undefined &&
        existing.databaseProfileId !== DATABASE_PROFILE_ID) ||
      (existing.configProfileId !== undefined && existing.configProfileId !== configProfileId) ||
      (existing.adapterEndpoint !== undefined &&
        existing.adapterEndpoint !== options.adapterEndpoint)
    ) {
      throw new Error("NPC_PMS_EXISTING_DEPLOYMENT_IDENTITY_MISMATCH");
    }
    if (existing.status === "ACTIVE") return existing;
    const action =
      existing.desiredState === "draining" || existing.desiredReplicas === 0
        ? "start"
        : "reconcile";
    const response = await api.request<{ readonly deployment: RuntimeDeploymentRecord }>(
      "POST",
      `/api/v1/runtime-deployments/${encodeURIComponent(DEPLOYMENT_ID)}/${action}`,
      { providerId: PROVIDER_ID, expectedDesiredRevision: existing.desiredRevision },
    );
    return response.deployment;
  }
  const response = await api.request<{ readonly deployment: RuntimeDeploymentRecord }>(
    "POST",
    "/api/v1/runtime-deployments",
    {
      deploymentId: DEPLOYMENT_ID,
      providerId: PROVIDER_ID,
      environment: options.environment,
      runtimeVersion: RUNTIME_VERSION,
      databaseProfileId: DATABASE_PROFILE_ID,
      configProfileId,
      adapterEndpoint: options.adapterEndpoint,
      desiredReplicas: 1,
    },
  );
  return response.deployment;
}

async function waitForActiveDeployment(
  api: PmsApiClient,
  initial: RuntimeDeploymentRecord,
  options: Options,
): Promise<RuntimeDeploymentRecord> {
  const deadline = Date.now() + options.waitMs;
  let current = initial;
  while (Date.now() <= deadline) {
    if (current.status === "ACTIVE") return current;
    if (current.status === "FAILED" || current.status === "DEGRADED") {
      throw new Error(
        current.lastErrorCode === undefined
          ? "NPC_PMS_WORKER_RECONCILE_FAILED"
          : `NPC_PMS_WORKER_RECONCILE_FAILED_${safeCode(current.lastErrorCode)}`,
      );
    }
    await delay(options.pollMs);
    current = await api.request<RuntimeDeploymentRecord>(
      "GET",
      `/api/v1/runtime-deployments/${encodeURIComponent(DEPLOYMENT_ID)}?providerId=${encodeURIComponent(PROVIDER_ID)}`,
    );
  }
  throw new Error("NPC_PMS_WORKER_RECONCILE_TIMEOUT");
}

async function waitForRegistryAuthority(
  api: PmsApiClient,
  options: Options,
  expectedInstanceId: string,
): Promise<{
  readonly revision: number;
  readonly checksum: string;
  readonly canonicalChecksum: string;
  readonly etag: string;
  readonly conditionalStatus: number;
  readonly bootstrapChecksum: string;
  readonly serverId: string;
  readonly runtimeEndpoint: string;
  readonly catalogRevision: number;
  readonly toolNames: readonly string[];
  readonly sensitiveFieldScan: { readonly status: "passed"; readonly sensitiveKeys: 0 };
}> {
  const latestPath = `/api/v1/registry/${encodeURIComponent(options.environment)}/latest`;
  const deadline = Date.now() + options.waitMs;
  let latest: RawApiResponse | undefined;
  let snapshot: JsonObject | undefined;
  let provider: JsonObject | undefined;
  while (Date.now() <= deadline) {
    latest = await api.raw("GET", latestPath);
    if (latest.status === 200 && isObject(latest.body)) {
      snapshot = latest.body;
      const document = asObject(snapshot.document);
      const providers = Array.isArray(document?.providers)
        ? document.providers.filter(isObject)
        : [];
      provider = providers.find((candidate) => candidate.providerId === PROVIDER_ID);
      if (provider !== undefined) break;
    } else if (latest.status !== 404) {
      throw apiError(latest, "GET", latestPath);
    }
    await delay(options.pollMs);
  }
  if (latest === undefined || snapshot === undefined || provider === undefined) {
    throw new Error("NPC_PMS_REGISTRY_PROVIDER_TIMEOUT");
  }
  const revision = requirePositiveInteger(snapshot.revision, "NPC_PMS_REGISTRY_REVISION_INVALID");
  const checksum = requireSha256(snapshot.checksum, "NPC_PMS_REGISTRY_CHECKSUM_INVALID");
  const etag = latest.headers.get("etag");
  if (etag !== `"${checksum}"`) throw new Error("NPC_PMS_REGISTRY_ETAG_INVALID");
  const document = snapshot.document;
  assertCatalogPublicData(document);
  if (containsSensitiveKey(snapshot)) throw new Error("NPC_PMS_REGISTRY_SENSITIVE_FIELD_PRESENT");
  const canonicalChecksum = createHash("sha256").update(canonicalize(document)).digest("hex");
  if (canonicalChecksum !== checksum) throw new Error("NPC_PMS_REGISTRY_CANONICAL_HASH_MISMATCH");
  const conditional = await api.raw("GET", latestPath, undefined, { "if-none-match": etag });
  if (conditional.status !== 304) throw new Error("NPC_PMS_REGISTRY_IF_NONE_MATCH_FAILED");

  const bootstrap = await api.request<JsonObject>(
    "GET",
    `/api/v1/registry/${encodeURIComponent(options.environment)}/bootstrap`,
  );
  const bootstrapChecksum = requireSha256(
    asObject(bootstrap.snapshot)?.checksum,
    "NPC_PMS_REGISTRY_BOOTSTRAP_CHECKSUM_INVALID",
  );
  if (bootstrapChecksum !== checksum) throw new Error("NPC_PMS_REGISTRY_BOOTSTRAP_MISMATCH");

  const serverId = requireString(provider.serverId, "NPC_PMS_REGISTRY_SERVER_ID_INVALID");
  if (serverId !== expectedInstanceId) throw new Error("NPC_PMS_REGISTRY_SERVER_ID_MISMATCH");
  const runtimeEndpoint = validateRegistryEndpoint(
    requireString(provider.effectiveEndpoint, "NPC_PMS_REGISTRY_ENDPOINT_INVALID"),
  );
  const catalogRevision = requirePositiveInteger(
    provider.catalogRevision,
    "NPC_PMS_REGISTRY_CATALOG_REVISION_INVALID",
  );
  const tools = Array.isArray(provider.tools) ? provider.tools.filter(isObject) : [];
  const toolNames = tools.map((tool) => requireString(tool.name, "NPC_PMS_REGISTRY_TOOL_INVALID"));
  if (
    toolNames.length === 0 ||
    REQUIRED_READ_OPERATIONS.some((name) => !toolNames.includes(name))
  ) {
    throw new Error("NPC_PMS_REGISTRY_REQUIRED_READ_TOOL_MISSING");
  }
  return {
    revision,
    checksum,
    canonicalChecksum,
    etag,
    conditionalStatus: conditional.status,
    bootstrapChecksum,
    serverId,
    runtimeEndpoint,
    catalogRevision,
    toolNames: Object.freeze([...toolNames].sort()),
    sensitiveFieldScan: { status: "passed", sensitiveKeys: 0 },
  };
}

async function verifyRegistryRuntimeReadOnly(endpoint: string) {
  const url = new URL(endpoint);
  const health = await fetch(new URL("/health/ready", url), {
    signal: AbortSignal.timeout(10_000),
  });
  if (!health.ok) throw new Error("NPC_PMS_REGISTRY_RUNTIME_NOT_READY");
  await health.body?.cancel();

  let requestId = 1;
  const discovery = await runtimeRpc(url, requestId++, "server/discover", {});
  if (asObject(discovery.result)?.resultType !== "complete") {
    throw new Error("NPC_RUNTIME_DISCOVERY_INCOMPLETE");
  }
  const toolsList = await runtimeRpc(url, requestId++, "tools/list", {});
  const tools = Array.isArray(asObject(toolsList.result)?.tools)
    ? (asObject(toolsList.result)?.tools as unknown[]).filter(isObject)
    : [];
  const toolNames = tools.map((tool) => requireString(tool.name, "NPC_RUNTIME_TOOL_INVALID"));
  if (REQUIRED_READ_OPERATIONS.some((name) => !toolNames.includes(name))) {
    throw new Error("NPC_RUNTIME_REQUIRED_READ_TOOL_MISSING");
  }
  const calls: JsonObject[] = [];
  for (const operation of REQUIRED_READ_OPERATIONS) {
    const response = await runtimeRpc(
      url,
      requestId++,
      "tools/call",
      { name: operation, arguments: { resourceId: RESOURCE_ID } },
      operation,
    );
    const result = asObject(response.result);
    if (result?.resultType !== "complete" || result.structuredContent === undefined) {
      throw new Error(`NPC_RUNTIME_READ_INCOMPLETE_${safeCode(operation)}`);
    }
    if (containsSensitiveKey(result.structuredContent)) {
      throw new Error(`NPC_RUNTIME_READ_SENSITIVE_FIELD_${safeCode(operation)}`);
    }
    calls.push({
      operation,
      resultType: "complete",
      structuredContentSha256: createHash("sha256")
        .update(canonicalize(result.structuredContent))
        .digest("hex"),
      valuesPersistedInEvidence: false,
    });
  }
  return {
    endpointSource: "registry",
    protocolVersion: PROTOCOL_VERSION,
    serverDiscover: "passed",
    toolsList: "passed",
    requiredReadOperations: calls,
    mutatingOperationsCalled: 0,
  };
}

async function runtimeRpc(
  endpoint: URL,
  id: number,
  method: string,
  params: JsonObject,
  operation?: string,
): Promise<JsonObject> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": PROTOCOL_VERSION,
      "mcp-method": method,
      "x-sdar-subject": "npc-goal11-pms-read-only",
      "x-sdar-tenant": "npc-qualification",
      "x-sdar-execution-mode": "simulation",
      "x-sdar-simulation-id": "npc-goal11-real-interface",
      ...(operation === undefined ? {} : { "mcp-name": operation }),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
          "io.modelcontextprotocol/clientInfo": {
            name: "sdar-npc-goal11-pms-read-only",
            version: "1.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {
            extensions: { "io.modelcontextprotocol/tasks": {} },
          },
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const source = await boundedResponseText(response, MAX_API_RESPONSE_BYTES);
  let body: unknown;
  try {
    body = JSON.parse(source) as unknown;
  } catch {
    throw new Error("NPC_RUNTIME_RESPONSE_JSON_INVALID");
  }
  if (!response.ok || !isObject(body) || body.error !== undefined || !isObject(body.result)) {
    throw new Error(`NPC_RUNTIME_RPC_FAILED_${safeCode(method)}`);
  }
  return body;
}

async function loadManagementToken(options: Options): Promise<string> {
  if (options.managementTokenFile !== undefined) {
    return readSecureTextFile(options.managementTokenFile, "NPC_PMS_MANAGEMENT_TOKEN_FILE_INVALID");
  }
  if (!options.managementTokenStdin) throw new Error("NPC_PMS_MANAGEMENT_TOKEN_SOURCE_REQUIRED");
  let source = "";
  for await (const chunk of process.stdin) {
    source += String(chunk);
    if (Buffer.byteLength(source, "utf8") > MAX_CREDENTIAL_BYTES) {
      throw new Error("NPC_PMS_MANAGEMENT_TOKEN_STDIN_TOO_LARGE");
    }
  }
  const token = source.trim();
  if (token.length === 0) throw new Error("NPC_PMS_MANAGEMENT_TOKEN_STDIN_EMPTY");
  return token;
}

async function loadProvisioningCredentials(path: string): Promise<ProvisioningCredentials> {
  const source = await readSecureTextFile(path, "NPC_PMS_PROVISIONING_FILE_INVALID");
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new Error("NPC_PMS_PROVISIONING_FILE_INVALID");
  }
  if (!isObject(value)) throw new Error("NPC_PMS_PROVISIONING_FILE_INVALID");
  const keys = Object.keys(value).sort();
  if (
    canonicalize(keys) !==
    canonicalize(["adminDatabaseUrl", "adminSecretRef", "clusterRef", "runtimePassword"])
  ) {
    throw new Error("NPC_PMS_PROVISIONING_FILE_INVALID");
  }
  const clusterRef = requireString(value.clusterRef, "NPC_PMS_PROVISIONING_FILE_INVALID");
  const adminSecretRef = requireString(value.adminSecretRef, "NPC_PMS_PROVISIONING_FILE_INVALID");
  const adminDatabaseUrl = requireString(
    value.adminDatabaseUrl,
    "NPC_PMS_PROVISIONING_FILE_INVALID",
  );
  const runtimePassword = requireString(value.runtimePassword, "NPC_PMS_PROVISIONING_FILE_INVALID");
  if (runtimePassword.length < 16) throw new Error("NPC_PMS_PROVISIONING_FILE_INVALID");
  const url = new URL(adminDatabaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.username.length === 0 ||
    url.password.length === 0 ||
    url.hostname.length === 0
  ) {
    throw new Error("NPC_PMS_PROVISIONING_FILE_INVALID");
  }
  return Object.freeze({
    clusterRef,
    adminSecretRef,
    adminDatabaseUrl: url.toString(),
    runtimePassword,
  });
}

async function validateRuntimeControlPlaneCredential(
  root: string,
  instanceId: string,
): Promise<void> {
  const path = resolve(root, runtimeCredentialRelativePath(instanceId));
  assertContained(root, path);
  await readSecureTextFile(path, "NPC_PMS_RUNTIME_CONTROL_PLANE_TOKEN_INVALID");
}

function runtimeCredentialRelativePath(instanceId: string): string {
  return [
    "providers",
    PROVIDER_ID,
    "deployments",
    DEPLOYMENT_ID,
    "instances",
    instanceId,
    "control-plane.token",
  ].join("/");
}

export async function readSecureTextFile(path: string, code: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error(code);
  let status;
  let canonical;
  try {
    [status, canonical] = await Promise.all([lstat(path), realpath(path)]);
  } catch {
    throw new Error(code);
  }
  const permissions = status.mode & 0o7777;
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    status.nlink !== 1 ||
    status.size < 1 ||
    status.size > MAX_CREDENTIAL_BYTES ||
    canonical !== resolve(path) ||
    (process.platform !== "win32" && ((permissions & ~0o600) !== 0 || (permissions & 0o400) === 0))
  ) {
    throw new Error(code);
  }
  const source = (await readFile(path, "utf8")).trim();
  if (source.length === 0) throw new Error(code);
  return source;
}

function context(operationId: string, step: string) {
  return {
    operationId,
    idempotencyKey: `${operationId}:${step}`,
    mode: "apply" as const,
  };
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

function sslModeFromUrl(url: URL): "disable" | "require" | "verify-ca" | "verify-full" {
  const mode = url.searchParams.get("sslmode") ?? "disable";
  if (!["disable", "require", "verify-ca", "verify-full"].includes(mode)) {
    throw new Error("NPC_PMS_PROVISIONING_SSL_MODE_INVALID");
  }
  return mode as "disable" | "require" | "verify-ca" | "verify-full";
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

async function writeEvidence(path: string | undefined, value: unknown): Promise<void> {
  if (path === undefined) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
}

function apiError(response: RawApiResponse, method: string, path: string): ApiError {
  const body = asObject(response.body);
  const error = asObject(body?.error);
  const code = typeof error?.code === "string" ? safeCode(error.code) : undefined;
  return new ApiError(response.status, method, path, code);
}

async function boundedResponseText(response: Response, maximum: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) throw new Error("PMS_RESPONSE_TOO_LARGE");
  const source = await response.text();
  if (Buffer.byteLength(source, "utf8") > maximum) throw new Error("PMS_RESPONSE_TOO_LARGE");
  return source;
}

function containsSensitiveKey(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value !== "object") return false;
  if (ancestors.has(value)) return true;
  ancestors.add(value);
  if (Array.isArray(value)) {
    const found = value.some((item) => containsSensitiveKey(item, ancestors));
    ancestors.delete(value);
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
    if (
      /(?:password|authorization|token|secret|credential|privatekey)$/.test(normalized) ||
      ["apikey", "accesstoken", "refreshtoken", "cookie", "setcookie"].includes(normalized)
    ) {
      ancestors.delete(value);
      return true;
    }
    if (containsSensitiveKey(child, ancestors)) {
      ancestors.delete(value);
      return true;
    }
  }
  ancestors.delete(value);
  return false;
}

function validateApiBaseUrl(value: string): string {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error("NPC_PMS_API_BASE_URL_INVALID");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url.toString();
}

function validateRegistryEndpoint(value: string): string {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    !url.pathname.endsWith("/mcp")
  ) {
    throw new Error("NPC_PMS_REGISTRY_ENDPOINT_INVALID");
  }
  return url.toString();
}

function validateAdapterEndpoint(value: string): string {
  if (!/^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\]):\d{1,5}$/.test(value)) {
    throw new Error("NPC_PMS_ADAPTER_ENDPOINT_INVALID");
  }
  const port = Number(value.slice(value.lastIndexOf(":") + 1));
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("NPC_PMS_ADAPTER_ENDPOINT_INVALID");
  }
  return value;
}

function validateEnvironment(value: string): string {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(value)) throw new Error("NPC_PMS_ENVIRONMENT_INVALID");
  return value;
}

function validateWireMode(
  value: string,
): "ros_message_json" | "direct_domain_json" | "ros_bridge_json" {
  if (!["ros_message_json", "direct_domain_json", "ros_bridge_json"].includes(value)) {
    throw new Error("NPC_PMS_WIRE_MODE_INVALID");
  }
  return value as "ros_message_json" | "direct_domain_json" | "ros_bridge_json";
}

function requireActorId(value: string | undefined): string {
  if (value === undefined || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error("NPC_PMS_ACTOR_ID_REQUIRED");
  }
  return value;
}

function boundedInteger(
  source: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = source === undefined ? fallback : Number(source);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error("NPC_PMS_ARGUMENT_BOUNDS");
  }
  return value;
}

function requireString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function requirePositiveInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(code);
  return value as number;
}

function requireSha256(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new Error(code);
  return value;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): JsonObject | undefined {
  return isObject(value) ? value : undefined;
}

function safeCode(value: string): string {
  return value
    .toUpperCase()
    .replaceAll(/[^A-Z0-9_]/g, "_")
    .slice(0, 128);
}

function sanitizePath(value: string): string {
  return value.split("?", 1)[0]?.replaceAll(/[^A-Za-z0-9_./:-]/g, "_") ?? "UNKNOWN";
}

function assertContained(root: string, candidate: string): void {
  const path = relative(resolve(root), resolve(candidate));
  if (path === "" || path.startsWith("..") || isAbsolute(path)) {
    throw new Error("NPC_PMS_RUNTIME_CONTROL_PLANE_TOKEN_INVALID");
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function safeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && /^[A-Z0-9_:./-]+$/.test(error.message)) return error.message;
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}

if (
  process.argv[1] !== undefined &&
  ["pms-onboarding.ts", "pms-onboarding.js"].includes(basename(process.argv[1]))
) {
  void run().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${safeError(error)}\n`);
      process.exitCode = 1;
    },
  );
}
