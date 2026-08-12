import { readFile } from "node:fs/promises";

const path = process.argv[2];
if (path === undefined) fail("COMPOSE_CONFIG_ARGUMENT_REQUIRED");

let document;
try {
  document = JSON.parse(await readFile(path, "utf8"));
} catch {
  fail("COMPOSE_CONFIG_JSON_INVALID");
}

const revision = requiredEnvironment("BUNDLE_REVISION", /^[0-9a-f]{40,64}$/);
const postgresImage = requiredEnvironment(
  "POSTGRES_IMAGE",
  /^sdar\/production-postgres:17-alpine-[0-9a-f]{12}$/,
);
const expectedImages = {
  "pms-postgres": postgresImage,
  "pms-api": `sdar/production-ugv-pms-api:${revision}`,
  "pms-worker": `sdar/production-ugv-pms-worker:${revision}`,
  "pms-web": `sdar/production-pms-web:${revision}`,
  "ugv-adapter-postgres": postgresImage,
  "ugv-runtime-postgres": postgresImage,
  "ugv-adapter": `sdar/production-ugv-adapter:${revision}`,
  "ugv-runtime": `sdar/production-ugv-runtime:${revision}`,
  "pms-seed": `sdar/production-ugv-pms-worker:${revision}`,
};
const expectedServices = Object.keys(expectedImages).sort();
const services = object(document.services, "COMPOSE_SERVICES_INVALID");

if (document.name !== "sdar-production-ugv") fail("COMPOSE_PROJECT_NAME_INVALID");
if (JSON.stringify(Object.keys(services).sort()) !== JSON.stringify(expectedServices)) {
  fail("COMPOSE_SERVICE_SET_INVALID");
}

for (const [name, expectedImage] of Object.entries(expectedImages)) {
  const value = service(name);
  if (value.image !== expectedImage) fail(`IMAGE_IDENTITY_INVALID_${safe(name)}`);
  if (value.build !== undefined) fail(`BUILD_FORBIDDEN_${safe(name)}`);
  if (value.pull_policy !== "never") fail(`PULL_POLICY_INVALID_${safe(name)}`);
  if (/mock-ugv|mock-npc|simulator-mock|mqtt-test/i.test(JSON.stringify(value))) {
    fail(`MOCK_REFERENCE_FORBIDDEN_${safe(name)}`);
  }
}

const pmsApi = service("pms-api");
const pmsWorker = service("pms-worker");
const pmsWeb = service("pms-web");
const adapter = service("ugv-adapter");
const runtime = service("ugv-runtime");
const seed = service("pms-seed");

