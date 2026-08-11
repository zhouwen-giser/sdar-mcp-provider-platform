import { readFile } from "node:fs/promises";

const baseUrl = new URL("http://pms-web:8080");
const token = (await readFile("/run/pms-secrets/management-admin.token", "utf8")).trim();
if (token.length < 16 || /\s/.test(token)) fail("PMS_WEB_SMOKE_TOKEN_INVALID");

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
    authorization: `Bearer ${token}`,
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
  authorization: `Bearer ${token}`,
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

const blocked = await request("/api/v1/runtime-registration/instances/npc-smoke", {});
const blockedBody = await json(blocked, "PMS_WEB_BOUNDARY_RESPONSE_INVALID");
if (
  blocked.status !== 404 ||
  blockedBody?.status !== 404 ||
  blockedBody?.code !== "PMS_WEB_API_ROUTE_NOT_ALLOWED"
) {
  fail("PMS_WEB_PROXY_BOUNDARY_INVALID");
}

process.stdout.write(
  `${JSON.stringify({
    status: "passed",
    providerId,
    deploymentId,
    instanceId,
    registryRevision: registry.revision,
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
