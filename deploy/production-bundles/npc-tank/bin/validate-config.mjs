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
if (pmsWorker.network_mode !== "service:pms-api") fail("PMS_WORKER_NETWORK_AUTHORITY_INVALID");
if (environment(pmsWorker).PMS_WORKSPACE_ROOT !== "/app") fail("PMS_WORKER_ROOT_INVALID");
if (environment(seed).PMS_SEED_ADAPTER_ENDPOINT !== "npc-tank-adapter:7013") {
  fail("PMS_SEED_ADAPTER_ENDPOINT_INVALID");
}
if (environment(seed).PMS_SEED_CATALOG_ROOT !== "/app") {
  fail("PMS_SEED_CATALOG_ROOT_INVALID");
}
if (!Array.isArray(seed.profiles) || !seed.profiles.includes("seed")) {
  fail("PMS_SEED_PROFILE_REQUIRED");
}

const webEnvironment = environment(pmsWeb);
if (
  webEnvironment.PMS_WEB_DATA_MODE !== "api" ||
  webEnvironment.PMS_WEB_API_BASE !== "/api/console/v1" ||
  webEnvironment.PMS_WEB_API_UPSTREAM !== "http://pms-api:8090"
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
  AUTH_MODE: "jwt_hs256",
  MCP_LEGACY_ENDPOINT_ENABLED: "false",
  BUSINESS_EVENTS_ENABLED: "true",
  BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY: "true",
  PROVIDER_TELEMETRY_INGRESS_ENABLED: "true",
  PROVIDER_TELEMETRY_TLS_MODE: "disabled",
  ALLOW_WEAK_LEASE_CONFIGURATION: "false",
  INTERNAL_ENDPOINTS_ENABLED: "false",
});
if (!absoluteSecretPath(runtimeEnvironment.DATABASE_URL_FILE)) {
  fail("RUNTIME_SECRET_PATH_INVALID_DATABASE_URL_FILE");
}
assertTransportTrustAbsent(runtimeEnvironment, "RUNTIME");
for (const forbidden of [
  "PMS_RUNTIME_CONFIG_URL",
  "PMS_RUNTIME_CONFIG_TOKEN_FILE",
  "PMS_RUNTIME_REGISTRATION_URL",
  "PMS_RUNTIME_REGISTRATION_TOKEN_FILE",
]) {
  if (runtimeEnvironment[forbidden] !== undefined)
    fail(`DIRECT_RUNTIME_PMS_BOOTSTRAP_FORBIDDEN_${forbidden}`);
}
assertPublishedPort(runtime, 8080, "NPC_RUNTIME");

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
  ]) {
    if (value[key] !== undefined) fail(`${label}_TRANSPORT_TRUST_FORBIDDEN_${key}`);
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
