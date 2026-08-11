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
    providerId: "isr.vehicle.ugv.ugv1",
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
