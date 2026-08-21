import { readFileSync } from "node:fs";

const PROFILE = "ugv-agent-profile-simulation";
const EXPECTED_PROFILE_SERVICES = [
  "ugv-agent-profile-adapter",
  "ugv-agent-profile-adapter-postgres",
  "ugv-agent-profile-runtime",
  "ugv-agent-profile-runtime-postgres",
];
const FORBIDDEN_LOCAL_SERVICES = [
  "mock-ugv-device-mcp",
  "mock-ugv-mqtt-publisher",
  "mqtt-ugv-test",
];
const START_TARGETS = new Set(EXPECTED_PROFILE_SERVICES);

const composePath = parseArguments(process.argv.slice(2));
let document;
try {
  document = JSON.parse(readFileSync(composePath, "utf8"));
} catch {
  fail("UAP_COMPOSE_JSON_INVALID");
}

const services = record(document.services, "UAP_COMPOSE_SERVICES_INVALID");
const profileServices = Object.entries(services)
  .filter(([, value]) =>
    array(record(value, "UAP_COMPOSE_SERVICE_INVALID").profiles).includes(PROFILE),
  )
  .map(([name]) => name)
  .sort();
if (canonical(profileServices) !== canonical([...EXPECTED_PROFILE_SERVICES].sort()))
  fail("UAP_PROFILE_SERVICE_SET_INVALID");

for (const name of EXPECTED_PROFILE_SERVICES) {
  const service = record(services[name], `UAP_SERVICE_MISSING:${name}`);
  if (canonical(array(service.profiles)) !== canonical([PROFILE]))
    fail(`UAP_SERVICE_PROFILE_INVALID:${name}`);
  const networks = Object.keys(record(service.networks, `UAP_SERVICE_NETWORK_INVALID:${name}`));
  if (canonical(networks) !== canonical([PROFILE])) fail(`UAP_SERVICE_NETWORK_INVALID:${name}`);
  if (!array(service.security_opt).includes("no-new-privileges:true"))
    fail(`UAP_NO_NEW_PRIVILEGES_REQUIRED:${name}`);
}

const closure = dependencyClosure(services, START_TARGETS);
if (canonical([...closure].sort()) !== canonical([...START_TARGETS].sort()))
  fail("UAP_SELECTED_SERVICE_CLOSURE_INVALID");
for (const forbidden of FORBIDDEN_LOCAL_SERVICES)
  if (closure.has(forbidden)) fail(`UAP_LOCAL_MOCK_IN_SELECTED_CLOSURE:${forbidden}`);
for (const base of ["postgres", "adapter-typescript", "runtime"])
  if (closure.has(base)) fail(`UAP_ROOT_DEFAULT_IN_SELECTED_CLOSURE:${base}`);

const adapter = service(services, "ugv-agent-profile-adapter");
const runtime = service(services, "ugv-agent-profile-runtime");
const adapterEnvironment = environment(adapter, "UAP_ADAPTER_ENVIRONMENT_INVALID");
const runtimeEnvironment = environment(runtime, "UAP_RUNTIME_ENVIRONMENT_INVALID");

expectEnvironment(
  adapterEnvironment,
  {
    RUNTIME_ENV: "test",
    ALLOW_INSECURE_INTERNAL_TRANSPORT: "true",
    PROVIDER_ID: "isr.vehicle.ugv.ugv1",
    PROVIDER_VERSION: "1.0.0",
    UGV_RESOURCE_ID: "vehicle:ugv1",
    UGV_ENTITY_ID: "ugv1",
    UGV_VEHICLE_TYPE: "ugv",
    UGV_EXECUTION_MODE: "simulation",
    UGV_FIRE_ENABLED: "false",
    UGV_ALLOW_NAVIGATION_WITH_RECON: "false",
    UGV_ADAPTER_STORE_MODE: "postgres",
    UGV_DEVICE_MCP_URL: "http://192.168.2.63:19000/mcp",
    UGV_DEVICE_MCP_TLS_MODE: "disabled",
    UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT: "false",
    UGV_MQTT_URL: "mqtt://192.168.2.63:1883",
    UGV_MQTT_TLS_MODE: "disabled",
    UGV_MQTT_SESSION_MODE: "persistent",
    UGV_MQTT_WIRE_MODE: "ros_bridge_json",
    UGV_CHASSIS_FRESHNESS_MS: "3000",
    UGV_MISSION_FRESHNESS_MS: "3000",
    UGV_HEALTH_FRESHNESS_MS: "5000",
    UGV_TARGET_FRESHNESS_MS: "3000",
    UGV_PAYLOAD_FRESHNESS_MS: "3000",
    UGV_OBSERVATION_MAX_FUTURE_SKEW_MS: "1000",
    UGV_STATIONARY_SPEED_THRESHOLD_KMH: "0.1",
    UGV_STATIONARY_STABILITY_MS: "500",
    UGV_STATIONARY_MIN_SAMPLES: "2",
    PROVIDER_TELEMETRY_ENABLED: "true",
    PROVIDER_TELEMETRY_ENDPOINT: "ugv-agent-profile-runtime:7002",
    PROVIDER_TELEMETRY_TLS_MODE: "disabled",
  },
  "UAP_ADAPTER_CONFIGURATION_DRIFT",
);
expectEnvironment(
  runtimeEnvironment,
  {
    RUNTIME_ENV: "test",
    ALLOW_INSECURE_INTERNAL_TRANSPORT: "true",
    PROVIDER_ID: "isr.vehicle.ugv.ugv1",
    ADAPTER_ENDPOINT: "ugv-agent-profile-adapter:7010",
    ADAPTER_TLS_MODE: "disabled",
    AUTH_MODE: "development",
    MCP_LEGACY_ENDPOINT_ENABLED: "false",
    INTERNAL_ENDPOINTS_ENABLED: "false",
    BUSINESS_EVENTS_ENABLED: "true",
    BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY: "true",
    PROVIDER_TELEMETRY_INGRESS_ENABLED: "true",
    PROVIDER_TELEMETRY_TLS_MODE: "disabled",
  },
  "UAP_RUNTIME_CONFIGURATION_DRIFT",
);

