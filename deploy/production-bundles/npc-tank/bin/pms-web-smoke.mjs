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

const blocked = await request("/api/v1/runtime-registration/instances/npc-smoke", {});
const blockedBody = await json(blocked, "PMS_WEB_BOUNDARY_RESPONSE_INVALID");
if (
  blocked.status !== 404 ||
  blockedBody?.status !== 404 ||
  blockedBody?.code !== "PMS_WEB_API_ROUTE_NOT_ALLOWED"
) {
  fail("PMS_WEB_PROXY_BOUNDARY_INVALID");
}

process.stdout.write("NPC_PMS_WEB_SMOKE_PASS\n");

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
