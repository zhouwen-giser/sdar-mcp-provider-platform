import { readFileSync } from "node:fs";

const { profile, composeJson } = parseArguments(process.argv.slice(2));
if (profile !== "mock" && profile !== "external") fail("UGV_TEMPLATE_PROFILE_INVALID");

let document;
try {
  document = JSON.parse(readFileSync(composeJson, "utf8"));
} catch {
  fail("UGV_TEMPLATE_COMPOSE_JSON_INVALID");
}
const services = record(document.services, "UGV_TEMPLATE_SERVICES_INVALID");
const expected =
  profile === "mock"
    ? new Set([
        "mock-mqtt",
        "mock-ugv-device-mcp",
        "mock-ugv-mqtt-publisher",
        "ugv-adapter",
        "ugv-adapter-postgres",
        "ugv-runtime",
        "ugv-runtime-postgres",
      ])
    : new Set(["ugv-adapter", "ugv-adapter-postgres", "ugv-runtime", "ugv-runtime-postgres"]);
const actual = new Set(Object.keys(services));
if (actual.size !== expected.size || [...expected].some((name) => !actual.has(name)))
  fail("UGV_TEMPLATE_PROFILE_SERVICE_SET_INVALID");

const adapter = record(services["ugv-adapter"], "UGV_TEMPLATE_ADAPTER_MISSING");
const runtime = record(services["ugv-runtime"], "UGV_TEMPLATE_RUNTIME_MISSING");
const adapterEnv = record(adapter.environment, "UGV_TEMPLATE_ADAPTER_ENVIRONMENT_INVALID");
const runtimeEnv = record(runtime.environment, "UGV_TEMPLATE_RUNTIME_ENVIRONMENT_INVALID");

const deviceUrl = endpoint(adapterEnv.UGV_DEVICE_MCP_URL, "UGV_TEMPLATE_DEVICE_MCP_URL_INVALID");
const mqttUrl = endpoint(adapterEnv.UGV_MQTT_URL, "UGV_TEMPLATE_MQTT_URL_INVALID");
if (deviceUrl.username || deviceUrl.password || mqttUrl.username || mqttUrl.password)
  fail("UGV_TEMPLATE_ENDPOINT_CREDENTIALS_FORBIDDEN");
if (deviceUrl.search || deviceUrl.hash || mqttUrl.search || mqttUrl.hash)
  fail("UGV_TEMPLATE_ENDPOINT_QUERY_OR_FRAGMENT_FORBIDDEN");
if (!new Set(["http:", "https:"]).has(deviceUrl.protocol))
  fail("UGV_TEMPLATE_DEVICE_MCP_SCHEME_INVALID");
if (!new Set(["mqtt:", "mqtts:", "ws:", "wss:"]).has(mqttUrl.protocol))
  fail("UGV_TEMPLATE_MQTT_SCHEME_INVALID");

if (adapterEnv.UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT !== "false")
  fail("UGV_TEMPLATE_MOCK_FALLBACK_FORBIDDEN");
if (adapterEnv.UGV_FIRE_ENABLED !== "false") fail("UGV_TEMPLATE_FIRE_MUST_BE_DISABLED");
if (adapterEnv.UGV_ADAPTER_STORE_MODE !== "postgres") fail("UGV_TEMPLATE_POSTGRES_STORE_REQUIRED");
if (adapterEnv.ADAPTER_TLS_MODE !== "disabled" || runtimeEnv.ADAPTER_TLS_MODE !== "disabled")
  fail("UGV_TEMPLATE_DEVELOPMENT_TLS_MODE_INVALID");
if (runtimeEnv.AUTH_MODE !== "development" || runtimeEnv.RUNTIME_ENV !== "development")
  fail("UGV_TEMPLATE_RUNTIME_DEVELOPMENT_PROFILE_REQUIRED");
if (runtimeEnv.ADAPTER_ENDPOINT !== "ugv-adapter:7010")
  fail("UGV_TEMPLATE_ADAPTER_ENDPOINT_INVALID");
if (!String(adapterEnv.UGV_ADAPTER_DATABASE_URL).includes("@ugv-adapter-postgres:5432/"))
  fail("UGV_TEMPLATE_ADAPTER_DATABASE_BOUNDARY_INVALID");
if (!String(runtimeEnv.DATABASE_URL).includes("@ugv-runtime-postgres:5432/"))
  fail("UGV_TEMPLATE_RUNTIME_DATABASE_BOUNDARY_INVALID");

if (profile === "mock") {
  if (adapterEnv.UGV_EXECUTION_MODE !== "simulation")
    fail("UGV_TEMPLATE_MOCK_EXECUTION_MODE_INVALID");
  if (deviceUrl.hostname !== "mock-ugv-device-mcp" || mqttUrl.hostname !== "mock-mqtt")
    fail("UGV_TEMPLATE_MOCK_ENDPOINTS_INVALID");
} else {
  if (adapterEnv.UGV_EXECUTION_MODE !== "live") fail("UGV_TEMPLATE_EXTERNAL_LIVE_MODE_REQUIRED");
  if (
    deviceUrl.hostname === "mock-ugv-device-mcp" ||
    mqttUrl.hostname === "mock-mqtt" ||
    /(^|[.-])mock([.-]|$)/i.test(deviceUrl.hostname) ||
    /(^|[.-])mock([.-]|$)/i.test(mqttUrl.hostname)
  )
    fail("UGV_TEMPLATE_EXTERNAL_MOCK_ENDPOINT_FORBIDDEN");
}

process.stdout.write(`UGV_TEMPLATE_COMPOSE_VALID: profile=${profile}\n`);

function parseArguments(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index];
    if (name !== "--profile" && name !== "--compose-json") fail("UGV_TEMPLATE_ARGUMENT_INVALID");
    const value = values[++index];
    if (!value) fail("UGV_TEMPLATE_ARGUMENT_VALUE_REQUIRED");
    parsed[name.slice(2)] = value;
  }
  if (typeof parsed.profile !== "string" || typeof parsed["compose-json"] !== "string")
    fail("UGV_TEMPLATE_ARGUMENT_REQUIRED");
  return { profile: parsed.profile, composeJson: parsed["compose-json"] };
}

function record(value, code) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}

function endpoint(value, code) {
  if (typeof value !== "string") fail(code);
  try {
    return new URL(value);
  } catch {
    fail(code);
  }
}

function fail(code) {
  process.stderr.write(`${code}\n`);
  process.exit(2);
}
