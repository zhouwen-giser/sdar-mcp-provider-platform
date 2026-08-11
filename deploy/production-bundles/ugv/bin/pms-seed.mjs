import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { synchronizeWorkspaceProviderPackages } from "/app/dist/packages/pms-application/src/index.js";
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
const packageRoot = required("PMS_SEED_PACKAGE_ROOT");
const apiBaseUrl = internalApiUrl(required("PMS_SEED_API_BASE_URL"));
const databaseUrl = await secretText(required("PMS_SEED_DATABASE_URL_FILE"), 8_192);
const token = await secretText(required("PMS_SEED_ADMIN_TOKEN_FILE"), 8_192);
const correlationId = `ugv-production-seed-${randomUUID()}`;
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

try {
  const packageSync = await synchronizeWorkspaceProviderPackages(
    new PostgresPmsUnitOfWork(pool),
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
        registryAuthority: "not_configured",
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
      registryAuthority: "not_configured",
      packageSync,
    })}\n`,
  );
} finally {
  await pool.end();
}

async function api(method, path, body = undefined) {
  const response = await fetch(new URL(path, apiBaseUrl), {
    method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
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