if (Array.isArray(pmsApi.ports) && pmsApi.ports.length > 0) fail("PMS_API_HOST_PORT_FORBIDDEN");
const pmsApiEnvironment = environment(pmsApi);
requiredValues(pmsApiEnvironment, {
  ALLOW_INSECURE_INTERNAL_TRANSPORT: "true",
  PMS_API_MANAGEMENT_AUTH_MODE: "anonymous_intranet",
  PMS_RUNTIME_CREDENTIAL_FILE: "/run/pms-secrets/api/runtime.json",
});
if (
  pmsApiEnvironment.PMS_MANAGEMENT_CREDENTIAL_FILE !== undefined ||
  /management(?:-admin|-reader)?\.(?:json|token)/i.test(JSON.stringify(pmsApi))
) {
  fail("PMS_API_MANAGEMENT_CREDENTIAL_FORBIDDEN");
}
if (pmsWorker.network_mode !== "service:pms-api") fail("PMS_WORKER_NETWORK_AUTHORITY_INVALID");
if (environment(pmsWorker).PMS_WORKSPACE_ROOT !== "/app") fail("PMS_WORKER_ROOT_INVALID");
if (environment(pmsWorker).ALLOW_INSECURE_INTERNAL_TRANSPORT !== "true") {
  fail("PMS_WORKER_INSECURE_INTERNAL_TRANSPORT_OPT_IN_REQUIRED");
}
if (environment(pmsWorker).PMS_EXTERNAL_RUNTIME_CATALOG_AUTH_MODE !== "anonymous_intranet") {
  fail("PMS_WORKER_EXTERNAL_CATALOG_AUTH_MODE_INVALID");
}
if (environment(pmsWorker).PMS_RUNTIME_CONTROL_PLANE_URL !== "http://pms-api:8090") {
  fail("PMS_WORKER_CONTROL_PLANE_URL_INVALID");
}
if (environment(pmsWorker).PMS_EXTERNAL_RUNTIME_CATALOG_CREDENTIAL_FILE !== undefined) {
  fail("PMS_WORKER_EXTERNAL_CATALOG_CREDENTIAL_FORBIDDEN");
}
if (!hasNetwork(pmsApi, "ugv-service")) fail("PMS_API_PROVIDER_NETWORK_REQUIRED");
if (environment(seed).PMS_SEED_ADAPTER_ENDPOINT !== "ugv-adapter:7010") {
  fail("PMS_SEED_ADAPTER_ENDPOINT_INVALID");
}
if (environment(seed).PMS_SEED_PACKAGE_ROOT !== "/app") fail("PMS_SEED_PACKAGE_ROOT_INVALID");
requiredValues(environment(seed), {
  PMS_SEED_DEPLOYMENT_ID: "production-ugv-direct",
  PMS_SEED_INSTANCE_ID: "production-ugv-direct-1",
  PMS_SEED_RUNTIME_VERSION: "2.0.0-rc.1",
  PMS_SEED_RUNTIME_CONTROL_ENDPOINT: "http://ugv-runtime:8080",
});
assertEndpoint(
  environment(seed).PMS_SEED_RUNTIME_ADVERTISED_ENDPOINT,
  ["http:"],
  "RUNTIME_ADVERTISED",
  "/",
);
if (!Array.isArray(seed.profiles) || !seed.profiles.includes("seed")) {
  fail("PMS_SEED_PROFILE_REQUIRED");
}

const webEnvironment = environment(pmsWeb);
requiredValues(webEnvironment, {
  PMS_WEB_DATA_MODE: "api",
  PMS_WEB_API_BASE: "/api/console/v1",
  PMS_WEB_API_UPSTREAM: "http://pms-api:8090",
  PMS_WEB_RAW_API_PROXY_ENABLED: "true",
});
assertPublishedPort(pmsWeb, 8080, "PMS_WEB");

const adapterEnvironment = environment(adapter);
requiredValues(adapterEnvironment, {
  PROVIDER_ID: "isr.vehicle.ugv.ugv1",
  RUNTIME_ENV: "production",
  ALLOW_INSECURE_INTERNAL_TRANSPORT: "true",
  ADAPTER_TLS_MODE: "disabled",
  UGV_ADAPTER_STORE_MODE: "postgres",
  UGV_MQTT_TLS_MODE: "disabled",
  UGV_MQTT_SESSION_MODE: "persistent",
  UGV_DEVICE_MCP_TLS_MODE: "disabled",
  UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT: "false",
  PROVIDER_TELEMETRY_ENABLED: "true",
  PROVIDER_TELEMETRY_ENDPOINT: "ugv-runtime:7002",
  PROVIDER_TELEMETRY_TLS_MODE: "disabled",
});
if (
  !new Set(["ros_message_json", "direct_domain_json", "ros_bridge_json"]).has(
    adapterEnvironment.UGV_MQTT_WIRE_MODE,
  )
) {
  fail("UGV_MQTT_WIRE_MODE_INVALID");
}
assertEndpoint(adapterEnvironment.UGV_DEVICE_MCP_URL, ["http:"], "DEVICE_MCP", "/mcp");
assertEndpoint(adapterEnvironment.UGV_MQTT_URL, ["mqtt:", "ws:"], "MQTT");
assertTransportTrustAbsent(adapterEnvironment, "ADAPTER");
assertMigrationBeforeMain(
  adapter,
  "dist/apps/ugv-provider-adapter/src/migrate.js",
  "dist/apps/ugv-provider-adapter/src/main.js",
  "ADAPTER",
);
if (Array.isArray(adapter.ports) && adapter.ports.length > 0) fail("ADAPTER_HOST_PORT_FORBIDDEN");

