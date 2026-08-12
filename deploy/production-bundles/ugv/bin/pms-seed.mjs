import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import {
  ProviderManagementService,
  synchronizeWorkspaceProviderPackages,
} from "/app/dist/packages/pms-application/src/index.js";
import { PostgresPmsUnitOfWork } from "/app/dist/packages/pms-persistence-postgres/src/index.js";

const packageId = "builtin.isr.vehicle.ugv";
const packageVersion = "1.0.0";
const providerTypeId = "isr.vehicle.ugv";
const providerId = required("PMS_SEED_PROVIDER_ID");
const resourceId = "vehicle:ugv1";
const resourceType = "isr.vehicle.ugv";
const actorId = required("PMS_SEED_ACTOR_ID");
const environment = required("PMS_SEED_ENVIRONMENT");
const adapterEndpoint = required("PMS_SEED_ADAPTER_ENDPOINT");
const deploymentId = exact("PMS_SEED_DEPLOYMENT_ID", "production-ugv-direct");
const instanceId = exact("PMS_SEED_INSTANCE_ID", "production-ugv-direct-1");
const runtimeVersion = exact("PMS_SEED_RUNTIME_VERSION", "2.0.0-rc.1");
const controlEndpoint = directRuntimeUrl(
  "PMS_SEED_RUNTIME_CONTROL_ENDPOINT",
  required("PMS_SEED_RUNTIME_CONTROL_ENDPOINT"),
  true,
);
const advertisedEndpoint = directRuntimeUrl(
  "PMS_SEED_RUNTIME_ADVERTISED_ENDPOINT",
  required("PMS_SEED_RUNTIME_ADVERTISED_ENDPOINT"),
  false,
);
const registryEndpoint = new URL("/mcp", advertisedEndpoint).toString();
const publishedPort = boundedInteger("PMS_SEED_RUNTIME_PUBLISHED_PORT", 19_100, 1, 65_535);
if (Number(advertisedEndpoint.port) !== publishedPort) {
  throw new Error("PMS_SEED_RUNTIME_ADVERTISED_PORT_MISMATCH");
}
const waitTimeoutMs = boundedInteger("PMS_SEED_WAIT_TIMEOUT_MS", 180_000, 10_000, 600_000);
const pollIntervalMs = boundedInteger("PMS_SEED_POLL_INTERVAL_MS", 2_000, 250, 10_000);
const packageRoot = required("PMS_SEED_PACKAGE_ROOT");
const apiBaseUrl = internalApiUrl(required("PMS_SEED_API_BASE_URL"));
const databaseUrl = await secretText(required("PMS_SEED_DATABASE_URL_FILE"), 8_192);
const correlationId = `ugv-production-seed-${randomUUID()}`;
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const unitOfWork = new PostgresPmsUnitOfWork(pool);
const providerManagement = new ProviderManagementService(unitOfWork);

