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
  "pms-api": `sdar/production-npc-tank-pms-api:${revision}`,
  "pms-worker": `sdar/production-npc-tank-pms-worker:${revision}`,
  "pms-web": `sdar/production-pms-web:${revision}`,
  "npc-adapter-postgres": postgresImage,
  "npc-runtime-postgres": postgresImage,
  "npc-tank-adapter": `sdar/production-npc-tank-adapter:${revision}`,
  "npc-tank-runtime": `sdar/production-npc-tank-runtime:${revision}`,
  "pms-seed": `sdar/production-npc-tank-pms-worker:${revision}`,
};
const expectedServices = Object.keys(expectedImages).sort();
const services = object(document.services, "COMPOSE_SERVICES_INVALID");
if (document.name !== "sdar-production-npc-tank") fail("COMPOSE_PROJECT_NAME_INVALID");
if (JSON.stringify(Object.keys(services).sort()) !== JSON.stringify(expectedServices)) {
  fail("COMPOSE_SERVICE_SET_INVALID");
}

for (const [name, expectedImage] of Object.entries(expectedImages)) {
  const service = object(services[name], `SERVICE_INVALID_${safe(name)}`);
  if (service.image !== expectedImage) fail(`IMAGE_IDENTITY_INVALID_${safe(name)}`);
  if (service.build !== undefined) fail(`BUILD_FORBIDDEN_${safe(name)}`);
  if (service.pull_policy !== "never") fail(`PULL_POLICY_INVALID_${safe(name)}`);
  const rendered = JSON.stringify(service);
  if (/mock-npc|mock-ugv|simulator-mock|mqtt-test/i.test(rendered)) {
    fail(`MOCK_REFERENCE_FORBIDDEN_${safe(name)}`);
  }
}

const pmsApi = service("pms-api");
const pmsWorker = service("pms-worker");
const pmsWeb = service("pms-web");
const adapter = service("npc-tank-adapter");
const runtime = service("npc-tank-runtime");
const seed = service("pms-seed");