const runtimeEnvironment = environment(runtime);
requiredValues(runtimeEnvironment, {
  RUNTIME_ENV: "production",
  PROVIDER_ID: "isr.vehicle.ugv.ugv1",
  ADAPTER_ENDPOINT: "ugv-adapter:7010",
  ALLOW_INSECURE_INTERNAL_TRANSPORT: "true",
  ADAPTER_TLS_MODE: "disabled",
  AUTH_MODE: "anonymous",
  PMS_DEPLOYMENT_ID: "production-ugv-direct",
  PMS_INSTANCE_ID: "production-ugv-direct-1",
  PMS_RUNTIME_REGISTRATION_URL: "http://pms-api:8090",
  PMS_RUNTIME_REGISTRATION_TOKEN_FILE: "/run/secrets/pms-runtime-control-plane.token",
  PMS_RUNTIME_HEARTBEAT_INTERVAL_MS: "10000",
  MCP_LEGACY_ENDPOINT_ENABLED: "false",
  BUSINESS_EVENTS_ENABLED: "true",
  BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY: "true",
  PROVIDER_TELEMETRY_INGRESS_ENABLED: "true",
  PROVIDER_TELEMETRY_TLS_MODE: "disabled",
  ALLOW_WEAK_LEASE_CONFIGURATION: "false",
  INTERNAL_ENDPOINTS_ENABLED: "false",
});
for (const forbidden of ["JWT_HS256_SECRET", "JWT_ISSUER", "JWT_AUDIENCE"]) {
  if (runtimeEnvironment[forbidden] !== undefined)
    fail(`RUNTIME_AUTH_CREDENTIAL_FORBIDDEN_${forbidden}`);
}
if (/runtime_jwt|jwt-hs256/i.test(JSON.stringify(runtime))) {
  fail("RUNTIME_AUTH_SECRET_MOUNT_FORBIDDEN");
}
for (const forbidden of [
  "PMS_SEED_ADMIN_TOKEN_FILE",
  "PMS_SEED_MANAGEMENT_TOKEN_FILE",
  "PMS_SMOKE_ADMIN_TOKEN_FILE",
  "JWT_ISSUER",
  "JWT_AUDIENCE",
]) {
  if (environment(seed)[forbidden] !== undefined)
    fail(`SEED_AUTH_CREDENTIAL_FORBIDDEN_${forbidden}`);
}
assertTransportTrustAbsent(runtimeEnvironment, "RUNTIME");
assertMigrationBeforeMain(
  runtime,
  "dist/apps/runtime/src/migrate.js",
  "dist/apps/runtime/src/main.js",
  "RUNTIME",
);
assertPublishedPort(runtime, 8080, "UGV_RUNTIME");

for (const forbidden of [
  "PMS_RUNTIME_CONFIG_URL",
  "PMS_RUNTIME_CONFIG_TOKEN_FILE",
  "PMS_RUNTIME_CONFIG_CACHE_PATH",
]) {
  if (runtimeEnvironment[forbidden] !== undefined) {
    fail(`DIRECT_RUNTIME_CONFIG_AUTHORITY_FORBIDDEN_${forbidden}`);
  }
}
if (!hasNetwork(runtime, "ugv-service")) fail("DIRECT_RUNTIME_PROVIDER_NETWORK_REQUIRED");
if (hasNetwork(runtime, "pms-control")) fail("DIRECT_RUNTIME_CONTROL_NETWORK_REDUNDANT");
const advertisedUrl = new URL(environment(seed).PMS_SEED_RUNTIME_ADVERTISED_ENDPOINT);
const runtimePublishedPort = Number(object(runtime.ports[0], "UGV_RUNTIME_PORT_INVALID").published);
if (
  Number(advertisedUrl.port) !== runtimePublishedPort ||
  Number(environment(seed).PMS_SEED_RUNTIME_PUBLISHED_PORT) !== runtimePublishedPort
) {
  fail("RUNTIME_ADVERTISED_PORT_MISMATCH");
}

for (const [name, value] of [
  ["ugv-adapter", adapter],
  ["ugv-runtime", runtime],
]) {
  if (/internal-pki|private-ca|\.crt|\.pem|mqtt-password/i.test(JSON.stringify(value))) {
    fail(`TRANSPORT_TRUST_MOUNT_FORBIDDEN_${safe(name)}`);
  }
}

