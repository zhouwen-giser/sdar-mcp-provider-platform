const baseUrl = smokeOrigin(process.env.PMS_WEB_SMOKE_ORIGIN ?? "http://pms-web:8080");

const page = await request("/", {});
const html = await page.text();
if (
  page.status !== 200 ||
  !html.includes('<meta name="pms-web-data-mode" content="api">') ||
  !html.includes('<meta name="pms-web-api-base" content="/api/console/v1">') ||
  html.includes("http://pms-api:8090")
) {
  fail("PMS_WEB_RUNTIME_CONFIGURATION_INVALID");
}

const providers = await request("/api/console/v1/providers", {
  headers: {
    "x-correlation-id": "npc-production-pms-web-smoke",
  },
});
const providersBody = await json(providers, "PMS_WEB_PROVIDER_RESPONSE_INVALID");
if (
  providers.status !== 200 ||
  !Array.isArray(providersBody?.items) ||
  !providersBody.items.some(
    (provider) =>
      provider?.providerId === "isr.vehicle.npc-tank.npc-tank1" &&
      provider?.status === "active" &&
      provider?.hostingMode === "vendor_managed" &&
      provider?.adapterEndpoint === "npc-tank-adapter:7013",
  )
) {
  fail("PMS_WEB_NPC_PROVIDER_NOT_PROJECTED");
}

const providerId = "isr.vehicle.npc-tank.npc-tank1";
const deploymentId = "production-npc-tank-direct";
const instanceId = "production-npc-tank-direct-1";
const proxyHeaders = {
  "x-correlation-id": "npc-production-pms-web-smoke",
};
const deployments = await json(
  await request(
    `/api/console/v1/runtime-deployments?providerId=${encodeURIComponent(providerId)}`,
    { headers: proxyHeaders },
  ),
  "PMS_WEB_DEPLOYMENT_RESPONSE_INVALID",
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
  fail("PMS_WEB_DIRECT_DEPLOYMENT_NOT_PROJECTED");
}

const processes = await json(
  await request(
    `/api/console/v1/runtime-processes?providerId=${encodeURIComponent(providerId)}&deploymentId=${encodeURIComponent(deploymentId)}`,
    { headers: proxyHeaders },
  ),
  "PMS_WEB_PROCESS_RESPONSE_INVALID",
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
  fail("PMS_WEB_DIRECT_PROCESS_NOT_PROJECTED");
}

const registry = await json(
  await request("/api/console/v1/registry/production/latest", { headers: proxyHeaders }),
  "PMS_WEB_REGISTRY_RESPONSE_INVALID",
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
  fail("PMS_WEB_REGISTRY_NOT_PROJECTED");
}

const rawProviderResponse = await request(`/api/v1/providers/${encodeURIComponent(providerId)}`, {
  headers: proxyHeaders,
});
const rawProvider = await json(rawProviderResponse, "PMS_WEB_RAW_PROVIDER_RESPONSE_INVALID");
if (
  rawProviderResponse.status !== 200 ||
  rawProvider?.providerId !== providerId ||
  rawProvider.status !== "active"
) {
  fail("PMS_WEB_RAW_MANAGEMENT_API_NOT_VISIBLE");
}

const projectionResponse = await request(
  "/api/v1/registry/production/consumers/sdar/v1/sources/npc-tank-smpp/latest",
  { headers: proxyHeaders },
);
const projection = await json(projectionResponse, "PMS_WEB_SDAR_PROJECTION_RESPONSE_INVALID");
const projectionProvider = Array.isArray(projection?.providers)
  ? projection.providers.find((value) => value?.externalProviderId === providerId)
  : undefined;
if (
  projectionResponse.status !== 200 ||
  projectionResponse.headers.get("x-smpp-projection-contract") !== "sdar-registry-v1" ||
  !/^"[0-9a-f]{64}"$/.test(projectionResponse.headers.get("etag") ?? "") ||
  JSON.stringify(Object.keys(projection ?? {}).sort()) !==
    JSON.stringify(["checksum", "expiresAt", "generatedAt", "providers", "revision"]) ||
  projectionProvider?.externalServerId !== instanceId ||
  projectionProvider.serverEndpoint !== registryProvider.effectiveEndpoint ||
  projectionProvider.catalogRevision !== String(registryProvider.catalogRevision)
) {
  fail("PMS_WEB_SDAR_PROJECTION_INVALID");
}

process.stdout.write(
  `${JSON.stringify({
    status: "passed",
    smokeOrigin: baseUrl.origin,
    providerId,
    deploymentId,
    instanceId,
    registryRevision: registry.revision,
    rawManagementApiAnonymous: true,
    sdarProjectionAnonymous: true,
    projectionRevision: projection.revision,
    projectionChecksum: projection.checksum,
  })}\n`,
);

async function request(path, init) {
  try {
    return await fetch(new URL(path, baseUrl), {
      ...init,
      signal: globalThis.AbortSignal.timeout(10_000),
    });
  } catch {
    fail("PMS_WEB_REQUEST_FAILED");
  }
}

async function json(response, code) {
  try {
    return await response.json();
  } catch {
    fail(code);
  }
}

function fail(code) {
  process.stderr.write(`BLOCKED_EXTERNAL_ENV:${code}\n`);
  process.exit(2);
}

function smokeOrigin(source) {
  let value;
  try {
    value = new URL(source);
  } catch {
    fail("PMS_WEB_SMOKE_ORIGIN_INVALID");
  }
  if (
    value.protocol !== "http:" ||
    value.username.length > 0 ||
    value.password.length > 0 ||
    value.pathname !== "/" ||
    value.search.length > 0 ||
    value.hash.length > 0
  ) {
    fail("PMS_WEB_SMOKE_ORIGIN_INVALID");
  }
  return value;
}