if (Array.isArray(pmsApi.ports) && pmsApi.ports.length > 0) fail("PMS_API_HOST_PORT_FORBIDDEN");
const pmsApiEnvironment = environment(pmsApi);
requiredValues(pmsApiEnvironment, {
  ALLOW_INSECURE_INTERNAL_TRANSPORT: "true",
  PMS_API_MANAGEMENT_AUTH_MODE: "anonymous_intranet",
  PMS_RUNTIME_CREDENTIAL_FILE: "/run/pms-secrets/runtime.json",
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
if (environment(pmsWorker).PMS_EXTERNAL_RUNTIME_CATALOG_CREDENTIAL_FILE !== undefined) {
  fail("PMS_WORKER_EXTERNAL_CATALOG_CREDENTIAL_FORBIDDEN");
}
if (!hasNetwork(pmsApi, "provider-plane")) fail("PMS_API_PROVIDER_NETWORK_REQUIRED");
if (environment(seed).PMS_SEED_ADAPTER_ENDPOINT !== "npc-tank-adapter:7013") {
  fail("PMS_SEED_ADAPTER_ENDPOINT_INVALID");
}
if (environment(seed).PMS_SEED_CATALOG_ROOT !== "/app") {
  fail("PMS_SEED_CATALOG_ROOT_INVALID");
}
requiredValues(environment(seed), {
  PMS_SEED_DEPLOYMENT_ID: "production-npc-tank-direct",
  PMS_SEED_INSTANCE_ID: "production-npc-tank-direct-1",
  PMS_SEED_RUNTIME_VERSION: "2.0.0-rc.1",
  PMS_SEED_RUNTIME_CONTROL_ENDPOINT: "http://npc-tank-runtime:8080",
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
if (
  webEnvironment.PMS_WEB_DATA_MODE !== "api" ||
  webEnvironment.PMS_WEB_API_BASE !== "/api/console/v1" ||
  webEnvironment.PMS_WEB_API_UPSTREAM !== "http://pms-api:8090" ||
  webEnvironment.PMS_WEB_RAW_API_PROXY_ENABLED !== "true"
) {
  fail("PMS_WEB_API_MODE_INVALID");
}
assertPublishedPort(pmsWeb, 8080, "PMS_WEB");

const adapterEnvironment = environment(adapter);
requiredValues(adapterEnvironment, {
  PROVIDER_ID: "isr.vehicle.npc-tank.npc-tank1",
  RUNTIME_ENV: "production",
  ALLOW_INSECURE_INTERNAL_TRANSPORT: "true",
  ADAPTER_TLS_MODE: "disabled",
  NPC_TANK_ADAPTER_STORE_MODE: "postgres",
  NPC_TANK_MQTT_TLS_MODE: "disabled",
  NPC_TANK_MQTT_SESSION_MODE: "persistent",
  NPC_TANK_MQTT_WIRE_MODE: "ros_bridge_json",
  NPC_TANK_DEVICE_MCP_TLS_MODE: "disabled",
  NPC_TANK_DEVICE_MCP_ALLOW_MOCK_CONTRACT: "false",
  PROVIDER_TELEMETRY_ENABLED: "true",
  PROVIDER_TELEMETRY_TLS_MODE: "disabled",
  PROVIDER_TELEMETRY_ENDPOINT: "npc-tank-runtime:7002",
});
assertTransportTrustAbsent(adapterEnvironment, "ADAPTER");
assertEndpoint(adapterEnvironment.NPC_TANK_DEVICE_MCP_URL, ["http:"], "DEVICE_MCP", "/mcp");
assertEndpoint(adapterEnvironment.NPC_TANK_MQTT_URL, ["mqtt:"], "MQTT");
if (Array.isArray(adapter.ports) && adapter.ports.length > 0) fail("ADAPTER_HOST_PORT_FORBIDDEN");

const runtimeEnvironment = environment(runtime);
requiredValues(runtimeEnvironment, {
  RUNTIME_ENV: "production",
  PROVIDER_ID: "isr.vehicle.npc-tank.npc-tank1",
  ADAPTER_ENDPOINT: "npc-tank-adapter:7013",
  ALLOW_INSECURE_INTERNAL_TRANSPORT: "true",
  ADAPTER_TLS_MODE: "disabled",
  AUTH_MODE: "anonymous",
  PMS_DEPLOYMENT_ID: "production-npc-tank-direct",
  PMS_INSTANCE_ID: "production-npc-tank-direct-1",
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
  OTEL_EXPORTER_OTLP_TLS_MODE: "disabled",
  OTEL_SERVICE_INSTANCE_ID: "production-npc-tank-direct-1",
});
assertOtlpConfiguration(runtimeEnvironment, "NPC_TANK");
for (const forbidden of ["JWT_HS256_SECRET", "JWT_ISSUER", "JWT_AUDIENCE"]) {
  if (runtimeEnvironment[forbidden] !== undefined)
    fail(`RUNTIME_AUTH_CREDENTIAL_FORBIDDEN_${forbidden}`);
}
if (/runtime-jwt|jwt-hs256/i.test(JSON.stringify(runtime))) {
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
if (!absoluteSecretPath(runtimeEnvironment.DATABASE_URL_FILE)) {
  fail("RUNTIME_SECRET_PATH_INVALID_DATABASE_URL_FILE");
}
assertTransportTrustAbsent(runtimeEnvironment, "RUNTIME");
for (const forbidden of [
  "PMS_RUNTIME_CONFIG_URL",
  "PMS_RUNTIME_CONFIG_TOKEN_FILE",
  "PMS_RUNTIME_CONFIG_CACHE_PATH",
]) {
  if (runtimeEnvironment[forbidden] !== undefined)
    fail(`DIRECT_RUNTIME_CONFIG_AUTHORITY_FORBIDDEN_${forbidden}`);
}
if (!hasNetwork(runtime, "provider-plane")) fail("DIRECT_RUNTIME_PROVIDER_NETWORK_REQUIRED");
if (hasNetwork(runtime, "control-plane")) fail("DIRECT_RUNTIME_CONTROL_NETWORK_REDUNDANT");
assertPublishedPort(runtime, 8080, "NPC_RUNTIME");
const advertisedUrl = new URL(environment(seed).PMS_SEED_RUNTIME_ADVERTISED_ENDPOINT);
const runtimePublishedPort = Number(object(runtime.ports[0], "NPC_RUNTIME_PORT_INVALID").published);
if (
  Number(advertisedUrl.port) !== runtimePublishedPort ||
  Number(environment(seed).PMS_SEED_RUNTIME_PUBLISHED_PORT) !== runtimePublishedPort
) {
  fail("RUNTIME_ADVERTISED_PORT_MISMATCH");
}

for (const [name, value] of [
  ["npc-tank-adapter", adapter],
  ["npc-tank-runtime", runtime],
]) {
  const rendered = JSON.stringify(value);
  if (/internal-tls|private-ca|\.crt|\.pem|mqtt-password/i.test(rendered)) {
    fail(`TRANSPORT_TRUST_MOUNT_FORBIDDEN_${safe(name)}`);
  }
}

for (const name of ["pms-postgres", "npc-adapter-postgres", "npc-runtime-postgres"]) {
  const database = service(name);
  if (Array.isArray(database.ports) && database.ports.length > 0) {
    fail(`DATABASE_HOST_PORT_FORBIDDEN_${safe(name)}`);
  }
}

process.stdout.write("NPC_PRODUCTION_COMPOSE_POLICY_PASS\n");

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
    "NPC_TANK_MQTT_USERNAME",
    "NPC_TANK_MQTT_PASSWORD_FILE",
    "NPC_TANK_DEVICE_MCP_HEADERS_FILE",
    "NPC_TANK_MQTT_TLS_CA_PATH",
    "NPC_TANK_MQTT_TLS_CERT_PATH",
    "NPC_TANK_MQTT_TLS_KEY_PATH",
    "PROVIDER_TELEMETRY_TLS_CA_PATH",
    "PROVIDER_TELEMETRY_TLS_CERT_PATH",
    "PROVIDER_TELEMETRY_TLS_KEY_PATH",
    "OTEL_EXPORTER_OTLP_CA_PATH",
    "OTEL_EXPORTER_OTLP_CERT_PATH",
    "OTEL_EXPORTER_OTLP_KEY_PATH",
    "OTEL_EXPORTER_OTLP_HEADERS_FILE",
  ]) {
    if (value[key] !== undefined) fail(`${label}_TRANSPORT_TRUST_FORBIDDEN_${key}`);
  }
}

function assertOtlpConfiguration(value, label) {
  if (value.OTEL_ENABLED !== "true" && value.OTEL_ENABLED !== "false") {
    fail(`${label}_OTEL_ENABLED_INVALID`);
  }
  if (!/^[0-9]+$/.test(value.OTEL_EXPORTER_OTLP_TIMEOUT_MS ?? "")) {
    fail(`${label}_OTEL_TIMEOUT_INVALID`);
  }
  const timeout = Number(value.OTEL_EXPORTER_OTLP_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 60_000) {
    fail(`${label}_OTEL_TIMEOUT_INVALID`);
  }
  const endpoint = value.OTEL_EXPORTER_OTLP_ENDPOINT;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    fail(`${label}_OTEL_ENDPOINT_INVALID`);
  }
  if (
    url.protocol !== "http:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    /\/v1\/(?:traces|logs|metrics)\/?$/u.test(url.pathname)
  ) {
    fail(`${label}_OTEL_ENDPOINT_INVALID`);
  }
  if (
    value.OTEL_ENABLED === "true" &&
    (/REPLACE|mock|invalid/i.test(url.hostname) ||
      ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(url.hostname))
  ) {
    fail(`${label}_OTEL_ENDPOINT_UNCONFIGURED`);
  }
}

function absoluteSecretPath(value) {
  return typeof value === "string" && value.startsWith("/") && !/[\0\r\n]/.test(value);
}

function safe(value) {
  return value.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_");
}

function fail(code) {
  process.stderr.write(`BLOCKED_CONFIGURATION:${code}\n`);
  process.exit(2);
}