try {
  const packageSync = await synchronizeWorkspaceProviderPackages(
    unitOfWork,
    { actorId, correlationId },
    packageRoot,
  );

  const projection = await api(
    "GET",
    `/api/v1/provider-packages/${encodeURIComponent(packageId)}?version=${encodeURIComponent(packageVersion)}`,
  );
  if (
    projection?.packageId !== packageId ||
    projection?.packageVersion !== packageVersion ||
    projection?.providerType !== providerTypeId ||
    !Array.isArray(projection?.hostingModes) ||
    !projection.hostingModes.includes("vendor_managed") ||
    projection?.qualification?.componentStatus !== "passed"
  ) {
    throw new Error("PMS_SEED_PACKAGE_PROJECTION_INVALID");
  }

  let providerType = await getOrNull(
    `/api/v1/provider-types/${encodeURIComponent(providerTypeId)}`,
  );
  if (providerType === null) {
    providerType = await api("POST", "/api/v1/provider-types", {
      providerTypeId,
      displayName: "UGV",
    });
  }
  if (providerType?.providerTypeId !== providerTypeId) {
    throw new Error("PMS_SEED_PROVIDER_TYPE_IDENTITY_MISMATCH");
  }
  if (providerType.status !== "active") {
    providerType = await api(
      "PATCH",
      `/api/v1/provider-types/${encodeURIComponent(providerTypeId)}/status`,
      { status: "active", expectedUpdatedAt: providerType.updatedAt },
    );
  }

  let provider = await getOrNull(`/api/v1/providers/${encodeURIComponent(providerId)}`);
  if (provider === null) {
    provider = await api("POST", "/api/v1/providers", {
      providerId,
      providerTypeId,
      packageId,
      packageVersion,
      hostingMode: "vendor_managed",
      adapterEndpoint,
    });
  } else if (
    provider.providerTypeId !== providerTypeId ||
    provider.packageId !== packageId ||
    provider.packageVersion !== packageVersion ||
    provider.hostingMode !== "vendor_managed" ||
    provider.adapterEndpoint !== adapterEndpoint
  ) {
    throw new Error("PMS_SEED_PROVIDER_IDENTITY_MISMATCH");
  }
  if (provider.status !== "active") {
    if (!new Set(["draft", "degraded"]).has(provider.status)) {
      throw new Error("PMS_SEED_PROVIDER_NOT_ACTIVATABLE");
    }
    provider = await api("PATCH", `/api/v1/providers/${encodeURIComponent(providerId)}/status`, {
      status: "active",
      expectedUpdatedAt: provider.updatedAt,
    });
  }

  let resource = await getOrNull(
    `/api/v1/resources/${encodeURIComponent(environment)}/${encodeURIComponent(resourceId)}`,
  );
  if (resource === null) {
    resource = await api("POST", "/api/v1/resources", {
      environment,
      resourceId,
      resourceType,
      metadata: {
        displayName: "UGV 1",
        hostingMode: "vendor_managed",
        runtimeAuthority: "direct_container",
        registryAuthority: "pms_worker",
        productionQualification: "NOT_CLAIMED",
      },
    });
  } else if (resource.resourceType !== resourceType) {
    throw new Error("PMS_SEED_RESOURCE_IDENTITY_MISMATCH");
  }
  if (resource.status !== "available") {
    if (resource.status === "retired") throw new Error("PMS_SEED_RESOURCE_RETIRED");
    resource = await api(
      "PATCH",
      `/api/v1/resources/${encodeURIComponent(environment)}/${encodeURIComponent(resourceId)}/status`,
      { status: "available", expectedUpdatedAt: resource.updatedAt },
    );
  }
  resource = await convergeResourceAuthorityMetadata(resource);

  const bindings = await api(
    "GET",
    `/api/v1/providers/${encodeURIComponent(providerId)}/resource-bindings`,
  );
  if (!Array.isArray(bindings?.items)) throw new Error("PMS_SEED_BINDING_LIST_INVALID");
  if (
    !bindings.items.some(
      (binding) => binding?.environment === environment && binding?.resourceId === resourceId,
    )
  ) {
    await api("POST", `/api/v1/providers/${encodeURIComponent(providerId)}/resource-bindings`, {
      environment,
      resourceId,
    });
  }

  const deployment = await ensureDirectDeployment();
  const authority = await waitForAuthority(deployment);

  process.stdout.write(
    `${JSON.stringify({
      status: "seeded",
      packageId,
      providerTypeId,
      providerId,
      resourceId,
      environment,
      hostingMode: "vendor_managed",
      runtimeAuthority: "direct_container",
      registryAuthority: "pms_worker",
      productionQualification: "NOT_CLAIMED",
      deployment: authority.deployment,
      process: authority.process,
      registry: authority.registry,
      packageSync,
    })}\n`,
  );
} finally {
  await pool.end();
}

async function convergeResourceAuthorityMetadata(resource) {
  let current = resource;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (hasExpectedResourceAuthorityMetadata(current.metadata)) return current;
    const expectedUpdatedAt = new Date(current.updatedAt);
    if (Number.isNaN(expectedUpdatedAt.getTime())) {
      throw new Error("PMS_SEED_RESOURCE_UPDATED_AT_INVALID");
    }
    try {
      const updated = await providerManagement.updateResourceMetadata(
        {
          environment,
          resourceId,
          metadata: {
            ...current.metadata,
            displayName: "UGV 1",
            hostingMode: "vendor_managed",
            runtimeAuthority: "direct_container",
            registryAuthority: "pms_worker",
            productionQualification: "NOT_CLAIMED",
          },
          expectedUpdatedAt,
        },
        { actorId, correlationId },
      );
      if (!hasExpectedResourceAuthorityMetadata(updated.metadata)) {
        throw new Error("PMS_SEED_RESOURCE_AUTHORITY_METADATA_INVALID");
      }
      return updated;
    } catch (error) {
      if (error?.code !== "OPTIMISTIC_CONCURRENCY_CONFLICT" || attempt === 3) throw error;
      current = await providerManagement.getResource({ environment, resourceId });
    }
  }
  throw new Error("PMS_SEED_RESOURCE_AUTHORITY_METADATA_CONVERGENCE_EXHAUSTED");
}