if (
  adapterEnvironment.UGV_ADAPTER_DATABASE_URL !==
  "postgresql://ugv_profile_adapter@ugv-agent-profile-adapter-postgres:5432/ugv_profile_adapter"
)
  fail("UAP_ADAPTER_DATABASE_BOUNDARY_INVALID");
if (
  runtimeEnvironment.DATABASE_URL !==
  "postgresql://ugv_profile_runtime@ugv-agent-profile-runtime-postgres:5432/ugv_profile_runtime"
)
  fail("UAP_RUNTIME_DATABASE_BOUNDARY_INVALID");

for (const [name, value] of [
  ["UGV_DEVICE_MCP_URL", adapterEnvironment.UGV_DEVICE_MCP_URL],
  ["UGV_MQTT_URL", adapterEnvironment.UGV_MQTT_URL],
]) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    fail(`UAP_ENDPOINT_INVALID:${name}`);
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    fail(`UAP_ENDPOINT_SECRET_OR_DECORATION_FORBIDDEN:${name}`);
}

for (const [serviceName, serviceValue] of Object.entries(
  Object.fromEntries(EXPECTED_PROFILE_SERVICES.map((name) => [name, service(services, name)])),
)) {
  const values = environment(serviceValue, `UAP_SERVICE_ENVIRONMENT_INVALID:${serviceName}`);
  for (const key of Object.keys(values)) {
    if (/PASSWORD|TOKEN|SECRET|AUTHORIZATION/iu.test(key))
      fail(`UAP_INLINE_SECRET_KEY_FORBIDDEN:${serviceName}:${key}`);
    if (/REMOTE_COMMAND|SHELL_(?:ACCESS|ADMIN)|EXEC_ADMIN/iu.test(key))
      fail(`UAP_REMOTE_ADMIN_CONFIGURATION_FORBIDDEN:${serviceName}:${key}`);
  }
}

expectLoopbackPort(adapter, 7010, "17021", "UAP_ADAPTER_PORT_INVALID");
expectLoopbackPort(runtime, 8080, "19121", "UAP_RUNTIME_PORT_INVALID");
if (adapter.read_only !== true || runtime.read_only !== true)
  fail("UAP_APPLICATION_READ_ONLY_FS_REQUIRED");
if (!array(adapter.cap_drop).includes("ALL") || !array(runtime.cap_drop).includes("ALL"))
  fail("UAP_APPLICATION_CAP_DROP_REQUIRED");

const volumes = record(document.volumes, "UAP_VOLUMES_INVALID");
for (const name of [
  "ugv-agent-profile-adapter-postgres-data",
  "ugv-agent-profile-runtime-postgres-data",
  "ugv-agent-profile-adapter-state",
]) {
  if (volumes[name] === undefined) fail(`UAP_VOLUME_MISSING:${name}`);
  const renderedName = record(volumes[name], `UAP_VOLUME_INVALID:${name}`).name;
  if (renderedName !== `sdar-ugv-agent-profile-simulation_${name}`)
    fail(`UAP_VOLUME_PROJECT_SCOPE_INVALID:${name}`);
}

process.stdout.write(
  `UAP_COMPOSE_PROFILE_VALID: services=${EXPECTED_PROFILE_SERVICES.length} mocks=0 rootDefaults=0\n`,
);

function parseArguments(values) {
  if (values.length !== 2 || values[0] !== "--compose-json" || !values[1])
    fail("UAP_ARGUMENT_INVALID");
  return values[1];
}

function dependencyClosure(allServices, roots) {
  const result = new Set();
  const pending = [...roots];
  while (pending.length > 0) {
    const name = pending.pop();
    if (result.has(name)) continue;
    const current = service(allServices, name);
    result.add(name);
    for (const dependency of Object.keys(
      record(current.depends_on ?? {}, "UAP_DEPENDS_ON_INVALID"),
    ))
      pending.push(dependency);
  }
  return result;
}

function expectEnvironment(actual, expected, code) {
  for (const [key, value] of Object.entries(expected))
    if (actual[key] !== value) fail(`${code}:${key}`);
}

function expectLoopbackPort(value, target, published, code) {
  const matches = array(value.ports).filter(
    (port) => record(port, code).target === target && record(port, code).published === published,
  );
  if (matches.length !== 1 || record(matches[0], code).host_ip !== "127.0.0.1") fail(code);
}

function service(services, name) {
  return record(services[name], `UAP_SERVICE_MISSING:${name}`);
}

function environment(value, code) {
  return record(value.environment, code);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function record(value, code) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}

function canonical(value) {
  return JSON.stringify(value);
}

function fail(code) {
  process.stderr.write(`${code}\n`);
  process.exit(2);
}