for (const name of ["pms-postgres", "ugv-adapter-postgres", "ugv-runtime-postgres"]) {
  const database = service(name);
  if (Array.isArray(database.ports) && database.ports.length > 0) {
    fail(`DATABASE_HOST_PORT_FORBIDDEN_${safe(name)}`);
  }
}

process.stdout.write("UGV_PRODUCTION_COMPOSE_POLICY_PASS\n");

function service(name) {
  return object(services[name], `SERVICE_INVALID_${safe(name)}`);
}

function environment(value) {
  return object(value.environment, "SERVICE_ENVIRONMENT_INVALID");
}

function object(value, code) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(code);
  return value;
}

function requiredEnvironment(name, pattern) {
  const value = process.env[name];
  if (typeof value !== "string" || !pattern.test(value)) fail(`${name}_INVALID`);
  return value;
}

function requiredValues(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) fail(`PRODUCTION_VALUE_INVALID_${key}`);
  }
}

function assertEndpoint(source, protocols, label, requiredPath = undefined) {
  let url;
  try {
    url = new URL(source);
  } catch {
    fail(`${label}_URL_INVALID`);
  }
  if (
    !protocols.includes(url.protocol) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    /REPLACE|mock|invalid/i.test(url.hostname) ||
    ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(url.hostname)
  ) {
    fail(`${label}_URL_UNSAFE`);
  }
  if (requiredPath !== undefined && url.pathname !== requiredPath) fail(`${label}_PATH_INVALID`);
}

function assertPublishedPort(value, target, label) {
  if (!Array.isArray(value.ports) || value.ports.length !== 1) fail(`${label}_PORT_INVALID`);
  const port = object(value.ports[0], `${label}_PORT_INVALID`);
  const published = Number(port.published);
  if (
    Number(port.target) !== target ||
    typeof port.host_ip !== "string" ||
    port.host_ip.length === 0 ||
    /[\0\r\n]/.test(port.host_ip) ||
    !Number.isSafeInteger(published) ||
    published < 1 ||
    published > 65_535
  ) {
    fail(`${label}_PORT_NOT_EXPLICIT`);
  }
}

function hasNetwork(value, name) {
  return (
    typeof value.networks === "object" &&
    value.networks !== null &&
    !Array.isArray(value.networks) &&
    Object.prototype.hasOwnProperty.call(value.networks, name)
  );
}

function assertTransportTrustAbsent(value, label) {
  for (const key of [
    "NODE_EXTRA_CA_CERTS",
    "ADAPTER_TLS_CA_PATH",
    "ADAPTER_TLS_CERT_PATH",
    "ADAPTER_TLS_KEY_PATH",
    "UGV_MQTT_USERNAME",
    "UGV_MQTT_PASSWORD_FILE",
    "UGV_MQTT_TLS_CA_PATH",
    "UGV_MQTT_TLS_CERT_PATH",
    "UGV_MQTT_TLS_KEY_PATH",
    "UGV_DEVICE_MCP_HEADERS_FILE",
    "PROVIDER_TELEMETRY_TLS_CA_PATH",
    "PROVIDER_TELEMETRY_TLS_CERT_PATH",
    "PROVIDER_TELEMETRY_TLS_KEY_PATH",
  ]) {
    if (value[key] !== undefined) fail(`${label}_TRANSPORT_TRUST_FORBIDDEN_${key}`);
  }
}

function assertMigrationBeforeMain(value, migrationEntry, mainEntry, label) {
  const command = Array.isArray(value.command) ? value.command.join("\n") : "";
  const migrationPosition = command.indexOf(migrationEntry);
  const mainPosition = command.indexOf(mainEntry);
  if (migrationPosition < 0 || mainPosition < 0 || migrationPosition >= mainPosition) {
    fail(`${label}_MIGRATION_ORDER_INVALID`);
  }
}

function safe(value) {
  return value.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_");
}

function fail(code) {
  process.stderr.write(`BLOCKED_CONFIGURATION:${code}\n`);
  process.exit(2);
}