function hasExpectedResourceAuthorityMetadata(metadata) {
  return (
    metadata?.displayName === "UGV 1" &&
    metadata?.hostingMode === "vendor_managed" &&
    metadata?.runtimeAuthority === "direct_container" &&
    metadata?.registryAuthority === "pms_worker" &&
    metadata?.productionQualification === "NOT_CLAIMED"
  );
}

async function ensureDirectDeployment() {
  const path = `/api/v1/runtime-deployments/${encodeURIComponent(deploymentId)}?providerId=${encodeURIComponent(providerId)}`;
  let deployment = await getOrNull(path);
  if (deployment === null) {
    deployment = unwrapDeployment(
      await api("POST", "/api/v1/runtime-deployments", {
        deploymentId,
        providerId,
        environment,
        runtimeVersion,
        adapterEndpoint,
        desiredReplicas: 1,
        runtimeAuthority: "direct_container",
        directContainer: {
          instanceId,
          controlEndpoint: controlEndpoint.toString(),
          advertisedEndpoint: advertisedEndpoint.toString(),
        },
      }),
    );
  } else {
    assertDirectDeploymentIdentity(deployment);
    if (deployment.status === "STOPPED" || deployment.desiredState !== "running") {
      throw new Error("DIRECT_RUNTIME_EXTERNAL_LIFECYCLE_STATE_UNSUPPORTED");
    } else if (new Set(["FAILED", "DEGRADED"]).has(deployment.status)) {
      deployment = unwrapDeployment(
        await api(
          "POST",
          `/api/v1/runtime-deployments/${encodeURIComponent(deploymentId)}/reconcile`,
          { providerId, expectedDesiredRevision: deployment.desiredRevision },
        ),
      );
    }
  }
  assertDirectDeploymentIdentity(deployment);
  return deployment;
}

