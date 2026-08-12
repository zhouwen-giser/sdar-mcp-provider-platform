const [baseUrlSource] = process.argv.slice(2);
if (baseUrlSource === undefined) fail("SMOKE_ARGUMENTS_REQUIRED");

const baseUrl = new URL(baseUrlSource);
if (baseUrl.protocol !== "http:" || baseUrl.hostname !== "127.0.0.1") {
  fail("SMOKE_BASE_URL_INVALID");
}
const page = await safeFetch(new URL("/", baseUrl), {}, "PMS_WEB_READY_FAILED");
const html = await page.text();
if (
  page.status !== 200 ||
  !html.includes('<meta name="pms-web-data-mode" content="api">') ||
  !html.includes('<meta name="pms-web-api-base" content="/api/console/v1">') ||
  html.includes("http://pms-api:8090")
) {
  fail("PMS_WEB_RUNTIME_CONFIG_INVALID");
}

const providers = await safeFetch(
  new URL("/api/console/v1/providers", baseUrl),
  {
    headers: {
      "x-correlation-id": "pms-console-package-smoke",
    },
  },
  "PMS_WEB_CONSOLE_PROXY_FAILED",
);
if (providers.status !== 200) fail("PMS_WEB_CONSOLE_PROXY_STATUS_INVALID");
const providersBody = await providers.json().catch(() => undefined);
if (!Array.isArray(providersBody?.items)) fail("PMS_WEB_CONSOLE_PROXY_BODY_INVALID");

const blocked = await safeFetch(
  new URL("/api/v1/runtime-registration/instances/package-smoke", baseUrl),
  {},
  "PMS_WEB_PROXY_BOUNDARY_FAILED",
);
const blockedBody = await blocked.json().catch(() => undefined);
if (
  blocked.status !== 404 ||
  blockedBody?.code !== "PMS_WEB_API_ROUTE_NOT_ALLOWED" ||
  blockedBody?.status !== 404
) {
  fail("PMS_WEB_PROXY_BOUNDARY_INVALID");
}

process.stdout.write("PMS_CONSOLE_HTTP_SMOKE_PASS\n");

async function safeFetch(url, init, code) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  timer.unref();
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    fail(code);
  } finally {
    clearTimeout(timer);
  }
}

function fail(code) {
  process.stderr.write(`BLOCKED_EXTERNAL_ENV:${code}\n`);
  process.exit(2);
}
