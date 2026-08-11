const origin = new URL("http://127.0.0.1:8080");

const page = await boundedFetch(new URL("/", origin));
const html = await page.text();
if (
  page.status !== 200 ||
  !html.includes('<meta name="pms-web-data-mode" content="api">') ||
  !html.includes('<meta name="pms-web-api-base" content="/api/console/v1">') ||
  html.includes("http://pms-api:8090")
) {
  throw new Error("UGV_SMOKE_PMS_WEB_RUNTIME_CONFIG_INVALID");
}

const providers = await boundedFetch(new URL("/api/console/v1/providers", origin), {
  headers: { "x-correlation-id": "ugv-production-pms-web-smoke" },
});
let providersBody;
try {
  providersBody = await providers.json();
} catch {
  throw new Error("UGV_SMOKE_PMS_WEB_PROXY_NON_JSON");
}
if (
  providers.status !== 200 ||
  !Array.isArray(providersBody?.items) ||
  !providersBody.items.some((provider) => provider?.providerId === "isr.vehicle.ugv.ugv1")
) {
  throw new Error("UGV_SMOKE_PMS_WEB_PROVIDER_NOT_VISIBLE");
}

const providerId = "isr.vehicle.ugv.ugv1";
const deploymentId = "production-ugv-direct";
const instanceId = "production-ugv-direct-1";
const proxyHeaders = { "x-correlation-id": "ugv-production-pms-web-smoke" };
const deployments = await json(
  await boundedFetch(
    new URL(
      `/api/console/v1/runtime-deployments?providerId=${encodeURIComponent(providerId)}`,
      origin,
    ),
    { headers: proxyHeaders },
  ),
  "UGV_SMOKE_PMS_WEB_DEPLOYMENT_RESPONSE_INVALID",
);
const deployment = Array.isArray(deployments?.items)
  ? deployments.items.find((value) => value?.deploymentId === deploymentId)
  : undefined;
if (
  deployment?.status !== "ACTIVE" ||
  deployment.desiredState !== "running" ||
  deployment.databaseProfileId !== "not_applicable" ||
  deployment.configProfileId !== "not_applicable"
) {
  throw new Error("UGV_SMOKE_PMS_WEB_DIRECT_DEPLOYMENT_NOT_VISIBLE");
}

const processes = await json(
  await boundedFetch(
    new URL(
      `/api/console/v1/runtime-processes?providerId=${encodeURIComponent(providerId)}&deploymentId=${encodeURIComponent(deploymentId)}`,
      origin,
    ),
    { headers: proxyHeaders },
  ),
  "UGV_SMOKE_PMS_WEB_PROCESS_RESPONSE_INVALID",
);
const runtimeProcess = Array.isArray(processes?.items)
  ? processes.items.find((value) => value?.instanceId === instanceId)
  : undefined;
if (
  runtimeProcess?.observedHealth !== "READY" ||
  runtimeProcess.readyForActive !== true ||
  runtimeProcess.registrationState !== "registered" ||
  runtimeProcess.registrationFreshness !== "registered"
) {
  throw new Error("UGV_SMOKE_PMS_WEB_DIRECT_PROCESS_NOT_VISIBLE");
}

const registry = await json(
  await boundedFetch(new URL("/api/console/v1/registry/production/latest", origin), {
    headers: proxyHeaders,
  }),
  "UGV_SMOKE_PMS_WEB_REGISTRY_RESPONSE_INVALID",
);
const registryProvider = Array.isArray(registry?.document?.providers)
  ? registry.document.providers.find((value) => value?.providerId === providerId)
  : undefined;
if (
  registryProvider?.serverId !== instanceId ||
  typeof registryProvider.effectiveEndpoint !== "string" ||
  !registryProvider.effectiveEndpoint.endsWith("/mcp") ||
  !Array.isArray(registryProvider.tools) ||
  registryProvider.tools.length === 0
) {
  throw new Error("UGV_SMOKE_PMS_WEB_REGISTRY_NOT_VISIBLE");
}

const blocked = await boundedFetch(
  new URL("/api/v1/runtime-registration/instances/ugv-production-smoke", origin),
);
let blockedBody;
try {
  blockedBody = await blocked.json();
} catch {
  throw new Error("UGV_SMOKE_PMS_WEB_BOUNDARY_NON_JSON");
}
if (
  blocked.status !== 404 ||
  blockedBody?.status !== 404 ||
  blockedBody?.code !== "PMS_WEB_API_ROUTE_NOT_ALLOWED"
) {
  throw new Error("UGV_SMOKE_PMS_WEB_PROXY_BOUNDARY_INVALID");
}

process.stdout.write(
  `${JSON.stringify({
    status: "passed",
    dataMode: "api",
    apiBase: "/api/console/v1",
    providerId,
    deploymentId,
    instanceId,
    registryRevision: registry.revision,
    directManagementApiBlocked: true,
  })}\n`,
);

async function boundedFetch(url, init = {}) {
  try {
    return await fetch(url, { ...init, signal: globalThis.AbortSignal.timeout(10_000) });
  } catch {
    throw new Error("UGV_SMOKE_PMS_WEB_REQUEST_FAILED");
  }
}

async function json(response, code) {
  let value;
  try {
    value = await response.json();
  } catch {
    throw new Error(code);
  }
  if (response.status !== 200) throw new Error(code);
  return value;
}