async function waitForAuthority(initial) {
  const deadline = Date.now() + waitTimeoutMs;
  let deployment = initial;
  let lastStatus = deployment.status;
  while (Date.now() <= deadline) {
    deployment = await api(
      "GET",
      `/api/v1/runtime-deployments/${encodeURIComponent(deploymentId)}?providerId=${encodeURIComponent(providerId)}`,
    );
    assertDirectDeploymentIdentity(deployment);
    lastStatus = deployment.status;
    const process = await getOrNull(
      `/api/v1/runtime-processes/${encodeURIComponent(instanceId)}?providerId=${encodeURIComponent(providerId)}`,
    );
    const registry = await getOrNull(`/api/v1/registry/${encodeURIComponent(environment)}/latest`);
    const provider = registryProvider(registry);
    if (
      deployment.status === "ACTIVE" &&
      processReady(process) &&
      provider?.effectiveEndpoint === registryEndpoint &&
      provider.serverId === instanceId &&
      Array.isArray(provider.tools) &&
      provider.tools.length > 0
    ) {
      return {
        deployment: {
          deploymentId,
          status: deployment.status,
          runtimeAuthority: deployment.runtimeAuthority,
        },
        process: {
          instanceId,
          observedHealth: process.observedHealth,
          registrationFreshness: process.registrationFreshness,
          lastHeartbeatAt: process.lastHeartbeatAt,
          configState: process.configState,
        },
        registry: {
          revision: registry.revision,
          checksum: registry.checksum,
          effectiveEndpoint: provider.effectiveEndpoint,
          catalogToolCount: provider.tools.length,
        },
      };
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`PMS_SEED_DIRECT_RUNTIME_AUTHORITY_TIMEOUT_${safe(lastStatus)}`);
}

function assertDirectDeploymentIdentity(deployment) {
  if (
    deployment?.deploymentId !== deploymentId ||
    deployment.providerId !== providerId ||
    deployment.environment !== environment ||
    deployment.runtimeVersion !== runtimeVersion ||
    deployment.adapterEndpoint !== adapterEndpoint ||
    deployment.runtimeAuthority !== "direct_container" ||
    deployment.directContainer?.instanceId !== instanceId ||
    deployment.directContainer?.controlEndpoint !== controlEndpoint.toString() ||
    deployment.directContainer?.advertisedEndpoint !== advertisedEndpoint.toString()
  ) {
    throw new Error("PMS_SEED_DIRECT_RUNTIME_DEPLOYMENT_IDENTITY_MISMATCH");
  }
}

function processReady(process) {
  if (
    process?.instanceId !== instanceId ||
    process.deploymentId !== deploymentId ||
    process.observedHealth !== "READY" ||
    process.readyForActive !== true ||
    process.registrationState !== "registered" ||
    process.registrationFreshness !== "registered" ||
    process.configState !== "externally_managed" ||
    typeof process.lastHeartbeatAt !== "string"
  ) {
    return false;
  }
  const heartbeatAgeMs = Date.now() - Date.parse(process.lastHeartbeatAt);
  return Number.isFinite(heartbeatAgeMs) && heartbeatAgeMs >= 0 && heartbeatAgeMs < 45_000;
}

function registryProvider(registry) {
  const providers = registry?.document?.providers;
  return Array.isArray(providers)
    ? providers.find((value) => value?.providerId === providerId)
    : undefined;
}

function unwrapDeployment(value) {
  return value?.deployment ?? value;
}

async function api(method, path, body = undefined) {
  const response = await fetch(new URL(path, apiBaseUrl), {
    method,
    headers: {
      accept: "application/json",
      "x-actor-id": actorId,
      "x-correlation-id": correlationId,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  const source = await response.text();
  let payload;
  try {
    payload = source.length === 0 ? null : JSON.parse(source);
  } catch {
    throw new Error("PMS_SEED_API_RESPONSE_INVALID");
  }
  if (!response.ok) {
    const code = payload?.error?.code;
    throw new Error(
      typeof code === "string" && /^[A-Z0-9_]{1,128}$/.test(code)
        ? `PMS_SEED_API_${response.status}_${code}`
        : `PMS_SEED_API_${response.status}`,
    );
  }
  return payload;
}

async function getOrNull(path) {
  try {
    return await api("GET", path);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PMS_SEED_API_404")) return null;
    throw error;
  }
}

async function secretText(path, maximumBytes) {
  const value = (await readFile(path, "utf8")).trim();
  if (value.length < 16 || value.length > maximumBytes || /[\0\r\n]/.test(value)) {
    throw new Error("PMS_SEED_SECRET_FILE_INVALID");
  }
  return value;
}

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0 || /[\0\r\n]/.test(value)) {
    throw new Error(`${name}_REQUIRED`);
  }
  return value;
}

function exact(name, expected) {
  const value = required(name);
  if (value !== expected) throw new Error(`${name}_INVALID`);
  return value;
}

function boundedInteger(name, fallback, minimum, maximum) {
  const source = process.env[name] ?? String(fallback);
  if (!/^[1-9][0-9]*$/.test(source)) throw new Error(`${name}_INVALID`);
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name}_INVALID`);
  }
  return value;
}

function directRuntimeUrl(name, source, internal) {
  const value = new URL(source);
  if (
    value.protocol !== "http:" ||
    value.pathname !== "/" ||
    value.search.length > 0 ||
    value.hash.length > 0 ||
    value.username.length > 0 ||
    value.password.length > 0 ||
    value.port.length === 0 ||
    (internal
      ? value.hostname !== "ugv-runtime" || value.port !== "8080"
      : new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]).has(value.hostname) ||
        /REPLACE|mock|invalid/i.test(value.hostname))
  ) {
    throw new Error(`${name}_INVALID`);
  }
  return value;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safe(value) {
  return typeof value === "string" ? value.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_") : "UNKNOWN";
}

function internalApiUrl(source) {
  const value = new URL(source);
  if (
    value.protocol !== "http:" ||
    value.hostname !== "pms-api" ||
    value.port !== "8090" ||
    value.pathname !== "/" ||
    value.search.length > 0 ||
    value.hash.length > 0 ||
    value.username.length > 0 ||
    value.password.length > 0
  ) {
    throw new Error("PMS_SEED_API_BASE_URL_INVALID");
  }
  return value;
}
